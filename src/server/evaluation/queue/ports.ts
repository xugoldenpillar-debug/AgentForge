import type {
  EvaluationAttempt,
  EvaluationAttemptId,
  EvaluationAttemptState,
  EvaluationJobId,
  EvaluationOutboxEventId,
  EvaluationOutboxEventKind,
  EvaluationTimestamp,
  EvaluationWorkerMessage,
  JsonObject,
} from '../../../shared/evaluation-types.ts';
import type { EvaluationOutboxRow } from '../../../shared/types.ts';
import type {
  EvaluationCompletion,
  EvaluationFailure,
  EvaluationJobRecord,
  EvaluationJobStore,
} from '../domain.ts';

export interface EvaluationQueueEnvelope {
  readonly eventId: EvaluationOutboxEventId;
  readonly version: number;
  readonly kind: EvaluationOutboxEventKind;
  readonly jobId: EvaluationJobId;
  readonly requestDigest: string;
  readonly payload: JsonObject;
  readonly enqueuedAt: EvaluationTimestamp;
}

export interface EvaluationQueueDelivery {
  readonly deliveryId: string;
  readonly message: EvaluationQueueEnvelope;
}

export interface EvaluationQueueControlPlane {
  isReady(): boolean | Promise<boolean>;
  readinessReason?(): string | undefined;
}

export interface EvaluationQueuePort extends EvaluationQueueControlPlane {
  enqueue(message: EvaluationQueueEnvelope): Promise<{ readonly duplicate: boolean }>;
  receive(): Promise<EvaluationQueueDelivery | null>;
  acknowledge(deliveryId: string): Promise<boolean>;
  reject(deliveryId: string): Promise<boolean>;
}

export interface EvaluationOutboxStore {
  claimOutbox(input: {
    readonly owner: string;
    readonly limit: number;
    readonly leaseTtlMs: number;
    readonly now?: string;
  }): Promise<readonly EvaluationOutboxRow[]>;
  markOutboxPublished(id: string, owner: string, leaseToken: string, now?: string): Promise<boolean>;
  rescheduleOutbox(
    id: string,
    owner: string,
    leaseToken: string,
    errorCode: string,
    availableAt: string,
    now?: string,
  ): Promise<boolean>;
  deadLetterOutbox?(
    id: string,
    owner: string,
    leaseToken: string,
    errorCode: string,
    now?: string,
  ): Promise<boolean>;
}

export interface EvaluationAttemptStore {
  createOrClaimAttempt(input: {
    readonly jobId: EvaluationJobId;
    readonly deliveryKey: string;
    readonly workerId: string;
    readonly leaseTtlMs: number;
    readonly now?: string;
  }): Promise<{
    readonly attempt: EvaluationAttempt;
    readonly created: boolean;
    readonly claimed: boolean;
    /** Durable implementations may expose this for reclaimed attempts; old adapters may omit it. */
    readonly stateVersion?: number;
  }>;
  renewAttemptLease(input: {
    readonly attemptId: EvaluationAttemptId;
    readonly workerId: string;
    readonly workerLeaseId: string;
    readonly leaseTtlMs: number;
    readonly now?: string;
  }): Promise<EvaluationAttempt | null>;
  transitionAttempt(input: {
    readonly attemptId: EvaluationAttemptId;
    readonly workerId: string;
    readonly workerLeaseId: string;
    readonly expectedState: EvaluationAttemptState;
    readonly expectedStateVersion: number;
    readonly nextState: EvaluationAttemptState;
    readonly startedAt?: string | null;
    readonly finishedAt?: string | null;
  }): Promise<EvaluationAttempt | null>;
}

export interface EvaluationWorkerStore extends EvaluationJobStore, EvaluationAttemptStore {}

export interface EvaluationExecutionContext {
  readonly job: EvaluationJobRecord;
  readonly attempt: EvaluationAttempt;
  readonly workerId: string;
  readonly executionToken: string;
  readonly message: EvaluationQueueEnvelope;
}

export type EvaluationExecutionOutcome =
  | { readonly kind: 'completed'; readonly completion: EvaluationCompletion }
  | { readonly kind: 'incomplete'; readonly completion: EvaluationCompletion }
  | { readonly kind: 'failed'; readonly failure: EvaluationFailure }
  | { readonly kind: 'unknown'; readonly code?: string }
  | { readonly kind: 'cancelled' };

/** The actual evaluator is injected; this layer never calls a provider itself. */
export interface EvaluationAttemptExecutor {
  execute(context: EvaluationExecutionContext): Promise<EvaluationExecutionOutcome>;
}

export interface StaleEvaluationAttempt {
  readonly attempt: EvaluationAttempt;
  /** Repository row version used for compare-and-swap fencing. */
  readonly stateVersion: number;
  readonly workerId: string;
  readonly workerLeaseId: string;
  readonly upstreamState: 'none' | 'known-failure' | 'unknown' | 'indeterminate';
}

export interface EvaluationReconciliationStore {
  findStaleAttempts(input: { readonly before: string; readonly limit: number }): Promise<readonly StaleEvaluationAttempt[]>;
}

export interface EvaluationQueueDependencies {
  readonly queue: EvaluationQueuePort;
  readonly store: EvaluationWorkerStore;
  readonly executor: EvaluationAttemptExecutor;
  readonly reconciliation?: EvaluationReconciliationStore;
  readonly workerId: string;
  readonly leaseTtlMs: number;
  readonly now?: () => string;
}

export interface EvaluationWorkerMessageResult {
  readonly status:
    | 'processed'
    | 'duplicate'
    | 'not-ready'
    | 'stale-worker'
    | 'ignored'
    | 'failed';
  readonly message: EvaluationWorkerMessage | null;
  readonly jobId: EvaluationJobId | null;
  readonly attemptId: EvaluationAttemptId | null;
  readonly detail?: string;
}
