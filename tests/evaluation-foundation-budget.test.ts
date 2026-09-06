import assert from 'node:assert/strict';
import test from 'node:test';
import {
  InMemoryEvaluationBudgetService,
  EvaluationBudgetError,
  type EvaluationCapacityPolicy,
  type EvaluationCapacityRequest,
  type EvaluationCapacityLease,
  type EvaluationSettlementUsage
} from '../src/server/evaluation/budget/index.ts';
import {
  EvaluationInvocationError,
  InMemoryEvaluationInvocationBoundary,
  type EvaluationInvocationDispatchContext,
  type EvaluationInvocationDispatchResult,
  type EvaluationInvocationDispatcher,
  type EvaluationInvocationUsage
} from '../src/server/evaluation/invocation/index.ts';
import { asOpaqueId } from '../src/shared/evaluation-types.ts';

const ids = {
  job: asOpaqueId<'evaluation-job'>('job-budget-1'),
  attempt: asOpaqueId<'evaluation-attempt'>('attempt-1')
};
const now = '2026-09-06T00:00:00.000Z';

class RecordingCapacityPolicy implements EvaluationCapacityPolicy {
  readonly reservations: EvaluationCapacityRequest[] = [];
  readonly releases: EvaluationCapacityRequest[] = [];
  private sequence = 0;
  reject = false;

  async reserve(input: EvaluationCapacityRequest): Promise<EvaluationCapacityLease | null> {
    this.reservations.push(input);
    await Promise.resolve();
    return this.reject ? null : { token: `capacity-${++this.sequence}`, scope: input.scope };
  }

  release(input: EvaluationCapacityRequest & { readonly lease: EvaluationCapacityLease }): void {
    this.releases.push(input);
  }
}

function reservationInput(overrides: Partial<Parameters<InMemoryEvaluationBudgetService['reserve']>[0]> = {}) {
  return {
    jobId: ids.job,
    purpose: 'competitive' as const,
    kind: 'execution-budget' as const,
    scope: 'provider:demo',
    idempotencyKey: 'reservation-request-1',
    requestDigest: 'sha256:reservation-1',
    reserved: {
      inputTokens: 1000,
      outputTokens: 500,
      toolCalls: 4,
      executionMs: 10000,
      costUsd: 2
    },
    now,
    ...overrides
  };
}

function usage(overrides: Partial<EvaluationSettlementUsage> = {}): EvaluationSettlementUsage {
  return {
    id: 'usage-1',
    jobId: ids.job,
    certainty: 'known',
    chargeability: 'chargeable',
    inputTokens: 100,
    outputTokens: 50,
    toolCalls: 1,
    executionMs: 200,
    costUsd: 0.25,
    ...overrides
  };
}

function budgetHarness() {
  const capacity = new RecordingCapacityPolicy();
  const service = new InMemoryEvaluationBudgetService(capacity, { now: () => now });
  return { capacity, service };
}

test('concurrent reservation attempts create one reservation and reserve capacity once', async () => {
  const { capacity, service } = budgetHarness();
  const [first, second] = await Promise.all([
    service.reserve(reservationInput()),
    service.reserve(reservationInput())
  ]);

  assert.equal(first.changed, true);
  assert.equal(second.changed, false);
  assert.equal(first.reservation.id, second.reservation.id);
  assert.equal(capacity.reservations.length, 1);
});

test('reservation rejects a reused identity with a different digest', async () => {
  const { service } = budgetHarness();
  await service.reserve(reservationInput());

  await assert.rejects(
    service.reserve(reservationInput({ requestDigest: 'sha256:different' })),
    (error: unknown) => error instanceof EvaluationBudgetError && error.code === 'RESERVATION_CONFLICT'
  );
});

test('settlement is idempotent and concurrent duplicate settlement is not double-counted', async () => {
  const { service } = budgetHarness();
  const created = await service.reserve(reservationInput());
  const settlement = {
    reservationId: created.reservation.id,
    settlementKey: 'settlement-1',
    requestDigest: 'sha256:settlement-1',
    usage: usage(),
    finalize: false,
    now
  } as const;

  const results = await Promise.all([service.settle(settlement), service.settle(settlement)]);
  assert.equal(results.filter((result) => result.changed).length, 1);
  assert.equal(results[0].reservation.settled.costUsd, 0.25);
  assert.equal(results[1].reservation.settled.costUsd, 0.25);
  assert.equal((await service.listUsage(created.reservation.id)).length, 1);
});

