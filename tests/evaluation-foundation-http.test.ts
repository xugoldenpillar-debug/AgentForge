import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { MemoryRepository } from './helpers/memory-repository.ts';
import { seedTestArena } from './helpers/seed-arena.ts';
import { testWorkflow } from './helpers/workflow.ts';
import { CHALLENGE_SECRET, TEST_CASES } from '../src/server/fixtures.ts';
import { ArenaService } from '../src/server/service.ts';
import { EvaluationRepositoryAdapter } from '../src/db/evaluation-repository.ts';
import {
  EvaluationService,
  type EvaluationDispatchSink,
} from '../src/server/evaluation/domain.ts';
import { handleArena } from '../src/server/http.ts';
import { validateBody } from '../src/server/validation.ts';
import {
  ApiError,
  createEvaluation,
  getEvaluation,
  pollEvaluation,
  recoverEvaluation,
} from '../src/lib/client-api.ts';
import type { EvaluationOutboxEvent } from '../src/shared/evaluation-types.ts';
import type { RunCase, User } from '../src/shared/types.ts';

const ORIGIN = 'http://localhost:3000';

class DispatchSink implements EvaluationDispatchSink {
  readonly events: EvaluationOutboxEvent[] = [];

  async enqueue(event: EvaluationOutboxEvent): Promise<void> {
    if (!this.events.some((current) => current.id === event.id)) this.events.push(event);
  }
}

function user(id: string, name: string): User {
  return {
    id,
    name,
    email: `${id}@example.invalid`,
    emailVerified: false,
    image: null,
    createdAt: '2026-09-06T00:00:00.000Z',
    updatedAt: '2026-09-06T00:00:00.000Z',
    elo: 1000,
    reputation: 0,
    isSeed: false,
  };
}

async function fixture() {
  const repo = new MemoryRepository();
  const owner = user('http-owner', 'HTTP Owner');
  const other = user('http-other', 'HTTP Other');
  await seedTestArena(repo, owner);
  await repo.insert('users', [other]);

  const dispatch = new DispatchSink();
  let sequence = 0;
  const scheduler = new EvaluationService(new EvaluationRepositoryAdapter(repo), dispatch, {
    createId: () => `http-job-${++sequence}`,
    now: () => '2026-09-06T00:00:00.000Z',
  });
  const service = new ArenaService(repo, {
    demoMode: true,
    encryptionKey: randomBytes(32).toString('base64'),
    allowedHosts: ['api.example.com'],
    competitiveRunScheduler: scheduler,
  });
  const build = await service.saveBuild(owner.id, {
    problemId: 'messy-json',
    title: 'HTTP evaluation build',
    visibility: 'public',
    workflow: testWorkflow('json'),
  });
  return { repo, owner, other, dispatch, scheduler, service, build };
}

