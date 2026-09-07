import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { ArenaService } from '../src/server/service.ts';
import { EvaluationRepositoryAdapter } from '../src/db/evaluation-repository.ts';
import { MemoryRepository } from './helpers/memory-repository.ts';
import { seedTestArena } from './helpers/seed-arena.ts';
import { testWorkflow } from './helpers/workflow.ts';
import { TEST_CASES } from '../src/server/fixtures.ts';
import { createDurableOutboxCompetitiveRunScheduler } from '../src/server/evaluation/runtime.ts';
import { CompetitiveEvaluationExecutor } from '../src/server/evaluation/competitive-executor.ts';
import {
  EvaluationOutboxPublisher,
  EvaluationWorker,
  InMemoryEvaluationQueue,
} from '../src/server/evaluation/queue/index.ts';
import type {
  EvaluationAttempt,
  EvaluationInputSnapshot,
  EvaluationOutboxEvent,
  EvaluationWorkerMessage,
} from '../src/shared/evaluation-types.ts';
import { asOpaqueId } from '../src/shared/evaluation-types.ts';
import type { EvaluationJobRecord } from '../src/server/evaluation/domain.ts';
import type {
  EvaluationAttemptExecutor,
  EvaluationQueueDelivery,
  EvaluationQueueEnvelope,
  EvaluationQueuePort,
  EvaluationReconciliationStore,
  StaleEvaluationAttempt,
} from '../src/server/evaluation/queue/ports.ts';
import { createEvaluationWorkerRuntime, runEvaluationWorkerLoop } from '../scripts/evaluation-worker.ts';
import type { AIProvider } from '../src/lib/ai/types.ts';
import type { User } from '../src/shared/types.ts';

const now = '2026-09-06T00:00:00.000Z';
const later = '2026-09-06T00:00:02.000Z';
const ids = {
  user: asOpaqueId<'user'>('worker-user'),
  run: asOpaqueId<'run'>('worker-run'),
  job: asOpaqueId<'evaluation-job'>('worker-job'),
};
const snapshot: EvaluationInputSnapshot = {
  schemaVersion: 1,
  buildVersionId: asOpaqueId<'build-version'>('worker-version'),
  testSuiteVersionId: asOpaqueId<'test-suite-version'>('worker-suite'),
  skillVersionId: null,
  runtimeAdapter: 'next-worker',
  modelOfferingId: 'demo-forge',
  policyVersion: 'policy-1',
  consentVersion: null,
  credentialAuthorizationId: null,
  snapshotDigest: 'sha256:worker-snapshot',
  capturedAt: now,
  metadata: {
    visibility: 'hidden',
    testCaseIds: ['case-1'],
  },
};

function jobRecord(state: EvaluationJobRecord['state'] = 'accepted'): EvaluationJobRecord {
  return {
    id: ids.job,
    userId: ids.user,
    purpose: 'competitive',
    association: { kind: 'competitive-run', runId: ids.run, visibility: 'hidden' },
    state,
    snapshot,
    idempotency: { scope: 'evaluation-job-create', key: 'worker-request', requestDigest: 'sha256:worker-request' },
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
    id: asOpaqueId<'evaluation-outbox-event'>('worker-event'),
    version: 1,
    kind: 'evaluation-job-accepted',
    aggregateId: ids.job,
    occurredAt: now,
    requestDigest: 'sha256:worker-request',
    payload: { jobId: ids.job, snapshotDigest: snapshot.snapshotDigest },
    publishedAt: null,
  };
}

function envelope(): EvaluationQueueEnvelope {
  return {
    eventId: asOpaqueId<'evaluation-outbox-event'>('worker-event'),
    version: 1,
    kind: 'evaluation-job-accepted',
    jobId: ids.job,
    requestDigest: 'sha256:worker-request',
    payload: { jobId: ids.job, snapshotDigest: snapshot.snapshotDigest },
    enqueuedAt: now,
  };
}

class ReplayQueue implements EvaluationQueuePort {
  ready = true;
  readonly pending: EvaluationQueueEnvelope[] = [];
  private readonly inFlight = new Map<string, EvaluationQueueDelivery>();
  private deliveryNumber = 0;

  isReady(): boolean {
    return this.ready;
  }

