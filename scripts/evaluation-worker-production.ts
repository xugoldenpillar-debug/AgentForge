import { createDurableOutboxCompetitiveRunScheduler } from '../src/server/evaluation/runtime.ts';
import { pathToFileURL } from 'node:url';
import { constants as fsConstants, promises as fs } from 'node:fs';
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
import { CreationEvaluationExecutor } from '../src/server/evaluation/creation-executor.ts';
import { RunscSandboxProvider } from '../src/server/sandbox/runsc.ts';
import { FileSystemArtifactStorageAdapter } from '../src/server/artifacts/filesystem.ts';
import {
  BullMqEvaluationQueue,
  type BullMqEvaluationQueueOptions,
} from '../src/server/evaluation/queue/bullmq.ts';
import type {
  EvaluationAttemptExecutor,
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

/** Shared by the real entrypoint and the isolated PostgreSQL completion gate. */
export function createProductionWorkerService(
  repository: Repository,
  config: ProductionWorkerConfig,
  env: NodeJS.ProcessEnv = process.env,
): ArenaService {
  const platform = config.platformApiKey && config.platformModel
    ? {
        model: config.platformModel,
        inputPrice: config.platformInputPrice,
        outputPrice: config.platformOutputPrice,
      }
    : undefined;
  return new ArenaService(repository, {
    demoMode: testModelsEnabled(env),
    encryptionKey: config.encryptionKey,
    allowedHosts: config.allowedHosts,
    platform,
    createRealProvider: byokProvider,
    createPlatformProvider: platform
      ? () => gatewayProvider(config.platformApiKey!, platform)
      : undefined,
    maxRunCost: config.maxRunCost,
    maxCases: config.maxCases,
    env,
    competitiveRunScheduler: createDurableOutboxCompetitiveRunScheduler(repository),
  });
}

async function createCreationExecutor(
  config: ProductionWorkerConfig,
  repository: Repository,
  evaluationRepository: EvaluationRepositoryAdapter,
): Promise<CreationEvaluationExecutor | null> {
  if (!config.artifactArenaEnabled) return null;
  const runscPath = config.sandboxRunscPath!;
  const rootfsPath = config.sandboxRootfs!;
  const workRoot = config.sandboxWorkRoot!;
  const templatePath = config.sandboxOciTemplate!;
  const storageRoot = config.artifactStorageRoot!;
  await fs.access(runscPath, fsConstants.X_OK);
  const rootfs = await fs.stat(rootfsPath);
  if (!rootfs.isDirectory()) throw new Error('SANDBOX_ROOTFS must be a directory.');
  await fs.access(templatePath, fsConstants.R_OK);
  await fs.mkdir(workRoot, { recursive: true, mode: 0o700 });
  const workRootStat = await fs.stat(workRoot);
  if (!workRootStat.isDirectory() || (workRootStat.mode & 0o077) !== 0) {
    throw new Error('SANDBOX_WORK_ROOT must be a root-private directory.');
  }
  await fs.mkdir(storageRoot, { recursive: true, mode: 0o2750 });
  const storageRootStat = await fs.stat(storageRoot);
  if (!storageRootStat.isDirectory()
    || storageRootStat.gid !== config.artifactStorageGid
    || (storageRootStat.mode & 0o2077) !== 0o2050) {
    throw new Error('ARTIFACT_STORAGE_ROOT must be setgid, group-readable and inaccessible to other users.');
  }
  if (typeof process.getegid === 'function' && process.getegid() !== config.artifactStorageGid) {
    throw new Error('The worker effective GID must match ARTIFACT_STORAGE_GID.');
  }
  return new CreationEvaluationExecutor({
    repository,
    evaluationRepository,
    sandbox: new RunscSandboxProvider({
      runscPath,
      rootfsPath,
      workRoot,
      templatePath,
    }),
    storage: new FileSystemArtifactStorageAdapter(storageRoot, { directoryMode: 0o750, fileMode: 0o640 }),
    encryptionKey: config.encryptionKey,
    sandboxImageDigest: config.sandboxImageDigest!,
    createProvider: byokProvider,
  });
}

function routeExecutor(
  competitive: CompetitiveEvaluationExecutor,
  creation: CreationEvaluationExecutor | null,
): EvaluationAttemptExecutor {
  return {
    execute(context) {
      if (context.job.purpose === 'creation') {
        return creation
          ? creation.execute(context)
          : Promise.resolve({ kind: 'failed' as const, failure: { code: 'CREATION_RUNTIME_UNAVAILABLE', retryable: false } });
      }
      return competitive.execute(context);
    },
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

  const service = createProductionWorkerService(repository, config);
  const reconciliation = new PostgresEvaluationReconciliationStore(repository);
  const competitiveExecutor = new CompetitiveEvaluationExecutor({ service, repository, evaluationRepository });
  const creationExecutor = await createCreationExecutor(config, repository, evaluationRepository);
  const executor = routeExecutor(competitiveExecutor, creationExecutor);
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
        executor,
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
