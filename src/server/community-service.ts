import { createHash, randomUUID } from 'node:crypto';
import type {
  Attachment,
  Component,
  ComponentVersion,
  PublicationRequest,
  PublicationReview,
  ComponentRelease,
  ComponentKind,
  PublicationRequestStatus,
  PublicationReviewDecision,
  Repository,
  CommunityAuditEventRow,
} from '../shared/types.ts';
import { AppError, ERROR_CODES, ensure } from '../shared/error-core.ts';
import {
  parseCommunityDefinition,
  projectPublicComponent,
  type CommunityAttachmentManifest,
  type CommunityComponentDefinition,
} from '../lib/community/contracts.ts';

const DEFAULT_LICENSE_ALLOWLIST = Object.freeze([
  'MIT',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
]);

export type CommunityRole = 'reviewer' | 'admin';

export interface CommunityActor {
  id?: string;
  userId?: string;
}

export interface CommunityAuditEvent {
  id: string;
  action:
    | 'component.created'
    | 'component.draft.updated'
    | 'component.version.frozen'
    | 'publication.requested'
    | 'publication.reviewed';
  actorId: string;
  componentId: string;
  componentVersionId?: string;
  publicationRequestId?: string;
  occurredAt: string;
  metadata: Readonly<Record<string, string | number | boolean | null>>;
}

export interface CommunityAuditWriter {
  write(event: CommunityAuditEvent): Promise<void>;
}

export interface CommunityServiceOptions {
  now?: () => string;
  id?: () => string;
  resolveRoles?: (actorId: string) => Promise<ReadonlySet<CommunityRole> | readonly CommunityRole[]>;
  resolveRole?: (actorId: string) => Promise<CommunityRole | null>;
  auditWriter?: CommunityAuditWriter;
  /** Retained for source compatibility; the D1 allowlist is intentionally not configurable. */
  allowedLicenses?: readonly string[];
}

export interface CreateDraftInput {
  definition: unknown;
}

export interface UpdateDraftInput {
  componentId: string;
  expectedRevision: number;
  definition: unknown;
}

export interface FreezeVersionInput {
  componentId: string;
  expectedRevision: number;
}

export interface PersistTextAttachmentInput {
  componentVersionId: string;
  path: string;
  content: string;
  expected?: { mediaType?: string; sizeBytes?: number; sha256?: string };
}

export interface CreatePublicationRequestInput {
  componentVersionId: string;
  publicExampleIds?: readonly string[];
  publicReferencePaths?: readonly string[];
  declaration: string;
}

export interface ReviewPublicationInput {
  publicationRequestId: string;
  expectedStatus: PublicationRequestStatus;
  expectedRevision?: number;
  decision: PublicationReviewDecision;
  reason: string;
  checks?: readonly string[];
}

export interface PublicationDecisionResult {
  request: PublicationRequest;
  review: PublicationReview;
  release: ComponentRelease | null;
}

