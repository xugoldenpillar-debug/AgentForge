import {
  asOpaqueId,
  EVALUATION_WORKER_CONTRACT,
  EVALUATION_WORKER_MESSAGE_VERSION,
  isTerminalEvaluationJobState,
} from '../../../shared/evaluation-types.ts';
import type {
  EvaluationAttempt,
  EvaluationAttemptId,
  EvaluationAttemptState,
  EvaluationJobId,
  EvaluationJobState,
  EvaluationWorkerMessage,
  JsonObject,
} from '../../../shared/evaluation-types.ts';
import type { EvaluationJobPatch } from '../domain.ts';
import { EvaluationQueueProtocolError } from './errors.ts';
import type {
  EvaluationExecutionContext,
  EvaluationExecutionOutcome,
  EvaluationQueueDependencies,
  EvaluationQueueEnvelope,
  EvaluationWorkerMessageResult,
  StaleEvaluationAttempt,
} from './ports.ts';

export interface EvaluationReconciliationResult {
  readonly inspected: number;
  readonly fenced: number;
  readonly markedUnknown: number;
  readonly skipped: number;
}

/**
 * Independent worker lifecycle. The evaluator is injected, so this module does not
 * know about Next.js, PostgreSQL clients, providers, or model response payloads.
 */
export class EvaluationWorker {
  private readonly dependencies: EvaluationQueueDependencies;
  private readonly now: () => string;
  private shutdownRequested = false;

  constructor(dependencies: EvaluationQueueDependencies) {
    this.dependencies = dependencies;
    this.now = dependencies.now ?? (() => new Date().toISOString());
  }

  requestShutdown(): void {
    this.shutdownRequested = true;
  }

  async processNext(): Promise<EvaluationWorkerMessageResult> {
    if (this.shutdownRequested) {
      return { status: 'not-ready', message: null, jobId: null, attemptId: null, detail: 'shutdown-requested' };
    }
    if (!(await this.isQueueReady())) {
      return { status: 'not-ready', message: null, jobId: null, attemptId: null };
    }

    let delivery;
    try {
      delivery = await this.dependencies.queue.receive();
    } catch {
      return { status: 'not-ready', message: null, jobId: null, attemptId: null };
    }
    if (!delivery) return { status: 'ignored', message: null, jobId: null, attemptId: null, detail: 'queue-empty' };

    if (!(await this.isQueueReady())) {
      await this.dependencies.queue.reject(delivery.deliveryId);
      return { status: 'not-ready', message: null, jobId: delivery.message.jobId, attemptId: null };
    }

    try {
      const result = await this.handle(delivery.message);
      await this.dependencies.queue.acknowledge(delivery.deliveryId);
      return result;
    } catch (error) {
      await this.dependencies.queue.reject(delivery.deliveryId);
      throw error;
    }
  }

  private async isQueueReady(): Promise<boolean> {
    try {
      return await this.dependencies.queue.isReady();
    } catch {
      // Health checks are a fail-closed boundary: an unavailable or
      // indeterminate control plane must not admit new model work.
      return false;
    }
  }

  async renewAttemptLease(attempt: EvaluationAttempt): Promise<EvaluationAttempt | null> {
    if (!attempt.workerLeaseId) return null;
    return this.dependencies.store.renewAttemptLease({
      attemptId: attempt.id,
      workerId: this.dependencies.workerId,
      workerLeaseId: attempt.workerLeaseId,
      leaseTtlMs: this.dependencies.leaseTtlMs,
      now: this.now(),
    });
  }

  async reconcileStaleAttempts(limit = 50): Promise<EvaluationReconciliationResult> {
    const source = this.dependencies.reconciliation;
    if (!source) return { inspected: 0, fenced: 0, markedUnknown: 0, skipped: 0 };
    const stale = await source.findStaleAttempts({
      before: this.now(),
      limit,
    });
    let fenced = 0;
    let markedUnknown = 0;
    let skipped = 0;

    for (const item of stale) {
      const reconciling = await this.transitionStaleAttempt(item, 'reconciling');
      if (!reconciling) {
        skipped += 1;
        continue;
      }
      fenced += 1;
      await this.markJobReconciling(item);
      if (item.upstreamState === 'unknown' || item.upstreamState === 'indeterminate') {
        const unknown = await this.transitionStaleAttempt(item, 'unknown', 'reconciling');
        if (unknown) {
          markedUnknown += 1;
          await this.markJobUnknown(item);
        }
      }
    }

    return { inspected: stale.length, fenced, markedUnknown, skipped };
  }

