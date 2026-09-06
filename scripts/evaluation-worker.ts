import { EvaluationOutboxPublisher } from '../src/server/evaluation/queue/outbox-publisher.ts';
import { EvaluationWorker } from '../src/server/evaluation/queue/worker.ts';
import type {
  EvaluationAttemptExecutor,
  EvaluationOutboxStore,
  EvaluationQueueDependencies,
  EvaluationQueuePort,
  EvaluationWorkerStore,
} from '../src/server/evaluation/queue/ports.ts';

export interface EvaluationWorkerRuntime {
  readonly publisher: EvaluationOutboxPublisher;
  readonly worker: EvaluationWorker;
}

export interface EvaluationWorkerRuntimeOptions extends EvaluationQueueDependencies {
  readonly outbox: EvaluationOutboxStore;
  readonly publisherId: string;
  readonly publisherLeaseTtlMs: number;
  readonly publisherBatchSize: number;
}

/**
 * Dependency-injected entrypoint for a separate Node worker process.
 * Production Redis/BullMQ and PostgreSQL adapters are intentionally supplied by the caller.
 */
export function createEvaluationWorkerRuntime(options: EvaluationWorkerRuntimeOptions): EvaluationWorkerRuntime {
  return {
    publisher: new EvaluationOutboxPublisher(options.outbox, options.queue, {
      publisherId: options.publisherId,
      leaseTtlMs: options.publisherLeaseTtlMs,
      batchSize: options.publisherBatchSize,
      now: options.now,
    }),
    worker: new EvaluationWorker(options),
  };
}

export async function runEvaluationWorkerOnce(runtime: EvaluationWorkerRuntime): Promise<{
  readonly published: Awaited<ReturnType<EvaluationOutboxPublisher['publishBatch']>>;
  readonly processed: Awaited<ReturnType<EvaluationWorker['processNext']>>;
}> {
  const published = await runtime.publisher.publishBatch();
  const processed = await runtime.worker.processNext();
  return { published, processed };
}

export async function runEvaluationWorkerLoop(
  runtime: EvaluationWorkerRuntime,
  options: { readonly signal?: AbortSignal; readonly pollIntervalMs?: number } = {},
): Promise<void> {
  const pollIntervalMs = options.pollIntervalMs ?? 250;
  while (!options.signal?.aborted) {
    await runEvaluationWorkerOnce(runtime);
    if (options.signal?.aborted) break;
    await new Promise<void>((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

export type { EvaluationAttemptExecutor, EvaluationQueuePort, EvaluationWorkerStore };
