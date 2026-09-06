import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { MemoryRepository } from './helpers/memory-repository.ts';
import { seedTestArena } from './helpers/seed-arena.ts';
import { testWorkflow } from './helpers/workflow.ts';
import { TEST_CASES } from '../src/server/fixtures.ts';
import { ArenaService } from '../src/server/service.ts';
import { EvaluationRepositoryAdapter } from '../src/db/evaluation-repository.ts';
import {
  EvaluationService,
  type EvaluationDispatchSink,
} from '../src/server/evaluation/domain.ts';
import type { CaseResult, RunEvent, User } from '../src/shared/types.ts';
import type { EvaluationOutboxEvent } from '../src/shared/evaluation-types.ts';
import { createDurableOutboxCompetitiveRunScheduler } from '../src/server/evaluation/runtime.ts';

class DispatchSink implements EvaluationDispatchSink {
  readonly events: EvaluationOutboxEvent[] = [];

  async enqueue(event: EvaluationOutboxEvent): Promise<void> {
    if (!this.events.some((current) => current.id === event.id)) this.events.push(event);
  }
}

function results(problemId: string, visibility: 'public' | 'hidden'): CaseResult[] {
  return TEST_CASES
    .filter((testCase) => testCase.problemId === problemId && testCase.visibility === visibility)
    .map((testCase) => ({
      caseId: testCase.id,
      category: testCase.category,
      passed: true,
      secure: true,
      failureType: null,
      inputTokens: 10,
      outputTokens: 5,
      reasoningTokens: 0,
      toolCalls: 0,
      latency: 2,
      cost: 0,
      estimated: true,
    }));
}

async function fixture() {
  const repo = new MemoryRepository();
  const user: User = {
    id: 'evaluation-user',
    name: 'Evaluation User',
    email: 'evaluation@example.invalid',
    emailVerified: false,
    image: null,
    createdAt: '2026-09-06T00:00:00.000Z',
    updatedAt: '2026-09-06T00:00:00.000Z',
    elo: 1000,
    reputation: 0,
    isSeed: false,
  };
  await seedTestArena(repo, user);
  const evaluationRepository = new EvaluationRepositoryAdapter(repo);
  const dispatch = new DispatchSink();
  const scheduler = new EvaluationService(evaluationRepository, dispatch, {
    createId: (() => {
      let count = 0;
      return () => `evaluation-job-${++count}`;
    })(),
    now: () => '2026-09-06T00:00:00.000Z',
  });
  const service = new ArenaService(repo, {
    demoMode: true,
    encryptionKey: randomBytes(32).toString('base64'),
    allowedHosts: ['api.example.com'],
    competitiveRunScheduler: scheduler,
  });
  const build = await service.saveBuild(user.id, {
    problemId: 'messy-json',
    title: 'Durable competitive build',
    visibility: 'public',
    workflow: testWorkflow('json'),
  });
  return { repo, service, user, build, dispatch };
}

test('durable competitive scheduling creates a job association without executing the model', async () => {
  const { repo, service, user, build, dispatch } = await fixture();
  const events: RunEvent[] = [];
  const accepted = await service.scheduleCompetitiveRun(user.id, {
    buildId: build.id,
    kind: 'hidden',
    idempotencyKey: 'competitive-request-1',
  });

  assert.equal(accepted.job.purpose, 'competitive');
  assert.equal(accepted.job.state, 'queued');
  assert.deepEqual(accepted.job.association, {
    kind: 'competitive-run',
    runId: accepted.run.id,
    visibility: 'hidden',
  });
  assert.equal((await repo.read('runs', { id: accepted.run.id })).length, 1);
  assert.equal((await repo.read('evaluationJobs')).length, 1);
  assert.equal((await repo.read('evaluationAttempts')).length, 0);
  assert.equal(dispatch.events.length, 1);
  assert.equal(events.length, 0);
});

test('competitive scheduling is idempotent and does not duplicate the Run or Job', async () => {
  const { repo, service, user, build } = await fixture();
  const first = await service.scheduleCompetitiveRun(user.id, {
    buildId: build.id,
    kind: 'public',
    idempotencyKey: 'competitive-request-replay',
  });
  const replay = await service.scheduleCompetitiveRun(user.id, {
    buildId: build.id,
    kind: 'public',
    idempotencyKey: 'competitive-request-replay',
  });

  assert.equal(replay.created, false);
  assert.equal(replay.run.id, first.run.id);
  assert.equal(replay.job.id, first.job.id);
  assert.equal((await repo.read('runs', { userId: user.id })).length, 1);
  assert.equal((await repo.read('evaluationJobs')).length, 1);
  assert.equal((await repo.read('evaluationOutbox')).length, 1);
});

test('only complete hidden competitive evaluations create Submission and rewards', async () => {
  const { repo, service, user, build } = await fixture();
  const accepted = await service.scheduleCompetitiveRun(user.id, {
    buildId: build.id,
    kind: 'hidden',
    idempotencyKey: 'competitive-complete',
  });
  const workflow = testWorkflow('json');
  const completed = await service.completeCompetitiveRun({
    runId: accepted.run.id,
    userId: user.id,
    buildId: build.id,
    versionId: build.currentVersionId,
    problemId: 'messy-json',
    kind: 'hidden',
    tier: 'demo',
    model: 'demo-forge',
    workflow,
    constraints: (await repo.read('problems', { id: 'messy-json' }))[0].constraints,
    results: results('messy-json', 'hidden'),
    evidence: 'complete',
  });

  assert.equal(completed.status, 'completed');
  assert.ok(completed.submissionId);
  assert.equal((await repo.read('submissions', { runId: accepted.run.id })).length, 1);
  assert.equal((await repo.read('reputations', { userId: user.id })).filter((row) => row.reason === 'submission').length, 1);
});