  private async handle(message: EvaluationQueueEnvelope): Promise<EvaluationWorkerMessageResult> {
    if (message.version !== EVALUATION_WORKER_MESSAGE_VERSION) {
      throw new EvaluationQueueProtocolError(`Unsupported queue message version '${String(message.version)}'.`);
    }
    if (message.kind === 'evaluation-job-accepted' || message.kind === 'evaluation-attempt-dispatch-requested') {
      return this.executeAttempt(message);
    }
    if (message.kind === 'evaluation-attempt-reconcile-requested') {
      await this.reconcileStaleAttempts(1);
      return { status: 'processed', message: toWorkerMessage(message, null), jobId: message.jobId, attemptId: null };
    }
    if (message.kind === 'evaluation-job-cancel-requested') {
      return this.handleCancellation(message);
    }
    throw new EvaluationQueueProtocolError(`Unsupported queue event '${message.kind}'.`);
  }

  private async executeAttempt(message: EvaluationQueueEnvelope): Promise<EvaluationWorkerMessageResult> {
    const job = await this.dependencies.store.get(message.jobId);
    if (!job) return { status: 'ignored', message: null, jobId: message.jobId, attemptId: null, detail: 'job-not-found' };
    if (isTerminalEvaluationJobState(job.state)) {
      return { status: 'duplicate', message: null, jobId: message.jobId, attemptId: null, detail: 'job-terminal' };
    }
    if (job.state === 'accepted') {
      const queued = await this.dependencies.store.transition(message.jobId, ['accepted'], {
        state: 'queued',
        executionToken: null,
        updatedAt: this.now(),
      });
      if (!queued) return { status: 'duplicate', message: null, jobId: message.jobId, attemptId: null, detail: 'job-already-queued' };
    }
    const queuedJob = await this.dependencies.store.get(message.jobId);
    if (!queuedJob || queuedJob.state !== 'queued') {
      return { status: 'duplicate', message: null, jobId: message.jobId, attemptId: null, detail: 'job-not-queued' };
    }

    const claimed = await this.dependencies.store.createOrClaimAttempt({
      jobId: message.jobId,
      deliveryKey: String(message.eventId),
      workerId: this.dependencies.workerId,
      leaseTtlMs: this.dependencies.leaseTtlMs,
      now: this.now(),
    });
    const claimedStateVersion = claimed.stateVersion ?? 0;
    if (
      claimed.claimed
      && claimed.stateVersion === undefined
      && claimed.attempt.state !== 'claimed'
    ) {
      return {
        status: 'stale-worker',
        message: null,
        jobId: message.jobId,
        attemptId: claimed.attempt.id,
        detail: 'reclaimed-attempt-requires-reconciliation',
      };
    }
    if (!claimed.claimed || !claimed.attempt.workerLeaseId) {
      return {
        status: claimed.created ? 'failed' : 'duplicate',
        message: null,
        jobId: message.jobId,
        attemptId: claimed.attempt.id,
        detail: claimed.created ? 'attempt-was-not-claimed' : 'attempt-already-active',
      };
    }

    const executionToken = `${this.dependencies.workerId}:${claimed.attempt.workerLeaseId}`;
    const runningJob = await this.dependencies.store.transition(
      message.jobId,
      ['queued'],
      {
        state: 'running',
        executionToken,
        updatedAt: this.now(),
      },
    );
    if (!runningJob) {
      return this.stopStaleAttempt(claimed.attempt, message.jobId, 'job-claim-lost', claimedStateVersion);
    }

    const runningAttempt = await this.dependencies.store.transitionAttempt({
      attemptId: claimed.attempt.id,
      workerId: this.dependencies.workerId,
      workerLeaseId: claimed.attempt.workerLeaseId,
      expectedState: claimed.attempt.state,
      expectedStateVersion: claimedStateVersion,
      nextState: 'running',
      startedAt: this.now(),
    });
    if (!runningAttempt) {
      return { status: 'stale-worker', message: null, jobId: message.jobId, attemptId: claimed.attempt.id, detail: 'attempt-lease-fenced' };
    }

    if (!(await this.dependencies.queue.isReady())) {
      return this.finishWithoutExecution(message, runningAttempt, executionToken, claimedStateVersion + 1, 'control-plane-unavailable');
    }

    const execution = await this.executeWithHeartbeat({
      job: runningJob,
      attempt: runningAttempt,
      workerId: this.dependencies.workerId,
      executionToken,
      message,
    }, claimedStateVersion + 1);
    if (execution.leaseLost) {
      // The old worker no longer owns the attempt. Acknowledge the delivery so
      // it is not blindly replayed; reconciliation will fence the attempt and
      // preserve any possibly-dispatched upstream call as unknown.
      return {
        status: 'stale-worker',
        message: null,
        jobId: message.jobId,
        attemptId: runningAttempt.id,
        detail: 'attempt-lease-lost-during-execution',
      };
    }
    return this.finishAttempt(message, runningAttempt, executionToken, execution.stateVersion, execution.outcome);
  }

