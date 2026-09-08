import { randomUUID } from 'node:crypto';
import { AppError, ERROR_CODES, ensure } from '../../shared/errors.ts';
import { materializeArtifactManifest, type ArtifactManifestV1 } from '../../shared/artifact-contract.ts';
import type { ArtifactBundle, Artifact } from '../../shared/types.ts';
import type { Repository } from '../../shared/types.ts';
import { assertArtifactManifestIntegrity, computeArtifactManifestDigest } from './integrity.ts';
import type { ArtifactCollectionResult } from './types.ts';
import { createArtifactStorageKey, objectVersionForBytes } from './filesystem.ts';
import type { ArtifactStorageWriter } from './access.ts';

export interface SealArtifactBundleInput {
  readonly ownerId: string;
  readonly creationRunId?: string | null;
  readonly runId?: string | null;
  readonly outputSlot: string;
  readonly entrypoint: string | null;
  readonly collection: ArtifactCollectionResult;
  readonly repository: Repository;
  readonly storage: ArtifactStorageWriter;
  readonly now?: () => string;
}

export interface SealedArtifactBundleResult {
  readonly bundle: ArtifactBundle;
  readonly artifacts: readonly Artifact[];
  readonly manifest: ArtifactManifestV1;
}

/**
 * Materializes a sandbox snapshot into immutable objects and durable metadata.
 * Object writes happen before the database transaction; a failed transaction
 * compensates by removing only the objects created by this seal attempt. The
 * caller owns the surrounding run transition so it can verify sandbox disposal
 * before exposing a completed result.
 */
export async function sealArtifactBundle(input: SealArtifactBundleInput): Promise<SealedArtifactBundleResult> {
  const now = input.now ?? (() => new Date().toISOString());
  const bundleId = `bundle-${randomUUID()}`;
  const writes: Array<{ storageKey: string; objectVersion: string }> = [];
  const storageKeys: Record<string, string> = {};
  const collection = input.collection.manifest;
  ensure(collection.entries.length > 0, 'At least one artifact is required.', 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);

  try {
    for (const file of input.collection.files) {
      const entry = collection.entries.find((candidate) => candidate.relativePath === file.relativePath);
      ensure(entry, 'Collected artifact file is missing from its manifest.', 409, ERROR_CODES.RUNTIME_POLICY_DENIED);
      const storageKey = createArtifactStorageKey(input.ownerId, bundleId, entry.artifactId, entry.sha256);
      const objectVersion = objectVersionForBytes(file.bytes);
      const written = await input.storage.write({
        ownerId: input.ownerId,
        bundleId,
        artifactId: entry.artifactId,
        storageKey,
        objectVersion,
        bytes: file.bytes,
      });
      ensure(written.storageKey === storageKey && written.objectVersion === objectVersion, 'Artifact storage returned a mutable object reference.', 409, ERROR_CODES.RUNTIME_POLICY_DENIED);
      storageKeys[entry.artifactId] = storageKey;
      writes.push({ storageKey, objectVersion });
    }

    assertArtifactManifestIntegrity(collection);
    const persistedEntries = collection.entries.map((entry) => ({
      ...entry,
      objectVersion: objectVersionForBytes(input.collection.files.find((file) => file.relativePath === entry.relativePath)?.bytes ?? new Uint8Array()),
    }));
    const persistedCollection = {
      ...collection,
      entries: persistedEntries,
      manifestDigest: '',
    } as typeof collection;
    const sealedCollection = {
      ...persistedCollection,
      manifestDigest: computeArtifactManifestDigest(persistedCollection),
    } as typeof collection;
    const manifest = materializeArtifactManifest({
      collection: sealedCollection,
      bundleId,
      outputSlot: input.outputSlot,
      entrypoint: input.entrypoint,
      storageKeys,
    });

    const bundle: ArtifactBundle = {
      id: bundleId,
      ownerId: input.ownerId,
      creationRunId: input.creationRunId ?? null,
      runId: input.runId ?? null,
      attemptId: collection.attemptId,
      outputSlot: input.outputSlot,
      status: 'sealed',
      snapshotDigest: collection.snapshotDigest,
      manifestDigest: sealedCollection.manifestDigest,
      // The collection manifest is the authoritative runtime evidence used by
      // DrizzleArtifactReadPort; the materialized manifest is returned for
      // callers that need the storage-facing v1 shape.
      manifest: sealedCollection as unknown as ArtifactBundle['manifest'],
      sealedAt: now(),
      createdAt: now(),
      updatedAt: now(),
    };
    const artifacts: Artifact[] = sealedCollection.entries.map((entry) => {
      const objectVersion = objectVersionForBytes(input.collection.files.find((file) => file.relativePath === entry.relativePath)?.bytes ?? new Uint8Array());
      return {
        id: entry.artifactId,
        ownerId: input.ownerId,
        bundleId,
        path: entry.relativePath,
        mediaType: entry.mediaType as Artifact['mediaType'],
        detectedMediaType: entry.mediaType as Artifact['detectedMediaType'],
        sizeBytes: entry.bytes,
        sha256: entry.sha256,
        storageKey: storageKeys[entry.artifactId],
        objectVersion,
        visibility: entry.classification === 'public-feedback' ? 'public' : 'private',
        createdAt: now(),
      };
    });

    await input.repository.transaction(async (tx) => {
      await tx.insert('artifactBundles', [bundle]);
      await tx.insert('artifacts', artifacts);
    });
    return { bundle, artifacts, manifest };
  } catch (error) {
    await Promise.all(writes.map((write) => input.storage.remove?.(write).catch(() => undefined)));
    if (error instanceof AppError) throw error;
    throw new AppError('Artifact sealing failed.', 503, ERROR_CODES.RUNTIME_UNAVAILABLE);
  }
}
