import type {
  EvaluationDigest,
  EvaluationInvocation,
  EvaluationInvocationId,
  EvaluationInvocationState,
  EvaluationJobId,
  EvaluationAttemptId,
  UsageCertainty,
  UsageChargeability
} from '../../../shared/evaluation-types.ts';

export interface EvaluationInvocationTiming {
  readonly queueWaitMs: number | null;
  readonly executionDurationMs: number | null;
}

export interface EvaluationInvocationUsage {
  readonly certainty: UsageCertainty;
  readonly chargeability: UsageChargeability;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly reasoningTokens: number | null;
  readonly toolCalls: number | null;
  readonly latencyMs: number | null;
  readonly costUsd: number | null;
}

export interface EvaluationInvocationReceipt {
  readonly invocationId: EvaluationInvocationId;
  readonly jobId: EvaluationJobId;
  readonly attemptId: EvaluationAttemptId;
  readonly requestDigest: EvaluationDigest;
  readonly responseDigest: EvaluationDigest | null;
  readonly providerRequestId: string | null;
  readonly state: Extract<EvaluationInvocationState, 'succeeded' | 'failed' | 'cancelled' | 'unknown'>;
  readonly usage: EvaluationInvocationUsage;
  readonly timing: EvaluationInvocationTiming;
  readonly recordedAt: string;
}

export interface EvaluationInvocationRecord extends EvaluationInvocation {
  readonly requestId: string;
  readonly idempotencyKey: string;
  readonly providerScope: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly queuedAt: string;
  readonly preparedAt: string;
  readonly dispatchedAt: string | null;
  readonly completedAt: string | null;
  readonly possiblyDispatched: boolean;
  readonly timing: EvaluationInvocationTiming;
  readonly receipt: EvaluationInvocationReceipt | null;
}

export interface PrepareEvaluationInvocationInput {
  readonly invocationId?: EvaluationInvocationId;
  readonly jobId: EvaluationJobId;
  readonly attemptId: EvaluationAttemptId;
  readonly invocationIndex: number;
  readonly requestId: string;
  readonly idempotencyKey: string;
  readonly providerScope: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly requestDigest: EvaluationDigest;
  readonly queuedAt: string;
  readonly preparedAt?: string;
}

export interface DispatchEvaluationInvocationInput {
  readonly invocationId: EvaluationInvocationId;
  readonly startedAt: string;
}

export interface FinalizeEvaluationInvocationInput {
  readonly invocationId: EvaluationInvocationId;
  readonly state: Extract<EvaluationInvocationState, 'succeeded' | 'failed' | 'cancelled' | 'unknown'>;
  readonly requestDigest: EvaluationDigest;
  readonly responseDigest?: EvaluationDigest | null;
  readonly providerRequestId?: string | null;
  readonly usage: EvaluationInvocationUsage;
  readonly completedAt: string;
}

export interface EvaluationInvocationDispatchContext {
  readonly invocationId: EvaluationInvocationId;
  readonly jobId: EvaluationJobId;
  readonly attemptId: EvaluationAttemptId;
  readonly requestId: string;
  readonly idempotencyKey: string;
  readonly requestDigest: EvaluationDigest;
}

export interface EvaluationInvocationDispatchResult {
  readonly state: Extract<EvaluationInvocationState, 'succeeded' | 'failed' | 'cancelled' | 'unknown'>;
  readonly responseDigest?: EvaluationDigest | null;
  readonly providerRequestId?: string | null;
  readonly usage: EvaluationInvocationUsage;
}

export interface EvaluationInvocationDispatcher {
  dispatch(input: EvaluationInvocationDispatchContext): EvaluationInvocationDispatchResult | Promise<EvaluationInvocationDispatchResult>;
}

export interface EvaluationInvocationOperationResult {
  readonly changed: boolean;
  readonly invocation: EvaluationInvocationRecord;
}

export interface EvaluationInvocationBoundary {
  prepare(input: PrepareEvaluationInvocationInput): Promise<EvaluationInvocationOperationResult>;
  dispatch(input: DispatchEvaluationInvocationInput): Promise<EvaluationInvocationOperationResult>;
  finalize(input: FinalizeEvaluationInvocationInput): Promise<EvaluationInvocationOperationResult>;
  execute(input: DispatchEvaluationInvocationInput, dispatcher: EvaluationInvocationDispatcher): Promise<EvaluationInvocationOperationResult>;
  reconcile(input: FinalizeEvaluationInvocationInput): Promise<EvaluationInvocationOperationResult>;
  get(invocationId: EvaluationInvocationId): Promise<EvaluationInvocationRecord | null>;
  getByIdempotency(idempotencyKey: string): Promise<EvaluationInvocationRecord | null>;
  getReceipt(invocationId: EvaluationInvocationId): Promise<EvaluationInvocationReceipt | null>;
}

export class EvaluationInvocationError extends Error {
  readonly code: EvaluationInvocationErrorCode;

  constructor(code: EvaluationInvocationErrorCode, message: string) {
    super(message);
    this.name = 'EvaluationInvocationError';
    this.code = code;
  }
}

export type EvaluationInvocationErrorCode =
  | 'INVALID_INPUT'
  | 'INVOCATION_NOT_FOUND'
  | 'IDEMPOTENCY_CONFLICT'
  | 'REQUEST_ALREADY_UNCERTAIN'
  | 'INVOCATION_ALREADY_FINALIZED'
  | 'INVALID_STATE'
  | 'UPSTREAM_RESULT_UNKNOWN';