  private async executeWithHeartbeat(
    context: EvaluationExecutionContext,
    initialStateVersion: number,
  ): Promise<{
    readonly outcome: EvaluationExecutionOutcome;
    readonly stateVersion: number;
    readonly leaseLost: boolean;
  }> {
    const heartbeatMs = Math.max(1_000, Math.floor(this.dependencies.leaseTtlMs / 3));
    let stateVersion = initialStateVersion;
    let leaseLost = false;
    let renewalInFlight: Promise<void> | null = null;
    const heartbeat = setInterval(() => {
      if (renewalInFlight || leaseLost) return;
      renewalInFlight = (async () => {
        try {
          const renewed = await this.renewAttemptLease(context.attempt);
          if (!renewed) {
            leaseLost = true;
            return;
          }
          stateVersion += 1;
        } catch {
          leaseLost = true;
        } finally {
          renewalInFlight = null;
        }
      })();
    }, heartbeatMs);
    heartbeat.unref?.();

    try {
      let outcome: EvaluationExecutionOutcome;
      try {
        outcome = await this.dependencies.executor.execute(context);
      } catch {
        // An executor exception may mean that an upstream call was dispatched
        // but its result was not durably observed. Never retry that paid call.
        outcome = { kind: 'unknown', code: 'UPSTREAM_RESULT_UNKNOWN' };
      }
      if (renewalInFlight) await renewalInFlight;
      return { outcome, stateVersion, leaseLost };
    } finally {
      clearInterval(heartbeat);
      if (renewalInFlight) await renewalInFlight;
    }
  }

  private async finishAttempt(
    message: EvaluationQueueEnvelope,
    attempt: EvaluationAttempt,
    executionToken: string,
    runningStateVersion: number,
    outcome: EvaluationExecutionOutcome,
  ): Promise<EvaluationWorkerMessageResult> {
    const workerLeaseId = requireLease(attempt);
    let updatedJob;

    if (outcome.kind === 'cancelled') {
      // Cancellation is a two-step domain transition. The executor has
      // confirmed its stop point, so fence the attempt through `cancelling`
      // before recording its terminal `cancelled` state.
      const cancellingAttempt = await this.dependencies.store.transitionAttempt({
        attemptId: attempt.id,
        workerId: this.dependencies.workerId,
        workerLeaseId,
        expectedState: 'running',
        expectedStateVersion: runningStateVersion,
        nextState: 'cancelling',
        finishedAt: null,
      });
      if (!cancellingAttempt) {
        return { status: 'stale-worker', message: null, jobId: message.jobId, attemptId: attempt.id, detail: 'late-attempt-write' };
      }

      const cancellingJob = await this.dependencies.store.transition(
        message.jobId,
        ['running'],
        {
          state: 'cancelling',
          executionToken,
          completion: null,
          failure: null,
          completedAt: null,
          updatedAt: this.now(),
        },
        { executionToken },
      );
      if (!cancellingJob) {
        const current = await this.dependencies.store.get(message.jobId);
        if (!current || current.state !== 'cancelling' || current.executionToken !== executionToken) {
          return { status: 'stale-worker', message: null, jobId: message.jobId, attemptId: attempt.id, detail: 'late-job-write' };
        }
      }

      const cancelledAttempt = await this.dependencies.store.transitionAttempt({
        attemptId: attempt.id,
        workerId: this.dependencies.workerId,
        workerLeaseId,
        expectedState: 'cancelling',
        expectedStateVersion: runningStateVersion + 1,
        nextState: 'cancelled',
        finishedAt: this.now(),
      });
      if (!cancelledAttempt) {
        return { status: 'stale-worker', message: null, jobId: message.jobId, attemptId: attempt.id, detail: 'late-attempt-write' };
      }

      updatedJob = await this.dependencies.store.transition(
        message.jobId,
        ['cancelling'],
        outcomeToJobPatch(outcome, this.now()),
        { executionToken },
      );
    } else {
      const target = outcomeToAttemptState(outcome);
      const finished = await this.dependencies.store.transitionAttempt({
        attemptId: attempt.id,
        workerId: this.dependencies.workerId,
        workerLeaseId,
        expectedState: 'running',
        expectedStateVersion: runningStateVersion,
        nextState: target,
        finishedAt: target === 'unknown' ? null : this.now(),
      });
      if (!finished) {
        return { status: 'stale-worker', message: null, jobId: message.jobId, attemptId: attempt.id, detail: 'late-attempt-write' };
      }

      updatedJob = await this.dependencies.store.transition(
        message.jobId,
        ['running', 'cancelling'],
        outcomeToJobPatch(outcome, this.now()),
        { executionToken },
      );
    }

    if (!updatedJob) return { status: 'stale-worker', message: null, jobId: message.jobId, attemptId: attempt.id, detail: 'late-job-write' };
    return {
      status: 'processed',
      message: toWorkerMessage(message, attempt.id),
      jobId: message.jobId,
      attemptId: attempt.id,
    };
  }

