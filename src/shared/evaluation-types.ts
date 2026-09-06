import {
  EVALUATION_ERROR_CODES,
  EvaluationContractError,
  invalidContract
} from './evaluation-errors.ts';

/** Values accepted by persisted evaluation payloads and message bodies. */
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { readonly [key: string]: JsonValue };

/** A string that is intentionally not interchangeable with another domain identifier. */
export type OpaqueId<Kind extends string> = string & { readonly __opaqueId: Kind };
export type EvaluationJobId = OpaqueId<'evaluation-job'>;
export type EvaluationAttemptId = OpaqueId<'evaluation-attempt'>;
export type EvaluationInvocationId = OpaqueId<'evaluation-invocation'>;
export type EvaluationOutboxEventId = OpaqueId<'evaluation-outbox-event'>;
export type EvaluationMessageId = OpaqueId<'evaluation-message'>;
export type EvaluationBudgetReservationId = OpaqueId<'evaluation-budget-reservation'>;
export type EvaluationUsageRecordId = OpaqueId<'evaluation-usage-record'>;
export type EvaluationIdempotencyRecordId = OpaqueId<'evaluation-idempotency-record'>;
export type UserId = OpaqueId<'user'>;
export type RunId = OpaqueId<'run'>;
export type BuildVersionId = OpaqueId<'build-version'>;
export type TestSuiteVersionId = OpaqueId<'test-suite-version'>;
export type SkillVersionId = OpaqueId<'skill-version'>;
export type SelfTestRunId = OpaqueId<'self-test-run'>;
export type ComponentEvaluationId = OpaqueId<'component-evaluation'>;

/** Timestamps follow the repository convention of serializable ISO-8601 strings. */
export type EvaluationTimestamp = string;
export type EvaluationDigest = string;

export function asOpaqueId<Kind extends string>(value: string): OpaqueId<Kind> {
  if (value.trim().length === 0) throw invalidContract('Opaque identifiers must not be empty.');
  return value as OpaqueId<Kind>;
}

export type EvaluationPurpose = 'competitive' | 'author-self-test' | 'component-evaluation';
export type CompetitiveEvaluationVisibility = 'public' | 'hidden';

export type EvaluationJobState =
  | 'accepted'
  | 'queued'
  | 'running'
  | 'cancelling'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'incomplete'
  | 'unknown'
  | 'reconciling'
  | 'expired';

export type EvaluationAttemptState =
  | 'created'
  | 'claimed'
  | 'running'
  | 'cancelling'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'incomplete'
  | 'unknown'
  | 'reconciling'
  | 'expired';

export type EvaluationInvocationState =
  | 'pending'
  | 'started'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'unknown'
  | 'reconciling';

export type CancellationReason =
  | 'user-requested'
  | 'authorization-revoked'
  | 'budget-revoked'
  | 'system-shutdown'
  | 'worker-timeout';

export type UsageCertainty = 'known' | 'unknown';
export type UsageChargeability = 'not-chargeable' | 'chargeable' | 'uncertain';

export type EvaluationOutboxEventKind =
  | 'evaluation-job-accepted'
  | 'evaluation-job-cancel-requested'
  | 'evaluation-attempt-dispatch-requested'
  | 'evaluation-attempt-reconcile-requested';

export type EvaluationWorkerMessageKind =
  | 'execute-attempt'
  | 'reconcile-attempt'
  | 'cancel-attempt';

export const EVALUATION_WORKER_CONTRACT = 'agentforge.evaluation.worker' as const;
export const EVALUATION_WORKER_MESSAGE_VERSION = 1 as const;
export const EVALUATION_SNAPSHOT_VERSION = 1 as const;

export type EvaluationAssociation =
  | { readonly kind: 'competitive-run'; readonly runId: RunId; readonly visibility: CompetitiveEvaluationVisibility }
  | { readonly kind: 'self-test-run'; readonly selfTestRunId: SelfTestRunId }
  | { readonly kind: 'component-evaluation'; readonly componentEvaluationId: ComponentEvaluationId };

