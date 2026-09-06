import { asOpaqueId, type EvaluationBudgetReservation, type EvaluationBudgetReservationId, type EvaluationBudgetReservationState, type EvaluationBudgetVector } from '../../../shared/evaluation-types.ts';
import {
  type CreateEvaluationBudgetReservationInput,
  type EvaluationBudgetOperationResult,
  EvaluationBudgetError,
  type EvaluationBudgetService,
  type EvaluationCapacityLease,
  type EvaluationCapacityPolicy,
  type EvaluationSettlementUsage,
  type ReconcileEvaluationBudgetInput,
  type ReleaseEvaluationBudgetInput,
  type SettleEvaluationBudgetInput,
  usageToBudgetVector
} from './ports.ts';

interface StoredReservation {
  reservation: EvaluationBudgetReservation;
  readonly scope: string;
  readonly capacityLease: EvaluationCapacityLease;
  readonly requestDigest: string;
  readonly idempotencyKey: string;
  readonly settlementDigests: Map<string, string>;
  readonly settlementResults: Map<string, EvaluationBudgetReservation>;
  readonly usages: Map<string, EvaluationSettlementUsage>;
  readonly usageDigests: Map<string, string>;
  readonly unknownSettlementKeys: Set<string>;
  releaseDigest: string | null;
  releaseResult: EvaluationBudgetReservation | null;
}

export interface InMemoryEvaluationBudgetServiceOptions {
  readonly now?: () => string;
  readonly createId?: () => string;
}

/**
 * Deterministic in-memory budget ledger. It models the atomic boundaries that
 * a PostgreSQL adapter must preserve, while leaving capacity policy external.
 */
export class InMemoryEvaluationBudgetService implements EvaluationBudgetService {
  private readonly reservations = new Map<EvaluationBudgetReservationId, StoredReservation>();
  private readonly capacity: EvaluationCapacityPolicy;
  private readonly reservationByJob = new Map<string, EvaluationBudgetReservationId>();
  private readonly locks = new Map<string, Promise<void>>();
  private readonly clock: () => string;
  private readonly createId: () => string;

  constructor(capacity: EvaluationCapacityPolicy, options: InMemoryEvaluationBudgetServiceOptions = {}) {
    this.capacity = capacity;
    this.clock = options.now ?? (() => new Date().toISOString());
    let sequence = 0;
    this.createId = options.createId ?? (() => `budget-reservation-${++sequence}`);
  }

  async reserve(input: CreateEvaluationBudgetReservationInput): Promise<EvaluationBudgetOperationResult> {
    validateCreateInput(input);
    return this.withLock(`job:${input.jobId}`, async () => {
      const existingId = this.reservationByJob.get(input.jobId);
      if (existingId) {
        const existing = this.requireStored(existingId);
        if (existing.idempotencyKey !== input.idempotencyKey || existing.requestDigest !== input.requestDigest) {
          throw new EvaluationBudgetError('RESERVATION_CONFLICT', 'A budget reservation already exists for this evaluation job.');
        }
        return { changed: false, reservation: snapshotReservation(existing.reservation) };
      }

      const reservationId = input.reservationId ?? asOpaqueId<'evaluation-budget-reservation'>(this.createId());
      const capacityLease = await this.capacity.reserve({
        reservationId,
        jobId: input.jobId,
        purpose: input.purpose,
        scope: input.scope,
        requested: cloneVector(input.reserved)
      });
      if (!capacityLease) throw new EvaluationBudgetError('CAPACITY_UNAVAILABLE', 'Evaluation capacity is not available.');

      const now = input.now ?? this.clock();
      const reservation: EvaluationBudgetReservation = freezeReservation({
        id: reservationId,
        jobId: input.jobId,
        purpose: input.purpose,
        kind: input.kind,
        state: 'reserved',
        reserved: cloneVector(input.reserved),
        settled: emptyVector(),
        usageCertainty: 'known',
        chargeability: 'not-chargeable',
        createdAt: now,
        updatedAt: now
      });
      const stored: StoredReservation = {
        reservation,
        scope: input.scope,
        capacityLease,
        requestDigest: input.requestDigest,
        idempotencyKey: input.idempotencyKey,
        settlementDigests: new Map(),
        settlementResults: new Map(),
        usages: new Map(),
        usageDigests: new Map(),
        unknownSettlementKeys: new Set(),
        releaseDigest: null,
        releaseResult: null
      };
      this.reservations.set(reservation.id, stored);
      this.reservationByJob.set(input.jobId, reservation.id);
      return { changed: true, reservation: snapshotReservation(reservation) };
    });
  }