  private async finishWithoutExecution(
    message: EvaluationQueueEnvelope,
    attempt: EvaluationAttempt,
    executionToken: string,
    runningStateVersion: number,
    code: string,
  ): Promise<EvaluationWorkerMessageResult> {
    const outcome: EvaluationExecutionOutcome = { kind: 'failed', failure: { code, retryable: true } };
    return this.finishAttempt(message, attempt, executionToken, runningStateVersion, outcome);
  }

  private async stopStaleAttempt(attempt: EvaluationAttempt, jobId: EvaluationJobId, detail: string, stateVersion: number): Promise<EvaluationWorkerMessageResult> {
    if (attempt.workerLeaseId) {
      await this.dependencies.store.transitionAttempt({
        attemptId: attempt.id,
        workerId: this.dependencies.workerId,
        workerLeaseId: attempt.workerLeaseId,
        expectedState: attempt.state,
        expectedStateVersion: stateVersion,
        nextState: 'failed',
        finishedAt: this.now(),
      });
    }
    return { status: 'stale-worker', message: null, jobId, attemptId: attempt.id, detail };
  }

  private async handleCancellation(message: EvaluationQueueEnvelope): Promise<EvaluationWorkerMessageResult> {
    const job = await this.dependencies.store.get(message.jobId);
    if (!job) return { status: 'ignored', message: null, jobId: message.jobId, attemptId: null, detail: 'job-not-found' };
    if (isTerminalEvaluationJobState(job.state) || job.state === 'unknown') {
      return { status: 'duplicate', message: null, jobId: message.jobId, attemptId: null, detail: 'job-terminal' };
    }

    const attemptId = readAttemptId(message.payload);
    // A running executor must observe the cancellation request at its own safe
    // stop point. The queue event records the request but cannot revoke an
    // external model call or claim confirmation on that executor's behalf.
    if (job.executionToken !== null) {
      return { status: 'processed', message: toWorkerMessage(message, attemptId), jobId: message.jobId, attemptId, detail: 'cancellation-requested' };
    }
    if (job.state !== 'cancelling') {
      return { status: 'ignored', message: toWorkerMessage(message, attemptId), jobId: message.jobId, attemptId, detail: 'job-not-cancelling' };
    }

    const cancelled = await this.dependencies.store.transition(
      message.jobId,
      ['cancelling'],
      {
        state: 'cancelled',
        executionToken: null,
        completion: null,
        failure: null,
        completedAt: this.now(),
        updatedAt: this.now(),
      },
    );
    if (!cancelled) {
      const current = await this.dependencies.store.get(message.jobId);
      return {
        status: current?.state === 'cancelled' ? 'duplicate' : 'stale-worker',
        message: toWorkerMessage(message, attemptId),
        jobId: message.jobId,
        attemptId,
        detail: 'cancellation-race',
      };
    }
    return { status: 'processed', message: toWorkerMessage(message, attemptId), jobId: message.jobId, attemptId };
  }

