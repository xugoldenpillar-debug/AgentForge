import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError, ERROR_CODES } from '../src/shared/errors.ts';
import { asOpaqueId, type EvaluationJobId } from '../src/shared/evaluation-types.ts';
import type {
  CreateEvaluationJobInput,
  CreateEvaluationJobResult,
  EvaluationJobView,
  EvaluationTransitionResult,
} from '../src/server/evaluation/domain.ts';
import { digestAgentBuildDefinition } from '../src/lib/agent-build/digest.ts';
import { CREATION_AGENT_BUILD_CONTRACT } from '../src/server/creation/catalog.ts';
import { CreationRunService, type CreationJobScheduler } from '../src/server/creation/service.ts';
import { ANIMATION_CHALLENGES, ANIMATION_CHALLENGE_VERSIONS } from '../src/server/animation-challenges.ts';
import { createDurableOutboxCompetitiveRunScheduler } from '../src/server/evaluation/runtime.ts';
import type { Credential, User } from '../src/shared/types.ts';
import { MemoryRepository } from './helpers/memory-repository.ts';

const NOW = '2026-09-08T00:00:00.000Z';
const OWNER = 'creation-owner';
const OTHER = 'creation-other';
const BUILD_ID = 'creation-build';
const BUILD_VERSION_ID = 'creation-build-v1';
const CREDENTIAL_ID = 'creation-credential';
const OTHER_CREDENTIAL_ID = 'creation-credential-two';
const challengeVersion = ANIMATION_CHALLENGE_VERSIONS[0];

const user = (id: string): User => ({
  id,
  name: id,
  email: `${id}@example.invalid`,
  emailVerified: true,
  image: null,
  createdAt: NOW,
  updatedAt: NOW,
  elo: 1000,
  reputation: 0,
  isSeed: false,
});

const definition = Object.freeze({
  mode: 'agent' as const,
  definitionSchemaVersion: 1 as const,
  instructions: 'Use a clear silhouette and smooth declarative motion.',
  ...CREATION_AGENT_BUILD_CONTRACT,
  skillRefs: [],
  requestedCapabilities: [],
  profileRef: null,
});

function credential(id = CREDENTIAL_ID, modelId = 'model-one'): Credential {
  return {
    id,
    userId: OWNER,
    protocol: 'openai-chat',
    name: id,
    baseUrl: 'https://api.example.invalid/v1',
    modelId,
    ciphertext: 'not-read-by-creation-service',
    lastFour: 'test',
    inputPrice: null,
    outputPrice: null,
    createdAt: NOW,
  };
}

class FakeScheduler implements CreationJobScheduler {
  readonly jobs = new Map<string, EvaluationJobView>();
  createCalls = 0;

  async createJob(input: CreateEvaluationJobInput): Promise<CreateEvaluationJobResult> {
    this.createCalls += 1;
    const id = asOpaqueId<'evaluation-job'>(`creation-job-${this.createCalls}`);
    const job: EvaluationJobView = {
      id,
      userId: input.userId,
      purpose: input.purpose,
      association: input.association,
      state: 'queued',
      snapshot: input.snapshot,
      idempotency: {
        scope: 'evaluation-job-create',
        key: input.idempotencyKey,
        requestDigest: input.snapshot.snapshotDigest,
      },
      budgetReservationId: input.budgetReservationId ?? null,
      cancellationReason: null,
      cancellationRequestedAt: null,
      completion: null,
      failure: null,
      acceptedAt: NOW,
      createdAt: NOW,
      updatedAt: NOW,
      completedAt: null,
    };
    this.jobs.set(String(id), job);
    return { created: true, job };
  }

  async getJob(jobId: EvaluationJobId): Promise<EvaluationJobView> {
    const job = this.jobs.get(String(jobId));
    if (!job) throw new Error('job not found');
    return structuredClone(job);
  }

