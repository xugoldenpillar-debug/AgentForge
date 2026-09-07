import { createHash } from 'node:crypto';
import type { SandboxSnapshot, SandboxSnapshotEntry } from './types.ts';
import { assertUniqueRelativePaths, compareRelativePaths } from './path-policy.ts';

const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/u;

type SnapshotDigestInput = Omit<SandboxSnapshot, 'snapshotDigest'>;

interface DigestSnapshotEntry {
  readonly relativePath: string;
  readonly kind: SandboxSnapshotEntry['kind'];
  readonly bytes: number;
  readonly mediaType: string;
  readonly classification: SandboxSnapshotEntry['classification'];
  readonly objectVersion?: string;
  readonly sha256?: string;
}

export function isSha256Digest(value: unknown): value is string {
  return typeof value === 'string' && SHA256_DIGEST.test(value);
}

/**
 * Computes the digest over the immutable snapshot identity and its canonical,
 * path-sorted entry metadata. The digest field itself is intentionally omitted.
 */
export function computeSandboxSnapshotDigest(snapshot: SnapshotDigestInput): string {
  const entries = [...snapshot.entries]
    .map(toDigestEntry)
    .sort((left, right) => compareRelativePaths(left.relativePath, right.relativePath));
  assertUniqueRelativePaths(entries.map((entry) => entry.relativePath), 'snapshot path');
  return digestText(canonicalJson({
    snapshotId: snapshot.snapshotId,
    attemptId: snapshot.attemptId,
    fenceToken: snapshot.fenceToken,
    sealedAt: snapshot.sealedAt,
    entries
  }));
}

function toDigestEntry(entry: SandboxSnapshotEntry): DigestSnapshotEntry {
  return {
    relativePath: entry.relativePath,
    kind: entry.kind,
    bytes: entry.bytes,
    mediaType: entry.mediaType,
    classification: entry.classification,
    ...(entry.objectVersion === undefined ? {} : { objectVersion: entry.objectVersion }),
    ...(entry.sha256 === undefined ? {} : { sha256: entry.sha256 })
  };
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