test('different settlement keys can be applied concurrently without losing usage', async () => {
  const { service } = budgetHarness();
  const created = await service.reserve(reservationInput());
  const common = {
    reservationId: created.reservation.id,
    requestDigest: 'sha256:settlement',
    finalize: false,
    now
  } as const;

  const [first, second] = await Promise.all([
    service.settle({ ...common, settlementKey: 'settlement-a', usage: usage({ id: 'usage-a', costUsd: 0.1 }) }),
    service.settle({ ...common, settlementKey: 'settlement-b', usage: usage({ id: 'usage-b', costUsd: 0.2 }) })
  ]);

  const final = await service.get(created.reservation.id);
  assert.equal(first.changed, true);
  assert.equal(second.changed, true);
  assert.ok(Math.abs((final?.settled.costUsd ?? 0) - 0.3) < Number.EPSILON);
});

test('unknown usage is held for reconciliation and is never auto-released or normally settled', async () => {
  const { capacity, service } = budgetHarness();
  const created = await service.reserve(reservationInput());
  const unknown = usage({
    id: 'usage-unknown',
    certainty: 'unknown',
    chargeability: 'uncertain',
    inputTokens: null,
    outputTokens: null,
    toolCalls: null,
    executionMs: null,
    costUsd: null
  });

  const held = await service.settle({
    reservationId: created.reservation.id,
    settlementKey: 'unknown-settlement',
    requestDigest: 'sha256:unknown',
    usage: unknown,
    finalize: true,
    now
  });
  assert.equal(held.reservation.state, 'held-for-reconciliation');
  assert.equal(held.reservation.usageCertainty, 'unknown');
  assert.equal(held.reservation.chargeability, 'uncertain');
  assert.equal(held.reservation.settled.costUsd, 0);

  await assert.rejects(
    service.release({
      reservationId: created.reservation.id,
      releaseKey: 'release-1',
      requestDigest: 'sha256:release',
      now
    }),
    (error: unknown) => error instanceof EvaluationBudgetError && error.code === 'RELEASE_NOT_ALLOWED'
  );
  await assert.rejects(
    service.settle({
      reservationId: created.reservation.id,
      settlementKey: 'normal-after-unknown',
      requestDigest: 'sha256:normal-after-unknown',
      usage: usage({ id: 'usage-after-unknown' }),
      finalize: true,
      now
    }),
    (error: unknown) => error instanceof EvaluationBudgetError && error.code === 'UNCERTAIN_USAGE_REQUIRES_RECONCILIATION'
  );
  assert.equal(capacity.releases.length, 0);
});

test('explicit reconciliation can settle known usage but cannot hide a digest conflict', async () => {
  const { service } = budgetHarness();
  const created = await service.reserve(reservationInput());
  await service.settle({
    reservationId: created.reservation.id,
    settlementKey: 'unknown-settlement',
    requestDigest: 'sha256:unknown',
    usage: usage({
      id: 'usage-unknown',
      certainty: 'unknown',
      chargeability: 'uncertain',
      inputTokens: null,
      outputTokens: null,
      toolCalls: null,
      executionMs: null,
      costUsd: null
    }),
    finalize: true,
    now
  });

  const reconciled = await service.reconcile({
    reservationId: created.reservation.id,
    unknownSettlementKey: 'unknown-settlement',
    settlementKey: 'reconciliation-1',
    requestDigest: 'sha256:reconciliation',
    usage: usage({ id: 'usage-reconciled', costUsd: 0.4 }),
    finalize: true,
    now
  });
  assert.equal(reconciled.reservation.state, 'settled');
  assert.equal(reconciled.reservation.usageCertainty, 'known');
  assert.equal(reconciled.reservation.settled.costUsd, 0.4);

  await assert.rejects(
    service.reconcile({
      reservationId: created.reservation.id,
      unknownSettlementKey: 'unknown-settlement',
      settlementKey: 'reconciliation-2',
      requestDigest: 'sha256:reconciliation-2',
      usage: usage({ id: 'usage-reconciled-2' }),
      finalize: false,
      now
    }),
    (error: unknown) => error instanceof EvaluationBudgetError && error.code === 'UNCERTAIN_USAGE_REQUIRES_RECONCILIATION'
  );
});

const invocationUsage: EvaluationInvocationUsage = {
  certainty: 'known',
  chargeability: 'chargeable',
  inputTokens: 20,
  outputTokens: 10,
  reasoningTokens: 0,
  toolCalls: 1,
  latencyMs: 2000,
  costUsd: 0.1
};

function invocationHarness() {
  return new InMemoryEvaluationInvocationBoundary({
    now: () => '2026-09-06T00:00:07.000Z',
    createId: () => 'invocation-generated'
  });
}

async function prepareInvocation(boundary: InMemoryEvaluationInvocationBoundary, overrides: Record<string, unknown> = {}) {
  return boundary.prepare({
    jobId: ids.job,
    attemptId: ids.attempt,
    invocationIndex: 1,
    requestId: 'request-1',
    idempotencyKey: 'provider-idempotency-1',
    providerScope: 'provider:demo',
    providerId: 'demo',
    modelId: 'demo-model',
    requestDigest: 'sha256:request-1',
    queuedAt: '2026-09-06T00:00:00.000Z',
    preparedAt: '2026-09-06T00:00:01.000Z',
    ...overrides
  });
}

