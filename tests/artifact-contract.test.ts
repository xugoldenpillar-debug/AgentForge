import assert from 'node:assert/strict';
import test from 'node:test';
import {
  digestArtifactManifest,
  materializeArtifactManifest,
  parseArtifactManifest,
  type ArtifactCollectionManifestV1,
} from '../src/shared/artifact-contract.ts';
import { ERROR_CODES } from '../src/shared/errors.ts';

const digest = `sha256:${'b'.repeat(64)}`;
const collection: ArtifactCollectionManifestV1 = {
  manifestVersion: 1,
  businessRef: 'problem:pelican',
  attemptId: 'attempt-1',
  fenceToken: 'fence-1',
  environmentDigest: digest,
  snapshotDigest: digest,
  outputContractVersion: 'output-v1',
  entries: [{
    artifactId: 'artifact-1',
    slotId: 'site',
    relativePath: 'index.html',
    mediaType: 'text/html',
    bytes: 12,
    sha256: digest,
    objectVersion: 'object-v1',
    classification: 'public-feedback',
  }],
  sealedAt: '2026-09-07T00:00:00.000Z',
  manifestDigest: digest,
};

function assertContractError(error: unknown): boolean {
  assert.equal(error && typeof error === 'object' && 'code' in error ? error.code : undefined, ERROR_CODES.REQUEST_VALIDATION_FAILED);
  return true;
}

test('collection manifests materialize into persisted manifests only with explicit immutable storage keys', () => {
  const persisted = materializeArtifactManifest({
    collection,
    bundleId: 'bundle-1',
    outputSlot: 'site',
    entrypoint: 'index.html',
    storageKeys: { 'artifact-1': 'bundles/bundle-1/artifact-1' },
  });

  assert.equal(persisted.schemaVersion, 1);
  assert.equal(persisted.bundleId, 'bundle-1');
  assert.equal(persisted.attemptId, collection.attemptId);
  assert.equal(persisted.outputSlot, 'site');
  assert.deepEqual(persisted.entries[0], {
    artifactId: 'artifact-1',
    path: 'index.html',
    mediaType: 'text/html',
    sizeBytes: 12,
    sha256: digest,
    object: {
      storageKey: 'bundles/bundle-1/artifact-1',
      objectVersion: 'object-v1',
    },
  });
  assert.equal(digestArtifactManifest(persisted).startsWith('sha256:'), true);
});

test('a runtime collection manifest is not accepted as a persisted manifest', () => {
  assert.throws(() => parseArtifactManifest(collection), assertContractError);
  assert.throws(() => materializeArtifactManifest({
    collection,
    bundleId: 'bundle-1',
    outputSlot: 'site',
    entrypoint: null,
    storageKeys: {},
  }), assertContractError);
});
