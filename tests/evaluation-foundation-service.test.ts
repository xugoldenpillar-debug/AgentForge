import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asOpaqueId } from '../src/shared/evaluation-types.ts';
import type {
  EvaluationInputSnapshot,
  EvaluationJobId,
  EvaluationJobState,
  EvaluationOutboxEvent,
  UserId
} from '../src/shared/evaluation-types.ts';
import {
  EvaluationService,
  EvaluationServiceError,
  type EvaluationJobRecord,
  type CreateEvaluationJobInput,
  type EvaluationDispatchSink,
  type EvaluationJobPatch,
  type EvaluationJobStore,
  type EvaluationTransitionGuard
} from '../src/server/evaluation/domain.ts';

class MemoryJobStore implements EvaluationJobStore {
  readonly records = new Map<string, EvaluationJobRecord>();
  readonly byIdempotency = new Map<string, string>();
  createIfAbsentCalls = 0;

  async findByIdempotency(scope: 'evaluation-job-create', key: string): Promise<EvaluationJobRecord | null> {
    const id = this.byIdempotency.get(`${scope}:${key}`);
    return id ? this.records.get(id) ?? null : null;
  }

  async createIfAbsent(
    record: EvaluationJobRecord,
    _acceptedEvent: EvaluationOutboxEvent
  ): Promise<{ readonly created: boolean; readonly record: EvaluationJobRecord }> {
    this.createIfAbsentCalls += 1;
    const key = `${record.idempotency.scope}:${record.idempotency.key}`;
    const existingId = this.byIdempotency.get(key);
    if (existingId) return { created: false, record: this.records.get(existingId)! };
    this.byIdempotency.set(key, record.id);
    this.records.set(record.id, record);
    return { created: true, record };
  }

  async get(jobId: EvaluationJobId): Promise<EvaluationJobRecord | null> {
    return this.records.get(jobId) ?? null;
  }

  async transition(
    jobId: EvaluationJobId,
    expectedStates: readonly EvaluationJobState[],
    patch: EvaluationJobPatch,
    guard?: EvaluationTransitionGuard
  ): Promise<EvaluationJobRecord | null> {
    const current = this.records.get(jobId);
    if (!current || !expectedStates.includes(current.state)) return null;
    if (guard?.executionToken !== undefined && current.executionToken !== guard.executionToken) return null;
    const next: EvaluationJobRecord = { ...current, ...patch };
    this.records.set(jobId, next);
    return next;
  }
}

class MemoryDispatchSink implements EvaluationDispatchSink {
  readonly events: EvaluationOutboxEvent[] = [];
  fail = false;

  async enqueue(event: EvaluationOutboxEvent): Promise<void> {
    if (this.fail) throw new Error('outbox unavailable');
    if (!this.events.some((existing) => existing.id === event.id)) this.events.push(event);
  }
}

const ids = {
  user: asOpaqueId<'user'>('user-1') as UserId,
  run: asOpaqueId<'run'>('run-1'),
  buildVersion: asOpaqueId<'build-version'>('build-version-1'),
  testSuite: asOpaqueId<'test-suite-version'>('test-suite-1'),
  skill: asOpaqueId<'skill-version'>('skill-version-1')
};

const snapshot: EvaluationInputSnapshot = {
  schemaVersion: 1,
  buildVersionId: ids.buildVersion,
  testSuiteVersionId: ids.testSuite,
  skillVersionId: ids.skill,
  runtimeAdapter: 'next-worker',
  modelOfferingId: 'demo-model',
  policyVersion: 'policy-1',
  consentVersion: 'consent-1',
  credentialAuthorizationId: null,
  snapshotDigest: 'sha256:snapshot',
  capturedAt: '2026-09-06T00:00:00.000Z',
  metadata: { locale: 'en-US' }
};

function input(overrides: Partial<CreateEvaluationJobInput> = {}): CreateEvaluationJobInput {
  return {
    userId: ids.user,
    purpose: 'competitive',
    association: { kind: 'competitive-run', runId: ids.run, visibility: 'hidden' },
    snapshot,
    idempotencyKey: 'request-1',
    ...overrides
  };
}