  async enqueue(message: EvaluationQueueEnvelope): Promise<{ readonly duplicate: boolean }> {
    this.pending.push(structuredClone(message));
    return { duplicate: false };
  }

  async receive(): Promise<EvaluationQueueDelivery | null> {
    if (!this.ready) return null;
    const message = this.pending.shift();
    if (!message) return null;
    const delivery = { deliveryId: `delivery-${++this.deliveryNumber}`, message };
    this.inFlight.set(delivery.deliveryId, delivery);
    return delivery;
  }

  async acknowledge(deliveryId: string): Promise<boolean> {
    return this.inFlight.delete(deliveryId);
  }

  async reject(deliveryId: string): Promise<boolean> {
    const delivery = this.inFlight.get(deliveryId);
    if (!delivery) return false;
    this.inFlight.delete(deliveryId);
    this.pending.unshift(delivery.message);
    return true;
  }
}

async function durableJob() {
  const base = new MemoryRepository();
  const repository = new EvaluationRepositoryAdapter(base, () => now);
  await repository.createIfAbsent(jobRecord(), acceptedEvent());
  return { base, repository };
}

function makeWorker(
  queue: EvaluationQueuePort,
  repository: EvaluationRepositoryAdapter,
  executor: EvaluationAttemptExecutor,
  options: {
    readonly reconciliation?: EvaluationReconciliationStore;
    readonly now?: () => string;
    readonly leaseTtlMs?: number;
  } = {},
): EvaluationWorker {
  return new EvaluationWorker({
    queue,
    store: repository,
    executor,
    reconciliation: options.reconciliation,
    workerId: 'worker-execution-test',
    leaseTtlMs: options.leaseTtlMs ?? 1_000,
    now: options.now ?? (() => now),
  });
}

function successfulExecutor(counter: { calls: number }): EvaluationAttemptExecutor {
  return {
    async execute() {
      counter.calls += 1;
      return { kind: 'completed', completion: { evidence: 'complete', summary: { passed: 1 } } };
    },
  };
}

test('independent worker executes a successful delivery exactly once', async () => {
  const { base, repository } = await durableJob();
  const queue = new ReplayQueue();
  await queue.enqueue(envelope());
  await queue.enqueue(envelope());
  const counter = { calls: 0 };
  const worker = makeWorker(queue, repository, successfulExecutor(counter));

  const first = await worker.processNext();
  const second = await worker.processNext();

  assert.equal(first.status, 'processed');
  assert.equal(second.status, 'duplicate');
  assert.equal(counter.calls, 1);
  assert.equal((await repository.get(ids.job))?.state, 'completed');
  assert.equal((await base.read('evaluationAttempts')).length, 1);
  assert.equal((await base.read('evaluationAttempts'))[0]?.state, 'completed');
});

test('independent worker executes a frozen competitive run and records invocation usage', async () => {
  const fixture = await competitiveFixture();
  const accepted = await fixture.service.scheduleCompetitiveRun(fixture.user.id, {
    buildId: fixture.build.id,
    kind: 'hidden',
    idempotencyKey: 'worker-competitive-success',
  });

  const result = await executeScheduledCompetitiveJob(fixture, accepted.job.id);
  const job = await fixture.evaluationRepository.get(accepted.job.id);
  const run = (await fixture.repo.read('runs', { id: accepted.run.id }))[0];
  const invocations = await fixture.repo.read('evaluationInvocations', { jobId: accepted.job.id });
  const usage = await fixture.repo.read('evaluationUsageRecords', { jobId: accepted.job.id });

  assert.equal(result.status, 'processed');
  assert.equal(job?.state, 'completed');
  assert.equal(run?.status, 'completed');
  assert.ok(invocations.length > 0);
  assert.ok(invocations.every((invocation) => invocation.state === 'succeeded'));
  assert.equal(usage.length, invocations.length);
  assert.ok(usage.every((record) => record.certainty === 'known'));
  assert.equal((await fixture.repo.read('submissions', { runId: accepted.run.id })).length, 1);
});