  async requestCancellation(jobId: EvaluationJobId): Promise<EvaluationTransitionResult> {
    const job = await this.getJob(jobId);
    const cancelled: EvaluationJobView = {
      ...job,
      state: 'cancelled',
      cancellationReason: 'user-requested',
      cancellationRequestedAt: NOW,
      completedAt: NOW,
      updatedAt: NOW,
    };
    this.jobs.set(String(jobId), cancelled);
    return { applied: true, job: structuredClone(cancelled) };
  }

  async acknowledgeUnknown(jobId: EvaluationJobId): Promise<EvaluationTransitionResult> {
    const job = await this.getJob(jobId);
    assert.equal(job.state, 'unknown');
    const incomplete: EvaluationJobView = {
      ...job,
      state: 'incomplete',
      completion: {
        evidence: 'partial',
        summary: { upstreamResult: 'unknown', userAcknowledgedPotentialCharge: true },
      },
      failure: { code: 'UPSTREAM_RESULT_UNKNOWN_ACKNOWLEDGED', retryable: false },
      completedAt: NOW,
      updatedAt: NOW,
    };
    this.jobs.set(String(jobId), incomplete);
    return { applied: true, job: structuredClone(incomplete) };
  }

  setState(jobId: string, patch: Partial<EvaluationJobView>): void {
    const job = this.jobs.get(jobId);
    assert.ok(job);
    this.jobs.set(jobId, { ...job, ...patch });
  }
}

class RaceObservingScheduler implements CreationJobScheduler {
  private readonly scheduler: CreationJobScheduler;
  private readonly onCreated: (job: EvaluationJobView) => Promise<void>;

  constructor(repository: MemoryRepository, onCreated: (job: EvaluationJobView) => Promise<void>) {
    this.scheduler = createDurableOutboxCompetitiveRunScheduler(repository);
    this.onCreated = onCreated;
  }

  async createJob(input: CreateEvaluationJobInput): Promise<CreateEvaluationJobResult> {
    const result = await this.scheduler.createJob(input);
    // This callback runs after the durable outbox transaction commits but
    // before CreationRunService can perform any follow-up update. It models a
    // worker consuming the just-published creation job at the race boundary.
    await this.onCreated(result.job);
    return result;
  }

  getJob(jobId: EvaluationJobId): Promise<EvaluationJobView> {
    return this.scheduler.getJob(jobId);
  }

  requestCancellation(jobId: EvaluationJobId, reason?: 'user-requested'): Promise<EvaluationTransitionResult> {
    return this.scheduler.requestCancellation(jobId, reason);
  }

  acknowledgeUnknown(jobId: EvaluationJobId): Promise<EvaluationTransitionResult> {
    return this.scheduler.acknowledgeUnknown(jobId);
  }
}

async function harness(schedulerFactory?: (repository: MemoryRepository) => CreationJobScheduler) {
  const repository = new MemoryRepository();
  const scheduler = schedulerFactory?.(repository) ?? new FakeScheduler();
  await repository.insert('users', [user(OWNER), user(OTHER)]);
  await repository.insert('animationChallenges', [{ ...ANIMATION_CHALLENGES[0] }]);
  await repository.insert('animationChallengeVersions', [{ ...challengeVersion }]);
  await repository.insert('builds', [{
    id: BUILD_ID,
    problemId: null,
    animationChallengeId: challengeVersion.challengeId,
    userId: OWNER,
    title: 'Animation builder',
    visibility: 'private',
    currentVersionId: BUILD_VERSION_ID,
    parentBuildId: null,
    createdAt: NOW,
    updatedAt: NOW,
  }]);
  await repository.insert('buildVersions', [{
    id: BUILD_VERSION_ID,
    buildId: BUILD_ID,
    revision: 1,
    title: 'Animation builder',
    visibility: 'private',
    createdAt: NOW,
    mode: 'agent',
    agentDefinition: definition,
    definitionDigest: digestAgentBuildDefinition(definition),
    animationChallengeVersionId: challengeVersion.id,
  }]);
  await repository.insert('credentials', [credential(), credential(OTHER_CREDENTIAL_ID, 'model-two')]);
  const service = new CreationRunService(repository, { scheduler, now: () => NOW });
  return { repository, scheduler, service };
}