  private async transitionStaleAttempt(
    item: StaleEvaluationAttempt,
    nextState: 'reconciling' | 'unknown',
    expectedState: EvaluationAttemptState = item.attempt.state,
  ): Promise<EvaluationAttempt | null> {
    return this.dependencies.store.transitionAttempt({
      attemptId: item.attempt.id,
      workerId: item.workerId,
      workerLeaseId: item.workerLeaseId,
      expectedState,
      expectedStateVersion: expectedState === item.attempt.state ? item.stateVersion : item.stateVersion + 1,
      nextState,
      finishedAt: nextState === 'unknown' ? null : undefined,
    });
  }

  private async markJobReconciling(item: StaleEvaluationAttempt): Promise<void> {
    const job = await this.dependencies.store.get(item.attempt.jobId);
    if (!job || (job.state !== 'running' && job.state !== 'cancelling')) return;
    const executionToken = `${item.workerId}:${item.workerLeaseId}`;
    await this.dependencies.store.transition(
      job.id,
      [job.state],
      {
        state: 'reconciling',
        updatedAt: this.now(),
      },
      { executionToken },
    );
  }

  private async markJobUnknown(item: StaleEvaluationAttempt): Promise<void> {
    const job = await this.dependencies.store.get(item.attempt.jobId);
    if (!job || (job.state !== 'running' && job.state !== 'reconciling')) return;
    const executionToken = `${item.workerId}:${item.workerLeaseId}`;
    await this.dependencies.store.transition(
      job.id,
      [job.state as Extract<EvaluationJobState, 'running' | 'reconciling'>],
      {
        state: 'unknown',
        executionToken: null,
        failure: { code: 'UPSTREAM_RESULT_UNKNOWN', retryable: false },
        completion: null,
        completedAt: null,
        updatedAt: this.now(),
      },
      { executionToken },
    );
  }
}

function outcomeToAttemptState(outcome: EvaluationExecutionOutcome): Extract<EvaluationAttemptState, 'completed' | 'failed' | 'cancelled' | 'incomplete' | 'unknown'> {
  if (outcome.kind === 'completed') return 'completed';
  if (outcome.kind === 'incomplete') return 'incomplete';
  if (outcome.kind === 'failed') return 'failed';
  if (outcome.kind === 'cancelled') return 'cancelled';
  return 'unknown';
}

function outcomeToJobPatch(outcome: EvaluationExecutionOutcome, now: string): EvaluationJobPatch {
  if (outcome.kind === 'completed') return { state: 'completed', executionToken: null, completion: outcome.completion, failure: null, completedAt: now, updatedAt: now };
  if (outcome.kind === 'incomplete') return { state: 'incomplete', executionToken: null, completion: outcome.completion, failure: null, completedAt: now, updatedAt: now };
  if (outcome.kind === 'failed') return { state: 'failed', executionToken: null, completion: null, failure: outcome.failure, completedAt: now, updatedAt: now };
  if (outcome.kind === 'cancelled') return { state: 'cancelled', executionToken: null, completion: null, failure: null, completedAt: now, updatedAt: now };
  return { state: 'unknown', executionToken: null, completion: null, failure: { code: outcome.code ?? 'UPSTREAM_RESULT_UNKNOWN', retryable: false }, completedAt: null, updatedAt: now };
}

function requireLease(attempt: EvaluationAttempt): string {
  if (!attempt.workerLeaseId) throw new EvaluationQueueProtocolError(`Attempt '${attempt.id}' has no worker lease.`);
  return attempt.workerLeaseId;
}

function readAttemptId(payload: JsonObject): EvaluationAttemptId | null {
  const value = payload.attemptId;
  return typeof value === 'string' && value.length > 0 ? asOpaqueId<'evaluation-attempt'>(value) : null;
}

function toWorkerMessage(message: EvaluationQueueEnvelope, attemptId: EvaluationAttemptId | null): EvaluationWorkerMessage | null {
  if (!attemptId) return null;
  return {
    contract: EVALUATION_WORKER_CONTRACT,
    version: EVALUATION_WORKER_MESSAGE_VERSION,
    kind: message.kind === 'evaluation-attempt-reconcile-requested'
      ? 'reconcile-attempt'
      : message.kind === 'evaluation-job-cancel-requested'
        ? 'cancel-attempt'
        : 'execute-attempt',
    messageId: asOpaqueId<'evaluation-message'>(String(message.eventId)),
    jobId: message.jobId,
    attemptId,
    requestDigest: message.requestDigest,
    snapshotDigest: typeof message.payload.snapshotDigest === 'string' ? message.payload.snapshotDigest : '',
    issuedAt: message.enqueuedAt,
  };
}