test('provider authorization revocation fails before dispatch and creates no Submission', async () => {
  const fixture = await competitiveFixture({
    providerExecute: async () => {
      throw new Error('provider must not be called after revocation');
    },
  });
  const credential = await fixture.service.addProvider(fixture.user.id, {
    name: 'Revocable provider',
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'sk-worker-revocation-test',
    modelId: 'revocable-model',
  });
  const workflow = testWorkflow('json');
  for (const node of workflow.nodes.filter((candidate) => candidate.kind === 'model')) {
    node.config.credentialId = credential.id;
    node.config.modelId = 'revocable-model';
  }
  const build = await fixture.service.saveBuild(fixture.user.id, {
    problemId: 'messy-json',
    title: 'Revocation worker build',
    visibility: 'public',
    workflow,
  });
  const accepted = await fixture.service.scheduleCompetitiveRun(fixture.user.id, {
    buildId: build.id,
    kind: 'hidden',
    consent: true,
    idempotencyKey: 'worker-provider-revocation',
  });
  await fixture.service.deleteProvider(fixture.user.id, credential.id);

  const result = await executeScheduledCompetitiveJob(fixture, accepted.job.id);
  const job = await fixture.evaluationRepository.get(accepted.job.id);
  const run = (await fixture.repo.read('runs', { id: accepted.run.id }))[0];

  assert.equal(result.status, 'processed');
  assert.equal(job?.state, 'failed');
  assert.equal(job?.failure?.code, 'PROVIDER_NOT_FOUND');
  assert.equal(run?.status, 'failed');
  assert.equal((await fixture.repo.read('submissions', { runId: accepted.run.id })).length, 0);
});

test('unknown upstream failure is persisted and never automatically retried', async () => {
  const { repository } = await durableJob();
  const queue = new ReplayQueue();
  await queue.enqueue(envelope());
  const counter = { calls: 0 };
  const worker = makeWorker(queue, repository, {
    async execute() {
      counter.calls += 1;
      throw new Error('response lost after provider dispatch');
    },
  });

  const first = await worker.processNext();
  await queue.enqueue(envelope());
  const second = await worker.processNext();

  assert.equal(first.status, 'processed');
  assert.equal(second.status, 'duplicate');
  assert.equal(counter.calls, 1);
  assert.equal((await repository.get(ids.job))?.state, 'unknown');
});

test('lease loss fences stale write-back and leaves reconciliation as the authority', async () => {
  const { repository } = await durableJob();
  const queue = new ReplayQueue();
  await queue.enqueue(envelope());
  const originalRenew = repository.renewAttemptLease.bind(repository);
  repository.renewAttemptLease = async () => null;
  const worker = makeWorker(queue, repository, {
    async execute() {
      await new Promise((resolve) => setTimeout(resolve, 1_100));
      return { kind: 'completed', completion: { evidence: 'complete', summary: {} } };
    },
  }, { leaseTtlMs: 3_000 });

  const result = await worker.processNext();
  repository.renewAttemptLease = originalRenew;

  assert.equal(result.status, 'stale-worker');
  assert.equal((await repository.get(ids.job))?.state, 'running');
  assert.equal((await repository.get(ids.job))?.completion, null);
});

test('worker loop handles graceful stop, drains in-flight work, and reconciles stale attempts', async () => {
  const { repository } = await durableJob();
  const queue = new ReplayQueue();
  const controller = new AbortController();
  let markStarted!: () => void;
  const startedPromise = new Promise<void>((resolve) => { markStarted = resolve; });
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  let executorCalls = 0;
  const reconciliationCalls: number[] = [];
  const source: EvaluationReconciliationStore = {
    async findStaleAttempts(input) {
      reconciliationCalls.push(input.limit);
      return [];
    },
  };
  await queue.enqueue(envelope());

  const runtime = createEvaluationWorkerRuntime({
    queue,
    store: repository,
    executor: {
      async execute() {
        executorCalls += 1;
        markStarted();
        controller.abort();
        await blocked;
        return { kind: 'completed', completion: { evidence: 'complete', summary: {} } };
      },
    },
    reconciliation: source,
    workerId: 'worker-loop-test',
    leaseTtlMs: 1_000,
    outbox: repository,
    publisherId: 'publisher-loop-test',
    publisherLeaseTtlMs: 1_000,
    publisherBatchSize: 10,
    now: () => now,
  });

  const loop = runEvaluationWorkerLoop(runtime, {
    signal: controller.signal,
    pollIntervalMs: 1,
    reconciliationIntervalMs: 0,
    installSignalHandlers: false,
  });
  await startedPromise;
  let settled = false;
  void loop.then(() => { settled = true; });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(settled, false);
  release();
  await loop;
  assert.equal(executorCalls, 1);
  assert.ok(reconciliationCalls.length >= 2);
});