  async get(reservationId: EvaluationBudgetReservationId): Promise<EvaluationBudgetReservation | null> {
    const stored = this.reservations.get(reservationId);
    return stored ? snapshotReservation(stored.reservation) : null;
  }

  async settle(input: SettleEvaluationBudgetInput): Promise<EvaluationBudgetOperationResult> {
    validateSettlementInput(input);
    return this.withLock(`reservation:${input.reservationId}`, async () => {
      const stored = this.requireStored(input.reservationId);
      const previousDigest = stored.settlementDigests.get(input.settlementKey);
      if (previousDigest) {
        if (previousDigest !== input.requestDigest) {
          throw new EvaluationBudgetError('SETTLEMENT_CONFLICT', 'The settlement key was already used for a different request.');
        }
        const replay = stored.settlementResults.get(input.settlementKey) ?? stored.reservation;
        return { changed: false, reservation: snapshotReservation(replay) };
      }
      if (stored.reservation.state === 'settled' || stored.reservation.state === 'released') {
        throw new EvaluationBudgetError('RESERVATION_ALREADY_SETTLED', 'The budget reservation is already in a terminal state.');
      }
      if (stored.unknownSettlementKeys.size > 0 || stored.reservation.usageCertainty === 'unknown') {
        throw new EvaluationBudgetError('UNCERTAIN_USAGE_REQUIRES_RECONCILIATION', 'Uncertain usage requires explicit reconciliation before further settlement.');
      }
      if (input.usage.jobId !== stored.reservation.jobId) {
        throw new EvaluationBudgetError('INVALID_INPUT', 'Usage belongs to a different evaluation job.');
      }
      const existingUsageDigest = stored.usageDigests.get(input.usage.id);
      if (existingUsageDigest) {
        if (existingUsageDigest !== input.requestDigest) {
          throw new EvaluationBudgetError('SETTLEMENT_CONFLICT', 'The usage record was already settled for a different request.');
        }
        return { changed: false, reservation: snapshotReservation(stored.reservation) };
      }

      const now = input.now ?? this.clock();
      const complete = input.finalize && input.usage.certainty === 'known';
      const next = applySettlement(stored.reservation, input.usage, complete, now);
      if (complete) await this.releaseCapacity(stored);
      stored.settlementDigests.set(input.settlementKey, input.requestDigest);
      stored.usages.set(input.usage.id, cloneUsage(input.usage));
      stored.usageDigests.set(input.usage.id, input.requestDigest);
      if (input.usage.certainty === 'unknown') stored.unknownSettlementKeys.add(input.settlementKey);
      stored.settlementResults.set(input.settlementKey, next);
      stored.reservation = next;
      return { changed: true, reservation: snapshotReservation(next) };
    });
  }

  async reconcile(input: ReconcileEvaluationBudgetInput): Promise<EvaluationBudgetOperationResult> {
    validateReconcileInput(input);
    return this.withLock(`reservation:${input.reservationId}`, async () => {
      const stored = this.requireStored(input.reservationId);
      if (!stored.unknownSettlementKeys.has(input.unknownSettlementKey)) {
        throw new EvaluationBudgetError('UNCERTAIN_USAGE_REQUIRES_RECONCILIATION', 'No uncertain settlement is available for reconciliation.');
      }
      const previousDigest = stored.settlementDigests.get(input.settlementKey);
      if (previousDigest) {
        if (previousDigest !== input.requestDigest) {
          throw new EvaluationBudgetError('SETTLEMENT_CONFLICT', 'The reconciliation key was already used for a different request.');
        }
        const replay = stored.settlementResults.get(input.settlementKey) ?? stored.reservation;
        return { changed: false, reservation: snapshotReservation(replay) };
      }
      if (input.usage.certainty !== 'known') {
        throw new EvaluationBudgetError('INVALID_INPUT', 'Reconciliation requires known usage or an explicit continued hold.');
      }
      if (input.usage.jobId !== stored.reservation.jobId) {
        throw new EvaluationBudgetError('INVALID_INPUT', 'Usage belongs to a different evaluation job.');
      }
      const existingUsageDigest = stored.usageDigests.get(input.usage.id);
      if (existingUsageDigest) {
        if (existingUsageDigest !== input.requestDigest) {
          throw new EvaluationBudgetError('SETTLEMENT_CONFLICT', 'The usage record was already settled for a different request.');
        }
        return { changed: false, reservation: snapshotReservation(stored.reservation) };
      }

      const now = input.now ?? this.clock();
      const next = applyReconciliation(stored.reservation, input.usage, input.finalize, now);
      if (input.finalize) await this.releaseCapacity(stored);
      stored.unknownSettlementKeys.delete(input.unknownSettlementKey);
      stored.settlementDigests.set(input.settlementKey, input.requestDigest);
      stored.usages.set(input.usage.id, cloneUsage(input.usage));
      stored.usageDigests.set(input.usage.id, input.requestDigest);
      stored.settlementResults.set(input.settlementKey, next);
      stored.reservation = next;
      return { changed: true, reservation: snapshotReservation(next) };
    });
  }

