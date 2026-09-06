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

export interface EvaluationWorkerLoopOptions {
  /** External cancellation is useful for tests and process supervisors. */
  readonly signal?: AbortSignal;
  readonly pollIntervalMs?: number;
  readonly reconciliationIntervalMs?: number;
  readonly reconciliationBatchSize?: number;
  /** Process signal handlers are enabled for the standalone worker by default. */
  readonly installSignalHandlers?: boolean;
  /** Run one final stale-attempt pass after in-flight work has drained. */
  readonly reconcileOnShutdown?: boolean;
}

/**
 * Dependency-injected entrypoint for a separate Node worker process.
 * Production Redis/BullMQ and PostgreSQL adapters are supplied by the caller.
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

/**
 * Runs the publisher and executor loop until an external abort or SIGTERM/SIGINT.
 *
 * The loop is intentionally sequential: once processNext has claimed an Attempt,
 * shutdown waits for that invocation to finish and for its fenced write-back to
 * complete. Errors from publishing, reconciliation, or execution are allowed to
 * reject the loop so a supervisor can restart the process instead of silently
 * treating a broken worker as healthy.
 */
export async function runEvaluationWorkerLoop(
  runtime: EvaluationWorkerRuntime,
  options: EvaluationWorkerLoopOptions = {},
): Promise<void> {
  const pollIntervalMs = validateInterval(options.pollIntervalMs ?? 250, 'pollIntervalMs');
  const reconciliationIntervalMs = validateInterval(
    options.reconciliationIntervalMs ?? 5_000,
    'reconciliationIntervalMs',
  );
  const reconciliationBatchSize = validatePositiveInteger(
    options.reconciliationBatchSize ?? 50,
    'reconciliationBatchSize',
  );
  const installSignalHandlers = options.installSignalHandlers ?? true;
  const reconcileOnShutdown = options.reconcileOnShutdown ?? true;
  const signal = options.signal;
  let stopRequested = signal?.aborted ?? false;
  let lastReconciledAt = Number.NEGATIVE_INFINITY;

  const requestStop = (): void => {
    stopRequested = true;
    runtime.worker.requestShutdown();
  };
  const onAbort = (): void => requestStop();
  const onSignal = (): void => requestStop();

  if (stopRequested) runtime.worker.requestShutdown();
  signal?.addEventListener('abort', onAbort, { once: true });
  if (installSignalHandlers) {
    process.once('SIGTERM', onSignal);
    process.once('SIGINT', onSignal);
  }

  try {
    while (!stopRequested && !signal?.aborted) {
      const currentTime = Date.now();
      if (currentTime - lastReconciledAt >= reconciliationIntervalMs) {
        await runtime.worker.reconcileStaleAttempts(reconciliationBatchSize);
        lastReconciledAt = Date.now();
      }
      if (stopRequested || signal?.aborted) break;

      await runEvaluationWorkerOnce(runtime);
      if (stopRequested || signal?.aborted) break;
      await waitForPollInterval(pollIntervalMs, signal, () => stopRequested);
    }

    requestStop();
    if (reconcileOnShutdown) {
      await runtime.worker.reconcileStaleAttempts(reconciliationBatchSize);
    }
  } finally {
    signal?.removeEventListener('abort', onAbort);
    if (installSignalHandlers) {
      process.removeListener('SIGTERM', onSignal);
      process.removeListener('SIGINT', onSignal);
    }
  }
}

function validateInterval(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a finite non-negative number.`);
  }
  return value;
}

function validatePositiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer.`);
  }
  return value;
}

async function waitForPollInterval(
  intervalMs: number,
  signal: AbortSignal | undefined,
  shouldStop: () => boolean,
): Promise<void> {
  if (intervalMs === 0 || signal?.aborted || shouldStop()) return;
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, intervalMs);
    signal?.addEventListener('abort', finish, { once: true });
  });
}

export type { EvaluationAttemptExecutor, EvaluationQueuePort, EvaluationWorkerStore };
