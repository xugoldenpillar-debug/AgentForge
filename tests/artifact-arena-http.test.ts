import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import type { ArenaService } from '../src/server/service.ts';
import { handleArena, type ArtifactArenaHttpServices } from '../src/server/http.ts';
import { computeArtifactManifestDigest, MAX_ARTIFACT_READ_BYTES } from '../src/server/artifacts/index.ts';
import { validateBody } from '../src/server/validation.ts';
import { AppError, ERROR_CODES } from '../src/shared/errors.ts';
import type { ArtifactReadBundle, ArtifactReadPort, ArtifactReadResult } from '../src/server/artifacts/access.ts';
import type { ArtifactManifest, ArtifactManifestEntry } from '../src/server/artifacts/types.ts';
import type {
  PublicWorkPublication,
  ShowcaseAuditEvent,
  WorkPublication,
  WorkPublicationDecision,
} from '../src/server/showcase/contracts.ts';

const ORIGIN = 'http://localhost:3000';
const OWNER = 'artifact-http-owner';
const OTHER = 'artifact-http-other';
const NOW = '2026-09-07T00:00:00.000Z';

function digest(value: string | Uint8Array): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function request(path: string, init: RequestInit = {}): Request {
  return new Request(`${ORIGIN}/api/arena/${path}`, {
    ...init,
    headers: new Headers({
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    }),
  });
}