  async release(input: ReleaseEvaluationBudgetInput): Promise<EvaluationBudgetOperationResult> {
    validateReleaseInput(input);
    return this.withLock(`reservation:${input.reservationId}`, async () => {
      const stored = this.requireStored(input.reservationId);
      if (stored.releaseDigest) {
        if (stored.releaseDigest !== input.requestDigest) {
          throw new EvaluationBudgetError('SETTLEMENT_CONFLICT', 'The release key was already used for a different request.');
        }
        return {
          changed: false,
          reservation: snapshotReservation(stored.releaseResult ?? stored.reservation)
        };
      }
      if (stored.unknownSettlementKeys.size > 0 || stored.reservation.usageCertainty === 'unknown' || stored.reservation.chargeability === 'uncertain') {
        throw new EvaluationBudgetError('RELEASE_NOT_ALLOWED', 'Uncertain usage must remain held for reconciliation.');
      }
      if (stored.reservation.state === 'settled' || stored.reservation.state === 'released') {
        throw new EvaluationBudgetError('RELEASE_NOT_ALLOWED', 'The budget reservation cannot be released from its current state.');
      }

      await this.releaseCapacity(stored);
      const now = input.now ?? this.clock();
      const next = freezeReservation({
        ...stored.reservation,
        state: 'released',
        updatedAt: now
      });
      stored.releaseDigest = input.requestDigest;
      stored.releaseResult = next;
      stored.reservation = next;
      return { changed: true, reservation: snapshotReservation(next) };
    });
  }

  async listUsage(reservationId: EvaluationBudgetReservationId): Promise<readonly EvaluationSettlementUsage[]> {
    const stored = this.reservations.get(reservationId);
    if (!stored) return [];
    return [...stored.usages.values()].map(cloneUsage);
  }

  async getState(reservationId: EvaluationBudgetReservationId): Promise<EvaluationBudgetReservationState | null> {
    return (await this.get(reservationId))?.state ?? null;
  }

  private async releaseCapacity(stored: StoredReservation): Promise<void> {
    await this.capacity.release({
      reservationId: stored.reservation.id,
      jobId: stored.reservation.jobId,
      purpose: stored.reservation.purpose,
      scope: stored.scope,
      requested: cloneVector(stored.reservation.reserved),
      lease: stored.capacityLease
    });
  }

  private requireStored(reservationId: EvaluationBudgetReservationId): StoredReservation {
    const stored = this.reservations.get(reservationId);
    if (!stored) throw new EvaluationBudgetError('RESERVATION_NOT_FOUND', 'The budget reservation was not found.');
    return stored;
  }

  private async withLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const chain = previous.then(() => current);
    this.locks.set(key, chain);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.locks.get(key) === chain) this.locks.delete(key);
    }
  }
}

function validateCreateInput(input: CreateEvaluationBudgetReservationInput): void {
  if (!input.jobId || !input.purpose || !input.kind || input.scope.trim().length === 0 || input.idempotencyKey.trim().length === 0 || input.requestDigest.trim().length === 0) {
    throw new EvaluationBudgetError('INVALID_INPUT', 'A complete budget reservation identity is required.');
  }
  validateVector(input.reserved);
}

function validateSettlementInput(input: SettleEvaluationBudgetInput): void {
  if (!input.reservationId || input.settlementKey.trim().length === 0 || input.requestDigest.trim().length === 0) {
    throw new EvaluationBudgetError('INVALID_INPUT', 'A complete settlement identity is required.');
  }
  validateUsage(input.usage);
}

