import { ERROR_CODES, ensure } from '../../shared/errors.ts';
import {
  assertUniqueRelativePaths,
  compareRelativePaths,
  normalizedPathKey,
  validateBoundedLimit,
  validateOpaqueToken,
  validateRelativePath
} from '../sandbox/path-policy.ts';
import { ARTIFACT_MANIFEST_VERSION, DEFAULT_ARTIFACT_COLLECTION_LIMITS, type ArtifactClassification, type ArtifactCollectionContext, type ArtifactCollectionLimits, type ArtifactCollectionResult, type ArtifactCollectionManifest, type ArtifactCollectionManifestEntry, type ArtifactOutputSlot, type ArtifactSnapshotReader } from './types.ts';
import { computeArtifactManifestDigest, digestArtifactBytes, isArtifactDigest } from './integrity.ts';
import { computeSandboxSnapshotDigest } from '../sandbox/snapshot-digest.ts';

const CLASSIFICATION_RANK: Readonly<Record<ArtifactClassification, number>> = {
  'public-feedback': 0,
  'private-creation': 1,
  hidden: 2
};

const SPECIAL_ENTRY_KINDS = new Set(['symlink', 'hardlink', 'block-device', 'character-device', 'fifo', 'socket']);

export async function collectArtifacts(
  reader: ArtifactSnapshotReader,
  context: ArtifactCollectionContext,
  slots: readonly ArtifactOutputSlot[]
): Promise<ArtifactCollectionResult> {
  validateContext(context);
  const limits = context.limits ?? DEFAULT_ARTIFACT_COLLECTION_LIMITS;
  validateLimits(limits);
  validateSlots(slots, limits);

  const snapshot = reader.snapshot;
  ensure(snapshot.attemptId === context.attemptId && snapshot.fenceToken === context.fenceToken, 'Artifact snapshot fence mismatch.', 403, ERROR_CODES.ACCESS_FORBIDDEN);
  ensure(isArtifactDigest(snapshot.snapshotDigest), 'Artifact snapshot digest is invalid.', 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
  ensure(snapshot.snapshotDigest === computeSandboxSnapshotDigest(snapshot), 'Artifact snapshot integrity check failed.', 409, ERROR_CODES.RUNTIME_POLICY_DENIED);
  ensure(snapshot.entries.length <= limits.maxEntries, 'Artifact entry limit exceeded.', 413, ERROR_CODES.REQUEST_BODY_TOO_LARGE);
  assertUniqueRelativePaths(snapshot.entries.map((entry) => entry.relativePath), 'artifact path');

  const slotByPath = new Map(slots.map((slot) => [normalizedPathKey(slot.relativePath), slot]));
  const seenRequired = new Set<string>();
  const entries: ArtifactCollectionManifestEntry[] = [];
  const files = [] as ArtifactCollectionResult['files'][number][];
  let totalBytes = 0;

  for (const snapshotEntry of snapshot.entries) {
    const path = validateRelativePath(snapshotEntry.relativePath, 'artifact path');
    ensure(CLASSIFICATION_RANK[snapshotEntry.classification] !== undefined, 'Artifact classification is invalid.', 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
    ensure(!SPECIAL_ENTRY_KINDS.has(snapshotEntry.kind), 'Special files cannot be sealed as artifacts.', 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);

    const slot = slotByPath.get(normalizedPathKey(path));
    if (slot === undefined) continue;
    ensure(snapshotEntry.kind === 'file', 'Only regular files can be sealed as artifacts.', 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
    validateBoundedLimit(snapshotEntry.bytes, limits.maxFileBytes, 'artifact file size');
    ensure(mediaTypeAllowed(snapshotEntry.mediaType, slot.mediaTypes), 'Artifact media type does not match its output slot.', 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
    ensure(snapshotEntry.bytes <= slot.maxBytes, 'Artifact exceeds its output slot size.', 413, ERROR_CODES.REQUEST_BODY_TOO_LARGE);
    if (slot.required) seenRequired.add(slot.slotId);

    const file = await reader.readFile(path, Math.min(snapshotEntry.bytes, limits.maxFileBytes));
    ensure(file.relativePath === path, 'Artifact reader returned a different path.', 409, ERROR_CODES.RUNTIME_POLICY_DENIED);
    ensure(file.bytes.byteLength === snapshotEntry.bytes, 'Artifact bytes changed while sealing.', 409, ERROR_CODES.RUNTIME_POLICY_DENIED);
    ensure(file.objectVersion === undefined || snapshotEntry.objectVersion === undefined || file.objectVersion === snapshotEntry.objectVersion, 'Artifact object version changed while sealing.', 409, ERROR_CODES.RUNTIME_POLICY_DENIED);
    const sha256 = digestArtifactBytes(file.bytes);
    ensure(snapshotEntry.sha256 === undefined || snapshotEntry.sha256 === sha256, 'Artifact digest changed while sealing.', 409, ERROR_CODES.RUNTIME_POLICY_DENIED);
    totalBytes += file.bytes.byteLength;
    ensure(totalBytes <= limits.maxOutputBytes, 'Artifact output limit exceeded.', 413, ERROR_CODES.REQUEST_BODY_TOO_LARGE);

    const classification = strongestClassification(slot.classification, snapshotEntry.classification);
    const objectVersion = file.objectVersion ?? snapshotEntry.objectVersion;
    ensure(typeof objectVersion === 'string' && objectVersion.length > 0, 'Artifact object version is required for sealing.', 409, ERROR_CODES.RUNTIME_POLICY_DENIED);
    const artifactId = createArtifactId(context, path, sha256);
    entries.push({
      artifactId,
      slotId: slot.slotId,
      relativePath: path,
      mediaType: normalizeMediaType(snapshotEntry.mediaType),
      bytes: file.bytes.byteLength,
      sha256,
      objectVersion,
      classification
    });
    files.push({ relativePath: path, bytes: new Uint8Array(file.bytes), objectVersion });
  }

  for (const slot of slots) {
    ensure(!slot.required || seenRequired.has(slot.slotId), `Required output slot '${slot.slotId}' is missing.`, 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
  }

  entries.sort((left, right) => compareRelativePaths(left.relativePath, right.relativePath));
  const manifestWithoutDigest = {
    manifestVersion: ARTIFACT_MANIFEST_VERSION,
    businessRef: context.businessRef,
    attemptId: context.attemptId,
    fenceToken: context.fenceToken,
    environmentDigest: context.environmentDigest,
    snapshotDigest: snapshot.snapshotDigest,
    outputContractVersion: context.outputContractVersion,
    entries,
    sealedAt: snapshot.sealedAt
  } as const;
  const frozenEntries = entries.map((entry) => Object.freeze(entry));
  const manifest: ArtifactCollectionManifest = Object.freeze({
    ...manifestWithoutDigest,
    entries: Object.freeze(frozenEntries),
    manifestDigest: computeArtifactManifestDigest({ ...manifestWithoutDigest, entries: frozenEntries, manifestDigest: '' })
  });
  return { manifest, files: Object.freeze(files.sort((left, right) => compareRelativePaths(left.relativePath, right.relativePath)).map((file) => Object.freeze(file))) };
}

function validateContext(context: ArtifactCollectionContext): void {
  validateOpaqueToken(context.businessRef, 'businessRef');
  validateOpaqueToken(context.attemptId, 'attemptId');
  validateOpaqueToken(context.fenceToken, 'fenceToken');
  validateOpaqueToken(context.environmentDigest, 'environmentDigest');
  validateOpaqueToken(context.outputContractVersion, 'outputContractVersion');
}

function validateLimits(limits: ArtifactCollectionLimits): void {
  ensure(Number.isSafeInteger(limits.maxEntries) && limits.maxEntries > 0 && limits.maxEntries <= 4096, 'Artifact entry limit is invalid.', 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
  ensure(Number.isSafeInteger(limits.maxFileBytes) && limits.maxFileBytes > 0 && limits.maxFileBytes <= 64 * 1024 * 1024, 'Artifact file limit is invalid.', 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
  ensure(Number.isSafeInteger(limits.maxOutputBytes) && limits.maxOutputBytes > 0 && limits.maxOutputBytes <= 256 * 1024 * 1024, 'Artifact output limit is invalid.', 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
}

function validateSlots(slots: readonly ArtifactOutputSlot[], limits: ArtifactCollectionLimits): void {
  ensure(slots.length > 0 && slots.length <= limits.maxEntries, 'At least one output slot is required.', 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
  assertUniqueRelativePaths(slots.map((slot) => slot.relativePath), 'output slot path');
  const slotIds = new Set<string>();
  for (const slot of slots) {
    validateOpaqueToken(slot.slotId, 'output slot id');
    ensure(!slotIds.has(slot.slotId), 'Output slot ids must be unique.', 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
    slotIds.add(slot.slotId);
    validateRelativePath(slot.relativePath, 'output slot path');
    ensure(slot.mediaTypes.length > 0, 'Output slot media types are required.', 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
    ensure(slot.mediaTypes.every((mediaType) => normalizeMediaType(mediaType).length > 0), 'Output slot media type is invalid.', 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
    ensure(CLASSIFICATION_RANK[slot.classification] !== undefined, 'Output slot classification is invalid.', 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
    validateBoundedLimit(slot.maxBytes, limits.maxFileBytes, 'output slot size');
  }
}

function mediaTypeAllowed(actual: string, allowed: readonly string[]): boolean {
  const normalizedActual = normalizeMediaType(actual);
  return allowed.some((candidate) => {
    const normalizedCandidate = normalizeMediaType(candidate);
    return normalizedCandidate === normalizedActual || (normalizedCandidate.endsWith('/*') && normalizedActual.startsWith(normalizedCandidate.slice(0, -1)));
  });
}

function normalizeMediaType(mediaType: string): string {
  ensure(typeof mediaType === 'string' && /^[\x20-\x7e]{1,128}$/.test(mediaType), 'Artifact media type is invalid.', 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
  return mediaType.split(';', 1)[0].trim().toLocaleLowerCase('en-US');
}

function strongestClassification(left: ArtifactClassification, right: ArtifactClassification): ArtifactClassification {
  return CLASSIFICATION_RANK[left] >= CLASSIFICATION_RANK[right] ? left : right;
}

function createArtifactId(context: ArtifactCollectionContext, relativePath: string, sha256: string): string {
  return `artifact-${digestText(`${context.attemptId}\u0000${relativePath}\u0000${sha256}`).slice('sha256:'.length, 24)}`;
}


function digestText(value: string): string {
  return digestArtifactBytes(new TextEncoder().encode(value));
}