function record(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function text(value: unknown, field: string, maxLength: number): string {
  ensure(typeof value === 'string' && value.trim().length > 0, `${field} is required.`, 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
  ensure(value.length <= maxLength, `${field} is too long.`, 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
  return value;
}

function sortedJson(value: unknown): string {
  const normalize = (current: unknown): unknown => {
    if (Array.isArray(current)) return current.map(normalize);
    if (!record(current)) return current;
    return Object.fromEntries(Object.keys(current).sort().map((key) => [key, normalize(current[key])]));
  };
  return JSON.stringify(normalize(value));
}

export function digestCommunityDefinition(value: unknown): string {
  return `sha256:${createHash('sha256').update(sortedJson(value)).digest('hex')}`;
}

function canonicalSha256(value: string): string {
  return value.replace(/^sha256:/i, '').toLowerCase();
}

function publicMaterial(
  componentId: string,
  versionId: string,
  definition: CommunityComponentDefinition,
  publicExampleIds: readonly string[],
  publicReferencePaths: readonly string[],
): unknown {
  const projection = projectPublicComponent({
    id: componentId,
    versionId,
    definition,
    status: 'active',
    publicExampleIds: [...publicExampleIds],
    publicReferencePaths: [...publicReferencePaths],
  });
  if (projection.kind === 'workflow-recipe') {
    const { status: _status, ...safeProjection } = projection;
    return safeProjection;
  }
  const { status: _status, ...safeProjection } = projection;
  return safeProjection;
}

function componentKind(definition: CommunityComponentDefinition): ComponentKind {
  return definition.kind;
}

function componentFields(definition: CommunityComponentDefinition): Pick<Component, 'name' | 'description' | 'kind'> {
  return { name: definition.name, description: definition.description, kind: componentKind(definition) };
}

function resourceNotFound(message: string): never {
  throw new AppError(message, 404, ERROR_CODES.RESOURCE_NOT_FOUND);
}

function conflict(message: string): never {
  throw new AppError(message, 409, ERROR_CODES.CONCURRENT_SAVE);
}

function attachmentConflict(message: string): never {
  throw new AppError(message, 409, ERROR_CODES.COMPONENT_VERSION_CONFLICT);
}

export class CommunityService {
  private readonly repo: Repository;
  private readonly now: () => string;
  private readonly id: () => string;
  private readonly roles?: (actorId: string) => Promise<ReadonlySet<CommunityRole> | readonly CommunityRole[]>;
  private readonly resolveRole?: (actorId: string) => Promise<CommunityRole | null>;
  private readonly auditWriter?: CommunityAuditWriter;
  private readonly allowedLicenses: ReadonlySet<string>;
  private readonly recordedEvents: CommunityAuditEvent[] = [];

  constructor(repo: Repository, options: CommunityServiceOptions = {}) {
    this.repo = repo;
    this.now = options.now ?? (() => new Date().toISOString());
    this.id = options.id ?? randomUUID;
    this.roles = options.resolveRoles;
    this.resolveRole = options.resolveRole;
    this.auditWriter = options.auditWriter;
    // D1 is a frozen policy boundary. Do not allow callers to widen or replace it.
    this.allowedLicenses = new Set(DEFAULT_LICENSE_ALLOWLIST);
  }

  /** Returns an in-process diagnostic snapshot; durable events live in the repository table. */
  auditEvents(): CommunityAuditEvent[] {
    return clone(this.recordedEvents);
  }

  async createDraft(actor: CommunityActor | string | null | undefined, input: CreateDraftInput): Promise<Component> {
    const actorId = this.requireActor(actor);
    const definition = parseCommunityDefinition(input.definition);
    const now = this.now();
    const component: Component = {
      id: this.id(),
      ownerId: actorId,
      ...componentFields(definition),
      visibility: 'private',
      draftRevision: 1,
      draftDefinition: clone(definition),
      currentVersionId: null,
      createdAt: now,
      updatedAt: now,
    };
    const event = this.event('component.created', actorId, component.id, now, {
      draftRevision: component.draftRevision,
    });
    await this.repo.transaction(async (tx) => {
      await tx.insert('components', [component]);
      await this.writeAudit(tx, event);
    });
    this.recordedEvents.push(event);
    return clone(component);
  }

  async updateDraft(actor: CommunityActor | string | null | undefined, input: UpdateDraftInput): Promise<Component> {
    const actorId = this.requireActor(actor);
    const component = await this.requireOwnedComponent(actorId, input.componentId);
    ensure(Number.isInteger(input.expectedRevision) && input.expectedRevision >= 1, 'A valid draft revision is required.', 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
    const definition = parseCommunityDefinition(input.definition);
    const fields = componentFields(definition);
    const updated: Component = {
      ...component,
      ...fields,
      draftRevision: input.expectedRevision + 1,
      draftDefinition: clone(definition),
      updatedAt: this.now(),
    };
    const event = this.event('component.draft.updated', actorId, component.id, updated.updatedAt, {
      fromRevision: input.expectedRevision,
      toRevision: updated.draftRevision,
    });
    let result: Component;
    await this.repo.transaction(async (tx) => {
      const rows = await tx.update('components', {
        id: component.id,
        ownerId: actorId,
        draftRevision: input.expectedRevision,
      }, {
        ...fields,
        draftRevision: updated.draftRevision,
        draftDefinition: updated.draftDefinition,
        updatedAt: updated.updatedAt,
      });
      if (rows.length !== 1) conflict('The component draft changed before it could be saved.');
      result = rows[0];
      await this.writeAudit(tx, event);
    });
    this.recordedEvents.push(event);
    return clone(result!);
  }

  async listComponents(actor: CommunityActor | string | null | undefined): Promise<Component[]> {
    const actorId = this.requireActor(actor);
    return clone(await this.repo.read('components', { ownerId: actorId }));
  }

  async listOwnedComponents(actor: CommunityActor | string | null | undefined): Promise<Component[]> {
    return this.listComponents(actor);
  }

  async getComponent(actor: CommunityActor | string | null | undefined, componentId: string): Promise<Component> {
    const actorId = this.requireActor(actor);
    return clone(await this.requireOwnedComponent(actorId, componentId));
  }

  async freezeVersion(actor: CommunityActor | string | null | undefined, input: FreezeVersionInput): Promise<ComponentVersion> {
    const actorId = this.requireActor(actor);
    ensure(Number.isInteger(input.expectedRevision) && input.expectedRevision >= 1, 'A valid draft revision is required.', 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
    const versionId = this.id();
    const now = this.now();
    let version: ComponentVersion;
    let completedEvent: CommunityAuditEvent;
    await this.repo.transaction(async (tx) => {
      const component = (await tx.read('components', { id: input.componentId }))[0];
      if (!component) resourceNotFound('Component not found.');
      ensure(component.ownerId === actorId, 'You do not own this component.', 403, ERROR_CODES.OWNERSHIP_FORBIDDEN);
      if (component.currentVersionId !== null) {
        const currentVersion = (await tx.read('componentVersions', { id: component.currentVersionId }))[0];
        const provenance = record(currentVersion?.provenance) ? currentVersion.provenance : null;
        if (provenance?.draftRevision === input.expectedRevision) {
          conflict('This draft revision has already been frozen.');
        }
      }
      ensure(component.draftRevision === input.expectedRevision, 'The component draft changed before it could be frozen.', 409, ERROR_CODES.CONCURRENT_SAVE);
      const definition = parseCommunityDefinition(component.draftDefinition);
      const definitionDigest = digestCommunityDefinition(definition);
      const rows = await tx.update('components', {
        id: component.id,
        ownerId: actorId,
        draftRevision: input.expectedRevision,
      }, { currentVersionId: versionId, updatedAt: now });
      if (rows.length !== 1) conflict('The component draft changed before it could be frozen.');
      const previousVersions = await tx.read('componentVersions', { componentId: component.id });
      const versionNumber = Math.max(0, ...previousVersions.map((item) => item.versionNumber)) + 1;
      version = {
        id: versionId,
        ownerId: actorId,
        componentId: component.id,
        versionNumber,
        contractVersion: definition.formatVersion,
        definition: clone(definition),
        definitionDigest,
        dependencies: clone(definition.dependencies),
        publicMaterial: {},
        licenseSpdx: definition.license,
        provenance: { ...clone(definition.provenance), draftRevision: input.expectedRevision },
        frozenAt: now,
        createdAt: now,
      };
      completedEvent = this.event('component.version.frozen', actorId, component.id, now, {
        draftRevision: input.expectedRevision,
        definitionDigest,
        versionNumber,
      });
      await tx.insert('componentVersions', [version]);
      await this.writeAudit(tx, { ...completedEvent, componentVersionId: version.id });
    });
    this.recordedEvents.push({ ...completedEvent!, componentVersionId: version!.id });
    return clone(version!);
  }

  async freezeComponentVersion(actor: CommunityActor | string | null | undefined, input: FreezeVersionInput): Promise<ComponentVersion> {
    return this.freezeVersion(actor, input);
  }

  async getComponentVersion(actor: CommunityActor | string | null | undefined, versionId: string): Promise<ComponentVersion> {
    const actorId = this.requireActor(actor);
    const version = (await this.repo.read('componentVersions', { id: versionId }))[0];
    if (!version) resourceNotFound('Component version not found.');
    ensure(version.ownerId === actorId, 'You do not own this component version.', 403, ERROR_CODES.OWNERSHIP_FORBIDDEN);
    return clone(version);
  }

  async getVersion(actor: CommunityActor | string | null | undefined, versionId: string): Promise<ComponentVersion> {
    return this.getComponentVersion(actor, versionId);
  }

  async listAttachments(actor: CommunityActor | string | null | undefined, componentVersionId: string): Promise<Attachment[]> {
    const actorId = this.requireActor(actor);
    const version = (await this.repo.read('componentVersions', { id: componentVersionId }))[0];
    if (!version) resourceNotFound('Component version not found.');
    const rows = await this.repo.read('attachments', { componentVersionId });
    const ownedRows = rows.filter((attachment) => attachment.ownerId === version.ownerId);
    if (version.ownerId === actorId) return clone(ownedRows);
    const release = (await this.repo.read('componentReleases', { componentVersionId, status: 'active' }))[0];
    ensure(release, 'This component version is not publicly accessible.', 403, ERROR_CODES.ACCESS_FORBIDDEN);
    return clone(ownedRows.filter((attachment) => attachment.visibility === 'public'));
  }

  async getAttachment(actor: CommunityActor | string | null | undefined, attachmentId: string): Promise<Attachment> {
    const actorId = this.requireActor(actor);
    const attachment = (await this.repo.read('attachments', { id: attachmentId }))[0];
    if (!attachment) resourceNotFound('Component attachment not found.');
    const version = (await this.repo.read('componentVersions', { id: attachment.componentVersionId }))[0];
    if (!version) resourceNotFound('Component version not found.');
    if (attachment.ownerId === actorId && version.ownerId === actorId) return clone(attachment);
    const release = (await this.repo.read('componentReleases', { componentVersionId: version.id, status: 'active' }))[0];
    ensure(release && attachment.visibility === 'public', 'This component attachment is not publicly accessible.', 403, ERROR_CODES.ACCESS_FORBIDDEN);
    return clone(attachment);
  }

  async persistTextAttachment(
    actor: CommunityActor | string | null | undefined,
    input: PersistTextAttachmentInput,
  ): Promise<Attachment> {
    const actorId = this.requireActor(actor);
    ensure(typeof input.path === 'string' && input.path.length > 0, 'A reference path is required.', 400, ERROR_CODES.COMPONENT_ATTACHMENT_INVALID);
    ensure(typeof input.content === 'string', 'Attachment content must be text.', 400, ERROR_CODES.COMPONENT_ATTACHMENT_INVALID);

    const sizeBytes = Buffer.byteLength(input.content, 'utf8');
    const sha256 = createHash('sha256').update(input.content, 'utf8').digest('hex');
    let result: Attachment;

    await this.repo.transaction(async (tx) => {
      const version = (await tx.read('componentVersions', { id: input.componentVersionId }))[0];
      if (!version) resourceNotFound('Component version not found.');
      ensure(version.ownerId === actorId, 'You do not own this component version.', 403, ERROR_CODES.OWNERSHIP_FORBIDDEN);

      const definition = parseCommunityDefinition(version.definition);
      ensure(definition.kind === 'instruction-skill', 'This component version has no text attachment references.', 400, ERROR_CODES.COMPONENT_ATTACHMENT_INVALID);
      const manifest = definition.references.find((reference) => reference.path === input.path);
      ensure(manifest, 'The attachment path is not declared by this component version.', 400, ERROR_CODES.COMPONENT_ATTACHMENT_INVALID);
      ensure(manifest.mediaType === 'text/plain', 'Only text/plain attachments are supported.', 400, ERROR_CODES.COMPONENT_ATTACHMENT_INVALID);
      if (input.expected) {
        if (input.expected.mediaType !== undefined) {
          ensure(typeof input.expected.mediaType === 'string' && input.expected.mediaType === manifest.mediaType, 'Attachment media type does not match its manifest.', 400, ERROR_CODES.COMPONENT_ATTACHMENT_INVALID);
        }
        if (input.expected.sizeBytes !== undefined) {
          ensure(Number.isSafeInteger(input.expected.sizeBytes) && input.expected.sizeBytes === manifest.sizeBytes, 'Attachment size does not match its manifest.', 400, ERROR_CODES.COMPONENT_ATTACHMENT_INVALID);
        }
        if (input.expected.sha256 !== undefined) {
          ensure(typeof input.expected.sha256 === 'string' && canonicalSha256(input.expected.sha256) === canonicalSha256(manifest.sha256), 'Attachment digest does not match its manifest.', 400, ERROR_CODES.COMPONENT_ATTACHMENT_INVALID);
        }
      }
      ensure(sizeBytes === manifest.sizeBytes, 'Attachment content size does not match its manifest.', 400, ERROR_CODES.COMPONENT_ATTACHMENT_INVALID);
      ensure(sha256 === canonicalSha256(manifest.sha256), 'Attachment content digest does not match its manifest.', 400, ERROR_CODES.COMPONENT_ATTACHMENT_INVALID);

      const existingRows = await tx.read('attachments', { componentVersionId: version.id, path: input.path });
      ensure(existingRows.length <= 1, 'Duplicate attachment metadata detected.', 409, ERROR_CODES.COMPONENT_VERSION_CONFLICT);
      const existing = existingRows[0];
      if (existing) {
        ensure(existing.ownerId === actorId && existing.componentVersionId === version.id, 'You do not own this component attachment.', 403, ERROR_CODES.OWNERSHIP_FORBIDDEN);
        ensure(
          existing.visibility === 'private' &&
          existing.mediaType === manifest.mediaType &&
          existing.sizeBytes === manifest.sizeBytes &&
          canonicalSha256(existing.sha256) === canonicalSha256(manifest.sha256),
          'The declared attachment metadata conflicts with an existing attachment.',
          409,
          ERROR_CODES.COMPONENT_VERSION_CONFLICT,
        );
        const existingContent = (await tx.read('componentAttachmentContents', { attachmentId: existing.id }))[0];
        if (existingContent) {
          ensure(existingContent.content === input.content, 'The attachment path already has different content.', 409, ERROR_CODES.COMPONENT_VERSION_CONFLICT);
        } else {
          await tx.insert('componentAttachmentContents', [{ attachmentId: existing.id, content: input.content }]);
        }
        result = existing;
        return;
      }

      const attachment: Attachment = {
        id: this.id(),
        ownerId: actorId,
        componentVersionId: version.id,
        path: manifest.path,
        mediaType: manifest.mediaType,
        sizeBytes: manifest.sizeBytes,
        sha256: manifest.sha256,
        storageKey: `component-attachments/${version.id}/${this.id()}`,
        visibility: 'private',
        createdAt: this.now(),
      };
      await tx.insert('attachments', [attachment]);
      await tx.insert('componentAttachmentContents', [{ attachmentId: attachment.id, content: input.content }]);
      result = attachment;
    });

    return clone(result!);
  }

  async readTextAttachment(actor: CommunityActor | string | null | undefined, attachmentId: string): Promise<string> {
    const attachment = await this.getAttachment(actor, attachmentId);
    ensure(attachment.mediaType === 'text/plain', 'Only text/plain attachments can be read.', 400, ERROR_CODES.COMPONENT_ATTACHMENT_INVALID);
    const content = (await this.repo.read('componentAttachmentContents', { attachmentId: attachment.id }))[0];
    if (!content) resourceNotFound('Component attachment content not found.');
    return content.content;
  }

  async createPublicationRequest(actor: CommunityActor | string | null | undefined, input: CreatePublicationRequestInput): Promise<PublicationRequest> {
    const actorId = this.requireActor(actor);
    const declaration = text(input.declaration, 'declaration', 4_000);
    let request: PublicationRequest;
    let event: CommunityAuditEvent;
    await this.repo.transaction(async (tx) => {
      const version = (await tx.read('componentVersions', { id: input.componentVersionId }))[0];
      if (!version) resourceNotFound('Component version not found.');
      ensure(version.ownerId === actorId, 'You do not own this component version.', 403, ERROR_CODES.OWNERSHIP_FORBIDDEN);
      const component = (await tx.read('components', { id: version.componentId }))[0];
      if (!component) resourceNotFound('Component not found.');
      ensure(component.ownerId === actorId, 'You do not own this component.', 403, ERROR_CODES.OWNERSHIP_FORBIDDEN);
      ensure(component.currentVersionId === version.id, 'Only the current frozen version can be submitted.', 409, ERROR_CODES.COMPONENT_VERSION_CONFLICT);
      const definition = parseCommunityDefinition(version.definition);
      ensure(definition.license !== null, 'A license is required before publication.', 400, ERROR_CODES.COMPONENT_LICENSE_REQUIRED);
      ensure(this.allowedLicenses.has(definition.license), 'This license is not allowed for publication.', 400, ERROR_CODES.COMPONENT_LICENSE_UNSUPPORTED);
      const existingRequest = (await tx.read('publicationRequests', { componentVersionId: version.id }))[0];
      ensure(!existingRequest, 'This component version already has a publication request.', 409, ERROR_CODES.COMPONENT_VERSION_CONFLICT);
      const now = this.now();
      request = {
        id: this.id(),
        componentVersionId: version.id,
        requesterId: actorId,
        status: 'submitted',
        requestRevision: 1,
        publicMaterialSnapshot: publicMaterial(component.id, version.id, definition, input.publicExampleIds ?? [], input.publicReferencePaths ?? []),
        declaration,
        createdAt: now,
        updatedAt: now,
        decidedAt: null,
      };
      event = this.event('publication.requested', actorId, component.id, now, {
        requestRevision: request.requestRevision,
      });
      await tx.insert('publicationRequests', [request]);
      await this.writeAudit(tx, { ...event, componentVersionId: version.id, publicationRequestId: request.id });
    });
    this.recordedEvents.push({ ...event!, componentVersionId: request!.componentVersionId, publicationRequestId: request!.id });
    return clone(request!);
  }

  async reviewPublication(actor: CommunityActor | string | null | undefined, input: ReviewPublicationInput): Promise<PublicationDecisionResult> {
    const reviewerId = this.requireActor(actor);
    const request = (await this.repo.read('publicationRequests', { id: input.publicationRequestId }))[0];
    if (!request) resourceNotFound('Publication request not found.');
    const version = (await this.repo.read('componentVersions', { id: request.componentVersionId }))[0];
    if (!version) resourceNotFound('Component version not found.');
    ensure(version.ownerId !== reviewerId, 'Authors cannot review their own component.', 403, ERROR_CODES.OWNERSHIP_FORBIDDEN);
    await this.requireReviewer(reviewerId);
    ensure(input.expectedStatus === request.status, 'The publication request status is stale.', 409, ERROR_CODES.CONCURRENT_SAVE);
    if (input.expectedRevision !== undefined) {
      ensure(Number.isInteger(input.expectedRevision) && input.expectedRevision >= 1, 'A valid publication request revision is required.', 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
      ensure(input.expectedRevision === request.requestRevision, 'The publication request revision is stale.', 409, ERROR_CODES.CONCURRENT_SAVE);
    }
    ensure(request.status === 'submitted' || request.status === 'in_review', 'This publication request cannot be decided.', 409, ERROR_CODES.CONCURRENT_SAVE);
    ensure(input.decision === 'approved' || input.decision === 'rejected', 'A valid publication decision is required.', 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
    const reason = text(input.reason, 'reason', 4_000);
    const checks = (input.checks ?? []).map((check) => text(check, 'check', 160));
    ensure(checks.length <= 32, 'Too many review checks.', 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
    const now = this.now();
    const review: PublicationReview = {
      id: this.id(),
      publicationRequestId: request.id,
      reviewerId,
      decision: input.decision,
      reason,
      evidence: { source: 'community-review', checks },
      createdAt: now,
    };
    const nextStatus: PublicationRequestStatus = input.decision === 'approved' ? 'approved' : 'rejected';
    const event: CommunityAuditEvent = {
      id: this.id(),
      action: 'publication.reviewed',
      actorId: reviewerId,
      componentId: version.componentId,
      componentVersionId: version.id,
      publicationRequestId: request.id,
      occurredAt: now,
      metadata: { expectedStatus: request.status, decision: input.decision, nextStatus },
    };
    let result: PublicationDecisionResult;
    await this.repo.transaction(async (tx) => {
      const updated = await tx.update('publicationRequests', {
        id: request.id,
        status: input.expectedStatus,
        requestRevision: request.requestRevision,
      }, { status: nextStatus, requestRevision: request.requestRevision + 1, updatedAt: now, decidedAt: now });
      if (updated.length !== 1) conflict('The publication request was decided by another reviewer.');
      let release: ComponentRelease | null = null;
      if (input.decision === 'approved') {
        const existingRelease = (await tx.read('componentReleases', { componentVersionId: version.id }))[0];
        ensure(!existingRelease, 'This component version has already been released.', 409, ERROR_CODES.CONCURRENT_SAVE);
        release = {
          id: this.id(),
          componentVersionId: version.id,
          publicationRequestId: request.id,
          status: 'active',
          releasedAt: now,
          disabledReason: null,
          createdAt: now,
        };
        await tx.insert('componentReleases', [release]);
        const componentRows = await tx.update('components', { id: version.componentId, ownerId: version.ownerId }, { visibility: 'public', updatedAt: now });
        ensure(componentRows.length === 1, 'Component not found.', 404, ERROR_CODES.RESOURCE_NOT_FOUND);
      }
      await tx.insert('publicationReviews', [review]);
      await this.writeAudit(tx, event);
      result = { request: updated[0], review, release };
    });
    this.recordedEvents.push(event);
    return clone(result!);
  }

  async decidePublication(actor: CommunityActor | string | null | undefined, input: ReviewPublicationInput): Promise<PublicationDecisionResult> {
    return this.reviewPublication(actor, input);
  }

  private requireActor(actor: CommunityActor | string | null | undefined): string {
    const actorId = typeof actor === 'string' ? actor : actor?.id ?? actor?.userId;
    ensure(typeof actorId === 'string' && actorId.trim().length > 0, 'Authentication is required.', 401, ERROR_CODES.AUTH_REQUIRED);
    return actorId;
  }

  private async requireOwnedComponent(actorId: string, componentId: string): Promise<Component> {
    const component = (await this.repo.read('components', { id: componentId }))[0];
    if (!component) resourceNotFound('Component not found.');
    ensure(component.ownerId === actorId, 'You do not own this component.', 403, ERROR_CODES.OWNERSHIP_FORBIDDEN);
    return component;
  }

  private async requireReviewer(actorId: string): Promise<void> {
    if (this.resolveRole) {
      const role = await this.resolveRole(actorId);
      ensure(role === 'reviewer' || role === 'admin', 'Reviewer authorization is required.', 403, ERROR_CODES.ACCESS_FORBIDDEN);
      return;
    }
    const roles = this.roles ? await this.roles(actorId) : new Set<CommunityRole>();
    const roleSet = roles instanceof Set ? roles : new Set(roles);
    ensure(roleSet.has('reviewer') || roleSet.has('admin'), 'Reviewer authorization is required.', 403, ERROR_CODES.ACCESS_FORBIDDEN);
  }

  private event(
    action: CommunityAuditEvent['action'],
    actorId: string,
    componentId: string,
    occurredAt: string,
    metadata: Readonly<Record<string, string | number | boolean | null>>,
  ): CommunityAuditEvent {
    return { id: this.id(), action, actorId, componentId, occurredAt, metadata };
  }

  private async writeAudit(tx: Repository, event: CommunityAuditEvent): Promise<void> {
    const row: CommunityAuditEventRow = {
      id: event.id,
      action: event.action,
      actorId: event.actorId,
      componentId: event.componentId,
      componentVersionId: event.componentVersionId ?? null,
      publicationRequestId: event.publicationRequestId ?? null,
      occurredAt: event.occurredAt,
      metadata: event.metadata,
    };
    await tx.insert('communityAuditEvents', [row]);
    if (this.auditWriter) await this.auditWriter.write(clone(event));
  }
}