function input(overrides: Partial<Parameters<CreationRunService['schedule']>[1]> = {}) {
  return {
    buildVersionId: BUILD_VERSION_ID,
    challengeVersionId: challengeVersion.id,
    credentialId: CREDENTIAL_ID,
    idempotencyKey: 'creation-request-one',
    ...overrides,
  };
}

function isAppError(error: unknown, status: number, code: string): boolean {
  return error instanceof AppError && error.status === status && error.code === code;
}

test('CreationRun scheduling is idempotent and its safe projection excludes credentials, prompts, context and execution tokens', async () => {
  const { scheduler, service } = await harness();
  const first = await service.schedule(OWNER, input());
  const second = await service.schedule(OWNER, input());

  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.run.id, first.run.id);
  assert.equal(second.job.id, first.job.id);
  assert.equal(scheduler.createCalls, 1);

  const serialized = JSON.stringify(second);
  assert.doesNotMatch(serialized, new RegExp(CREDENTIAL_ID));
  assert.doesNotMatch(serialized, /smooth declarative motion/i);
  assert.doesNotMatch(serialized, /executionToken|credentialAuthorizationId|contextDigest/i);
});

test('CreationRun association is visible before the durable outbox can be consumed', async () => {
  let observedAssociation: string | null = null;
  let observedOutboxRows = 0;
  const { repository, service } = await harness((base) => new RaceObservingScheduler(base, async (job) => {
    assert.equal(job.association.kind, 'creation-run');
    const runId = String(job.association.creationRunId);
    const run = (await base.read('creationRuns', { id: runId }))[0];
    observedAssociation = run?.evaluationJobId ?? null;
    observedOutboxRows = (await base.read('evaluationOutbox', { jobId: String(job.id) })).length;

    // This is the executor's association guard at the exact point where the
    // old implementation could observe a committed outbox row too early.
    assert.equal(observedAssociation, String(job.id));
    assert.equal(observedOutboxRows, 1);
  }));

  const accepted = await service.schedule(OWNER, input({ idempotencyKey: 'creation-race-boundary' }));

  assert.equal(observedAssociation, String(accepted.job.id));
  assert.equal(observedOutboxRows, 1);
  assert.equal(accepted.run.evaluationJobId, String(accepted.job.id));
});

test('CreationRun scheduling does not overwrite a state already advanced by a worker', async () => {
  const { repository, service } = await harness((base) => new RaceObservingScheduler(base, async (job) => {
    assert.equal(job.association.kind, 'creation-run');
    const runId = String(job.association.creationRunId);
    const updated = await base.update('creationRuns', { id: runId, evaluationJobId: String(job.id) }, {
      status: 'running',
      startedAt: NOW,
      updatedAt: NOW,
    });
    assert.equal(updated[0]?.status, 'running');
  }));

  const accepted = await service.schedule(OWNER, input({ idempotencyKey: 'creation-worker-won-race' }));

  assert.equal(accepted.run.evaluationJobId, String(accepted.job.id));
  assert.equal(accepted.run.status, 'running');
  assert.equal((await repository.read('creationRuns', { id: accepted.run.id }))[0]?.status, 'running');
});

test('CreationRun idempotency rejects a different challenge, build, or provider authorization', async () => {
  const { repository, service } = await harness();
  await service.schedule(OWNER, input());

  await assert.rejects(
    () => service.schedule(OWNER, input({ challengeVersionId: ANIMATION_CHALLENGE_VERSIONS[1].id })),
    (error: unknown) => isAppError(error, 409, ERROR_CODES.RUNTIME_POLICY_DENIED)
      || isAppError(error, 409, ERROR_CODES.REQUEST_VALIDATION_FAILED),
  );
  await assert.rejects(
    () => service.schedule(OWNER, input({ credentialId: OTHER_CREDENTIAL_ID })),
    (error: unknown) => isAppError(error, 409, ERROR_CODES.REQUEST_VALIDATION_FAILED),
  );

  const copiedVersionId = 'creation-build-v2';
  await repository.insert('buildVersions', [{
    ...(await repository.read('buildVersions', { id: BUILD_VERSION_ID }))[0],
    id: copiedVersionId,
    revision: 2,
  }]);
  await assert.rejects(
    () => service.schedule(OWNER, input({ buildVersionId: copiedVersionId })),
    (error: unknown) => isAppError(error, 409, ERROR_CODES.REQUEST_VALIDATION_FAILED),
  );
});

