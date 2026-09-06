import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asOpaqueId } from '../src/shared/evaluation-types.ts';
import type {
  EvaluationAttempt,
  EvaluationInputSnapshot,
  EvaluationJobId,
  EvaluationOutboxEvent,
} from '../src/shared/evaluation-types.ts';
import { EvaluationRepositoryAdapter } from '../src/db/evaluation-repository.ts';
import type { EvaluationJobRecord } from '../src/server/evaluation/domain.ts';
import {
  InMemoryEvaluationQueue,
  EvaluationOutboxPublisher,
  EvaluationWorker,
  type EvaluationQueuePort,
  type EvaluationQueueDelivery,
  type EvaluationQueueEnvelope,
} from '../src/server/evaluation/queue/index.ts';
import type {
  EvaluationAttemptExecutor,
  EvaluationReconciliationStore,
  StaleEvaluationAttempt,
} from '../src/server/evaluation/queue/ports.ts';
import { MemoryRepository } from './helpers/memory-repository.ts';

const now = '2026-09-06T00:00:00.000Z';
const later = '2026-09-06T00:00:02.000Z';
const ids = {
  user: asOpaqueId<'user'>('user-1'),
  run: asOpaqueId<'run'>('run-1'),
  job: asOpaqueId<'evaluation-job'>('job-1'),
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

function jobRecord(state: EvaluationJobRecord['state'] = 'accepted'): EvaluationJobRecord {
  return {
    id: ids.job,
    userId: ids.user,
    purpose: 'competitive',
    association: { kind: 'competitive-run', runId: ids.run, visibility: 'hidden' },
    state,
    snapshot,
    idempotency: { scope: 'evaluation-job-create', key: 'request-1', requestDigest: 'sha256:request' },
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

function acceptedEvent(): EvaluationOutboxEvent {
  return {
    id: asOpaqueId<'evaluation-outbox-event'>('accepted:job-1'),
    version: 1,
    kind: 'evaluation-job-accepted',
    aggregateId: ids.job,
    occurredAt: now,
    requestDigest: 'sha256:request',
    payload: { jobId: ids.job, snapshotDigest: snapshot.snapshotDigest },
    publishedAt: null,
  };
}

function envelope(): EvaluationQueueEnvelope {
  return {
    eventId: asOpaqueId<'evaluation-outbox-event'>('accepted:job-1'),
    version: 1,
    kind: 'evaluation-job-accepted',
    jobId: ids.job,
    requestDigest: 'sha256:request',
    payload: { jobId: ids.job, snapshotDigest: snapshot.snapshotDigest },
    enqueuedAt: now,
  };
}

class ReplayQueue implements EvaluationQueuePort {
  ready = true;
  readonly pending: EvaluationQueueEnvelope[] = [];
  private readonly inflight = new Map<string, EvaluationQueueDelivery>();
  private deliveryNumber = 0;

  isReady(): boolean {
    return this.ready;
  }

  async enqueue(message: EvaluationQueueEnvelope): Promise<{ readonly duplicate: boolean }> {
    this.pending.push(message);
    return { duplicate: false };
  }

  async receive(): Promise<EvaluationQueueDelivery | null> {
    if (!this.ready) return null;
    const message = this.pending.shift();
    if (!message) return null;
    const delivery = { deliveryId: `delivery-${++this.deliveryNumber}`, message };
    this.inflight.set(delivery.deliveryId, delivery);
    return delivery;
  }

  async acknowledge(deliveryId: string): Promise<boolean> {
    return this.inflight.delete(deliveryId);
  }

  async reject(deliveryId: string): Promise<boolean> {
    const delivery = this.inflight.get(deliveryId);
    if (!delivery) return false;
    this.inflight.delete(deliveryId);
    this.pending.unshift(delivery.message);
    return true;
  }
}

async function createDurableJob() {
  const base = new MemoryRepository();
  const repository = new EvaluationRepositoryAdapter(base, () => now);
  await repository.createIfAbsent(jobRecord(), acceptedEvent());
  return { base, repository };
}

function completedExecutor(counter: { calls: number }): EvaluationAttemptExecutor {
  return {
    async execute() {
      counter.calls += 1;
      return { kind: 'completed', completion: { evidence: 'complete', summary: { passed: 1 } } };
    },
  };
}

function worker(
  queue: EvaluationQueuePort,
  repository: EvaluationRepositoryAdapter,
  executor: EvaluationAttemptExecutor,
  options: { readonly now?: () => string; readonly reconciliation?: EvaluationReconciliationStore } = {},
): EvaluationWorker {
  return new EvaluationWorker({
    queue,
    store: repository,
    executor,
    reconciliation: options.reconciliation,
    workerId: 'worker-a',
    leaseTtlMs: 1_000,
    now: options.now ?? (() => now),
  });
}

test('Outbox publisher claims and publishes durable rows, then does not republish published rows', async () => {
  const { repository } = await createDurableJob();
  const queue = new InMemoryEvaluationQueue();
  const publisher = new EvaluationOutboxPublisher(repository, queue, {
    publisherId: 'publisher-a',
    leaseTtlMs: 1_000,
    batchSize: 10,
    now: () => now,
  });

  const first = await publisher.publishBatch();
  const second = await publisher.publishBatch();

  assert.equal(first.claimed, 1);
  assert.equal(first.published, 1);
  assert.equal(second.claimed, 0);
  assert.equal(queue.pendingCount, 1);
});

test('queue outage leaves the durable outbox row pending for a later publisher pass', async () => {
  const { base, repository } = await createDurableJob();
  const queue = new InMemoryEvaluationQueue();
  queue.setReady(false);
  const publisher = new EvaluationOutboxPublisher(repository, queue, {
    publisherId: 'publisher-a',
    leaseTtlMs: 1_000,
    batchSize: 10,
    now: () => now,
  });

  const result = await publisher.publishBatch();
  const rows = await base.read('evaluationOutbox');

  assert.equal(result.skipped, true);
  assert.equal(result.claimed, 0);
  assert.equal(rows[0]?.status, 'pending');
});

test('duplicate queue delivery converges on one completed Attempt and one executor invocation', async () => {
  const { base, repository } = await createDurableJob();
  const queue = new ReplayQueue();
  await queue.enqueue(envelope());
  await queue.enqueue(envelope());
  const counter = { calls: 0 };
  const evaluationWorker = worker(queue, repository, completedExecutor(counter));

  const first = await evaluationWorker.processNext();
  const second = await evaluationWorker.processNext();
  const storedJob = await repository.get(ids.job);
  const baseAttempts = await base.read('evaluationAttempts');

  assert.equal(first.status, 'processed');
  assert.equal(second.status, 'duplicate');
  assert.equal(counter.calls, 1);
  assert.equal(storedJob?.state, 'completed');
  assert.equal(baseAttempts.length, 1);
  assert.equal(baseAttempts[0]?.state, 'completed');
});

test('control-plane outage prevents the worker from accepting or executing work', async () => {
  const { repository } = await createDurableJob();
  const queue = new InMemoryEvaluationQueue();
  await queue.enqueue(envelope());
  queue.setReady(false);
  const counter = { calls: 0 };
  const evaluationWorker = worker(queue, repository, completedExecutor(counter));

  const result = await evaluationWorker.processNext();

  assert.equal(result.status, 'not-ready');
  assert.equal(counter.calls, 0);
  assert.equal(queue.pendingCount, 1);
});

test('an expired outbox lease cannot be acknowledged by the old publisher', async () => {
  const { repository } = await createDurableJob();
  const first = await repository.claimOutbox({ owner: 'publisher-a', limit: 1, leaseTtlMs: 1_000, now });
  const second = await repository.claimOutbox({ owner: 'publisher-b', limit: 1, leaseTtlMs: 1_000, now: later });
  const old = first[0]!;
  const current = second[0]!;

  assert.equal(await repository.markOutboxPublished(old.id, 'publisher-a', old.leaseToken!, later), false);
  assert.equal(await repository.markOutboxPublished(current.id, 'publisher-b', current.leaseToken!, later), true);
});

test('a stale worker cannot write back after another worker fences its Attempt lease', async () => {
  const { base, repository } = await createDurableJob();
  const queue = new ReplayQueue();
  await queue.enqueue(envelope());
  let release!: () => void;
  const paused = new Promise<void>((resolve) => { release = resolve; });
  let started!: () => void;
  const startedPromise = new Promise<void>((resolve) => { started = resolve; });
  const executor: EvaluationAttemptExecutor = {
    async execute() {
      started();
      await paused;
      return { kind: 'completed', completion: { evidence: 'complete', summary: {} } };
    },
  };
  const evaluationWorker = worker(queue, repository, executor, { now: () => now });
  const processing = evaluationWorker.processNext();
  await startedPromise;
  const oldAttempt = (await base.read('evaluationAttempts'))[0]!;
  const reclaimed = await repository.createOrClaimAttempt({
    jobId: ids.job,
    deliveryKey: String(envelope().eventId),
    workerId: 'worker-b',
    leaseTtlMs: 1_000,
    now: later,
  });
  release();
  const result = await processing;

  assert.equal(reclaimed.claimed, true);
  assert.equal(result.status, 'stale-worker');
  const currentAttempt = (await base.read('evaluationAttempts'))[0]!;
  assert.notEqual(currentAttempt.workerLeaseId, oldAttempt.workerLeaseId);
  assert.equal((await repository.get(ids.job))?.state, 'running');
});

test('stale unknown upstream work is reconciled to unknown and is never automatically retried', async () => {
  const { base, repository } = await createDurableJob();
  await repository.transition(ids.job, ['accepted'], { state: 'queued', executionToken: null, updatedAt: now });
  const claimed = await repository.createOrClaimAttempt({ jobId: ids.job, deliveryKey: 'delivery-unknown', workerId: 'worker-a', leaseTtlMs: 1_000, now });
  const lease = claimed.attempt.workerLeaseId!;
  await repository.transition(ids.job, ['queued'], { state: 'running', executionToken: `worker-a:${lease}`, updatedAt: now });
  const runningAttempt = await repository.transitionAttempt({
    attemptId: claimed.attempt.id,
    workerId: 'worker-a',
    workerLeaseId: lease,
    expectedState: 'claimed',
    expectedStateVersion: 0,
    nextState: 'running',
    startedAt: now,
  });
  assert.ok(runningAttempt);

  const stale: StaleEvaluationAttempt = {
    attempt: runningAttempt,
    stateVersion: 1,
    workerId: 'worker-a',
    workerLeaseId: lease,
    upstreamState: 'unknown',
  };
  const source: EvaluationReconciliationStore = {
    async findStaleAttempts() {
      return [stale];
    },
  };
  const evaluationWorker = worker(new ReplayQueue(), repository, completedExecutor({ calls: 0 }), { reconciliation: source });

  const reconciliation = await evaluationWorker.reconcileStaleAttempts();
  const job = await repository.get(ids.job);
  const attempt = (await base.read('evaluationAttempts'))[0]!;

  assert.equal(reconciliation.markedUnknown, 1);
  assert.equal(job?.state, 'unknown');
  assert.equal(attempt.state, 'unknown');
  assert.equal(job?.failure?.code, 'UPSTREAM_RESULT_UNKNOWN');
});

test('executor exceptions become unknown and are not retried as paid work', async () => {
  const { repository } = await createDurableJob();
  const queue = new ReplayQueue();
  await queue.enqueue(envelope());
  const counter = { calls: 0 };
  const executor: EvaluationAttemptExecutor = {
    async execute() {
      counter.calls += 1;
      throw new Error('upstream response was not durably observed');
    },
  };
  const evaluationWorker = worker(queue, repository, executor);
  const first = await evaluationWorker.processNext();
  await queue.enqueue(envelope());
  const second = await evaluationWorker.processNext();

  assert.equal(first.status, 'processed');
  assert.equal(second.status, 'duplicate');
  assert.equal(counter.calls, 1);
  assert.equal((await repository.get(ids.job))?.state, 'unknown');
});

test('unknown upstream outcome is terminal for automatic delivery and does not invoke the executor again', async () => {
  const { repository } = await createDurableJob();
  const queue = new ReplayQueue();
  await queue.enqueue(envelope());
  const counter = { calls: 0 };
  const executor: EvaluationAttemptExecutor = {
    async execute() {
      counter.calls += 1;
      return { kind: 'unknown', code: 'UPSTREAM_TIMEOUT_AFTER_DISPATCH' };
    },
  };
  const evaluationWorker = worker(queue, repository, executor);
  const first = await evaluationWorker.processNext();
  await queue.enqueue(envelope());
  const second = await evaluationWorker.processNext();

  assert.equal(first.status, 'processed');
  assert.equal(second.status, 'duplicate');
  assert.equal(counter.calls, 1);
  assert.equal((await repository.get(ids.job))?.state, 'unknown');
});

test('executor cancellation fences the Attempt through cancelling before terminal cancellation', async () => {
  const { base, repository } = await createDurableJob();
  const queue = new ReplayQueue();
  await queue.enqueue(envelope());
  const evaluationWorker = worker(queue, repository, {
    async execute() {
      return { kind: 'cancelled' };
    },
  });

  const result = await evaluationWorker.processNext();
  const attempts = await base.read('evaluationAttempts');

  assert.equal(result.status, 'processed');
  assert.equal((await repository.get(ids.job))?.state, 'cancelled');
  assert.equal(attempts[0]?.state, 'cancelled');
});

test('a queued cancellation event confirms cancellation without invoking the executor', async () => {
  const { repository } = await createDurableJob();
  await repository.transition(ids.job, ['accepted'], {
    state: 'queued',
    executionToken: null,
    updatedAt: now,
  });
  await repository.transition(ids.job, ['queued'], {
    state: 'cancelling',
    cancellationReason: 'user-requested',
    cancellationRequestedAt: later,
    executionToken: null,
    updatedAt: later,
  });
  const queue = new ReplayQueue();
  await queue.enqueue({
    ...envelope(),
    eventId: asOpaqueId<'evaluation-outbox-event'>('cancel:job-1'),
    kind: 'evaluation-job-cancel-requested',
    payload: { jobId: ids.job },
    enqueuedAt: later,
  });
  const counter = { calls: 0 };
  const evaluationWorker = worker(queue, repository, completedExecutor(counter));

  const result = await evaluationWorker.processNext();

  assert.equal(result.status, 'processed');
  assert.equal(counter.calls, 0);
  assert.equal((await repository.get(ids.job))?.state, 'cancelled');
});
