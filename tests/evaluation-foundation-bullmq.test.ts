import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BullMqEvaluationQueue,
  bullMqEvaluationQueueOptionsFromEnv,
  validateAndCloneBullMqEnvelope,
} from '../src/server/evaluation/queue/bullmq.ts';
import { EvaluationQueueProtocolError } from '../src/server/evaluation/queue/errors.ts';
import type { EvaluationQueueEnvelope } from '../src/server/evaluation/queue/ports.ts';
import { asOpaqueId } from '../src/shared/evaluation-types.ts';

const envelope = (suffix = 'one'): EvaluationQueueEnvelope => ({
  eventId: asOpaqueId<'evaluation-outbox-event'>(`event-${suffix}`),
  version: 1,
  kind: 'evaluation-job-accepted',
  jobId: asOpaqueId<'evaluation-job'>(`job-${suffix}`),
  requestDigest: 'sha256:request',
  payload: {
    jobId: `job-${suffix}`,
    snapshotDigest: 'sha256:snapshot',
    version: 1,
    credentialAuthorizationId: 'authorization-id-only',
  },
  enqueuedAt: '2026-09-06T00:00:00.000Z',
});

test('BullMQ configuration is explicit and environment-driven without an in-memory fallback', () => {
  assert.deepEqual(
    bullMqEvaluationQueueOptionsFromEnv({
      REDIS_URL: 'rediss://user:password@example.test:6380/2',
      EVALUATION_QUEUE_NAME: 'evaluation-test',
      EVALUATION_QUEUE_PREFIX: 'agentforge:evaluation',
      EVALUATION_QUEUE_READINESS_TIMEOUT_MS: '250',
    }),
    {
      redisUrl: 'rediss://user:password@example.test:6380/2',
      queueName: 'evaluation-test',
      prefix: 'agentforge:evaluation',
      readinessTimeoutMs: 250,
    },
  );
  assert.equal(bullMqEvaluationQueueOptionsFromEnv({}), null);
});

test('BullMQ payload validation clones control data and rejects unsupported or sensitive fields', () => {
  const original = envelope();
  const cloned = validateAndCloneBullMqEnvelope(original);
  assert.deepEqual(cloned, original);
  assert.notEqual(cloned, original);
  assert.notEqual(cloned.payload, original.payload);

  assert.throws(
    () => validateAndCloneBullMqEnvelope({ ...original, version: 999 }),
    (error: unknown) => error instanceof EvaluationQueueProtocolError,
  );
  assert.throws(
    () => validateAndCloneBullMqEnvelope({
      ...original,
      payload: { jobId: 'job-one', prompt: 'must not be queued' },
    }),
    (error: unknown) => error instanceof EvaluationQueueProtocolError,
  );
  assert.throws(
    () => validateAndCloneBullMqEnvelope({
      ...original,
      payload: { jobId: 'job-one', credentials: { apiKey: 'must not be queued' } },
    }),
    (error: unknown) => error instanceof EvaluationQueueProtocolError,
  );
});

test('unavailable Redis fails closed for enqueue and does not fall back to memory', async () => {
  const queue = new BullMqEvaluationQueue({
    redisUrl: 'redis://127.0.0.1:63999',
    queueName: 'evaluation-unavailable-test',
    prefix: 'agentforge-test',
    readinessTimeoutMs: 50,
  });
  try {
    assert.equal(await queue.isReady(), false);
    assert.equal(queue.readinessReason(), 'redis-control-plane-unavailable');
    await assert.rejects(
      () => queue.enqueue(envelope('unavailable')),
      (error: unknown) => error instanceof Error && 'code' in error && error.code === 'EVALUATION_QUEUE_UNAVAILABLE',
    );
  } finally {
    await queue.close();
  }
});

test('live Redis/BullMQ delivery path publishes, de-duplicates, receives, and acknowledges', {
  skip: !process.env.REDIS_URL,
}, async () => {
  const queue = new BullMqEvaluationQueue({
    redisUrl: process.env.REDIS_URL!,
    queueName: `evaluation-live-${Date.now()}`,
    prefix: process.env.EVALUATION_QUEUE_PREFIX ?? 'agentforge-test',
    readinessTimeoutMs: 1_000,
    completedJobRetentionSeconds: 60,
    failedJobRetentionSeconds: 60,
  });
  try {
    assert.equal(await queue.isReady(), true, queue.readinessReason());
    assert.deepEqual(await queue.enqueue(envelope('live')), { duplicate: false });
    assert.deepEqual(await queue.enqueue(envelope('live')), { duplicate: true });

    const delivery = await queue.receive();
    assert.ok(delivery);
    assert.equal(delivery.message.eventId, 'event-live');
    assert.equal(await queue.acknowledge(delivery.deliveryId), true);
    assert.equal(await queue.receive(), null);
  } finally {
    await queue.close();
  }
});