export interface EvaluationInputSnapshot {
  readonly schemaVersion: typeof EVALUATION_SNAPSHOT_VERSION;
  readonly buildVersionId: BuildVersionId;
  readonly testSuiteVersionId: TestSuiteVersionId;
  readonly skillVersionId: SkillVersionId | null;
  readonly runtimeAdapter: string;
  readonly modelOfferingId: string | null;
  readonly policyVersion: string;
  readonly consentVersion: string | null;
  readonly credentialAuthorizationId: string | null;
  readonly snapshotDigest: EvaluationDigest;
  readonly capturedAt: EvaluationTimestamp;
  readonly metadata: JsonObject;
}

export type EvaluationIdempotencyScope =
  | 'evaluation-job-create'
  | 'evaluation-attempt-dispatch'
  | 'evaluation-attempt-settlement';

export interface EvaluationIdempotencyKey {
  readonly scope: EvaluationIdempotencyScope;
  readonly key: string;
  readonly requestDigest: EvaluationDigest;
}

export interface EvaluationIdempotencyRecord {
  readonly id: EvaluationIdempotencyRecordId;
  readonly idempotency: EvaluationIdempotencyKey;
  readonly jobId: EvaluationJobId;
  readonly createdAt: EvaluationTimestamp;
  readonly expiresAt: EvaluationTimestamp | null;
}

export type EvaluationBudgetKind = 'execution-budget' | 'benchmark-cost' | 'platform-spend';
export type EvaluationBudgetReservationState =
  | 'reserved'
  | 'partially-settled'
  | 'settled'
  | 'released'
  | 'held-for-reconciliation';

export interface EvaluationBudgetVector {
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly toolCalls: number | null;
  readonly executionMs: number | null;
  readonly costUsd: number | null;
}

export interface EvaluationBudgetReservation {
  readonly id: EvaluationBudgetReservationId;
  readonly jobId: EvaluationJobId;
  readonly purpose: EvaluationPurpose;
  readonly kind: EvaluationBudgetKind;
  readonly state: EvaluationBudgetReservationState;
  readonly reserved: EvaluationBudgetVector;
  readonly settled: EvaluationBudgetVector;
  readonly usageCertainty: UsageCertainty;
  readonly chargeability: UsageChargeability;
  readonly createdAt: EvaluationTimestamp;
  readonly updatedAt: EvaluationTimestamp;
}

export interface EvaluationUsageRecord {
  readonly id: EvaluationUsageRecordId;
  readonly jobId: EvaluationJobId;
  readonly attemptId: EvaluationAttemptId;
  readonly invocationId: EvaluationInvocationId | null;
  readonly certainty: UsageCertainty;
  readonly chargeability: UsageChargeability;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly reasoningTokens: number | null;
  readonly toolCalls: number | null;
  readonly latencyMs: number | null;
  readonly costUsd: number | null;
  readonly providerRequestId: string | null;
  readonly evidenceRef: string | null;
  readonly recordedAt: EvaluationTimestamp;
}

export interface EvaluationJob {
  readonly id: EvaluationJobId;
  readonly userId: UserId;
  readonly purpose: EvaluationPurpose;
  readonly association: EvaluationAssociation;
  readonly state: EvaluationJobState;
  readonly snapshot: EvaluationInputSnapshot;
  readonly idempotency: EvaluationIdempotencyKey;
  readonly budgetReservationId: EvaluationBudgetReservationId | null;
  readonly cancellationReason: CancellationReason | null;
  readonly acceptedAt: EvaluationTimestamp;
  readonly createdAt: EvaluationTimestamp;
  readonly updatedAt: EvaluationTimestamp;
  readonly completedAt: EvaluationTimestamp | null;
}

export interface EvaluationAttempt {
  readonly id: EvaluationAttemptId;
  readonly jobId: EvaluationJobId;
  readonly number: number;
  readonly state: EvaluationAttemptState;
  readonly workerLeaseId: string | null;
  readonly startedAt: EvaluationTimestamp | null;
  readonly finishedAt: EvaluationTimestamp | null;
  readonly createdAt: EvaluationTimestamp;
  readonly updatedAt: EvaluationTimestamp;
}

export interface EvaluationInvocation {
  readonly id: EvaluationInvocationId;
  readonly jobId: EvaluationJobId;
  readonly attemptId: EvaluationAttemptId;
  readonly state: EvaluationInvocationState;
  readonly invocationIndex: number;
  readonly requestDigest: EvaluationDigest;
  readonly providerRequestId: string | null;
  readonly usageRecordId: EvaluationUsageRecordId | null;
  readonly createdAt: EvaluationTimestamp;
  readonly updatedAt: EvaluationTimestamp;
}

