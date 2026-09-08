import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { asOpaqueId } from '../src/shared/evaluation-types.ts';
import type {
  EvaluationInputSnapshot,
  EvaluationJobId,
  EvaluationOutboxEvent,
  EvaluationUsageRecord,
} from '../src/shared/evaluation-types.ts';
import { EvaluationRepositoryAdapter, EvaluationPersistenceError } from '../src/db/evaluation-repository.ts';
import type { EvaluationJobRecord } from '../src/server/evaluation/domain.ts';
import { MemoryRepository } from './helpers/memory-repository.ts';
import type { Run } from '../src/shared/types.ts';

const now = '2026-09-06T00:00:00.000Z';
const ids = {
  user: asOpaqueId<'user'>('user-1'),
  run: asOpaqueId<'run'>('run-1'),
  job: asOpaqueId<'evaluation-job'>('job-1'),
  attempt: asOpaqueId<'evaluation-attempt'>('attempt-1'),
  invocation: asOpaqueId<'evaluation-invocation'>('invocation-1'),
};
const snapshot: EvaluationInputSnapshot = {
  schemaVersion: 1,
  buildVersionId: asOpaqueId<'build-version'>('build-version-1'),
  testSuiteVersionId: asOpaqueId<'test-suite-version'>('suite-1'),
  skillVersionId: asOpaqueId<'skill-version'>('skill-1'),
  runtimeAdapter: 'next-worker',
  modelOfferingId: 'demo-model',
  policyVersion: 'policy-1',
  consentVersion: 'consent-1',
  credentialAuthorizationId: null,
  snapshotDigest: 'sha256:snapshot',
  capturedAt: now,
  metadata: { visibility: 'hidden' },
};

function jobRecord(requestDigest = 'sha256:request'): EvaluationJobRecord {
  return {
    id: ids.job,
    userId: ids.user,
    purpose: 'competitive',
    association: { kind: 'competitive-run', runId: ids.run, visibility: 'hidden' },
    state: 'accepted',
    snapshot,
    idempotency: { scope: 'evaluation-job-create', key: 'request-1', requestDigest },
    budgetReservationId: null,
    cancellationReason: null,
    acceptedAt: now,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    executionToken: null,
    cancellationRequestedAt: null,
    completion: null,
    failure: null,
  };
}

function acceptedEvent(job: EvaluationJobId = ids.job, requestDigest = 'sha256:request'): EvaluationOutboxEvent {
  return {
    id: asOpaqueId<'evaluation-outbox-event'>(`accepted:${job}`),
    version: 1,
    kind: 'evaluation-job-accepted',
    aggregateId: job,
    occurredAt: now,
    requestDigest,
    payload: { jobId: job, snapshotDigest: snapshot.snapshotDigest },
    publishedAt: null,
  };
}

async function createRepository() {
  const base = new MemoryRepository();
  const repository = new EvaluationRepositoryAdapter(base, () => now);
  await repository.createIfAbsent(jobRecord(), acceptedEvent());
  return { base, repository };
}

test('migration is additive, names every durable table, and leaves earlier files unchanged', async () => {
  const migration = await readFile(new URL('../src/db/migrations/0006_evaluation_foundation.sql', import.meta.url), 'utf8');
  const freshSchema = await readFile(new URL('../src/db/schema.sql', import.meta.url), 'utf8');
  for (const table of [
    'evaluation_jobs',
    'evaluation_attempts',
    'evaluation_invocations',
    'evaluation_usage_records',
    'evaluation_idempotency_keys',
    'evaluation_budget_reservations',
    'evaluation_outbox',
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}`));
    assert.match(freshSchema, new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}`));
  }
  assert.doesNotMatch(migration, /\b(?:BEGIN|COMMIT|END|ROLLBACK|TRANSACTION)\b/i);
  const baseline = await readFile(new URL('../src/db/migrations/0001_initial_schema.sql', import.meta.url), 'utf8');
  const issuerMigration = await readFile(new URL('../src/db/migrations/0002_accounts_issuer.sql', import.meta.url), 'utf8');
  assert.doesNotMatch(baseline, /evaluation_/);
  assert.doesNotMatch(issuerMigration, /evaluation_/);
});

test('creating a durable job leaves historical runs untouched and does not backfill them', async () => {
  const base = new MemoryRepository();
  const historicalRun: Run = {
    id: ids.run,
    buildId: 'build-1',
    versionId: 'version-1',
    problemId: 'problem-1',
    userId: ids.user,
    kind: 'hidden',
    tier: 'demo',
    status: 'completed',
    summary: null,
    createdAt: now,
  };
  await base.insert('runs', [historicalRun]);
  const repository = new EvaluationRepositoryAdapter(base, () => now);
  await repository.createIfAbsent(jobRecord(), acceptedEvent());
  assert.deepEqual(await base.read('runs'), [historicalRun]);
  assert.equal((await base.read('evaluationJobs')).length, 1);
  assert.equal((await base.read('evaluationAttempts')).length, 0);
});

test('creation job association failure rolls back the job, idempotency row, and outbox together', async () => {
  const base = new MemoryRepository();
  const repository = new EvaluationRepositoryAdapter(base, () => now);
  const record: EvaluationJobRecord = {
    ...jobRecord('sha256:creation-request'),
    id: asOpaqueId<'evaluation-job'>('creation-job-missing-run'),
    purpose: 'creation',
    association: {
      kind: 'creation-run',
      creationRunId: asOpaqueId<'creation-run'>('creation-run-missing'),
    },
    idempotency: {
      scope: 'evaluation-job-create',
      key: 'creation-request',
      requestDigest: 'sha256:creation-request',
    },
  };

  await assert.rejects(
    repository.createIfAbsent(record, acceptedEvent(record.id, record.idempotency.requestDigest)),
    (error: unknown) => error instanceof EvaluationPersistenceError && error.code === 'not-found',
  );
  assert.equal((await base.read('evaluationJobs')).length, 0);
  assert.equal((await base.read('evaluationIdempotencyKeys')).length, 0);
  assert.equal((await base.read('evaluationOutbox')).length, 0);
});

