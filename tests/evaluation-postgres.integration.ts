import { createProductionWorkerService, readConfig } from '../scripts/evaluation-worker-production.ts';
// Real PostgreSQL + BullMQ gate, isolated database and per-run queue identity.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { DrizzleRepository } from '../src/db/repository.ts';
import { EvaluationRepositoryAdapter } from '../src/db/evaluation-repository.ts';
import { loadMigrations, runMigrations } from '../scripts/migration-runner.ts';
import { ArenaService } from '../src/server/service.ts';
import { createDurableOutboxCompetitiveRunScheduler } from '../src/server/evaluation/runtime.ts';
import { CompetitiveEvaluationExecutor } from '../src/server/evaluation/competitive-executor.ts';
import { BullMqEvaluationQueue } from '../src/server/evaluation/queue/bullmq.ts';
import { EvaluationOutboxPublisher, EvaluationWorker } from '../src/server/evaluation/queue/index.ts';
import { seedTestArena } from './helpers/seed-arena.ts';
import { testWorkflow } from './helpers/workflow.ts';
import type { User } from '../src/shared/types.ts';

const testUrl = process.env.MIGRATION_TEST_DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
for (const value of [testUrl, redisUrl]) {
  if (!value || !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(value).hostname)) {
    throw new Error('Explicit local MIGRATION_TEST_DATABASE_URL and REDIS_URL required.');
  }
}

test('real DB/outbox/BullMQ worker retains idempotency, frozen DAG execution and durable receipts', {timeout: 90000}, async () => {
  const suffix = randomUUID().replaceAll('-', '');
  const name = `ef_pi_integration_${suffix}`;
  const admin = postgres(testUrl!, {max: 2, onnotice: () => {}});
  let sql: ReturnType<typeof postgres> | undefined;
  let queue: BullMqEvaluationQueue | undefined;
  let created = false;
  try {
    await admin.unsafe(`CREATE DATABASE "${name}"`);
    created = true;
    const url = new URL(testUrl!);
    url.pathname = `/${name}`;
    sql = postgres(url.toString(), {max: 8, onnotice: () => {}});
    const connection = sql;
    await runMigrations({transaction: work => connection.begin(async tx => work({
      query: async (statement, values = []) => tx.unsafe(statement, values),
    }))}, await loadMigrations());
    const repo = new DrizzleRepository(drizzle(connection), connection);
    const timestamp = new Date().toISOString();
    const user: User = {id: `ef-user-${suffix}`, name: 'EF local test', email: `${suffix}@example.invalid`,
      emailVerified: false, image: null, createdAt: timestamp, updatedAt: timestamp, elo: 1000, reputation: 0, isSeed: false};
    await seedTestArena(repo, user);
    const service = new ArenaService(repo, {
      demoMode: true, encryptionKey: randomBytes(32).toString('base64'), allowedHosts: [],
      competitiveRunScheduler: createDurableOutboxCompetitiveRunScheduler(repo),
    });
    const build = await service.saveBuild(user.id, {
      problemId: 'messy-json', title: 'Real storage demo execution', visibility: 'private', workflow: testWorkflow('json'),
    });
    const request = {buildId: build.id, kind: 'hidden', idempotencyKey: `request-${suffix}`};
    const accepted = await Promise.all([
      service.scheduleCompetitiveRun(user.id, request), service.scheduleCompetitiveRun(user.id, request),
    ]);
    assert.equal(accepted[0].job.id, accepted[1].job.id);
    const jobId = accepted[0].job.id;
    assert.equal((await repo.read('evaluationJobs', {id: jobId})).length, 1);
    assert.equal((await repo.read('evaluationOutbox', {jobId})).length, 1);
    assert.equal((await repo.read('runs', {id: accepted[0].run.id}))[0].runtimeKind, 'dag');
    const agent = await service.saveBuild(user.id, {
      mode: 'agent', problemId: 'messy-json', title: 'Agent draft', visibility: 'private',
      agentDefinition: {mode: 'agent', definitionSchemaVersion: 1, instructions: 'Private draft'},
    });
    await assert.rejects(service.scheduleCompetitiveRun(user.id, {
      buildId: agent.id, kind: 'hidden', idempotencyKey: `agent-${suffix}`,
    }), {code: 'RUNTIME_POLICY_DENIED'});
    assert.equal((await repo.read('evaluationJobs', {userId: user.id})).length, 1);

    const store = new EvaluationRepositoryAdapter(repo);
    queue = new BullMqEvaluationQueue({redisUrl: redisUrl!, queueName: `ef-pi-${suffix}`,
      prefix: 'pi-main-integration-tests', readinessTimeoutMs: 2000,
      completedJobRetentionSeconds: 60, failedJobRetentionSeconds: 60});
    assert.equal(await queue.isReady(), true);
    const publisher = new EvaluationOutboxPublisher(store, queue, {
      publisherId: `publisher-${suffix}`, leaseTtlMs: 5000, batchSize: 10,
    });
    const workerService = createProductionWorkerService(repo, readConfig({
      DATABASE_URL: url.toString(), REDIS_URL: redisUrl!, EVALUATION_SCHEDULER_MODE: 'outbox',
      EVALUATION_QUEUE_NAME: `ef-pi-${suffix}`, EVALUATION_QUEUE_PREFIX: 'pi-main-integration-tests',
      EVALUATION_WORKER_ID: `worker-${suffix}`, CREDENTIAL_ENCRYPTION_KEY: service.options.encryptionKey,
    }), {APP_ENV: 'test', DEMO_MODE: 'true'});
    const worker = new EvaluationWorker({queue, store,
      executor: new CompetitiveEvaluationExecutor({service: workerService, repository: repo, evaluationRepository: store}),
      workerId: `worker-${suffix}`, leaseTtlMs: 10000});
    await publisher.publishBatch();
    assert.equal((await worker.processNext()).status, 'processed');
    assert.equal((await store.get(jobId))?.state, 'completed');
    const invocations = await repo.read('evaluationInvocations', {jobId});
    const usage = await repo.read('evaluationUsageRecords', {jobId});
    assert.ok(invocations.length > 0);
    assert.ok(invocations.every(row => row.state === 'succeeded'));
    assert.equal(usage.length, invocations.length);
    assert.ok(usage.every(row => row.certainty === 'known' && row.chargeability === 'not-chargeable'));
    assert.equal((await repo.read('submissions', {runId: accepted[0].run.id})).length, 1);
    await publisher.publishBatch();
    assert.equal((await worker.processNext()).status, 'ignored');
    assert.equal((await repo.read('evaluationInvocations', {jobId})).length, invocations.length);
    assert.equal((await service.scheduleCompetitiveRun(user.id, request)).job.id, jobId);
  } finally {
    await queue?.close();
    await sql?.end({timeout: 5});
    if (created) await admin.unsafe(`DROP DATABASE "${name}"`);
    await admin.end({timeout: 5});
  }
});
