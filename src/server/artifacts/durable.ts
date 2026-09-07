import { AppError, ERROR_CODES, ensure } from '../../shared/errors.ts';
import type { Repository } from '../../shared/types.ts';
import type { ArtifactCollectionManifest } from './types.ts';
import { assertArtifactManifestIntegrity } from './integrity.ts';
import type {
  ArtifactReadBundle,
  ArtifactReadPort,
  ArtifactReadResult,
  ArtifactStorageAdapter,
  ArtifactStorageReadResult,
} from './access.ts';
import type { PublicArtifactSource, SealedBundleSource } from '../showcase/contracts.ts';
import { readArtifactStorageObject, UnavailableArtifactStorageAdapter } from './access.ts';

function previewKind(mediaType: string, path: string): PublicArtifactSource['previewKind'] {
  const type = mediaType.toLowerCase().split(';', 1)[0];
  if (type === 'text/html') return 'html';
  if (type === 'text/markdown') return 'markdown';
  if (type === 'image/svg+xml') return 'svg';
  if (type.startsWith('image/')) return 'image';
  if (type === 'application/json') return 'json';
  if (type === 'text/csv') return 'csv';
  if (type.startsWith('text/')) return 'text';
  const extension = path.toLowerCase().split('.').pop();
  if (extension === 'md' || extension === 'markdown') return 'markdown';
  if (extension === 'html' || extension === 'htm') return 'html';
  if (extension === 'svg') return 'svg';
  if (extension === 'csv') return 'csv';
  return 'download';
}

function parseCollectionManifest(value: unknown): ArtifactCollectionManifest | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const manifest = value as ArtifactCollectionManifest;
  if (manifest.manifestVersion !== 1 || !Array.isArray(manifest.entries)) return null;
  try {
    assertArtifactManifestIntegrity(manifest);
    return manifest;
  } catch {
    return null;
  }
}

function publicBundle(bundle: Awaited<ReturnType<DrizzleArtifactReadPort['readBundle']>>): ArtifactReadBundle | null {
  if (!bundle) return null;
  const manifest = parseCollectionManifest(bundle.manifest);
  if (!manifest) return null;
  return {
    bundleId: bundle.id,
    ownerId: bundle.ownerId,
    outputSlot: bundle.outputSlot,
    status: bundle.status,
    manifest,
    sealedAt: bundle.sealedAt,
    createdAt: bundle.createdAt,
    updatedAt: bundle.updatedAt,
  };
}

/**
 * Durable metadata/object-storage adapter for Artifact Arena.
 *
 * The database stores only immutable manifest metadata. Bytes are read through
 * an injected object adapter with a mandatory byte ceiling; the default adapter
 * is intentionally unavailable so enabling the feature cannot silently expose
 * host files or a mutable/latest object alias.
 */
export class DrizzleArtifactReadPort implements ArtifactReadPort {
  readonly storage: ArtifactStorageAdapter;

  constructor(
    private readonly repository: Repository,
    storage: ArtifactStorageAdapter = new UnavailableArtifactStorageAdapter(),
  ) {
    this.storage = storage;
  }

  async readBundle(bundleId: string): Promise<{
    id: string;
    ownerId: string;
    outputSlot: string;
    status: 'collecting' | 'sealed' | 'rejected';
    manifest: unknown;
    sealedAt: string | null;
    createdAt: string;
    updatedAt: string;
  } | null> {
    const row = (await this.repository.read('artifactBundles', { id: bundleId }))[0];
    return row ? {
      id: row.id,
      ownerId: row.ownerId,
      outputSlot: row.outputSlot,
      status: row.status,
      manifest: row.manifest,
      sealedAt: row.sealedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    } : null;
  }

  async getBundleForOwner(ownerId: string, bundleId: string): Promise<ArtifactReadBundle | null> {
    const row = await this.readBundle(bundleId);
    if (!row || row.ownerId !== ownerId || row.status !== 'sealed') return null;
    return publicBundle(row);
  }

  async getArtifactForOwner(ownerId: string, artifactId: string, maxBytes: number): Promise<ArtifactReadResult | null> {
    const artifact = (await this.repository.read('artifacts', { id: artifactId, ownerId }))[0];
    if (!artifact) return null;
    const bundle = await this.getBundleForOwner(ownerId, artifact.bundleId);
    if (!bundle) return null;
    const entry = bundle.manifest.entries.find((candidate) => candidate.artifactId === artifactId);
    if (!entry || entry.classification === 'hidden') return null;
    ensure(entry.relativePath === artifact.path && entry.mediaType === artifact.mediaType,
      'Artifact metadata does not match its sealed manifest.', 409, ERROR_CODES.RUNTIME_POLICY_DENIED);
    const bytes = await readArtifactStorageObject(this.storage, {
      ownerId,
      bundleId: artifact.bundleId,
      artifactId: artifact.id,
      storageKey: artifact.storageKey,
      objectVersion: entry.objectVersion,
      maxBytes,
    }, entry);
    return { bundle, entry, bytes };
  }

  /** Narrow source projection used by publication creation. */
  async getSealedBundle(bundleId: string, ownerId: string): Promise<SealedBundleSource | null> {
    const row = await this.readBundle(bundleId);
    if (!row || row.ownerId !== ownerId || row.status !== 'sealed') return null;
    const manifest = parseCollectionManifest(row.manifest);
    if (!manifest) return null;
    const artifacts = await this.repository.read('artifacts', { bundleId, ownerId });
    const artifactById = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
    return {
      id: row.id,
      ownerId: row.ownerId,
      status: row.status,
      executionStatus: 'completed',
      snapshotDigest: manifest.snapshotDigest,
      manifestDigest: manifest.manifestDigest,
      attemptFence: manifest.fenceToken,
      artifacts: manifest.entries.map((entry) => {
        const artifact = artifactById.get(entry.artifactId);
        return {
          artifactId: entry.artifactId,
          relativePath: entry.relativePath,
          mediaType: entry.mediaType,
          previewKind: previewKind(entry.mediaType, entry.relativePath),
          sizeBytes: entry.bytes,
          sha256: entry.sha256,
          classification: entry.classification === 'hidden'
            ? 'hidden'
            : entry.classification === 'public-feedback' ? 'public' : 'private',
          ...(artifact ? {} : {}),
        };
      }),
    };
  }
}

export interface StaticObjectStorageAdapterOptions {
  readonly readObject: (input: { readonly artifactId: string; readonly storageKey: string; readonly objectVersion: string; readonly maxBytes: number }) => Promise<ArtifactStorageReadResult>;
}

/** Adapter factory for a real immutable object store; never accepts a URL/path. */
export function createStaticObjectStorageAdapter(options: StaticObjectStorageAdapterOptions): ArtifactStorageAdapter {
  return {
    async read(request) {
      const result = await options.readObject({
        artifactId: request.artifactId,
        storageKey: request.storageKey,
        objectVersion: request.objectVersion,
        maxBytes: request.maxBytes,
      });
      if (!(result?.bytes instanceof Uint8Array) || result.bytes.byteLength > request.maxBytes) {
        throw new AppError('Artifact object exceeds the permitted read limit.', 413, ERROR_CODES.REQUEST_BODY_TOO_LARGE);
      }
      if (result.objectVersion !== request.objectVersion) {
        throw new AppError('Artifact object version changed while reading.', 409, ERROR_CODES.RUNTIME_POLICY_DENIED);
      }
      return result;
    },
  };
}