export interface EvaluationOutboxEvent {
  readonly id: EvaluationOutboxEventId;
  readonly version: typeof EVALUATION_WORKER_MESSAGE_VERSION;
  readonly kind: EvaluationOutboxEventKind;
  readonly aggregateId: EvaluationJobId;
  readonly occurredAt: EvaluationTimestamp;
  readonly requestDigest: EvaluationDigest;
  readonly payload: JsonObject;
  readonly publishedAt: EvaluationTimestamp | null;
}

export interface EvaluationWorkerMessage {
  readonly contract: typeof EVALUATION_WORKER_CONTRACT;
  readonly version: typeof EVALUATION_WORKER_MESSAGE_VERSION;
  readonly kind: EvaluationWorkerMessageKind;
  readonly messageId: EvaluationMessageId;
  readonly jobId: EvaluationJobId;
  readonly attemptId: EvaluationAttemptId;
  readonly requestDigest: EvaluationDigest;
  readonly snapshotDigest: EvaluationDigest;
  readonly issuedAt: EvaluationTimestamp;
}

const JOB_TRANSITIONS: Readonly<Record<EvaluationJobState, readonly EvaluationJobState[]>> = {
  accepted: ['queued', 'failed', 'cancelled', 'expired'],
  queued: ['running', 'cancelling', 'failed', 'cancelled', 'expired'],
  running: ['cancelling', 'completed', 'failed', 'incomplete', 'unknown', 'reconciling'],
  cancelling: ['completed', 'failed', 'cancelled', 'incomplete', 'unknown', 'reconciling'],
  completed: [],
  failed: [],
  cancelled: [],
  incomplete: [],
  unknown: ['reconciling', 'completed', 'failed', 'cancelled', 'incomplete'],
  reconciling: ['completed', 'failed', 'cancelled', 'incomplete', 'unknown'],
  expired: []
};

const ATTEMPT_TRANSITIONS: Readonly<Record<EvaluationAttemptState, readonly EvaluationAttemptState[]>> = {
  created: ['claimed', 'failed', 'cancelled', 'expired'],
  claimed: ['running', 'failed', 'cancelled', 'expired'],
  running: ['cancelling', 'completed', 'failed', 'incomplete', 'unknown', 'reconciling'],
  cancelling: ['completed', 'failed', 'cancelled', 'incomplete', 'unknown', 'reconciling'],
  completed: [],
  failed: [],
  cancelled: [],
  incomplete: [],
  unknown: ['reconciling', 'completed', 'failed', 'cancelled', 'incomplete'],
  reconciling: ['completed', 'failed', 'cancelled', 'incomplete', 'unknown'],
  expired: []
};

const INVOCATION_TRANSITIONS: Readonly<Record<EvaluationInvocationState, readonly EvaluationInvocationState[]>> = {
  pending: ['started', 'cancelled', 'unknown'],
  started: ['succeeded', 'failed', 'cancelled', 'unknown', 'reconciling'],
  succeeded: [],
  failed: [],
  cancelled: [],
  unknown: ['reconciling', 'succeeded', 'failed', 'cancelled'],
  reconciling: ['succeeded', 'failed', 'cancelled', 'unknown']
};

const TERMINAL_JOB_STATES: ReadonlySet<EvaluationJobState> = new Set([
  'completed', 'failed', 'cancelled', 'incomplete', 'expired'
]);
const TERMINAL_ATTEMPT_STATES: ReadonlySet<EvaluationAttemptState> = new Set([
  'completed', 'failed', 'cancelled', 'incomplete', 'expired'
]);
const TERMINAL_INVOCATION_STATES: ReadonlySet<EvaluationInvocationState> = new Set([
  'succeeded', 'failed', 'cancelled'
]);

function transitionState<State extends string>(
  entity: string,
  current: State,
  next: State,
  transitions: Readonly<Record<State, readonly State[]>>,
  terminalStates: ReadonlySet<State>
): State {
  if (current === next) return current;
  if (terminalStates.has(current)) {
    throw new EvaluationContractError(
      EVALUATION_ERROR_CODES.TERMINAL_STATE_IMMUTABLE,
      `${entity} state '${current}' is terminal and cannot transition to '${next}'.`,
      { entity, from: current, to: next }
    );
  }
  if (!transitions[current].includes(next)) {
    throw new EvaluationContractError(
      EVALUATION_ERROR_CODES.INVALID_STATE_TRANSITION,
      `${entity} cannot transition from '${current}' to '${next}'.`,
      { entity, from: current, to: next }
    );
  }
  return next;
}