test('CreationRun enforces owner, challenge binding, and credential ownership/deletion', async () => {
  const { repository, service } = await harness();
  await assert.rejects(
    () => service.schedule(OTHER, input()),
    (error: unknown) => isAppError(error, 404, ERROR_CODES.VERSION_NOT_FOUND),
  );
  await assert.rejects(
    () => service.schedule(OWNER, input({ challengeVersionId: ANIMATION_CHALLENGE_VERSIONS[1].id, idempotencyKey: 'wrong-challenge' })),
    (error: unknown) => isAppError(error, 409, ERROR_CODES.RUNTIME_POLICY_DENIED),
  );
  await repository.remove('credentials', { id: CREDENTIAL_ID });
  await assert.rejects(
    () => service.schedule(OWNER, input({ idempotencyKey: 'deleted-credential' })),
    (error: unknown) => isAppError(error, 404, ERROR_CODES.PROVIDER_NOT_FOUND),
  );
});

test('CreationRun get recovers terminal state and artifact bundle, cancel is durable, and owner isolation is enforced', async () => {
  const { scheduler, service } = await harness();
  const scheduled = await service.schedule(OWNER, input());

  await assert.rejects(
    () => service.get(OTHER, scheduled.run.id),
    (error: unknown) => isAppError(error, 404, ERROR_CODES.RESOURCE_NOT_FOUND),
  );

  const cancelled = await service.cancel(OWNER, scheduled.run.id);
  assert.equal(cancelled.run.status, 'cancelled');
  assert.equal(cancelled.job?.state, 'cancelled');

  scheduler.setState(scheduled.job.id, {
    state: 'completed',
    completion: { evidence: 'complete', summary: { artifactBundleId: 'bundle-one', artifactCount: 1 } },
    completedAt: NOW,
  });
  const recovered = await service.get(OWNER, scheduled.run.id);
  assert.equal(recovered.run.status, 'completed');
  assert.equal(recovered.run.artifactBundleId, 'bundle-one');
});

test('CreationRun retry accepts only unsuccessful terminal jobs and creates a new idempotent run', async () => {
  const { scheduler, service } = await harness();
  const scheduled = await service.schedule(OWNER, input());

  await assert.rejects(
    () => service.retry(OWNER, scheduled.run.id, 'retry-too-early'),
    (error: unknown) => isAppError(error, 409, ERROR_CODES.RUNTIME_POLICY_DENIED),
  );

  scheduler.setState(scheduled.job.id, {
    state: 'failed',
    failure: { code: 'PROVIDER_REQUEST_FAILED', retryable: false },
    completedAt: NOW,
  });
  const retry = await service.retry(OWNER, scheduled.run.id, 'retry-one');
  const repeat = await service.retry(OWNER, scheduled.run.id, 'retry-one');
  assert.equal(retry.created, true);
  assert.equal(repeat.created, false);
  assert.notEqual(retry.run.id, scheduled.run.id);
  assert.equal(retry.run.id, repeat.run.id);
});

test('CreationRun projects unknown jobs as incomplete and releases them only after explicit charge acknowledgement', async () => {
  const { scheduler, service } = await harness();
  const scheduled = await service.schedule(OWNER, input({ idempotencyKey: 'creation-unknown' }));
  scheduler.setState(scheduled.job.id, {
    state: 'unknown',
    failure: { code: 'UPSTREAM_RESULT_UNKNOWN', retryable: false },
    completedAt: null,
  });

  const projected = await service.get(OWNER, scheduled.run.id);
  assert.equal(projected.job?.state, 'unknown');
  assert.equal(projected.run.status, 'incomplete');

  await assert.rejects(
    () => service.acknowledgeUnknown(OWNER, scheduled.run.id, false),
    (error: unknown) => isAppError(error, 400, ERROR_CODES.REQUEST_VALIDATION_FAILED),
  );
  assert.equal((await scheduler.getJob(scheduled.job.id)).state, 'unknown');

  const released = await service.acknowledgeUnknown(OWNER, scheduled.run.id, true);
  assert.equal(released.job?.state, 'incomplete');
  assert.equal(released.run.status, 'incomplete');
  assert.equal(released.job?.failure?.code, 'UPSTREAM_RESULT_UNKNOWN_ACKNOWLEDGED');
});