function createHarness() {
  const store = new MemoryJobStore();
  const dispatch = new MemoryDispatchSink();
  let id = 0;
  const service = new EvaluationService(store, dispatch, {
    createId: () => `id-${++id}`,
    now: (() => {
      let tick = 0;
      return () => `2026-09-06T00:00:0${++tick}.000Z`;
    })()
  });
  return { service, store, dispatch };
}

test('create is async, snapshots the request, and emits one idempotent outbox event', async () => {
  const { service, store, dispatch } = createHarness();
  const first = await service.createJob(input());

  assert.equal(first.created, true);
  assert.equal(first.job.state, 'queued');
  assert.equal(dispatch.events.length, 1);
  assert.equal(dispatch.events[0].kind, 'evaluation-job-accepted');
  assert.deepEqual(dispatch.events[0].payload.snapshot, snapshot);
  assert.equal(Object.isFrozen(first.job.snapshot), true);

  const second = await service.createJob(input());
  assert.equal(second.created, false);
  assert.equal(second.job.id, first.job.id);
  assert.equal(store.createIfAbsentCalls, 2, 'idempotent replay must pass through the atomic store seam');
  assert.equal(dispatch.events.length, 1);
});

test('same scoped idempotency key with a different request digest is rejected', async () => {
  const { service } = createHarness();
  await service.createJob(input());
  await assert.rejects(
    () => service.createJob(input({ snapshot: { ...snapshot, buildVersionId: asOpaqueId<'build-version'>('build-version-2') } })),
    (error: unknown) => error instanceof EvaluationServiceError && error.code === 'IDEMPOTENCY_CONFLICT'
  );
});

test('idempotency keys are scoped and purpose must match the one business association', async () => {
  const { service } = createHarness();
  const first = await service.createJob(input());
  const second = await service.createJob(input({
    userId: asOpaqueId<'user'>('user-2') as UserId,
    idempotencyKey: 'request-1'
  }));
  assert.notEqual(first.job.id, second.job.id);

  await assert.rejects(
    () => service.createJob(input({
      purpose: 'author-self-test',
      association: { kind: 'competitive-run', runId: ids.run, visibility: 'hidden' },
      idempotencyKey: 'request-2'
    })),
    (error: unknown) => error instanceof EvaluationServiceError && error.code === 'INVALID_ASSOCIATION'
  );
});

test('multiple business associations are rejected at the runtime boundary', async () => {
  const { service } = createHarness();
  await assert.rejects(
    () => service.createJob(input({
      association: { kind: 'competitive-run', runId: ids.run, visibility: 'hidden', selfTestRunId: 'unexpected' } as never
    })),
    (error: unknown) => error instanceof EvaluationServiceError && error.code === 'INVALID_ASSOCIATION'
  );
});

test('dispatch failure leaves an accepted job that can be retried by the same idempotent request', async () => {
  const { service, dispatch } = createHarness();
  dispatch.fail = true;
  await assert.rejects(() => service.createJob(input()));
  dispatch.fail = false;
  const retry = await service.createJob(input());
  assert.equal(retry.created, false);
  assert.equal(retry.job.state, 'queued');
  assert.equal(dispatch.events.length, 1);
});

test('claiming is race-safe and duplicate delivery cannot invoke the model twice', async () => {
  const { service } = createHarness();
  const created = await service.createJob(input());
  const [first, second] = await Promise.all([
    service.claimForExecution(created.job.id, 'worker-a'),
    service.claimForExecution(created.job.id, 'worker-b')
  ]);
  assert.equal([first, second].filter((result) => result.claimed).length, 1);
  assert.equal([first, second].filter((result) => result.reason === 'already_claimed').length, 1);
  assert.equal((await service.getJob(created.job.id)).state, 'running');
});

test('a queued cancellation can be confirmed without a worker token before execution starts', async () => {
  const { service } = createHarness();
  const created = await service.createJob(input());
  await service.requestCancellation(created.job.id);
  const confirmed = await service.confirmCancellation(created.job.id);
  assert.equal(confirmed.applied, true);
  assert.equal(confirmed.job.state, 'cancelled');
});

