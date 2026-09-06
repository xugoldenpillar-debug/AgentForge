import type {
  EvaluationBudgetKind,
  EvaluationBudgetReservation,
  EvaluationBudgetReservationId,
  EvaluationBudgetReservationState,
  EvaluationBudgetVector,
  EvaluationDigest,
  EvaluationJobId,
  EvaluationPurpose,
  EvaluationUsageRecord,
  UsageCertainty,
  UsageChargeability
} from '../../../shared/evaluation-types.ts';

export interface EvaluationCapacityRequest {
  readonly reservationId: EvaluationBudgetReservationId;
  readonly jobId: EvaluationJobId;
  readonly purpose: EvaluationPurpose;
  readonly scope: string;
  readonly requested: EvaluationBudgetVector;
}

export interface EvaluationCapacityLease {
  readonly token: string;
  readonly scope: string;
}

/**
 * Capacity is deliberately a port. Provider RPM/TPM and concurrency policy
 * belong to the deployment, not to this foundation package.
 */
export interface EvaluationCapacityPolicy {
  reserve(input: EvaluationCapacityRequest): EvaluationCapacityLease | null | Promise<EvaluationCapacityLease | null>;
  release(input: EvaluationCapacityRequest & { readonly lease: EvaluationCapacityLease }): void | Promise<void>;
}

export interface CreateEvaluationBudgetReservationInput {
  readonly reservationId?: EvaluationBudgetReservationId;
  readonly jobId: EvaluationJobId;
  readonly purpose: EvaluationPurpose;
  readonly kind: EvaluationBudgetKind;
  readonly scope: string;
  readonly idempotencyKey: string;
  readonly requestDigest: EvaluationDigest;
  readonly reserved: EvaluationBudgetVector;
  readonly now?: string;
}

export interface EvaluationSettlementUsage {
  readonly id: string;
  readonly jobId: EvaluationJobId;
  readonly certainty: UsageCertainty;
  readonly chargeability: UsageChargeability;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly toolCalls: number | null;
  readonly executionMs: number | null;
  readonly costUsd: number | null;
}

export interface SettleEvaluationBudgetInput {
  readonly reservationId: EvaluationBudgetReservationId;
  readonly settlementKey: string;
  readonly requestDigest: EvaluationDigest;
  readonly usage: EvaluationSettlementUsage;
  /** A known, complete settlement may close the reservation. */
  readonly finalize: boolean;
  readonly now?: string;
}

export interface ReconcileEvaluationBudgetInput {
  readonly reservationId: EvaluationBudgetReservationId;
  readonly unknownSettlementKey: string;
  readonly settlementKey: string;
  readonly requestDigest: EvaluationDigest;
  readonly usage: EvaluationSettlementUsage;
  readonly finalize: boolean;
  readonly now?: string;
}

export interface ReleaseEvaluationBudgetInput {
  readonly reservationId: EvaluationBudgetReservationId;
  readonly releaseKey: string;
  readonly requestDigest: EvaluationDigest;
  readonly now?: string;
}

export interface EvaluationBudgetOperationResult {
  readonly changed: boolean;
  readonly reservation: EvaluationBudgetReservation;
}

export interface EvaluationBudgetService {
  reserve(input: CreateEvaluationBudgetReservationInput): Promise<EvaluationBudgetOperationResult>;
  get(reservationId: EvaluationBudgetReservationId): Promise<EvaluationBudgetReservation | null>;
  settle(input: SettleEvaluationBudgetInput): Promise<EvaluationBudgetOperationResult>;
  reconcile(input: ReconcileEvaluationBudgetInput): Promise<EvaluationBudgetOperationResult>;
  release(input: ReleaseEvaluationBudgetInput): Promise<EvaluationBudgetOperationResult>;
  listUsage(reservationId: EvaluationBudgetReservationId): Promise<readonly EvaluationSettlementUsage[]>;
  getState(reservationId: EvaluationBudgetReservationId): Promise<EvaluationBudgetReservationState | null>;
}

export class EvaluationBudgetError extends Error {
  readonly code: EvaluationBudgetErrorCode;

  constructor(code: EvaluationBudgetErrorCode, message: string) {
    super(message);
    this.name = 'EvaluationBudgetError';
    this.code = code;
  }
}

export type EvaluationBudgetErrorCode =
  | 'INVALID_INPUT'
  | 'RESERVATION_NOT_FOUND'
  | 'RESERVATION_CONFLICT'
  | 'CAPACITY_UNAVAILABLE'
  | 'SETTLEMENT_CONFLICT'
  | 'RESERVATION_ALREADY_SETTLED'
  | 'UNCERTAIN_USAGE_REQUIRES_RECONCILIATION'
  | 'RELEASE_NOT_ALLOWED';

export function usageToBudgetVector(usage: EvaluationSettlementUsage): EvaluationBudgetVector {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    toolCalls: usage.toolCalls,
    executionMs: usage.executionMs,
    costUsd: usage.costUsd
  };
}

export function evaluationUsageRecordToSettlementUsage(record: EvaluationUsageRecord): EvaluationSettlementUsage {
  return {
    id: record.id,
    jobId: record.jobId,
    certainty: record.certainty,
    chargeability: record.chargeability,
    inputTokens: record.inputTokens,
    outputTokens: record.outputTokens,
    toolCalls: record.toolCalls,
    executionMs: record.latencyMs,
    costUsd: record.costUsd
  };
}