test('CreationRun scheduling failure does not leave an unassociated queued run', async () => {
  const { repository, service } = await harness(() => ({
    async createJob() {
      throw new Error('active slot');
    },
    async getJob() {
      throw new Error('not reached');
    },
    async requestCancellation() {
      throw new Error('not reached');
    },
    async acknowledgeUnknown() {
      throw new Error('not reached');
    },
  }));

  await assert.rejects(() => service.schedule(OWNER, input({ idempotencyKey: 'creation-scheduling-failure' })));
  const runs = await repository.read('creationRuns', { ownerId: OWNER });
  const failed = runs.find((run) => run.id.includes('creation-run-'));
  assert.equal(failed?.evaluationJobId, null);
  assert.equal(failed?.status, 'failed');
  assert.equal(failed?.completedAt, NOW);
});

test('stale CreationRun without a durable job is failed on recovery without replaying provider work', async () => {
  const { repository, scheduler, service } = await harness();
  const scheduled = await service.schedule(OWNER, input({ idempotencyKey: 'creation-stale-orphan' }));
  const staleAt = '2026-09-07T23:00:00.000Z';
  await repository.update('creationRuns', { id: scheduled.run.id }, {
    evaluationJobId: null,
    status: 'queued',
    updatedAt: staleAt,
    completedAt: null,
  });
  const recovering = new CreationRunService(repository, {
    scheduler,
    now: () => NOW,
    orphanGraceMs: 60_000,
  });

  const result = await recovering.get(OWNER, scheduled.run.id);

  assert.equal(result.job, null);
  assert.equal(result.run.status, 'failed');
  assert.equal(result.run.evaluationJobId, null);
  assert.equal(result.run.completedAt, NOW);
  assert.equal(scheduler.createCalls, 1, 'recovery must not schedule or replay provider work');
});

test('fresh CreationRun without a durable job remains queued during the scheduling grace period', async () => {
  const { repository, scheduler, service } = await harness();
  const scheduled = await service.schedule(OWNER, input({ idempotencyKey: 'creation-fresh-orphan' }));
  await repository.update('creationRuns', { id: scheduled.run.id }, {
    evaluationJobId: null,
    status: 'queued',
    updatedAt: NOW,
    completedAt: null,
  });
  const recovering = new CreationRunService(repository, {
    scheduler,
    now: () => '2026-09-08T00:00:30.000Z',
    orphanGraceMs: 60_000,
  });

  const result = await recovering.get(OWNER, scheduled.run.id);

  assert.equal(result.job, null);
  assert.equal(result.run.status, 'queued');
  assert.equal(result.run.completedAt, null);
});

test('stale CreationRun repairs a single durable job association instead of failing it', async () => {
  const { repository, scheduler, service } = await harness((base) => createDurableOutboxCompetitiveRunScheduler(base));
  const scheduled = await service.schedule(OWNER, input({ idempotencyKey: 'creation-repair-association' }));
  await repository.update('creationRuns', { id: scheduled.run.id }, {
    evaluationJobId: null,
    status: 'queued',
    updatedAt: '2026-09-07T23:00:00.000Z',
  });
  const recovering = new CreationRunService(repository, {
    scheduler,
    now: () => NOW,
    orphanGraceMs: 60_000,
  });

  const result = await recovering.get(OWNER, scheduled.run.id);

  assert.equal(result.run.evaluationJobId, scheduled.job.id);
  assert.equal(result.job?.id, scheduled.job.id);
  assert.equal(result.run.status, 'queued');
});