async function body(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

function arenaService(env: Record<string, string | undefined> = { ARTIFACT_ARENA_ENABLED: 'true' }): ArenaService {
  return {
    limit: async () => undefined,
    options: { env },
  } as unknown as ArenaService;
}

const html = '<script>alert(1)</script><h1>Pelican</h1><img src="https://remote.invalid/image.png">';
const htmlBytes = new TextEncoder().encode(html);
const htmlEntry: ArtifactManifestEntry = {
  artifactId: 'artifact-1',
  slotId: 'entry',
  relativePath: 'index.html',
  mediaType: 'text/html',
  bytes: htmlBytes.byteLength,
  sha256: digest(htmlBytes),
  objectVersion: 'index-v1',
  classification: 'public-feedback',
};
const manifestBase: ArtifactManifest = {
  manifestVersion: 1,
  businessRef: 'problem:pelican',
  attemptId: 'attempt-1',
  fenceToken: 'fence-1',
  environmentDigest: digest('environment'),
  snapshotDigest: digest('snapshot'),
  outputContractVersion: 'output-v1',
  entries: [htmlEntry],
  sealedAt: NOW,
  manifestDigest: '',
};
const manifest: ArtifactManifest = {
  ...manifestBase,
  manifestDigest: computeArtifactManifestDigest(manifestBase),
};
const bundle: ArtifactReadBundle = {
  bundleId: 'bundle-1',
  ownerId: OWNER,
  outputSlot: 'site',
  status: 'sealed',
  manifest,
  sealedAt: NOW,
  createdAt: NOW,
  updatedAt: NOW,
};
const artifact: ArtifactReadResult = { bundle, entry: htmlEntry, bytes: htmlBytes };

const artifacts: ArtifactReadPort = {
  async getBundleForOwner(ownerId, bundleId) {
    return ownerId === OWNER && bundleId === bundle.bundleId ? structuredClone(bundle) : null;
  },
  async getArtifactForOwner(ownerId, artifactId, maxBytes) {
    assert.equal(maxBytes, MAX_ARTIFACT_READ_BYTES);
    return ownerId === OWNER && artifactId === htmlEntry.artifactId ? structuredClone(artifact) : null;
  },
};

const publication: WorkPublication = {
  id: 'pub-1',
  ownerId: OWNER,
  sourceBundleId: bundle.bundleId,
  sourceSnapshotDigest: manifest.snapshotDigest,
  sourceManifestDigest: manifest.manifestDigest,
  sourceAttemptFence: manifest.fenceToken,
  releaseDigest: digest('release'),
  title: 'Pelican rides a bicycle',
  description: 'A static preview.',
  entryPath: htmlEntry.relativePath,
  files: [{
    artifactId: htmlEntry.artifactId,
    relativePath: htmlEntry.relativePath,
    mediaType: htmlEntry.mediaType,
    previewKind: 'html',
    sizeBytes: htmlEntry.bytes,
    sha256: htmlEntry.sha256,
  }],
  status: 'pending',
  revision: 1,
  createdAt: NOW,
  updatedAt: NOW,
  reviewedAt: null,
  withdrawnAt: null,
};
const publicPublication: PublicWorkPublication = {
  publicationId: publication.id,
  title: publication.title,
  description: publication.description,
  entryPath: publication.entryPath,
  releaseDigest: publication.releaseDigest,
  files: publication.files.map(({ relativePath, mediaType, previewKind, sizeBytes, sha256 }) => ({ relativePath, mediaType, previewKind, sizeBytes, sha256 })),
  createdAt: NOW,
};
const audit: ShowcaseAuditEvent = {
  id: 'audit-1',
  action: 'work-publication.reviewed',
  actorId: 'reviewer',
  publicationId: publication.id,
  occurredAt: NOW,
  metadata: {},
};

function publicationDecision(status: WorkPublication['status']): WorkPublicationDecision {
  return { publication: { ...publication, status }, audit };
}

let requestedBundleId: string | undefined;
let reviewedPublicationId: string | undefined;
const publications: NonNullable<ArtifactArenaHttpServices['publications']> = {
  async requestPublication(_actor, input) {
    requestedBundleId = input.bundleId;
    return structuredClone(publication);
  },
  async withdrawPublication() {
    return publicationDecision('withdrawn');
  },
  async reviewPublication(_actor, input) {
    reviewedPublicationId = input.publicationId;
    return publicationDecision(input.decision === 'approve' ? 'published' : input.decision === 'reject' ? 'rejected' : 'taken-down');
  },
  async getOwnerPublication() {
    return structuredClone(publication);
  },
  async getPublicPublication() {
    return structuredClone(publicPublication);
  },
  async resolvePublishedArtifact(publicationId, relativePath) {
    if (publicationId !== publication.id || relativePath !== htmlEntry.relativePath) {
      throw new AppError('Published artifact not found.', 404, ERROR_CODES.RESOURCE_NOT_FOUND);
    }
    return { ownerId: OWNER, artifactId: htmlEntry.artifactId };
  },
};

const baseOptions = {
  service: arenaService(),
  origin: ORIGIN,
  validateBody,
};

test('artifact HTTP reads are owner-scoped and preview content is data-only', async () => {
  const options = { ...baseOptions, userId: OWNER, artifactArena: { artifacts } } satisfies Parameters<typeof handleArena>[1];
  const bundleResponse = await handleArena(request('artifact-bundles/bundle-1'), options);
  assert.equal(bundleResponse.status, 200);
  const bundleProjection = await body(bundleResponse);
  assert.equal(bundleProjection.bundleId, bundle.bundleId);
  assert.equal('storageKey' in bundleProjection, false);
  assert.equal(JSON.stringify(bundleProjection).includes('fence-1'), false);

  const previewResponse = await handleArena(request('artifacts/artifact-1/preview'), options);
  assert.equal(previewResponse.status, 200);
  const preview = await body(previewResponse);
  const previewBody = preview.body as Record<string, unknown>;
  assert.equal(previewBody.kind, 'text');
  assert.doesNotMatch(String(previewBody.content), /<script|https:\/\//i);

  const contentResponse = await handleArena(request('artifacts/artifact-1/content'), options);
  assert.equal(contentResponse.status, 200);
  assert.equal(contentResponse.headers.get('content-type'), 'application/octet-stream');
  assert.match(contentResponse.headers.get('content-disposition') ?? '', /attachment; filename="index\.html"/);
  assert.deepEqual(new Uint8Array(await contentResponse.arrayBuffer()), htmlBytes);

  const otherResponse = await handleArena(request('artifact-bundles/bundle-1'), { ...options, userId: OTHER });
  assert.equal(otherResponse.status, 404);
  const anonymousResponse = await handleArena(request('artifacts/artifact-1/content'), { ...baseOptions, artifactArena: { artifacts } });
  assert.equal(anonymousResponse.status, 401);
});

test('artifact HTTP routes fail closed when a durable reader is not injected', async () => {
  const response = await handleArena(request('artifact-bundles/bundle-1'), { ...baseOptions, userId: OWNER });
  assert.equal(response.status, 503);
  const payload = await body(response);
  assert.equal(payload.error && (payload.error as Record<string, unknown>).code, 'RUNTIME_UNAVAILABLE');
});

test('the kill switch stops new Arena work without revoking historical artifact reads', async () => {
  const response = await handleArena(request('artifact-bundles/bundle-1'), {
    ...baseOptions,
    service: arenaService({ ARTIFACT_ARENA_ENABLED: 'true', ARTIFACT_ARENA_KILL_SWITCH: 'true' }),
    userId: OWNER,
    artifactArena: { artifacts },
  });
  assert.equal(response.status, 200);
  const payload = await body(response);
  assert.equal(payload.bundleId, bundle.bundleId);

  const createResponse = await handleArena(request('work-publications', {
    method: 'POST',
    headers: { Origin: ORIGIN },
    body: JSON.stringify({
      bundleId: bundle.bundleId,
      expectedSnapshotDigest: manifest.snapshotDigest,
      expectedManifestDigest: manifest.manifestDigest,
      title: publication.title,
      description: publication.description,
      entryPath: publication.entryPath,
      publicArtifactIds: [htmlEntry.artifactId],
    }),
  }), {
    ...baseOptions,
    service: arenaService({ ARTIFACT_ARENA_ENABLED: 'true', ARTIFACT_ARENA_KILL_SWITCH: 'true' }),
    userId: OWNER,
    artifactArena: { publications },
  });
  assert.equal(createResponse.status, 503);
  const error = await body(createResponse);
  assert.equal((error.error as Record<string, unknown>).code, 'RUNTIME_UNAVAILABLE');
});

test('malformed encoded path segments are rejected as client input', async () => {
  const response = await handleArena(
    new Request(`${ORIGIN}/api/arena/artifact-bundles/%E0%A4%A`, { headers: { 'Content-Type': 'application/json' } }),
    { ...baseOptions, userId: OWNER },
  );
  assert.equal(response.status, 400);
  const payload = await body(response);
  assert.equal((payload.error as Record<string, unknown>).code, 'REQUEST_VALIDATION_FAILED');
});

test('artifact downloads reject bytes that exceed the sealed manifest limit', async () => {
  const oversized: ArtifactReadPort = {
    async getBundleForOwner() {
      return structuredClone(bundle);
    },
    async getArtifactForOwner(_ownerId, _artifactId, maxBytes) {
      assert.equal(maxBytes, MAX_ARTIFACT_READ_BYTES);
      return { ...structuredClone(artifact), bytes: new Uint8Array(htmlBytes.byteLength + 1) };
    },
  };
  const response = await handleArena(request('artifacts/artifact-1/content'), {
    ...baseOptions,
    userId: OWNER,
    artifactArena: { artifacts: oversized },
  });
  assert.equal(response.status, 413);
  const payload = await body(response);
  assert.equal((payload.error as Record<string, unknown>).code, 'REQUEST_BODY_TOO_LARGE');
});

test('canonical publication routes dispatch through the narrow service seam and validate legacy aliases', async () => {
  requestedBundleId = undefined;
  reviewedPublicationId = undefined;
  const options = { ...baseOptions, userId: OWNER, artifactArena: { publications } } satisfies Parameters<typeof handleArena>[1];
  const createResponse = await handleArena(request('work-publications', {
    method: 'POST',
    headers: { Origin: ORIGIN },
    body: JSON.stringify({
      bundleId: bundle.bundleId,
      expectedSnapshotDigest: manifest.snapshotDigest,
      expectedManifestDigest: manifest.manifestDigest,
      title: publication.title,
      description: publication.description,
      entryPath: publication.entryPath,
      publicArtifactIds: [htmlEntry.artifactId],
    }),
  }), options);
  assert.equal(createResponse.status, 201);
  assert.equal(requestedBundleId, bundle.bundleId);

  const reviewResponse = await handleArena(request('work-publications/pub-1/review', {
    method: 'POST',
    headers: { Origin: ORIGIN },
    body: JSON.stringify({ expectedStatus: 'pending', expectedRevision: 1, decision: 'approve', reason: 'static output reviewed' }),
  }), options);
  assert.equal(reviewResponse.status, 200);
  assert.equal(reviewedPublicationId, publication.id);

  const invalidAliasResponse = await handleArena(request('showcase/publications/pub-1/review', {
    method: 'POST',
    headers: { Origin: ORIGIN },
    body: JSON.stringify({ expectedStatus: 'pending', expectedRevision: 1, decision: 'approve' }),
  }), options);
  assert.equal(invalidAliasResponse.status, 400);
});

test('publication likes use authenticated idempotent PUT and DELETE routes', async () => {
  const calls: string[] = [];
  const likes: NonNullable<ArtifactArenaHttpServices['likes']> = {
    async summary(publicationId, viewerId) {
      calls.push(`summary:${publicationId}:${viewerId ?? 'anonymous'}`);
      return { publicationId, count: 0, likedByViewer: false };
    },
    async like(userId, publicationId) {
      calls.push(`like:${userId}:${publicationId}`);
      return { publicationId, count: 1, likedByViewer: true, changed: true };
    },
    async unlike(userId, publicationId) {
      calls.push(`unlike:${userId}:${publicationId}`);
      return { publicationId, count: 0, likedByViewer: false, changed: true };
    },
  };
  const options = { ...baseOptions, userId: OWNER, artifactArena: { likes } };

  const put = await handleArena(request('showcase/publications/pub-1/like', {
    method: 'PUT',
    headers: { Origin: ORIGIN },
  }), options);
  assert.equal(put.status, 200);
  assert.equal((await body(put)).likedByViewer, true);

  const remove = await handleArena(request('showcase/publications/pub-1/like', {
    method: 'DELETE',
    headers: { Origin: ORIGIN },
  }), options);
  assert.equal(remove.status, 200);
  assert.equal((await body(remove)).likedByViewer, false);
  assert.deepEqual(calls, [`like:${OWNER}:pub-1`, `unlike:${OWNER}:pub-1`]);

  const anonymous = await handleArena(request('showcase/publications/pub-1/like', {
    method: 'PUT',
    headers: { Origin: ORIGIN },
  }), { ...baseOptions, artifactArena: { likes } });
  assert.equal(anonymous.status, 401);
});

test('creation-runs fail closed when the Creation Evaluation Foundation service is not injected', async () => {
  const idempotencyKey = 'creation-http-unavailable';
  const response = await handleArena(request('creation-runs', {
    method: 'POST',
    headers: { Origin: ORIGIN, 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({
      buildVersionId: 'build-version-1',
      challengeVersionId: 'animation-pelican-bike-v1',
      credentialId: 'credential-1',
      idempotencyKey,
    }),
  }), { ...baseOptions, userId: OWNER });

  assert.equal(response.status, 503);
  const payload = await body(response);
  assert.deepEqual(payload.error, {
    code: 'RUNTIME_UNAVAILABLE',
    message: 'Artifact Arena creation runs are not available.',
  });
});


test('public publication previews expose only the reviewed artifact projection', async () => {
  const response = await handleArena(request('showcase/publications/pub-1/preview?path=index.html'), {
    ...baseOptions,
    artifactArena: { publications, artifacts },
  });
  assert.equal(response.status, 200);
  const payload = await body(response);
  assert.equal((payload.body as Record<string, unknown>).kind, 'text');
  assert.doesNotMatch(JSON.stringify(payload), /<script|remote\.invalid|storageKey|artifact-1|fence-1/i);

  const deniedPublications: NonNullable<ArtifactArenaHttpServices['publications']> = {
    ...publications,
    async resolvePublishedArtifact() {
      throw new AppError('Published work not found.', 404, ERROR_CODES.RESOURCE_NOT_FOUND);
    },
  };
  const denied = await handleArena(request('showcase/publications/pub-1/preview?path=index.html'), {
    ...baseOptions,
    artifactArena: { publications: deniedPublications, artifacts },
  });
  assert.equal(denied.status, 404);
});

test('creation-run HTTP idempotency rejects missing keys and header/body conflicts before scheduling', async () => {
  const valid = {
    buildVersionId: 'build-version-1',
    challengeVersionId: 'animation-pelican-bike-v1',
    credentialId: 'credential-1',
  };
  const missing = await handleArena(request('creation-runs', {
    method: 'POST',
    headers: { Origin: ORIGIN },
    body: JSON.stringify(valid),
  }), { ...baseOptions, userId: OWNER });
  assert.equal(missing.status, 400);

  const conflict = await handleArena(request('creation-runs', {
    method: 'POST',
    headers: { Origin: ORIGIN, 'Idempotency-Key': 'header-key' },
    body: JSON.stringify({ ...valid, idempotencyKey: 'body-key' }),
  }), { ...baseOptions, userId: OWNER });
  assert.equal(conflict.status, 409);
});


test('Next.js arena adapter exports PUT so like requests reach the internal router', async () => {
  const source = await readFile(new URL('../src/app/api/arena/[...path]/route.ts', import.meta.url), 'utf8');
  assert.match(source, /export const PUT = handler;/);
});