function request(path: string, init: RequestInit = {}): Request {
  return new Request(`${ORIGIN}/api/arena/${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
}

async function jsonResponse(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

async function createJob(fixtureValue: Awaited<ReturnType<typeof fixture>>, key = 'http-request-1', kind: 'public' | 'hidden' = 'hidden') {
  return handleArena(request('evaluation-jobs', {
    method: 'POST',
    body: JSON.stringify({ buildId: fixtureValue.build.id, kind, idempotencyKey: key }),
  }), {
    service: fixtureValue.service,
    userId: fixtureValue.owner.id,
    origin: ORIGIN,
    validateBody,
  });
}

test('async competitive creation returns 202 with stable IDs and does not execute a model', async () => {
  const value = await fixture();
  const response = await createJob(value);
  assert.equal(response.status, 202);
  assert.equal(response.headers.get('location'), '/api/arena/evaluation-jobs/http-job-1');
  assert.equal(response.headers.get('retry-after'), '1');

  const payload = await jsonResponse(response);
  const job = payload.job as Record<string, unknown>;
  const run = payload.run as Record<string, unknown>;
  assert.equal(payload.created, true);
  assert.equal(job.id, 'http-job-1');
  assert.equal((job.association as Record<string, unknown>).runId, run.id);
  assert.equal(job.state, 'queued');
  assert.deepEqual(payload.attempts, []);
  assert.equal((await value.repo.read('evaluationAttempts')).length, 0);
  assert.equal(value.dispatch.events.length, 1);
});

test('async creation is idempotent and rejects a reused key with a different request digest', async () => {
  const value = await fixture();
  const first = await createJob(value, 'http-replay');
  const replay = await createJob(value, 'http-replay');
  assert.equal(replay.status, 202);
  const firstPayload = await jsonResponse(first);
  const replayPayload = await jsonResponse(replay);
  assert.equal(replayPayload.created, false);
  assert.equal((replayPayload.job as Record<string, unknown>).id, (firstPayload.job as Record<string, unknown>).id);
  assert.equal((replayPayload.run as Record<string, unknown>).id, (firstPayload.run as Record<string, unknown>).id);
  assert.equal((await value.repo.read('runs', { id: String((firstPayload.run as Record<string, unknown>).id) })).length, 1);
  assert.equal((await value.repo.read('evaluationJobs')).length, 1);
  assert.equal((await value.repo.read('evaluationOutbox')).length, 1);

  const conflict = await createJob(value, 'http-replay', 'public');
  assert.equal(conflict.status, 409);
  const conflictPayload = await jsonResponse(conflict);
  assert.equal((conflictPayload.error as Record<string, unknown>).code, 'REQUEST_VALIDATION_FAILED');
});

test('a second active job returns RUN_ALREADY_ACTIVE instead of a field-validation error', async () => {
  const value = await fixture();
  const first = await createJob(value, 'http-active-one');
  assert.equal(first.status, 202);

  const second = await createJob(value, 'http-active-two');
  assert.equal(second.status, 409);
  const payload = await jsonResponse(second);
  assert.equal((payload.error as Record<string, unknown>).code, 'RUN_ALREADY_ACTIVE');
});


test('acknowledging an unknown job releases the account active slot without replaying it', async () => {
  const value = await fixture();
  const first = await createJob(value, 'http-unknown-slot');
  const firstPayload = await jsonResponse(first);
  const jobId = String((firstPayload.job as Record<string, unknown>).id);
  const claim = await value.scheduler.claimForExecution(jobId as never, 'http-worker');
  assert(claim.executionToken);
  await value.scheduler.markUnknown(jobId as never, claim.executionToken!);

  const blocked = await createJob(value, 'http-before-acknowledgement');
  assert.equal(blocked.status, 409);
  assert.equal(
    ((await jsonResponse(blocked)).error as Record<string, unknown>).code,
    'RUN_ALREADY_ACTIVE',
  );

  const acknowledged = await value.scheduler.acknowledgeUnknown(jobId as never);
  assert.equal(acknowledged.job.state, 'incomplete');
  const next = await createJob(value, 'http-after-acknowledgement');
  assert.equal(next.status, 202);
  assert.equal((await jsonResponse(next)).created, true);
  assert.equal(value.dispatch.events.length, 2, 'acknowledgement must not enqueue or replay the old job');
});

test('async mode on the legacy runs route validates and returns the durable 202 path', async () => {
  const value = await fixture();
  const response = await handleArena(request('runs?mode=async', {
    method: 'POST',
    body: JSON.stringify({ buildId: value.build.id, kind: 'hidden', idempotencyKey: 'runs-async-1' }),
  }), {
    service: value.service,
    userId: value.owner.id,
    origin: ORIGIN,
    validateBody,
  });
  assert.equal(response.status, 202);
  assert.equal(response.headers.get('location'), '/api/arena/evaluation-jobs/http-job-1');
});

test('evaluation polling enforces ownership and keeps hidden details aggregate-only', async () => {
  const value = await fixture();
  const created = await createJob(value, 'http-hidden');
  const createdPayload = await jsonResponse(created);
  const job = createdPayload.job as Record<string, unknown>;
  const jobId = String(job.id);
  const run = createdPayload.run as Record<string, unknown>;
  const runId = String(run.id);
  const hiddenCase = TEST_CASES.find((testCase) => testCase.problemId === 'messy-json' && testCase.visibility === 'hidden');
  assert(hiddenCase);
  const hiddenRunCase: RunCase = {
    id: 'http-hidden-case',
    runId,
    caseId: hiddenCase.id,
    category: hiddenCase.category,
    passed: true,
    secure: true,
    failureType: null,
    input: hiddenCase.input,
    expected: hiddenCase.expected,
    actual: 'private model response',
    trace: [{ nodeId: 'model', kind: 'model', label: 'Model', state: 'done' }],
    inputTokens: 1,
    outputTokens: 1,
    reasoningTokens: 0,
    toolCalls: 0,
    latency: 1,
    cost: 0,
    estimated: true,
  };
  await value.repo.insert('runCases', [hiddenRunCase]);

  const ownerStatus = await handleArena(request(`evaluation-jobs/${encodeURIComponent(jobId)}`), {
    service: value.service,
    userId: value.owner.id,
    origin: ORIGIN,
    validateBody,
  });
  assert.equal(ownerStatus.status, 200);
  const ownerPayload = await jsonResponse(ownerStatus);
  const serialized = JSON.stringify(ownerPayload);
  assert.equal((ownerPayload.job as Record<string, unknown>).id, jobId);
  assert.equal((ownerPayload.run as Record<string, unknown>).id, runId);
  assert(!serialized.includes(hiddenCase.input));
  assert(!serialized.includes(JSON.stringify(hiddenCase.expected)));
  assert(!serialized.includes('private model response'));
  assert(!serialized.includes('trace'));
  assert(!serialized.includes(CHALLENGE_SECRET));
  assert.equal(Object.hasOwn(ownerPayload.run as object, 'cases'), false);

  const otherStatus = await handleArena(request(`evaluation-jobs/${encodeURIComponent(jobId)}`), {
    service: value.service,
    userId: value.other.id,
    origin: ORIGIN,
    validateBody,
  });
  assert.equal(otherStatus.status, 404);
  assert.deepEqual(await otherStatus.json(), {
    error: { code: 'RESOURCE_NOT_FOUND', message: 'Evaluation not found.' },
  });
});

test('public evaluation status exposes only the existing allowed public case projection', async () => {
  const value = await fixture();
  const publicBuild = await value.service.saveBuild(value.other.id, {
    problemId: 'messy-json',
    title: 'Public HTTP build',
    visibility: 'public',
    workflow: testWorkflow('json'),
  });
  const response = await handleArena(request('evaluation-jobs', {
    method: 'POST',
    body: JSON.stringify({ buildId: publicBuild.id, kind: 'public', idempotencyKey: 'http-public' }),
  }), {
    service: value.service,
    userId: value.other.id,
    origin: ORIGIN,
    validateBody,
  });
  assert.equal(response.status, 202);
  const payload = await jsonResponse(response);
  const run = payload.run as Record<string, unknown>;
  const publicCase = TEST_CASES.find((testCase) => testCase.problemId === 'messy-json' && testCase.visibility === 'public');
  assert(publicCase);
  await value.repo.insert('runCases', [{
    id: 'http-public-case',
    runId: String(run.id),
    caseId: publicCase.id,
    category: publicCase.category,
    passed: true,
    secure: true,
    failureType: null,
    input: publicCase.input,
    expected: publicCase.expected,
    actual: '{}',
    trace: [{ nodeId: 'model', kind: 'model', label: 'Model', state: 'done' }],
    inputTokens: 1,
    outputTokens: 1,
    reasoningTokens: 0,
    toolCalls: 0,
    latency: 1,
    cost: 0,
    estimated: true,
  }]);

  const status = await handleArena(request(`evaluation-jobs/${String((payload.job as Record<string, unknown>).id)}`), {
    service: value.service,
    userId: value.other.id,
    origin: ORIGIN,
    validateBody,
  });
  const statusPayload = await jsonResponse(status);
  const returnedRun = statusPayload.run as Record<string, unknown>;
  assert(Array.isArray(returnedRun.cases));
  assert.equal((returnedRun.cases as Array<Record<string, unknown>>)[0]?.input, publicCase.input);
});

test('cancellation is a request first, is idempotent, and cannot turn a completed job into success', async () => {
  const value = await fixture();
  const created = await createJob(value, 'http-cancel');
  const payload = await jsonResponse(created);
  const jobId = String((payload.job as Record<string, unknown>).id);

  const requested = await handleArena(request(`evaluation-jobs/${jobId}/cancel`, {
    method: 'POST',
    body: JSON.stringify({ reason: 'user-requested' }),
  }), {
    service: value.service,
    userId: value.owner.id,
    origin: ORIGIN,
    validateBody,
  });
  assert.equal(requested.status, 202);
  const requestedPayload = await jsonResponse(requested);
  assert.equal(requestedPayload.cancellationRequested, true);
  assert.equal((requestedPayload.job as Record<string, unknown>).state, 'cancelling');
  assert.equal((await value.repo.read('evaluationOutbox')).length, 2);

  const repeated = await handleArena(request(`evaluation-jobs/${jobId}/cancel`, {
    method: 'POST',
    body: JSON.stringify({ reason: 'user-requested' }),
  }), {
    service: value.service,
    userId: value.owner.id,
    origin: ORIGIN,
    validateBody,
  });
  assert.equal(repeated.status, 200);
  const repeatedPayload = await jsonResponse(repeated);
  assert.equal(repeatedPayload.cancellationRequested, false);
  assert.equal((await value.repo.read('evaluationOutbox')).length, 2);

  const confirmed = await value.scheduler.confirmCancellation(jobId as never);
  assert.equal(confirmed.job.state, 'cancelled');
  const afterConfirmation = await handleArena(request(`evaluation-jobs/${jobId}`), {
    service: value.service,
    userId: value.owner.id,
    origin: ORIGIN,
    validateBody,
  });
  const confirmedJob = (await jsonResponse(afterConfirmation)).job;
  assert(confirmedJob !== null && typeof confirmedJob === 'object' && 'state' in confirmedJob);
  assert.equal(confirmedJob.state, 'cancelled');
});

test('completion wins a cancellation race and unknown work is never projected as successful', async () => {
  const value = await fixture();
  const created = await createJob(value, 'http-race');
  const payload = await jsonResponse(created);
  const jobId = String((payload.job as Record<string, unknown>).id);
  const claim = await value.scheduler.claimForExecution(jobId as never, 'http-worker');
  assert(claim.executionToken);

  const requested = await handleArena(request(`evaluation-jobs/${jobId}/cancel`, {
    method: 'POST',
    body: JSON.stringify({ reason: 'user-requested' }),
  }), {
    service: value.service,
    userId: value.owner.id,
    origin: ORIGIN,
    validateBody,
  });
  assert.equal(requested.status, 202);
  const completed = await value.scheduler.completeJob(jobId as never, claim.executionToken!, { evidence: 'complete' });
  assert.equal(completed.job.state, 'completed');

  const completedStatus = await handleArena(request(`evaluation-jobs/${jobId}`), {
    service: value.service,
    userId: value.owner.id,
    origin: ORIGIN,
    validateBody,
  });
  const completedPayload = await jsonResponse(completedStatus);
  assert.equal((completedPayload.job as Record<string, unknown>).state, 'completed');
  assert.equal((completedPayload.job as Record<string, unknown>).completion && ((completedPayload.job as Record<string, unknown>).completion as Record<string, unknown>).evidence, 'complete');

  const unknownFixture = await fixture();
  const unknownCreated = await createJob(unknownFixture, 'http-unknown');
  const unknownPayload = await jsonResponse(unknownCreated);
  const unknownJobId = String((unknownPayload.job as Record<string, unknown>).id);
  const unknownClaim = await unknownFixture.scheduler.claimForExecution(unknownJobId as never, 'http-worker');
  assert(unknownClaim.executionToken);
  const unknown = await unknownFixture.scheduler.markUnknown(unknownJobId as never, unknownClaim.executionToken!);
  assert.equal(unknown.job.state, 'unknown');
  const unknownCancel = await handleArena(request(`evaluation-jobs/${unknownJobId}/cancel`, {
    method: 'POST',
    body: JSON.stringify({ reason: 'user-requested' }),
  }), {
    service: unknownFixture.service,
    userId: unknownFixture.owner.id,
    origin: ORIGIN,
    validateBody,
  });
  assert.equal(unknownCancel.status, 200);
  const unknownCancelPayload = await jsonResponse(unknownCancel);
  assert.equal((unknownCancelPayload.job as Record<string, unknown>).state, 'unknown');
  assert.equal((unknownCancelPayload.job as Record<string, unknown>).completion, null);
});

test('client helpers create, recover, and poll a durable evaluation across a disconnect', async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
  let getCount = 0;
  try {
    globalThis.fetch = async (input, init) => {
      calls.push({ input, init });
      const url = String(input);
      if (url.endsWith('/evaluation-jobs') && init?.method === 'POST') {
        return new Response(JSON.stringify({ created: true, job: { id: 'client-job' }, attempts: [], run: null }), { status: 202 });
      }
      if (url.endsWith('/evaluation-jobs/client-job')) {
        getCount += 1;
        if (getCount === 2) throw new TypeError('network disconnected');
        const state = getCount >= 4 ? 'completed' : 'queued';
        return new Response(JSON.stringify({ job: { id: 'client-job', state }, attempts: [], run: null }), { status: 200 });
      }
      throw new Error(`unexpected fetch ${url}`);
    };

    const created = await createEvaluation({ buildId: 'build-1', kind: 'hidden' }, { idempotencyKey: 'client-key' });
    assert.equal(created.created, true);
    assert.equal((calls[0]?.init?.headers as Record<string, string>)['Idempotency-Key'], 'client-key');
    const recovered = await recoverEvaluation('client-job');
    assert.equal(recovered.job.id, 'client-job');
    const terminal = await pollEvaluation('client-job', { intervalMs: 1, maxIntervalMs: 1 });
    assert.equal(terminal.job.state, 'completed');
    assert.equal(getCount, 4);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('client rejects an idempotency key that does not match the body', async () => {
  await assert.rejects(
    () => createEvaluation({ buildId: 'build-1', kind: 'hidden', idempotencyKey: 'body-key' }, { idempotencyKey: 'header-key' }),
    (error: unknown) => error instanceof ApiError && error.status === 409,
  );
});