test('cancellation is a request first and requires executor confirmation', async () => {
  const { service } = createHarness();
  const created = await service.createJob(input());
  const claim = await service.claimForExecution(created.job.id, 'worker');
  assert(claim.executionToken);

  const requested = await service.requestCancellation(created.job.id);
  assert.equal(requested.applied, true);
  assert.equal(requested.job.state, 'cancelling');
  const confirmed = await service.confirmCancellation(created.job.id, claim.executionToken!);
  assert.equal(confirmed.applied, true);
  assert.equal(confirmed.job.state, 'cancelled');
});

test('cancellation and completion race safely; the executor that wins the transition owns the terminal result', async () => {
  const { service } = createHarness();
  const created = await service.createJob(input());
  const claim = await service.claimForExecution(created.job.id, 'worker');
  assert(claim.executionToken);

  await service.requestCancellation(created.job.id);
  const completed = await service.completeJob(created.job.id, claim.executionToken!, { evidence: 'complete' });
  assert.equal(completed.applied, true);
  assert.equal(completed.job.state, 'completed');
  const after = await service.confirmCancellation(created.job.id, claim.executionToken!);
  assert.equal(after.applied, false);
  assert.equal(after.job.state, 'completed');
});

test('completion and failure are safe to repeat but cannot overwrite terminal evidence', async () => {
  const { service } = createHarness();
  const created = await service.createJob(input());
  const claim = await service.claimForExecution(created.job.id, 'worker');
  assert(claim.executionToken);

  const completed = await service.completeJob(created.job.id, claim.executionToken!, {
    evidence: 'complete',
    summary: { passed: 1, total: 1 }
  });
  assert.equal(completed.applied, true);
  const repeated = await service.failJob(created.job.id, claim.executionToken!, { code: 'LATE_FAILURE', retryable: false });
  assert.equal(repeated.applied, false);
  assert.equal(repeated.job.state, 'completed');
  assert.equal(repeated.job.completion?.summary?.passed, 1);
});

test('stale execution tokens cannot write back after a lease change', async () => {
  const { service, store } = createHarness();
  const created = await service.createJob(input());
  const claim = await service.claimForExecution(created.job.id, 'worker');
  assert(claim.executionToken);
  await store.transition(created.job.id, ['running'], {
    state: 'running',
    executionToken: 'new-owner-token',
    updatedAt: '2026-09-06T00:00:10.000Z'
  });

  await assert.rejects(
    () => service.completeJob(created.job.id, claim.executionToken!, { evidence: 'complete' }),
    (error: unknown) => error instanceof EvaluationServiceError && error.code === 'STALE_EXECUTION'
  );
  assert.equal((await service.getJob(created.job.id)).state, 'running');
});

test('unsafe snapshot metadata is rejected before persistence or dispatch', async () => {
  const { service, store, dispatch } = createHarness();
  await assert.rejects(
    () => service.createJob(input({ snapshot: { ...snapshot, metadata: { apiKey: 'secret' } } })),
    (error: unknown) => error instanceof EvaluationServiceError && error.code === 'UNSAFE_SNAPSHOT'
  );
  assert.equal(store.records.size, 0);
  assert.equal(dispatch.events.length, 0);
});

test('partial completion is incomplete and cannot imply a competitive submission', async () => {
  const { service } = createHarness();
  const created = await service.createJob(input());
  const claim = await service.claimForExecution(created.job.id, 'worker');
  assert(claim.executionToken);
  const result = await service.completeJob(created.job.id, claim.executionToken!, {
    evidence: 'partial',
    summary: { completedCases: 1, totalCases: 2 }
  });
  assert.equal(result.job.state, 'incomplete');
  assert.equal(result.job.association.kind, 'competitive-run');
});

test('unknown upstream state is recorded without automatic retry', async () => {
  const { service } = createHarness();
  const created = await service.createJob(input());
  const claim = await service.claimForExecution(created.job.id, 'worker');
  assert(claim.executionToken);
  const result = await service.markUnknown(created.job.id, claim.executionToken!);
  assert.equal(result.job.state, 'unknown');
  assert.equal((await service.claimForExecution(created.job.id, 'other')).reason, 'not_queued');
});
