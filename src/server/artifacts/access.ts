import { AppError, ERROR_CODES, ensure } from '../../shared/errors.ts';
import { ARTIFACT_LIMITS, type ArtifactBundleStatus } from '../../shared/artifact-contract.ts';
import type { ArtifactCollectionManifest, ArtifactCollectionManifestEntry, ArtifactClassification } from './types.ts';
import { assertArtifactManifestIntegrity, digestArtifactBytes } from './integrity.ts';
import { validateBoundedLimit } from '../sandbox/path-policy.ts';

export const MAX_ARTIFACT_READ_BYTES = ARTIFACT_LIMITS.maxArtifactBytes;

/**
 * Read-only artifact seam for the HTTP layer. Implementations must perform the
 * owner check against durable state before returning either manifest bytes or
 * content; the interface intentionally has no storage URL or path input.
 */
export interface ArtifactReadBundle {
  readonly bundleId: string;
  readonly ownerId: string;
  readonly outputSlot: string;
  readonly status: ArtifactBundleStatus;
  readonly manifest: ArtifactCollectionManifest;
  readonly sealedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ArtifactReadResult {
  readonly bundle: ArtifactReadBundle;
  readonly entry: ArtifactCollectionManifestEntry;
  readonly bytes: Uint8Array;
}

/**
 * Narrow object-storage seam. Callers provide an immutable object version and
 * a hard byte ceiling; implementations must not accept host paths, URLs, or
 * caller-controlled storage keys.
 */
export interface ArtifactStorageReadRequest {
  readonly ownerId: string;
  readonly bundleId: string;
  readonly artifactId: string;
  /** Immutable storage key resolved from durable artifact metadata; never client supplied. */
  readonly storageKey: string;
  readonly objectVersion: string;
  readonly maxBytes: number;
}

export interface ArtifactStorageReadResult {
  readonly bytes: Uint8Array;
  /** Version returned by storage metadata for the exact immutable read. */
  readonly objectVersion: string;
}

export interface ArtifactStorageAdapter {
  read(request: ArtifactStorageReadRequest): Promise<ArtifactStorageReadResult>;
}

/** Explicit fail-closed placeholder until a durable immutable store is wired. */
export class UnavailableArtifactStorageAdapter implements ArtifactStorageAdapter {
  async read(_request: ArtifactStorageReadRequest): Promise<ArtifactStorageReadResult> {
    throw new AppError('Artifact storage is not available.', 503, ERROR_CODES.RUNTIME_UNAVAILABLE);
  }
}

export interface ArtifactReadPort {
  getBundleForOwner(ownerId: string, bundleId: string): Promise<ArtifactReadBundle | null>;
  /** maxBytes is a mandatory upstream bound, not a post-read truncation hint. */
  getArtifactForOwner(ownerId: string, artifactId: string, maxBytes: number): Promise<ArtifactReadResult | null>;
}

/**
 * Reads one sealed object through the narrow storage seam. The adapter must
 * return the object version it actually read; a short/long read, stale version,
 * or digest mismatch is never accepted as a successful artifact.
 */
export async function readArtifactStorageObject(
  adapter: ArtifactStorageAdapter,
  request: ArtifactStorageReadRequest,
  entry: ArtifactCollectionManifestEntry,
): Promise<Uint8Array> {
  validateBoundedLimit(request.maxBytes, MAX_ARTIFACT_READ_BYTES, 'artifact read limit');
  ensure(request.objectVersion === entry.objectVersion, 'Artifact object version does not match its manifest.', 409, ERROR_CODES.RUNTIME_POLICY_DENIED);
  ensure(request.artifactId === entry.artifactId, 'Artifact id does not match its manifest.', 409, ERROR_CODES.RUNTIME_POLICY_DENIED);
  ensure(request.storageKey.trim().length > 0 && !/[\u0000-\u001f]/u.test(request.storageKey), 'Artifact storage key is invalid.', 409, ERROR_CODES.RUNTIME_POLICY_DENIED);
  ensure(entry.bytes <= request.maxBytes, 'Artifact exceeds the permitted read limit.', 413, ERROR_CODES.REQUEST_BODY_TOO_LARGE);

  const result = await adapter.read(request);
  ensure(result !== null && typeof result === 'object', 'Artifact storage returned an invalid result.', 409, ERROR_CODES.RUNTIME_POLICY_DENIED);
  ensure(result.bytes instanceof Uint8Array, 'Artifact storage returned invalid bytes.', 409, ERROR_CODES.RUNTIME_POLICY_DENIED);
  ensure(result.objectVersion === request.objectVersion, 'Artifact object version changed while reading.', 409, ERROR_CODES.RUNTIME_POLICY_DENIED);
  ensure(result.bytes.byteLength <= request.maxBytes, 'Artifact storage read exceeded the permitted limit.', 413, ERROR_CODES.REQUEST_BODY_TOO_LARGE);
  ensure(result.bytes.byteLength <= entry.bytes, 'Artifact storage read exceeded the sealed artifact size.', 413, ERROR_CODES.REQUEST_BODY_TOO_LARGE);
  ensure(result.bytes.byteLength === entry.bytes, 'Artifact storage returned a short read.', 409, ERROR_CODES.RUNTIME_POLICY_DENIED);
  ensure(digestArtifactBytes(result.bytes) === entry.sha256, 'Artifact storage digest does not match its manifest.', 409, ERROR_CODES.RUNTIME_POLICY_DENIED);
  return new Uint8Array(result.bytes);
}

/**
 * Defense-in-depth validation for any durable read port. A short read, a
 * stale/mismatched manifest entry, or a digest mismatch is never returned as
 * a successful artifact.
 */
export function assertArtifactReadIntegrity(artifact: ArtifactReadResult, maxBytes: number): void {
  validateBoundedLimit(maxBytes, MAX_ARTIFACT_READ_BYTES, 'artifact read limit');
  assertArtifactManifestIntegrity(artifact.bundle.manifest);
  const manifestEntry = artifact.bundle.manifest.entries.find((entry) => entry.artifactId === artifact.entry.artifactId);
  ensure(manifestEntry !== undefined, 'Artifact is not present in its sealed manifest.', 409, ERROR_CODES.RUNTIME_POLICY_DENIED);
  ensure(manifestEntry.slotId === artifact.entry.slotId
    && manifestEntry.relativePath === artifact.entry.relativePath
    && manifestEntry.mediaType === artifact.entry.mediaType
    && manifestEntry.bytes === artifact.entry.bytes
    && manifestEntry.sha256 === artifact.entry.sha256
    && manifestEntry.objectVersion === artifact.entry.objectVersion
    && manifestEntry.classification === artifact.entry.classification,
  'Artifact metadata does not match its sealed manifest.', 409, ERROR_CODES.RUNTIME_POLICY_DENIED);
  ensure(artifact.entry.classification !== 'hidden', 'This artifact is not available for download.', 404, ERROR_CODES.RESOURCE_NOT_FOUND);
  ensure(artifact.entry.bytes <= maxBytes, 'Artifact exceeds the permitted read limit.', 413, ERROR_CODES.REQUEST_BODY_TOO_LARGE);
  ensure(artifact.bytes instanceof Uint8Array, 'Artifact bytes are invalid.', 409, ERROR_CODES.RUNTIME_POLICY_DENIED);
  ensure(artifact.bytes.byteLength <= maxBytes, 'Artifact bytes exceed the permitted read limit.', 413, ERROR_CODES.REQUEST_BODY_TOO_LARGE);
  ensure(artifact.bytes.byteLength <= artifact.entry.bytes, 'Artifact bytes exceed the sealed artifact size.', 413, ERROR_CODES.REQUEST_BODY_TOO_LARGE);
  ensure(artifact.bytes.byteLength === artifact.entry.bytes, 'Artifact bytes do not match the sealed artifact.', 409, ERROR_CODES.RUNTIME_POLICY_DENIED);
  ensure(digestArtifactBytes(artifact.bytes) === artifact.entry.sha256, 'Artifact integrity check failed.', 409, ERROR_CODES.RUNTIME_POLICY_DENIED);
}

export interface ArtifactManifestProjectionEntry {
  readonly artifactId: string;
  readonly relativePath: string;
  readonly mediaType: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly classification: ArtifactClassification;
}

export interface ArtifactBundleProjection {
  readonly bundleId: string;
  readonly outputSlot: string;
  readonly status: ArtifactBundleStatus;
  readonly snapshotDigest: string;
  readonly manifestDigest: string;
  readonly entries: readonly ArtifactManifestProjectionEntry[];
  readonly sealedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Safe owner projection; storage keys, fence tokens and environment evidence stay server-side. */
export function projectArtifactBundle(bundle: ArtifactReadBundle): ArtifactBundleProjection {
  assertArtifactManifestIntegrity(bundle.manifest);
  return {
    bundleId: bundle.bundleId,
    outputSlot: bundle.outputSlot,
    status: bundle.status,
    snapshotDigest: bundle.manifest.snapshotDigest,
    manifestDigest: bundle.manifest.manifestDigest,
    // Hidden evidence is never part of a user-facing projection, including
    // the owner's bundle listing. Public/private-creation visibility is handled
    // by the owner-scoped read port and public publication projection.
    entries: bundle.manifest.entries.filter((entry) => entry.classification !== 'hidden').map((entry) => ({
      artifactId: entry.artifactId,
      relativePath: entry.relativePath,
      mediaType: entry.mediaType,
      bytes: entry.bytes,
      sha256: entry.sha256,
      classification: entry.classification,
    })),
    sealedAt: bundle.sealedAt,
    createdAt: bundle.createdAt,
    updatedAt: bundle.updatedAt,
  };
}
