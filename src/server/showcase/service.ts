import { createHash, randomUUID } from 'node:crypto';
import { AppError, ERROR_CODES, ensure } from '../../shared/error-core.ts';
import type {
  CreateWorkPublicationInput,
  CreationRunPort,
  PublicationActor,
  PublicationFileRef,
  PublishedWorkPublicationSource,
  PublicWorkPublication,
  ReviewWorkPublicationInput,
  SealedBundleSource,
  ShowcaseAuditEvent,
  ShowcaseRepository,
  WorkPublication,
  WorkPublicationDecision,
  WorkPublicationServiceOptions,
} from './contracts.ts';
import { CreationRunPublicationSeam } from './creation-run.ts';

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function actorId(actor: PublicationActor | string | null | undefined): string {
  const id = typeof actor === 'string' ? actor : actor?.id ?? actor?.userId;
  ensure(typeof id === 'string' && id.trim().length > 0, 'Authentication is required.', 401, ERROR_CODES.AUTH_REQUIRED);
  return id;
}

function text(value: unknown, field: string, maxLength: number): string {
  ensure(typeof value === 'string' && value.trim().length > 0, `${field} is required.`, 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
  ensure(value.length <= maxLength, `${field} is too long.`, 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
  return value;
}

function digest(value: unknown): string {
  const normalize = (current: unknown): unknown => {
    if (Array.isArray(current)) return current.map(normalize);
    if (!record(current)) return current;
    return Object.fromEntries(Object.keys(current).sort().map((key) => [key, normalize(current[key])]));
  };
  return `sha256:${createHash('sha256').update(JSON.stringify(normalize(value))).digest('hex')}`;
}

function safePath(value: unknown, field: string): string {
  const path = text(value, field, 512).replaceAll('\\', '/');
  ensure(!path.startsWith('/') && !path.split('/').includes('..'), `${field} must be a relative path.`, 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
  ensure(path !== '.' && path.length > 0, `${field} must not be empty.`, 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
  return path;
}

function notFound(message: string): never {
  throw new AppError(message, 404, ERROR_CODES.RESOURCE_NOT_FOUND);
}

function conflict(message: string): never {
  throw new AppError(message, 409, ERROR_CODES.CONCURRENT_SAVE);
}

function publicFiles(bundle: SealedBundleSource, input: CreateWorkPublicationInput): PublicationFileRef[] {
  ensure(bundle.status === 'sealed', 'Only sealed artifact bundles can be published.', 409, ERROR_CODES.EVALUATION_NOT_READY);
  ensure(bundle.executionStatus === 'completed', 'Only completed creation output can be published.', 409, ERROR_CODES.EVALUATION_NOT_READY);
  ensure(bundle.attemptFence.trim().length > 0, 'The artifact bundle is missing its attempt fence.', 409, ERROR_CODES.RUNTIME_POLICY_DENIED);
  ensure(bundle.artifacts.length > 0, 'The artifact bundle has no publishable files.', 409, ERROR_CODES.RUNTIME_POLICY_DENIED);
  ensure(Array.isArray(input.publicArtifactIds) && input.publicArtifactIds.length > 0, 'At least one public artifact is required.', 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
  const ids = new Set(input.publicArtifactIds);
  ensure(ids.size === input.publicArtifactIds.length, 'Public artifacts must be unique.', 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
  const selected = bundle.artifacts.filter((artifact) => ids.has(artifact.artifactId));
  ensure(selected.length === ids.size, 'Every public artifact must belong to the sealed bundle.', 409, ERROR_CODES.RUNTIME_POLICY_DENIED);
  ensure(selected.every((artifact) => artifact.classification === 'public'), 'Private or hidden artifacts cannot be published.', 403, ERROR_CODES.ACCESS_FORBIDDEN);
  return selected.map((artifact) => ({
    artifactId: artifact.artifactId,
    relativePath: safePath(artifact.relativePath, 'artifact path'),
    mediaType: text(artifact.mediaType, 'artifact media type', 200),
    previewKind: artifact.previewKind,
    sizeBytes: artifact.sizeBytes,
    sha256: artifact.sha256,
  })).sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function publicProjection(publication: WorkPublication): PublicWorkPublication {
  return {
    publicationId: publication.id,
    title: publication.title,
    description: publication.description,
    entryPath: publication.entryPath,
    releaseDigest: publication.releaseDigest,
    files: publication.files.map(({ relativePath, mediaType, previewKind, sizeBytes, sha256 }) => ({
      relativePath,
      mediaType,
      previewKind,
      sizeBytes,
      sha256,
    })),
    createdAt: publication.createdAt,
  };
}

function reviewRoleAllowed(
  roles: ReadonlySet<'reviewer' | 'admin'> | readonly ('reviewer' | 'admin')[] | undefined,
  decision: ReviewWorkPublicationInput['decision'],
): boolean {
  if (!roles) return false;
  const set = roles instanceof Set ? roles : new Set(roles);
  return set.has('admin') || (decision !== 'take-down' && set.has('reviewer'));
}

export class WorkPublicationService {
  private readonly repo: ShowcaseRepository;
  private readonly now: () => string;
  private readonly id: () => string;
  private readonly resolveRoles?: WorkPublicationServiceOptions['resolveRoles'];
  private readonly creationRuns?: CreationRunPublicationSeam;

  constructor(
    repo: ShowcaseRepository,
    options: WorkPublicationServiceOptions = {},
    creationRuns?: CreationRunPort,
  ) {
    this.repo = repo;
    this.now = options.now ?? (() => new Date().toISOString());
    this.id = options.id ?? randomUUID;
    this.resolveRoles = options.resolveRoles;
    this.creationRuns = creationRuns ? new CreationRunPublicationSeam(creationRuns) : undefined;
  }

  async requestPublication(actor: PublicationActor | string | null | undefined, input: CreateWorkPublicationInput): Promise<WorkPublication> {
    const ownerId = actorId(actor);
    ensure(!input.bundleId || typeof input.bundleId === 'string', 'bundleId must be a string.', 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
    ensure(!input.creationRunId || typeof input.creationRunId === 'string', 'creationRunId must be a string.', 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
    ensure(Boolean(input.bundleId) !== Boolean(input.creationRunId), 'Provide exactly one source: bundleId or creationRunId.', 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
    const bundleId = input.bundleId ?? '';
    const title = text(input.title, 'title', 160);
    const description = text(input.description, 'description', 2_000);
    const entryPath = safePath(input.entryPath, 'entryPath');
    const expectedSnapshotDigest = text(input.expectedSnapshotDigest, 'expectedSnapshotDigest', 200);
    const expectedManifestDigest = text(input.expectedManifestDigest, 'expectedManifestDigest', 200);
    const resolvedBundleId = input.creationRunId ? undefined : bundleId;
    let bundle: SealedBundleSource | null = null;
    if (input.creationRunId) {
      ensure(this.creationRuns, 'CreationRun publication integration is not configured.', 503, ERROR_CODES.RUNTIME_UNAVAILABLE);
      const run = await this.creationRuns.requireCompletedRun(ownerId, input.creationRunId);
      bundle = await this.repo.getSealedBundle(run.artifactBundleId ?? '', ownerId);
    } else {
      bundle = await this.repo.getSealedBundle(resolvedBundleId ?? '', ownerId);
    }
    if (!bundle) notFound('Artifact bundle not found.');
    ensure(bundle.ownerId === ownerId, 'You do not own this artifact bundle.', 403, ERROR_CODES.OWNERSHIP_FORBIDDEN);
    ensure(bundle.snapshotDigest === expectedSnapshotDigest, 'The artifact bundle snapshot changed.', 409, ERROR_CODES.CONCURRENT_SAVE);
    ensure(bundle.manifestDigest === expectedManifestDigest, 'The artifact bundle manifest changed.', 409, ERROR_CODES.CONCURRENT_SAVE);
    const files = publicFiles(bundle, input);
    ensure(files.some((file) => file.relativePath === entryPath), 'entryPath must identify a selected public artifact.', 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
    const now = this.now();
    const publication: WorkPublication = {
      id: this.id(),
      ownerId,
      sourceBundleId: bundle.id,
      sourceSnapshotDigest: bundle.snapshotDigest,
      sourceManifestDigest: bundle.manifestDigest,
      sourceAttemptFence: bundle.attemptFence,
      releaseDigest: digest({
        bundleId: bundle.id,
        snapshotDigest: bundle.snapshotDigest,
        manifestDigest: bundle.manifestDigest,
        attemptFence: bundle.attemptFence,
        title,
        description,
        entryPath,
        files,
      }),
      title,
      description,
      entryPath,
      files: clone(files),
      status: 'pending',
      revision: 1,
      createdAt: now,
      updatedAt: now,
      reviewedAt: null,
      withdrawnAt: null,
    };
    const audit: ShowcaseAuditEvent = {
      id: this.id(),
      action: 'work-publication.requested',
      actorId: ownerId,
      publicationId: publication.id,
      occurredAt: now,
      metadata: { status: publication.status, fileCount: files.length, releaseDigest: publication.releaseDigest },
    };
    await this.repo.transaction(async (tx) => {
      await tx.insertWorkPublication(publication);
      await tx.appendAuditEvent(audit);
    });
    return clone(publication);
  }

  async reviewPublication(actor: PublicationActor | string | null | undefined, input: ReviewWorkPublicationInput): Promise<WorkPublicationDecision> {
    const reviewerId = actorId(actor);
    const roles = await this.resolveRoles?.(reviewerId);
    ensure(reviewRoleAllowed(roles, input.decision), 'A reviewer role is required for this action.', 403, ERROR_CODES.ACCESS_FORBIDDEN);
    const publication = await this.repo.getWorkPublication(input.publicationId);
    if (!publication) notFound('Work publication not found.');
    ensure(publication.status === input.expectedStatus && publication.revision === input.expectedRevision, 'The publication changed before review.', 409, ERROR_CODES.CONCURRENT_SAVE);
    if (input.decision === 'approve') ensure(publication.status === 'pending', 'Only pending publications can be approved.', 409, ERROR_CODES.RUNTIME_POLICY_DENIED);
    if (input.decision === 'reject') ensure(publication.status === 'pending', 'Only pending publications can be rejected.', 409, ERROR_CODES.RUNTIME_POLICY_DENIED);
    if (input.decision === 'take-down') ensure(publication.status === 'published', 'Only published publications can be taken down.', 409, ERROR_CODES.RUNTIME_POLICY_DENIED);
    const reason = text(input.reason, 'reason', 2_000);
    const nextStatus = input.decision === 'approve' ? 'published' : input.decision === 'reject' ? 'rejected' : 'taken-down';
    const now = this.now();
    const updated = await this.repo.transaction(async (tx) => {
      const next = await tx.updateWorkPublication(publication.id, input.expectedRevision, {
        status: nextStatus,
        revision: input.expectedRevision + 1,
        updatedAt: now,
        reviewedAt: now,
        withdrawnAt: input.decision === 'take-down' ? now : publication.withdrawnAt,
      });
      if (!next) conflict('The publication changed before review could be saved.');
      const audit: ShowcaseAuditEvent = {
        id: this.id(),
        action: 'work-publication.reviewed',
        actorId: reviewerId,
        publicationId: publication.id,
        occurredAt: now,
        metadata: { fromStatus: publication.status, toStatus: nextStatus, reason },
      };
      await tx.appendAuditEvent(audit);
      return { publication: next, audit };
    });
    return { publication: clone(updated.publication), audit: clone(updated.audit) };
  }

  async withdrawPublication(actor: PublicationActor | string | null | undefined, publicationId: string, expectedRevision: number): Promise<WorkPublicationDecision> {
    const ownerId = actorId(actor);
    const publication = await this.repo.getWorkPublication(publicationId);
    if (!publication) notFound('Work publication not found.');
    ensure(publication.ownerId === ownerId, 'You do not own this publication.', 403, ERROR_CODES.OWNERSHIP_FORBIDDEN);
    ensure(publication.status === 'pending' || publication.status === 'published', 'This publication cannot be withdrawn.', 409, ERROR_CODES.RUNTIME_POLICY_DENIED);
    ensure(publication.revision === expectedRevision, 'The publication changed before withdrawal.', 409, ERROR_CODES.CONCURRENT_SAVE);
    const now = this.now();
    const updated = await this.repo.transaction(async (tx) => {
      const next = await tx.updateWorkPublication(publication.id, expectedRevision, {
        status: 'withdrawn', revision: expectedRevision + 1, updatedAt: now, withdrawnAt: now,
      });
      if (!next) conflict('The publication changed before withdrawal could be saved.');
      const audit: ShowcaseAuditEvent = {
        id: this.id(),
        action: 'work-publication.withdrawn',
        actorId: ownerId,
        publicationId: publication.id,
        occurredAt: now,
        metadata: { fromStatus: publication.status },
      };
      await tx.appendAuditEvent(audit);
      return { publication: next, audit };
    });
    return { publication: clone(updated.publication), audit: clone(updated.audit) };
  }

  async getOwnerPublication(actor: PublicationActor | string | null | undefined, publicationId: string): Promise<WorkPublication> {
    const ownerId = actorId(actor);
    const publication = await this.repo.getWorkPublication(publicationId);
    if (!publication) notFound('Work publication not found.');
    ensure(publication.ownerId === ownerId, 'You do not own this publication.', 403, ERROR_CODES.OWNERSHIP_FORBIDDEN);
    return clone(publication);
  }


  async resolvePublishedArtifact(publicationId: string, relativePath: string): Promise<{ ownerId: string; artifactId: string }> {
    const publication = await this.repo.getWorkPublication(publicationId);
    if (!publication || publication.status !== 'published') notFound('Published work not found.');
    const path = safePath(relativePath, 'relativePath');
    const file = publication.files.find((candidate) => candidate.relativePath === path);
    if (!file) notFound('Published artifact not found.');
    return { ownerId: publication.ownerId, artifactId: file.artifactId };
  }

  async resolvePublishedPublication(publicationId: string): Promise<PublishedWorkPublicationSource> {
    const publication = await this.repo.getWorkPublication(publicationId);
    if (!publication || publication.status !== 'published') notFound('Published work not found.');
    return { ownerId: publication.ownerId, publication: clone(publicProjection(publication)) };
  }

  async getPublicPublication(publicationId: string): Promise<PublicWorkPublication> {
    return (await this.resolvePublishedPublication(publicationId)).publication;
  }
}
