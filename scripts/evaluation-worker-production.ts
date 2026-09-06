import { pathToFileURL } from 'node:url';
import { database } from '../src/db/index.ts';
import { DrizzleRepository } from '../src/db/repository.ts';
import { EvaluationRepositoryAdapter } from '../src/db/evaluation-repository.ts';
import type { Repository, EvaluationAttemptRow } from '../src/shared/types.ts';
import {
  asOpaqueId,
  type EvaluationAttempt,
} from '../src/shared/evaluation-types.ts';
import {
  byokProvider,
  gatewayProvider,
} from '../src/lib/ai/sdk-provider.ts';
import { testModelsEnabled } from '../src/server/environment.ts';
import { ArenaService } from '../src/server/service.ts';
import { CompetitiveEvaluationExecutor } from '../src/server/evaluation/competitive-executor.ts';
import {
  BullMqEvaluationQueue,
  type BullMqEvaluationQueueOptions,
} from '../src/server/evaluation/queue/bullmq.ts';
import type {
  EvaluationQueueDependencies,
  EvaluationReconciliationStore,
  StaleEvaluationAttempt,
} from '../src/server/evaluation/queue/ports.ts';
import {
  createEvaluationWorkerRuntime,
  runEvaluationWorkerLoop,
} from './evaluation-worker.ts';

import { readWorkerConfig, type ProductionWorkerConfig } from './evaluation-worker-config.ts';
class PostgresEvaluationReconciliationStore implements EvaluationReconciliationStore {
  private readonly repository: Repository;

  constructor(repository: Repository) {
    this.repository = repository;
  }

  async findStaleAttempts(input: { readonly before: string; readonly limit: number }): Promise<readonly StaleEvaluationAttempt[]> {
    const rows = await this.repository.read('evaluationAttempts', {});
    const stale = rows
      .filter((row) => (
          (row.state === 'claimed'
            || row.state === 'running'
            || row.state === 'cancelling'
            || row.state === 'reconciling')
          && row.leaseExpiresAt !== null
          && row.leaseExpiresAt <= input.before
          && row.workerId !== null
          && row.workerLeaseId !== null
        ))
      .slice(0, input.limit);

    return Promise.all(stale.map(async (row) => ({
      attempt: toAttempt(row),
      stateVersion: row.stateVersion,
      workerId: row.workerId!,
      workerLeaseId: row.workerLeaseId!,
      upstreamState: await this.upstreamState(row),
    })));
  }

  private async upstreamState(row: EvaluationAttemptRow): Promise<StaleEvaluationAttempt['upstreamState']> {
    const invocations = await this.repository.read('evaluationInvocations', { attemptId: row.id });
    if (invocations.some((invocation) => (
      invocation.state === 'started'
      || invocation.state === 'unknown'
      || invocation.state === 'reconciling'
    ))) return 'unknown';
    if (invocations.some((invocation) => invocation.state === 'succeeded')) return 'indeterminate';
    if (invocations.some((invocation) => invocation.state === 'failed')) return 'known-failure';
    return 'none';
  }
}

function toAttempt(row: EvaluationAttemptRow): EvaluationAttempt {
  return {
    id: asOpaqueId<'evaluation-attempt'>(row.id),
    jobId: asOpaqueId<'evaluation-job'>(row.jobId),
    number: row.attemptNumber,
    state: row.state,
    workerLeaseId: row.workerLeaseId,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const readConfig = readWorkerConfig;

function createQueueOptions(config: ProductionWorkerConfig): BullMqEvaluationQueueOptions {
  return {
    redisUrl: config.redisUrl,
    queueName: config.queueName,
    prefix: config.queuePrefix,
    readinessTimeoutMs: config.queueReadinessTimeoutMs,
    completedJobRetentionSeconds: config.completedJobRetentionSeconds,
    failedJobRetentionSeconds: config.failedJobRetentionSeconds,
  };
}

async function run(): Promise<void> {
  const config = readConfig();
  const db = database();
  const repository = new DrizzleRepository();
  const evaluationRepository = new EvaluationRepositoryAdapter(repository);

  // Fail before accepting the process as healthy if the database is unreachable
  // or the evaluation migration has not been applied to this database.
  await db.sql`SELECT 1`;
  await repository.read('evaluationJobs', {});

  const platform = config.platformApiKey && config.platformModel
    ? {
        model: config.platformModel,
        inputPrice: config.platformInputPrice,
        outputPrice: config.platformOutputPrice,
      }
    : undefined;
  const service = new ArenaService(repository, {
    demoMode: testModelsEnabled(process.env),
    encryptionKey: config.encryptionKey,
    allowedHosts: config.allowedHosts,
    platform,
    createRealProvider: byokProvider,
    createPlatformProvider: platform
      ? () => gatewayProvider(config.platformApiKey!, platform)
      : undefined,
    maxRunCost: config.maxRunCost,
    maxCases: config.maxCases,
  });
  const reconciliation = new PostgresEvaluationReconciliationStore(repository);
  const controller = new AbortController();
  const queues: BullMqEvaluationQueue[] = [];
  const loops: Promise<void>[] = [];
  const onSignal = (): void => controller.abort();
  process.once('SIGTERM', onSignal);
  process.once('SIGINT', onSignal);

  try {
    for (let index = 0; index < config.concurrency; index += 1) {
      const queue = new BullMqEvaluationQueue(createQueueOptions(config));
      queues.push(queue);
      if (!(await queue.isReady())) {
        throw new Error('Redis control plane is not ready.');
      }
      const workerId = config.concurrency === 1
        ? config.workerId
        : `${config.workerId}-${index + 1}`;
      const dependencies: EvaluationQueueDependencies = {
        queue,
        store: evaluationRepository,
        reconciliation,
        executor: new CompetitiveEvaluationExecutor({
          service,
          repository,
          evaluationRepository,
        }),
        workerId,
        leaseTtlMs: config.workerLeaseTtlMs,
      };
      const runtime = createEvaluationWorkerRuntime({
        ...dependencies,
        outbox: evaluationRepository,
        publisherId: `${workerId}-publisher`,
        publisherLeaseTtlMs: config.publisherLeaseTtlMs,
        publisherBatchSize: config.publisherBatchSize,
      });
      loops.push(runEvaluationWorkerLoop(runtime, {
        signal: controller.signal,
        pollIntervalMs: config.workerPollIntervalMs,
        reconciliationIntervalMs: config.reconciliationIntervalMs,
        reconciliationBatchSize: config.reconciliationBatchSize,
        installSignalHandlers: false,
      }));
    }

    await Promise.all(loops);
  } catch {
    controller.abort();
    await Promise.allSettled(loops);
    throw new Error('Evaluation worker stopped because a required dependency or loop failed.');
  } finally {
    process.removeListener('SIGTERM', onSignal);
    process.removeListener('SIGINT', onSignal);
    await Promise.allSettled(queues.map((queue) => queue.close()));
    await db.sql.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch(() => {
    console.error('Evaluation worker failed closed. Check dependency health and configuration without logging secrets.');
    process.exitCode = 1;
  });
}

export { readConfig };
