import { createHash } from 'node:crypto';
import { ERROR_CODES, ensure } from '../../shared/errors.ts';
import { ARTIFACT_MANIFEST_VERSION, type ArtifactCollectionManifest } from './types.ts';

const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/u;

export function isArtifactDigest(value: unknown): value is string {
  return typeof value === 'string' && SHA256_DIGEST.test(value);
}

export function digestArtifactBytes(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

/** Computes the collector manifest digest without trusting its stored digest field. */
export function computeArtifactManifestDigest(manifest: ArtifactCollectionManifest): string {
  const manifestWithoutDigest = {
    manifestVersion: manifest.manifestVersion,
    businessRef: manifest.businessRef,
    attemptId: manifest.attemptId,
    fenceToken: manifest.fenceToken,
    environmentDigest: manifest.environmentDigest,
    snapshotDigest: manifest.snapshotDigest,
    outputContractVersion: manifest.outputContractVersion,
    entries: manifest.entries,
    sealedAt: manifest.sealedAt
  } as const;
  return digestText(canonicalJson(manifestWithoutDigest));
}

/**
 * Verifies the durable-facing collection evidence before it is projected or
 * used to read bytes. This is intentionally stricter than a type assertion:
 * callers may be holding stale or tampered storage records.
 */
export function assertArtifactManifestIntegrity(manifest: ArtifactCollectionManifest): void {
  ensure(manifest.manifestVersion === ARTIFACT_MANIFEST_VERSION, 'Artifact manifest version is unsupported.', 409, ERROR_CODES.RUNTIME_POLICY_DENIED);
  ensure(isArtifactDigest(manifest.snapshotDigest), 'Artifact snapshot digest is invalid.', 409, ERROR_CODES.RUNTIME_POLICY_DENIED);
  ensure(isArtifactDigest(manifest.manifestDigest), 'Artifact manifest digest is invalid.', 409, ERROR_CODES.RUNTIME_POLICY_DENIED);
  ensure(Array.isArray(manifest.entries), 'Artifact manifest entries are invalid.', 409, ERROR_CODES.RUNTIME_POLICY_DENIED);
  for (const entry of manifest.entries) {
    ensure(isArtifactDigest(entry.sha256), 'Artifact entry digest is invalid.', 409, ERROR_CODES.RUNTIME_POLICY_DENIED);
  }
  ensure(
    computeArtifactManifestDigest(manifest) === manifest.manifestDigest,
    'Artifact manifest integrity check failed.',
    409,
    ERROR_CODES.RUNTIME_POLICY_DENIED
  );
}

function digestText(value: string): string {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}