test('same idempotency key is replay-safe and a different digest is rejected', async () => {
  const { repository } = await createRepository();
  const replay = await repository.createIfAbsent(jobRecord(), acceptedEvent());
  assert.equal(replay.created, false);
  assert.equal(replay.record.id, ids.job);
  await assert.rejects(
    () => repository.createIfAbsent(jobRecord('sha256:different'), acceptedEvent(ids.job, 'sha256:different')),
    (error: unknown) => error instanceof EvaluationPersistenceError && error.code === 'idempotency-conflict',
  );
});

test('outbox and invocation delivery identities cannot be duplicated', async () => {
  const { base, repository } = await createRepository();
  const firstAttempt = await repository.createOrClaimAttempt({
    jobId: ids.job,
    deliveryKey: 'delivery-1',
    workerId: 'worker-a',
    leaseTtlMs: 10_000,
    now,
  });
  assert.equal(firstAttempt.created, true);
  const secondAttempt = await repository.createOrClaimAttempt({
    jobId: ids.job,
    deliveryKey: 'delivery-1',
    workerId: 'worker-b',
    leaseTtlMs: 10_000,
    now,
  });
  assert.equal(secondAttempt.created, false);
  assert.equal(secondAttempt.attempt.id, firstAttempt.attempt.id);
  const firstInvocation = await repository.createInvocation({
    id: ids.invocation,
    jobId: ids.job,
    attemptId: firstAttempt.attempt.id,
    invocationIndex: 1,
    requestId: 'request-id-1',
    idempotencyKey: 'provider-key-1',
    providerScope: 'demo',
    providerId: 'demo',
    modelId: 'demo-model',
    requestDigest: 'sha256:invocation',
  });
  const duplicate = await repository.createInvocation({
    id: asOpaqueId<'evaluation-invocation'>('invocation-2'),
    jobId: ids.job,
    attemptId: firstAttempt.attempt.id,
    invocationIndex: 1,
    requestId: 'request-id-1',
    idempotencyKey: 'provider-key-1',
    providerScope: 'demo',
    providerId: 'demo',
    modelId: 'demo-model',
    requestDigest: 'sha256:invocation',
  });
  assert.equal(firstInvocation.created, true);
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.invocation.id, ids.invocation);
  assert.equal((await base.read('evaluationOutbox')).length, 1);
  assert.equal((await base.read('evaluationInvocations')).length, 1);
});

test('unknown usage remains explicitly unknown instead of becoming zero usage', async () => {
  const { base, repository } = await createRepository();
  const attempt = await repository.createOrClaimAttempt({ jobId: ids.job, deliveryKey: 'delivery-1', workerId: 'worker-a', leaseTtlMs: 10_000, now });
  const invocation = await repository.createInvocation({
    id: ids.invocation,
    jobId: ids.job,
    attemptId: attempt.attempt.id,
    invocationIndex: 1,
    requestId: 'request-id-1',
    idempotencyKey: 'provider-key-1',
    providerScope: 'demo',
    providerId: 'demo',
    modelId: 'demo-model',
    requestDigest: 'sha256:invocation',
  });
  const usage: EvaluationUsageRecord = {
    id: asOpaqueId<'evaluation-usage-record'>('usage-1'),
    jobId: ids.job,
    attemptId: attempt.attempt.id,
    invocationId: invocation.invocation.id,
    certainty: 'unknown',
    chargeability: 'uncertain',
    inputTokens: null,
    outputTokens: null,
    reasoningTokens: null,
    toolCalls: null,
    latencyMs: null,
    costUsd: null,
    providerRequestId: null,
    evidenceRef: 'reconciliation-required',
    recordedAt: now,
  };
  await repository.finalizeInvocation({
    invocationId: invocation.invocation.id,
    state: 'unknown',
    usage,
    now,
  });
  const stored = (await base.read('evaluationUsageRecords'))[0];
  assert.equal(stored.certainty, 'unknown');
  assert.equal(stored.inputTokens, null);
  assert.equal(stored.outputTokens, null);
  assert.equal(stored.costUsd, null);
});

test('stale attempt lease cannot write after a new lease fences the old worker', async () => {
  const { base, repository } = await createRepository();
  const first = await repository.createOrClaimAttempt({ jobId: ids.job, deliveryKey: 'delivery-1', workerId: 'worker-a', leaseTtlMs: 1_000, now });
  const second = await repository.createOrClaimAttempt({
    jobId: ids.job,
    deliveryKey: 'delivery-1',
    workerId: 'worker-b',
    leaseTtlMs: 10_000,
    now: '2026-09-06T00:00:02.000Z',
  });
  assert.equal(second.claimed, true);
  const staleWrite = await repository.transitionAttempt({
    attemptId: first.attempt.id,
    workerId: 'worker-a',
    workerLeaseId: first.attempt.workerLeaseId!,
    expectedState: 'claimed',
    expectedStateVersion: (await base.read('evaluationAttempts'))[0].stateVersion,
    nextState: 'running',
    startedAt: '2026-09-06T00:00:03.000Z',
  });
  assert.equal(staleWrite, null);
});