test('invocation receipt separates queue wait from model execution duration', async () => {
  const boundary = invocationHarness();
  const prepared = await prepareInvocation(boundary);
  const dispatched = await boundary.dispatch({
    invocationId: prepared.invocation.id,
    startedAt: '2026-09-06T00:00:05.000Z'
  });
  const completed = await boundary.finalize({
    invocationId: prepared.invocation.id,
    state: 'succeeded',
    requestDigest: 'sha256:request-1',
    responseDigest: 'sha256:response-1',
    providerRequestId: 'provider-request-1',
    usage: invocationUsage,
    completedAt: '2026-09-06T00:00:07.000Z'
  });

  assert.equal(dispatched.invocation.timing.queueWaitMs, 5000);
  assert.equal(completed.invocation.timing.executionDurationMs, 2000);
  assert.equal(completed.invocation.receipt?.timing.queueWaitMs, 5000);
  assert.equal(completed.invocation.receipt?.timing.executionDurationMs, 2000);
});

test('invocation digest mismatch is rejected and does not overwrite the original request', async () => {
  const boundary = invocationHarness();
  await prepareInvocation(boundary);

  await assert.rejects(
    prepareInvocation(boundary, { requestDigest: 'sha256:different' }),
    (error: unknown) => error instanceof EvaluationInvocationError && error.code === 'IDEMPOTENCY_CONFLICT'
  );
});

test('duplicate dispatch and exact prepare replay are no-ops after dispatch', async () => {
  const boundary = invocationHarness();
  const prepared = await prepareInvocation(boundary);
  const first = await boundary.dispatch({
    invocationId: prepared.invocation.id,
    startedAt: '2026-09-06T00:00:05.000Z'
  });
  const second = await boundary.dispatch({
    invocationId: prepared.invocation.id,
    startedAt: '2026-09-06T00:00:05.000Z'
  });
  const replay = await prepareInvocation(boundary);

  assert.equal(first.changed, true);
  assert.equal(second.changed, false);
  assert.equal(replay.changed, false);
  assert.equal(replay.invocation.id, prepared.invocation.id);
});

test('unknown upstream result prevents replacement invocation and automatic retry', async () => {
  const boundary = invocationHarness();
  const prepared = await prepareInvocation(boundary);
  const received: EvaluationInvocationDispatchContext[] = [];
  const dispatcher: EvaluationInvocationDispatcher = {
    async dispatch(context): Promise<EvaluationInvocationDispatchResult> {
      received.push(context);
      throw new Error('transport result unavailable');
    }
  };

  await assert.rejects(
    boundary.execute({ invocationId: prepared.invocation.id, startedAt: '2026-09-06T00:00:05.000Z' }, dispatcher),
    (error: unknown) => error instanceof EvaluationInvocationError && error.code === 'UPSTREAM_RESULT_UNKNOWN'
  );
  assert.equal(received[0]?.idempotencyKey, 'provider-idempotency-1');
  const unknown = await boundary.get(prepared.invocation.id);
  assert.equal(unknown?.state, 'unknown');
  assert.equal(unknown?.possiblyDispatched, true);

  await assert.rejects(
    prepareInvocation(boundary, {
      requestId: 'replacement-request',
      idempotencyKey: 'replacement-idempotency'
    }),
    (error: unknown) => error instanceof EvaluationInvocationError && error.code === 'REQUEST_ALREADY_UNCERTAIN'
  );
});

test('unknown invocation requires explicit reconciliation before a known terminal outcome', async () => {
  const boundary = invocationHarness();
  const prepared = await prepareInvocation(boundary);
  await boundary.dispatch({ invocationId: prepared.invocation.id, startedAt: '2026-09-06T00:00:05.000Z' });
  await boundary.finalize({
    invocationId: prepared.invocation.id,
    state: 'unknown',
    requestDigest: 'sha256:request-1',
    usage: {
      certainty: 'unknown',
      chargeability: 'uncertain',
      inputTokens: null,
      outputTokens: null,
      reasoningTokens: null,
      toolCalls: null,
      latencyMs: null,
      costUsd: null
    },
    completedAt: '2026-09-06T00:00:07.000Z'
  });
  await assert.rejects(
    boundary.finalize({
      invocationId: prepared.invocation.id,
      state: 'succeeded',
      requestDigest: 'sha256:request-1',
      responseDigest: 'sha256:response-1',
      usage: invocationUsage,
      completedAt: '2026-09-06T00:00:08.000Z'
    }),
    (error: unknown) => error instanceof EvaluationInvocationError && error.code === 'REQUEST_ALREADY_UNCERTAIN'
  );
});