test('incomplete and unknown competitive outcomes never create Submission rows', async () => {
  const partialFixture = await competitiveFixture();
  const partial = await partialFixture.service.scheduleCompetitiveRun(partialFixture.user.id, {
    buildId: partialFixture.build.id,
    kind: 'hidden',
    idempotencyKey: 'worker-partial-no-submission',
  });
  const problem = (await partialFixture.repo.read('problems', { id: 'messy-json' }))[0]!;
  const partialCase = TEST_CASES.find((candidate) => candidate.problemId === 'messy-json' && candidate.visibility === 'hidden')!;
  await partialFixture.service.completeCompetitiveRun({
    runId: partial.run.id,
    userId: partialFixture.user.id,
    buildId: partialFixture.build.id,
    versionId: partialFixture.build.currentVersionId,
    problemId: problem.id,
    kind: 'hidden',
    tier: 'demo',
    model: 'demo-forge',
    workflow: testWorkflow('json'),
    constraints: problem.constraints,
    results: [{
      caseId: partialCase.id,
      category: partialCase.category,
      passed: true,
      secure: true,
      failureType: null,
      inputTokens: 1,
      outputTokens: 1,
      reasoningTokens: 0,
      toolCalls: 0,
      latency: 1,
      cost: 0,
      estimated: true,
    }],
    evidence: 'partial',
  });
  assert.equal((await partialFixture.repo.read('submissions', { runId: partial.run.id })).length, 0);

  const unknownFixture = await competitiveFixture();
  const unknown = await unknownFixture.service.scheduleCompetitiveRun(unknownFixture.user.id, {
    buildId: unknownFixture.build.id,
    kind: 'hidden',
    idempotencyKey: 'worker-unknown-no-submission',
  });
  await unknownFixture.service.failCompetitiveRun({
    runId: unknown.run.id,
    userId: unknownFixture.user.id,
  });
  assert.equal((await unknownFixture.repo.read('submissions', { runId: unknown.run.id })).length, 0);
});

async function executeScheduledCompetitiveJob(
  fixture: CompetitiveFixture,
  jobId: string,
): Promise<{ readonly status: string }> {
  const executionNow = new Date().toISOString();
  const publisher = new EvaluationOutboxPublisher(fixture.evaluationRepository, fixture.queue, {
    publisherId: 'worker-execution-publisher',
    leaseTtlMs: 1_000,
    batchSize: 10,
    now: () => executionNow,
  });
  await publisher.publishBatch();
  const executor = new CompetitiveEvaluationExecutor({
    service: fixture.service,
    repository: fixture.repo,
    evaluationRepository: fixture.evaluationRepository,
    now: () => executionNow,
  });
  const worker = new EvaluationWorker({
    queue: fixture.queue,
    store: fixture.evaluationRepository,
    executor,
    workerId: 'worker-execution-real',
    leaseTtlMs: 1_000,
    now: () => executionNow,
  });
  const result = await worker.processNext();
  assert.equal(String(result.jobId), jobId);
  return result;
}

interface CompetitiveFixture {
  readonly repo: MemoryRepository;
  readonly service: ArenaService;
  readonly user: User;
  readonly build: Awaited<ReturnType<ArenaService['saveBuild']>>;
  readonly evaluationRepository: EvaluationRepositoryAdapter;
  readonly queue: InMemoryEvaluationQueue;
}