test('public, partial, and unknown competitive evaluations never create Submission', async () => {
  const publicFixture = await fixture();
  const publicAccepted = await publicFixture.service.scheduleCompetitiveRun(publicFixture.user.id, {
    buildId: publicFixture.build.id,
    kind: 'public',
    idempotencyKey: 'competitive-public',
  });
  const publicProblem = (await publicFixture.repo.read('problems', { id: 'messy-json' }))[0];
  await publicFixture.service.completeCompetitiveRun({
    runId: publicAccepted.run.id,
    userId: publicFixture.user.id,
    buildId: publicFixture.build.id,
    versionId: publicFixture.build.currentVersionId,
    problemId: publicProblem.id,
    kind: 'public',
    tier: 'demo',
    model: 'demo-forge',
    workflow: testWorkflow('json'),
    constraints: publicProblem.constraints,
    results: results('messy-json', 'public'),
    evidence: 'complete',
  });
  assert.equal((await publicFixture.repo.read('submissions', { userId: publicFixture.user.id })).length, 0);

  const partialFixture = await fixture();
  const partialAccepted = await partialFixture.service.scheduleCompetitiveRun(partialFixture.user.id, {
    buildId: partialFixture.build.id,
    kind: 'hidden',
    idempotencyKey: 'competitive-partial',
  });
  const partialProblem = (await partialFixture.repo.read('problems', { id: 'messy-json' }))[0];
  const partial = await partialFixture.service.completeCompetitiveRun({
    runId: partialAccepted.run.id,
    userId: partialFixture.user.id,
    buildId: partialFixture.build.id,
    versionId: partialFixture.build.currentVersionId,
    problemId: partialProblem.id,
    kind: 'hidden',
    tier: 'demo',
    model: 'demo-forge',
    workflow: testWorkflow('json'),
    constraints: partialProblem.constraints,
    results: results('messy-json', 'hidden').slice(0, 1),
    evidence: 'partial',
  });
  assert.equal(partial.status, 'failed');
  assert.equal((await partialFixture.repo.read('submissions', { userId: partialFixture.user.id })).length, 0);

  const unknownFixture = await fixture();
  const unknownAccepted = await unknownFixture.service.scheduleCompetitiveRun(unknownFixture.user.id, {
    buildId: unknownFixture.build.id,
    kind: 'hidden',
    idempotencyKey: 'competitive-unknown',
  });
  const unknown = await unknownFixture.service.failCompetitiveRun({
    runId: unknownAccepted.run.id,
    userId: unknownFixture.user.id,
  });
  assert.equal(unknown.status, 'failed');
  assert.equal((await unknownFixture.repo.read('submissions', { userId: unknownFixture.user.id })).length, 0);
});



test('outbox publication failure preserves a persisted competitive job for recovery', async () => {
  const { repo, user, build } = await fixture();
  const failingScheduler = new EvaluationService(
    new EvaluationRepositoryAdapter(repo),
    {
      async enqueue(): Promise<void> {
        throw new Error('queue temporarily unavailable');
      },
    },
    { now: () => '2026-09-06T00:00:00.000Z' },
  );
  const service = new ArenaService(repo, {
    demoMode: true,
    encryptionKey: randomBytes(32).toString('base64'),
    allowedHosts: ['api.example.com'],
    competitiveRunScheduler: failingScheduler,
  });

  await assert.rejects(
    () => service.scheduleCompetitiveRun(user.id, {
      buildId: build.id,
      kind: 'hidden',
      idempotencyKey: 'outbox-publication-recovery',
    }),
    /queue temporarily unavailable/,
  );

  const run = (await repo.read('runs', { userId: user.id }))
    .find((candidate) => candidate.id.startsWith('competitive-run:'));
  assert(run);
  assert.equal(run.status, 'running');
  assert.equal((await repo.read('evaluationJobs', { businessRecordId: run.id })).length, 1);
  assert.equal((await repo.read('evaluationOutbox', { jobId: (await repo.read('evaluationJobs', { businessRecordId: run.id }))[0].id })).length, 1);
});

test('production scheduler stages a durable outbox job and never falls back to an in-memory queue', async () => {
  const { repo, user, build } = await fixture();
  const scheduler = createDurableOutboxCompetitiveRunScheduler(repo);
  const service = new ArenaService(repo, {
    demoMode: true,
    encryptionKey: randomBytes(32).toString('base64'),
    allowedHosts: ['api.example.com'],
    competitiveRunScheduler: scheduler,
  });

  const accepted = await service.scheduleCompetitiveRun(user.id, {
    buildId: build.id,
    kind: 'hidden',
    idempotencyKey: 'production-outbox-job',
  });

  assert.equal(accepted.job.state, 'queued');
  assert.equal((await repo.read('evaluationAttempts')).length, 0);
  const outbox = await repo.read('evaluationOutbox', { jobId: accepted.job.id });
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0].status, 'pending');
});

test('async scheduling fails closed when the durable scheduler is not configured', async () => {
  const { repo, user, build } = await fixture();
  const runsBefore = (await repo.read('runs')).length;
  const service = new ArenaService(repo, {
    demoMode: true,
    encryptionKey: randomBytes(32).toString('base64'),
    allowedHosts: ['api.example.com'],
  });

  await assert.rejects(
    () => service.scheduleCompetitiveRun(user.id, {
      buildId: build.id,
      kind: 'hidden',
      idempotencyKey: 'scheduler-not-configured',
    }),
    /Durable evaluation scheduling is unavailable/,
  );
  assert.equal((await repo.read('evaluationJobs')).length, 0);
  assert.equal((await repo.read('runs')).length, runsBefore);
});