export function isTerminalEvaluationJobState(state: EvaluationJobState): boolean {
  return TERMINAL_JOB_STATES.has(state);
}

export function isTerminalEvaluationAttemptState(state: EvaluationAttemptState): boolean {
  return TERMINAL_ATTEMPT_STATES.has(state);
}

export function isTerminalEvaluationInvocationState(state: EvaluationInvocationState): boolean {
  return TERMINAL_INVOCATION_STATES.has(state);
}

export function canTransitionEvaluationJob(from: EvaluationJobState, to: EvaluationJobState): boolean {
  return from === to || (!TERMINAL_JOB_STATES.has(from) && JOB_TRANSITIONS[from].includes(to));
}

export function canTransitionEvaluationAttempt(from: EvaluationAttemptState, to: EvaluationAttemptState): boolean {
  return from === to || (!TERMINAL_ATTEMPT_STATES.has(from) && ATTEMPT_TRANSITIONS[from].includes(to));
}

export function canTransitionEvaluationInvocation(from: EvaluationInvocationState, to: EvaluationInvocationState): boolean {
  return from === to || (!TERMINAL_INVOCATION_STATES.has(from) && INVOCATION_TRANSITIONS[from].includes(to));
}

export function transitionEvaluationJobState(from: EvaluationJobState, to: EvaluationJobState): EvaluationJobState {
  return transitionState('evaluation job', from, to, JOB_TRANSITIONS, TERMINAL_JOB_STATES);
}

export function transitionEvaluationAttemptState(from: EvaluationAttemptState, to: EvaluationAttemptState): EvaluationAttemptState {
  return transitionState('evaluation attempt', from, to, ATTEMPT_TRANSITIONS, TERMINAL_ATTEMPT_STATES);
}

export function transitionEvaluationInvocationState(from: EvaluationInvocationState, to: EvaluationInvocationState): EvaluationInvocationState {
  return transitionState('evaluation invocation', from, to, INVOCATION_TRANSITIONS, TERMINAL_INVOCATION_STATES);
}

export function assertEvaluationAssociation(
  purpose: EvaluationPurpose,
  association: EvaluationAssociation
): void {
  const expectedKind: EvaluationAssociation['kind'] = purpose === 'competitive'
    ? 'competitive-run'
    : purpose === 'author-self-test'
      ? 'self-test-run'
      : 'component-evaluation';

  if (association.kind !== expectedKind) {
    throw new EvaluationContractError(
      EVALUATION_ERROR_CODES.PURPOSE_ASSOCIATION_MISMATCH,
      `Evaluation purpose '${purpose}' cannot use association '${association.kind}'.`,
      { purpose, association: association.kind }
    );
  }

  const associationKeys = Object.keys(association);
  const expectedKeys = expectedKind === 'competitive-run'
    ? ['kind', 'runId', 'visibility']
    : ['kind', expectedKind === 'self-test-run' ? 'selfTestRunId' : 'componentEvaluationId'];

  if (associationKeys.length !== expectedKeys.length || expectedKeys.some((key) => !associationKeys.includes(key))) {
    throw new EvaluationContractError(
      EVALUATION_ERROR_CODES.INVALID_ASSOCIATION,
      'An evaluation job must contain exactly one complete business association.',
      { purpose, association: association.kind }
    );
  }
}

export function assertEvaluationJobContract(job: EvaluationJob): void {
  assertEvaluationAssociation(job.purpose, job.association);
  if (job.snapshot.schemaVersion !== EVALUATION_SNAPSHOT_VERSION) {
    throw new EvaluationContractError(
      EVALUATION_ERROR_CODES.INVALID_CONTRACT,
      `Unsupported evaluation snapshot version '${String(job.snapshot.schemaVersion)}'.`
    );
  }
  if (job.idempotency.scope !== 'evaluation-job-create') {
    throw new EvaluationContractError(
      EVALUATION_ERROR_CODES.INVALID_CONTRACT,
      'Evaluation job creation must use the evaluation-job-create idempotency scope.'
    );
  }
}