async function competitiveFixture(options: {
  readonly providerExecute?: AIProvider['execute'];
} = {}): Promise<CompetitiveFixture> {
  const repo = new MemoryRepository();
  const user: User = {
    id: `worker-user-${Math.random().toString(16).slice(2)}`,
    name: 'Worker Test User',
    email: 'worker@example.invalid',
    emailVerified: false,
    image: null,
    createdAt: now,
    updatedAt: now,
    elo: 1000,
    reputation: 0,
    isSeed: false,
  };
  await seedTestArena(repo, user);
  const encryptionKey = randomBytes(32).toString('base64');
  const providerExecute = options.providerExecute ?? (async () => ({
    text: '{}',
    inputTokens: 1,
    outputTokens: 1,
    reasoningTokens: 0,
    toolCalls: 0,
    latency: 1,
    cost: 0,
    estimated: false,
  }));
  const service = new ArenaService(repo, {
    demoMode: true,
    encryptionKey,
    allowedHosts: ['api.example.com'],
    createRealProvider: () => ({
      id: 'real-worker-provider',
      pricing: { inputPrice: 0, outputPrice: 0 },
      execute: providerExecute,
    }),
    competitiveRunScheduler: createDurableOutboxCompetitiveRunScheduler(repo),
  });
  const build = await service.saveBuild(user.id, {
    problemId: 'messy-json',
    title: 'Worker test build',
    visibility: 'public',
    workflow: testWorkflow('json'),
  });
  const evaluationRepository = new EvaluationRepositoryAdapter(repo, () => now);
  return {
    repo,
    service,
    user,
    build,
    evaluationRepository,
    queue: new InMemoryEvaluationQueue(),
  };
}

test('Agent draft enqueue fails before provider, job, outbox and invocation side effects', async () => {
  const fixture = await competitiveFixture();
  const agent = await fixture.service.saveBuild(fixture.user.id, {
    mode: 'agent', problemId: 'messy-json', title: 'Unexecutable draft', visibility: 'private',
    agentDefinition: { mode: 'agent', definitionSchemaVersion: 1, instructions: 'Private instructions' },
  });
  const before = {
    jobs: await fixture.repo.read('evaluationJobs'),
    outbox: await fixture.repo.read('evaluationOutbox'),
    invocations: await fixture.repo.read('evaluationInvocations'),
  };
  await assert.rejects(fixture.service.scheduleCompetitiveRun(fixture.user.id, {
    buildId: agent.id, kind: 'hidden', idempotencyKey: 'agent-must-not-enqueue',
  }), { code: 'RUNTIME_POLICY_DENIED' });
  assert.deepEqual(await fixture.repo.read('evaluationJobs'), before.jobs);
  assert.deepEqual(await fixture.repo.read('evaluationOutbox'), before.outbox);
  assert.deepEqual(await fixture.repo.read('evaluationInvocations'), before.invocations);
});

test('worker fails closed for a frozen Agent version before any invocation', async () => {
  const fixture = await competitiveFixture();
  const accepted = await fixture.service.scheduleCompetitiveRun(fixture.user.id, {
    buildId: fixture.build.id, kind: 'hidden', idempotencyKey: 'frozen-agent-denial',
  });
  // Fault-inject a persisted incompatible version. Retain DAG nodes to prove that
  // validation is of the frozen mode, not merely the presence of runnable nodes.
  await fixture.repo.update('buildVersions', { id: accepted.run.versionId }, { mode: 'agent' });
  await executeScheduledCompetitiveJob(fixture, accepted.job.id);
  assert.equal((await fixture.evaluationRepository.get(accepted.job.id))?.failure?.code, 'RUNTIME_POLICY_DENIED');
  assert.equal((await fixture.repo.read('evaluationInvocations', {jobId: accepted.job.id})).length, 0);
  assert.equal((await fixture.repo.read('evaluationUsageRecords', {jobId: accepted.job.id})).length, 0);
  assert.equal((await fixture.repo.read('submissions', {runId: accepted.run.id})).length, 0);
});

test('a queued DAG executes its frozen version even if the current pointer later names an Agent', async () => {
  const fixture = await competitiveFixture();
  const accepted = await fixture.service.scheduleCompetitiveRun(fixture.user.id, {
    buildId: fixture.build.id, kind: 'hidden', idempotencyKey: 'frozen-dag-remains-valid',
  });
  const original = (await fixture.repo.read('buildVersions', {id: accepted.run.versionId}))[0];
  await fixture.repo.insert('buildVersions', [{...original, id: 'future-agent-version', revision: original.revision + 1, mode: 'agent'}]);
  await fixture.repo.update('builds', {id: fixture.build.id}, {currentVersionId: 'future-agent-version'});
  await executeScheduledCompetitiveJob(fixture, accepted.job.id);
  assert.equal((await fixture.evaluationRepository.get(accepted.job.id))?.state, 'completed');
  assert.ok((await fixture.repo.read('evaluationInvocations', {jobId: accepted.job.id})).length > 0);
});
