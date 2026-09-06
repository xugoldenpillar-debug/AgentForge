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
