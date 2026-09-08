import assert from 'node:assert/strict';
import test from 'node:test';
import { artifactArenaAvailability } from '../src/server/artifact-arena-availability.ts';

const COMPLETE = {
  ARTIFACT_ARENA_ENABLED: 'true',
  PI_RUNTIME_ENABLED: 'true',
  ARTIFACT_STORAGE_ROOT: '/var/lib/agentforge/artifacts',
  EVALUATION_SCHEDULER_MODE: 'outbox',
  DATABASE_URL: 'postgres://configured',
  REDIS_URL: 'redis://configured',
  EVALUATION_QUEUE_NAME: 'agentforge',
  EVALUATION_QUEUE_PREFIX: 'prod',
  EVALUATION_WORKER_ID: 'worker-1',
  CREDENTIAL_ENCRYPTION_KEY: 'configured-not-secret-projection',
  ARTIFACT_STORAGE_GID: '987',
  SANDBOX_RUNSC_PATH: '/usr/local/bin/runsc',
  SANDBOX_ROOTFS: '/opt/agentforge/rootfs',
  SANDBOX_WORK_ROOT: '/var/lib/agentforge/sandboxes',
  SANDBOX_OCI_TEMPLATE: '/opt/agentforge/oci-template.json',
  SANDBOX_IMAGE_DIGEST: `sha256:${'a'.repeat(64)}`,
} as const;

test('Artifact Arena stays unavailable by default while historical reads remain enabled', () => {
  const availability = artifactArenaAvailability({}, '22.19.0');
  assert.deepEqual(availability.historicalReads, { enabled: true, reason: 'enabled' });
  for (const feature of [availability.builderDesign, availability.artifactPreviewProjection,
    availability.artifactRead, availability.creationRuns, availability.showcase,
    availability.voting, availability.piRuntime]) {
    assert.deepEqual(feature, { enabled: false, reason: 'feature_disabled' });
  }
});

test('operator intent does not advertise durable capabilities until dependencies are configured', () => {
  const availability = artifactArenaAvailability({ ARTIFACT_ARENA_ENABLED: 'true' }, '22.19.0');
  assert.deepEqual(availability.builderDesign, { enabled: true, reason: 'enabled' });
  assert.deepEqual(availability.artifactPreviewProjection, { enabled: true, reason: 'enabled' });
  for (const feature of [availability.artifactRead, availability.creationRuns, availability.showcase, availability.voting]) {
    assert.deepEqual(feature, { enabled: false, reason: 'dependency_unavailable' });
  }
  assert.deepEqual(availability.piRuntime, { enabled: false, reason: 'feature_disabled' });
});

test('complete durable and worker configuration advertises the public launch path', () => {
  const availability = artifactArenaAvailability(COMPLETE, '22.19.0');
  for (const feature of [availability.builderDesign, availability.artifactPreviewProjection,
    availability.artifactRead, availability.creationRuns, availability.showcase,
    availability.voting, availability.piRuntime]) {
    assert.deepEqual(feature, { enabled: true, reason: 'enabled' });
  }
});

test('the kill switch blocks mutations and execution while preserving configured historical reads', () => {
  const availability = artifactArenaAvailability({ ...COMPLETE, ARTIFACT_ARENA_KILL_SWITCH: 'true' }, '22.19.0');
  assert.equal(availability.killSwitchActive, true);
  assert.deepEqual(availability.historicalReads, { enabled: true, reason: 'enabled' });
  assert.deepEqual(availability.artifactRead, { enabled: true, reason: 'enabled' });
  for (const feature of [availability.builderDesign, availability.artifactPreviewProjection,
    availability.creationRuns, availability.showcase, availability.voting, availability.piRuntime]) {
    assert.deepEqual(feature, { enabled: false, reason: 'kill_switch' });
  }
});

test('Pi execution requires an exact flag, supported Node and complete worker sandbox configuration', () => {
  assert.deepEqual(artifactArenaAvailability({ ...COMPLETE, SANDBOX_ROOTFS: 'relative' }, '22.19.0').piRuntime,
    { enabled: false, reason: 'dependency_unavailable' });
  assert.deepEqual(artifactArenaAvailability(COMPLETE, '22.18.9').piRuntime,
    { enabled: false, reason: 'node_engine' });
  assert.deepEqual(artifactArenaAvailability({ ...COMPLETE, PI_RUNTIME_ENABLED: 'TRUE' }, '22.19.0').piRuntime,
    { enabled: false, reason: 'feature_disabled' });
});
