import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readWorkerConfig as readConfig, missingWorkerConfiguration } from '../scripts/evaluation-worker-config.ts';

const validEnvironment = {
  DATABASE_URL: 'postgres://worker:placeholder@db.example.test:5432/agentforge',
  REDIS_URL: 'rediss://redis.example.test:6380/0',
  EVALUATION_SCHEDULER_MODE: 'outbox',
  EVALUATION_QUEUE_NAME: 'agentforge-evaluations',
  EVALUATION_QUEUE_PREFIX: 'agentforge',
  EVALUATION_WORKER_ID: 'worker-test-1',
  CREDENTIAL_ENCRYPTION_KEY: 'placeholder-base64-key',
};

const validArenaEnvironment = {
  ...validEnvironment,
  ARTIFACT_ARENA_ENABLED: 'true',
  PI_RUNTIME_ENABLED: 'true',
  SANDBOX_RUNSC_PATH: '/usr/local/bin/runsc',
  SANDBOX_ROOTFS: '/opt/agentforge/rootfs',
  SANDBOX_WORK_ROOT: '/var/lib/agentforge/sandboxes',
  SANDBOX_OCI_TEMPLATE: '/opt/agentforge/oci-template.json',
  SANDBOX_IMAGE_DIGEST: 'sha256:9db7b59979c38555a39def84a31fb98b5296952f9e3afd4f6f11f05b07adfab0',
  ARTIFACT_STORAGE_ROOT: '/var/lib/agentforge/artifacts',
  ARTIFACT_STORAGE_GID: '987',
};

test('worker configuration fails closed when required settings are missing', () => {
  assert.deepEqual(missingWorkerConfiguration({}), [
    'DATABASE_URL',
    'REDIS_URL',
    'EVALUATION_SCHEDULER_MODE',
    'EVALUATION_QUEUE_NAME',
    'EVALUATION_QUEUE_PREFIX',
    'EVALUATION_WORKER_ID',
    'CREDENTIAL_ENCRYPTION_KEY',
  ]);
  assert.throws(
    () => readConfig({ ...validEnvironment, EVALUATION_SCHEDULER_MODE: 'memory' }),
    /EVALUATION_SCHEDULER_MODE must be outbox/,
  );
});

test('worker configuration accepts explicit durable settings without logging or normalizing secrets', () => {
  const config = readConfig({
    ...validEnvironment,
    EVALUATION_WORKER_LEASE_TTL_MS: '60000',
    EVALUATION_PUBLISHER_LEASE_TTL_MS: '30000',
    EVALUATION_WORKER_CONCURRENCY: '2',
  });
  assert.equal(config.schedulerMode, 'outbox');
  assert.equal(config.queueName, 'agentforge-evaluations');
  assert.equal(config.queuePrefix, 'agentforge');
  assert.equal(config.workerId, 'worker-test-1');
  assert.equal(config.concurrency, 2);
  assert.equal(config.redisUrl, validEnvironment.REDIS_URL);
  assert.equal(config.databaseUrl, validEnvironment.DATABASE_URL);
});


test('worker keeps the legacy durable worker valid while Artifact Arena is disabled', () => {
  const config = readConfig({ ...validEnvironment, ARTIFACT_ARENA_ENABLED: 'false', PI_RUNTIME_ENABLED: 'false' });
  assert.equal(config.artifactArenaEnabled, false);
  assert.equal(config.sandboxRootfs, undefined);
});

test('worker requires every absolute sandbox and storage path when Artifact Arena is enabled', () => {
  for (const name of ['SANDBOX_RUNSC_PATH', 'SANDBOX_ROOTFS', 'SANDBOX_WORK_ROOT', 'SANDBOX_OCI_TEMPLATE', 'ARTIFACT_STORAGE_ROOT', 'ARTIFACT_STORAGE_GID'] as const) {
    const environment = { ...validArenaEnvironment };
    delete environment[name];
    assert.throws(() => readConfig(environment), new RegExp(name));
  }
  assert.throws(
    () => readConfig({ ...validArenaEnvironment, SANDBOX_ROOTFS: 'relative/rootfs' }),
    /SANDBOX_ROOTFS must be absolute/,
  );
});

test('worker requires exact Pi enablement and a pinned sha256 image digest for Artifact Arena', () => {
  assert.throws(
    () => readConfig({ ...validArenaEnvironment, PI_RUNTIME_ENABLED: 'TRUE' }),
    /PI_RUNTIME_ENABLED must be true/,
  );
  assert.throws(
    () => readConfig({ ...validArenaEnvironment, SANDBOX_IMAGE_DIGEST: 'busybox:latest' }),
    /SANDBOX_IMAGE_DIGEST/,
  );
});

test('worker accepts a complete Artifact Arena sandbox configuration', () => {
  const config = readConfig(validArenaEnvironment);
  assert.equal(config.artifactArenaEnabled, true);
  assert.equal(config.sandboxRunscPath, '/usr/local/bin/runsc');
  assert.equal(config.sandboxRootfs, '/opt/agentforge/rootfs');
  assert.equal(config.artifactStorageRoot, '/var/lib/agentforge/artifacts');
  assert.equal(config.artifactStorageGid, 987);
});