function validateReconcileInput(input: ReconcileEvaluationBudgetInput): void {
  if (!input.reservationId || input.unknownSettlementKey.trim().length === 0 || input.settlementKey.trim().length === 0 || input.requestDigest.trim().length === 0) {
    throw new EvaluationBudgetError('INVALID_INPUT', 'A complete reconciliation identity is required.');
  }
  validateUsage(input.usage);
}

function validateReleaseInput(input: ReleaseEvaluationBudgetInput): void {
  if (!input.reservationId || input.releaseKey.trim().length === 0 || input.requestDigest.trim().length === 0) {
    throw new EvaluationBudgetError('INVALID_INPUT', 'A complete release identity is required.');
  }
}

function validateUsage(usage: EvaluationSettlementUsage): void {
  if (!usage.id || !usage.jobId) throw new EvaluationBudgetError('INVALID_INPUT', 'Usage identity is required.');
  validateOptionalNonNegative(usage.inputTokens);
  validateOptionalNonNegative(usage.outputTokens);
  validateOptionalNonNegative(usage.toolCalls);
  validateOptionalNonNegative(usage.executionMs);
  validateOptionalNonNegative(usage.costUsd);
}

function validateVector(vector: EvaluationBudgetVector): void {
  validateOptionalNonNegative(vector.inputTokens);
  validateOptionalNonNegative(vector.outputTokens);
  validateOptionalNonNegative(vector.toolCalls);
  validateOptionalNonNegative(vector.executionMs);
  validateOptionalNonNegative(vector.costUsd);
}

function validateOptionalNonNegative(value: number | null): void {
  if (value !== null && (!Number.isFinite(value) || value < 0)) {
    throw new EvaluationBudgetError('INVALID_INPUT', 'Budget values must be finite and non-negative.');
  }
}

function applySettlement(
  reservation: EvaluationBudgetReservation,
  usage: EvaluationSettlementUsage,
  complete: boolean,
  now: string
): EvaluationBudgetReservation {
  const known = usage.certainty === 'known';
  const settled = known ? addVector(reservation.settled, usageToBudgetVector(usage)) : cloneVector(reservation.settled);
  return freezeReservation({
    ...reservation,
    state: known && complete ? 'settled' : known ? 'partially-settled' : 'held-for-reconciliation',
    settled,
    usageCertainty: known ? reservation.usageCertainty : 'unknown',
    chargeability: known ? usage.chargeability : 'uncertain',
    updatedAt: now
  });
}

function applyReconciliation(
  reservation: EvaluationBudgetReservation,
  usage: EvaluationSettlementUsage,
  complete: boolean,
  now: string
): EvaluationBudgetReservation {
  return freezeReservation({
    ...reservation,
    state: complete ? 'settled' : 'partially-settled',
    settled: addVector(reservation.settled, usageToBudgetVector(usage)),
    usageCertainty: 'known',
    chargeability: usage.chargeability,
    updatedAt: now
  });
}

function addVector(left: EvaluationBudgetVector, right: EvaluationBudgetVector): EvaluationBudgetVector {
  return {
    inputTokens: addNullable(left.inputTokens, right.inputTokens),
    outputTokens: addNullable(left.outputTokens, right.outputTokens),
    toolCalls: addNullable(left.toolCalls, right.toolCalls),
    executionMs: addNullable(left.executionMs, right.executionMs),
    costUsd: addNullable(left.costUsd, right.costUsd)
  };
}

function addNullable(left: number | null, right: number | null): number | null {
  if (left === null || right === null) return left ?? right;
  return left + right;
}

function emptyVector(): EvaluationBudgetVector {
  return { inputTokens: 0, outputTokens: 0, toolCalls: 0, executionMs: 0, costUsd: 0 };
}

function cloneVector(vector: EvaluationBudgetVector): EvaluationBudgetVector {
  return { ...vector };
}

function cloneUsage(usage: EvaluationSettlementUsage): EvaluationSettlementUsage {
  return { ...usage };
}

function snapshotReservation(reservation: EvaluationBudgetReservation): EvaluationBudgetReservation {
  return freezeReservation({
    ...reservation,
    reserved: cloneVector(reservation.reserved),
    settled: cloneVector(reservation.settled)
  });
}

function freezeReservation(reservation: EvaluationBudgetReservation): EvaluationBudgetReservation {
  Object.freeze(reservation.reserved);
  Object.freeze(reservation.settled);
  return Object.freeze(reservation);
}
