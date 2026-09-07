import type { AppError } from '../../shared/error-core.ts';

export type PublicationStatus = 'pending' | 'published' | 'rejected' | 'withdrawn' | 'taken-down';
export type PublicationReviewDecision = 'approve' | 'reject' | 'take-down';
export type BundleStatus = 'collecting' | 'sealed' | 'rejected';
export type ArtifactClassification = 'public' | 'private' | 'hidden';
export type PreviewKind = 'html' | 'markdown' | 'svg' | 'image' | 'json' | 'csv' | 'text' | 'download';

/**
 * This is the only bundle surface a publication service may consume. The
 * storage key, provider URL, logs and hidden artifacts are deliberately not
 * part of the port, so an adapter cannot accidentally expose them here.
 */
export interface SealedBundleSource {
  id: string;
  ownerId: string;
  status: BundleStatus;
  executionStatus: 'completed' | 'failed' | 'incomplete';
  snapshotDigest: string;
  manifestDigest: string;
  attemptFence: string;
  artifacts: readonly PublicArtifactSource[];
}

export interface PublicArtifactSource {
  artifactId: string;
  relativePath: string;
  mediaType: string;
  previewKind: PreviewKind;
  sizeBytes: number;
  sha256: string;
  classification: ArtifactClassification;
}

export interface PublicationFileRef {
  artifactId: string;
  relativePath: string;
  mediaType: string;
  previewKind: PreviewKind;
  sizeBytes: number;
  sha256: string;
}

export interface WorkPublication {
  id: string;
  ownerId: string;
  sourceBundleId: string;
  sourceSnapshotDigest: string;
  sourceManifestDigest: string;
  sourceAttemptFence: string;
  releaseDigest: string;
  title: string;
  description: string;
  entryPath: string;
  files: readonly PublicationFileRef[];
  status: PublicationStatus;
  revision: number;
  createdAt: string;
  updatedAt: string;
  reviewedAt: string | null;
  withdrawnAt: string | null;
}

/** Safe projection for public pages. It contains no bundle, attempt, artifact or object-storage identifiers. */
export interface PublicWorkPublication {
  publicationId: string;
  title: string;
  description: string;
  entryPath: string;
  releaseDigest: string;
  files: readonly PublicArtifactProjection[];
  createdAt: string;
}

export interface PublicArtifactProjection {
  relativePath: string;
  mediaType: string;
  previewKind: PreviewKind;
  sizeBytes: number;
  sha256: string;
}

export interface ShowcaseAuditEvent {
  id: string;
  action:
    | 'work-publication.requested'
    | 'work-publication.reviewed'
    | 'work-publication.withdrawn';
  actorId: string;
  publicationId: string;
  occurredAt: string;
  metadata: Readonly<Record<string, string | number | boolean | null>>;
}

export interface ShowcaseRepository {
  transaction<T>(fn: (tx: ShowcaseRepository) => Promise<T>): Promise<T>;
  getSealedBundle(bundleId: string, ownerId: string): Promise<SealedBundleSource | null>;
  getWorkPublication(publicationId: string): Promise<WorkPublication | null>;
  insertWorkPublication(publication: WorkPublication): Promise<void>;
  updateWorkPublication(
    publicationId: string,
    expectedRevision: number,
    values: Partial<Pick<WorkPublication, 'status' | 'revision' | 'updatedAt' | 'reviewedAt' | 'withdrawnAt'>>,
  ): Promise<WorkPublication | null>;
  appendAuditEvent(event: ShowcaseAuditEvent): Promise<void>;
}

export interface CreationRunRef {
  id: string;
  ownerId: string;
  purpose: 'creation';
  status: 'accepted' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'incomplete';
  artifactBundleId: string | null;
  buildVersionId: string;
  briefVersionId: string;
}

/** AA-T6 seam: the publication layer validates a CreationRun without owning EF tables. */
export interface CreationRunPort {
  getCreationRun(runId: string, ownerId: string): Promise<CreationRunRef | null>;
}

export interface PublicationActor {
  id?: string;
  userId?: string;
}

export interface WorkPublicationServiceOptions {
  now?: () => string;
  id?: () => string;
  resolveRoles?: (actorId: string) => Promise<ReadonlySet<'reviewer' | 'admin'> | readonly ('reviewer' | 'admin')[]>;
}

export interface CreateWorkPublicationInput {
  bundleId?: string;
  creationRunId?: string;
  expectedSnapshotDigest: string;
  expectedManifestDigest: string;
  title: string;
  description: string;
  entryPath: string;
  publicArtifactIds: readonly string[];
}

export interface ReviewWorkPublicationInput {
  publicationId: string;
  expectedStatus: PublicationStatus;
  expectedRevision: number;
  decision: PublicationReviewDecision;
  reason: string;
}

export interface WorkPublicationDecision {
  publication: WorkPublication;
  audit: ShowcaseAuditEvent;
}

export type ShowcaseFailure = AppError;
