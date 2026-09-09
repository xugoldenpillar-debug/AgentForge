import { randomUUID } from 'node:crypto';
import type {
  EvaluationAttempt,
  EvaluationAttemptId,
  EvaluationAttemptState,
  EvaluationBudgetReservation,
  EvaluationIdempotencyKey,
  EvaluationInvocation,
  EvaluationInvocationId,
  EvaluationInvocationState,
  EvaluationJobId,
  EvaluationOutboxEvent,
  EvaluationUsageRecord,
  EvaluationJobState,
  EvaluationPurpose,
  EvaluationBudgetKind,
  EvaluationBudgetReservationState,
  UsageChargeability,
  UsageCertainty,
} from '../shared/evaluation-types.ts';
import {
  asOpaqueId,
  canTransitionEvaluationAttempt,
  canTransitionEvaluationInvocation,
  canTransitionEvaluationJob,
} from '../shared/evaluation-types.ts';
import type {
  EvaluationAttemptRow,
  EvaluationBudgetReservationRow,
  EvaluationIdempotencyKeyRow,
  EvaluationInvocationRow,
  EvaluationJobRow,
  EvaluationOutboxRow,
  EvaluationUsageRecordRow,
  Repository,
} from '../shared/types.ts';
import type {
  EvaluationCompletion,
  EvaluationFailure,
  EvaluationJobRecord,
  EvaluationJobStore,
  EvaluationJobPatch,
  EvaluationTransitionGuard,
} from '../server/evaluation/domain.ts';

export type EvaluationPersistenceErrorCode =
  | 'active-job-exists'
  | 'association-exists'
  | 'idempotency-conflict'
  | 'not-found'
  | 'duplicate'
  | 'stale-lease'
  | 'invalid-state'
  | 'invalid-request';

export class EvaluationPersistenceError extends Error {
  readonly code: EvaluationPersistenceErrorCode;

  constructor(code: EvaluationPersistenceErrorCode, message: string) {
    super(message);
    this.name = 'EvaluationPersistenceError';
    this.code = code;
  }
}

export interface CreateEvaluationAttemptInput {
  readonly jobId: EvaluationJobId;
  readonly deliveryKey: string;
  readonly workerId: string;
  readonly leaseTtlMs: number;
  readonly now?: string;
}

export interface CreateEvaluationAttemptResult {
  readonly attempt: EvaluationAttempt;
  readonly created: boolean;
  readonly claimed: boolean;
}

export interface RenewEvaluationAttemptLeaseInput {
  readonly attemptId: EvaluationAttemptId;
  readonly workerId: string;
  readonly workerLeaseId: string;
  readonly leaseTtlMs: number;
  readonly now?: string;
}

export interface TransitionEvaluationAttemptInput {
  readonly attemptId: EvaluationAttemptId;
  readonly workerId: string;
  readonly workerLeaseId: string;
  readonly expectedState: EvaluationAttemptState;
  readonly expectedStateVersion: number;
  readonly nextState: EvaluationAttemptState;
  readonly startedAt?: string | null;
  readonly finishedAt?: string | null;
}

export interface CreateEvaluationInvocationInput {
  readonly id: EvaluationInvocationId;
  readonly jobId: EvaluationJobId;
  readonly attemptId: EvaluationAttemptId;
  readonly invocationIndex: number;
  readonly requestId: string;
  readonly idempotencyKey: string;
  readonly providerScope: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly requestDigest: string;
}

export interface StartEvaluationInvocationInput {
  readonly invocationId: EvaluationInvocationId;
  readonly now?: string;
}

export interface FinalizeEvaluationInvocationInput {
  readonly invocationId: EvaluationInvocationId;
  readonly state: EvaluationInvocationState;
  readonly providerRequestId?: string | null;
  readonly usage: EvaluationUsageRecordRow;
  readonly now?: string;
}

export interface CreateEvaluationBudgetReservationInput {
  readonly id: string;
  readonly jobId: EvaluationJobId;
  readonly purpose: EvaluationPurpose;
  readonly kind: EvaluationBudgetKind;
  readonly state: EvaluationBudgetReservationState;
  readonly usageCertainty: UsageCertainty;
  readonly chargeability: UsageChargeability;
  readonly reservedInputTokens: number | null;
  readonly reservedOutputTokens: number | null;
  readonly reservedToolCalls: number | null;
  readonly reservedExecutionMs: number | null;
  readonly reservedCostUsd: number | null;
};

export interface SettleEvaluationBudgetInput {
  readonly jobId: EvaluationJobId;
  readonly expectedState: EvaluationBudgetReservationState;
  readonly nextState: EvaluationBudgetReservationState;
  readonly usageCertainty: UsageCertainty;
  readonly chargeability: UsageChargeability;
  readonly settledInputTokens: number | null;
  readonly settledOutputTokens: number | null;
  readonly settledToolCalls: number | null;
  readonly settledExecutionMs: number | null;
  readonly settledCostUsd: number | null;
  readonly now?: string;
}

export interface ClaimEvaluationOutboxInput {
  readonly owner: string;
  readonly limit: number;
  readonly leaseTtlMs: number;
  readonly now?: string;
}

export interface EvaluationRepository extends EvaluationJobStore {
  createOrClaimAttempt(input: CreateEvaluationAttemptInput): Promise<CreateEvaluationAttemptResult>;
  renewAttemptLease(input: RenewEvaluationAttemptLeaseInput): Promise<EvaluationAttempt | null>;
  transitionAttempt(input: TransitionEvaluationAttemptInput): Promise<EvaluationAttempt | null>;
  createInvocation(input: CreateEvaluationInvocationInput): Promise<{ invocation: EvaluationInvocation; created: boolean }>;
  startInvocation(input: StartEvaluationInvocationInput): Promise<EvaluationInvocation | null>;
  finalizeInvocation(input: FinalizeEvaluationInvocationInput): Promise<{ invocation: EvaluationInvocation; usage: EvaluationUsageRecord }>;
  createBudgetReservation(input: CreateEvaluationBudgetReservationInput): Promise<EvaluationBudgetReservation>;
  settleBudget(input: SettleEvaluationBudgetInput): Promise<EvaluationBudgetReservation | null>;
  claimOutbox(input: ClaimEvaluationOutboxInput): Promise<EvaluationOutboxRow[]>;
  markOutboxPublished(id: string, owner: string, leaseToken: string, now?: string): Promise<boolean>;
  rescheduleOutbox(id: string, owner: string, leaseToken: string, errorCode: string, availableAt: string, now?: string): Promise<boolean>;
  deadLetterOutbox(id: string, owner: string, leaseToken: string, errorCode: string, now?: string): Promise<boolean>;
}

const ACTIVE_JOB_STATES: readonly EvaluationJobState[] = [
  'accepted', 'queued', 'running', 'cancelling', 'unknown', 'reconciling',
];
const UNKNOWN_JOB_SLOT_GRACE_MS = 15 * 60 * 1000;
const ACTIVE_ATTEMPT_STATES: readonly EvaluationAttemptState[] = [
  'claimed', 'running', 'cancelling', 'reconciling',
];
const TERMINAL_ATTEMPT_STATES: readonly EvaluationAttemptState[] = [
  'completed', 'failed', 'cancelled', 'incomplete', 'expired',
];

export class EvaluationRepositoryAdapter implements EvaluationRepository {
  private readonly repository: Repository;
  private readonly clock: () => string;

  constructor(repository: Repository, clock: () => string = () => new Date().toISOString()) {
    this.repository = repository;
    this.clock = clock;
  }

  async findByIdempotency(scope: EvaluationJobRecord['idempotency']['scope'], key: string): Promise<EvaluationJobRecord | null> {
    const rows = await this.repository.read('evaluationIdempotencyKeys', { scope, key });
    const row = rows[0];
    return row ? this.get(asOpaqueId<'evaluation-job'>(row.jobId)) : null;
  }

  async createIfAbsent(
    record: EvaluationJobRecord,
    acceptedEvent: EvaluationOutboxEvent,
  ): Promise<{ readonly created: boolean; readonly record: EvaluationJobRecord }> {
    const scope = record.idempotency.scope;
    const key = record.idempotency.key;
    try {
      return await this.repository.transaction(async (tx) => {
        const existingKey = (await tx.read('evaluationIdempotencyKeys', { scope, key }))[0];
        if (existingKey) {
          if (existingKey.requestDigest !== record.idempotency.requestDigest) {
            throw new EvaluationPersistenceError('idempotency-conflict', 'The idempotency key was already used for a different request.');
          }
          const existing = await tx.read('evaluationJobs', { id: existingKey.jobId });
          if (!existing[0]) throw new EvaluationPersistenceError('not-found', 'The idempotency record points to a missing evaluation job.');
          await associateCreationRun(tx, record, existing[0].id);
          return { created: false, record: toJobRecord(existing[0]) };
        }

        const now = this.clock();
        const jobs = await tx.read('evaluationJobs', { userId: record.userId });
        for (const job of jobs) {
          if (job.state !== 'unknown') continue;
          const ageMs = Date.parse(now) - Date.parse(job.updatedAt);
          if (!Number.isFinite(ageMs) || ageMs < UNKNOWN_JOB_SLOT_GRACE_MS) continue;
          const released = await tx.update('evaluationJobs', {
            id: job.id,
            state: 'unknown',
            stateVersion: job.stateVersion,
          }, {
            state: 'incomplete',
            stateVersion: job.stateVersion + 1,
            executionToken: null,
            completedAt: now,
            updatedAt: now,
            completion: {
              evidence: 'partial',
              summary: { upstreamResult: 'unknown', activeSlotReleasedAfterGracePeriod: true },
            },
            failure: { code: 'UPSTREAM_RESULT_UNKNOWN_SLOT_RELEASED', retryable: false },
          });
          if (released[0] && job.purpose === 'creation') {
            await tx.update('creationRuns', { id: job.businessRecordId }, {
              status: 'incomplete',
              completedAt: now,
              updatedAt: now,
            });
          }
        }

        const activeJobs = (await tx.read('evaluationJobs', { userId: record.userId }))
          .filter((job) => ACTIVE_JOB_STATES.includes(job.state));
        if (activeJobs.length > 0) {
          throw new EvaluationPersistenceError('active-job-exists', 'The user already has an active evaluation job.');
        }

        const associated = await tx.read('evaluationJobs', {
          associationKind: associationKind(record),
          businessRecordId: businessRecordId(record),
        });
        if (associated.length > 0) {
          throw new EvaluationPersistenceError('association-exists', 'The business record is already associated with an evaluation job.');
        }

        await tx.insert('evaluationJobs', [toJobRow(record)]);
        // A creation outbox row becomes consumable as soon as this transaction
        // commits. Bind the run to the job before that commit so a worker can
        // never observe a durable job whose CreationRun still has no job id.
        await associateCreationRun(tx, record, String(record.id));
        await tx.insert('evaluationIdempotencyKeys', [toIdempotencyRow(record)]);
        await tx.insert('evaluationOutbox', [toOutboxRow(acceptedEvent)]);
        return { created: true, record };
      });
    } catch (error) {
      if (error instanceof EvaluationPersistenceError) throw error;
      const existing = await this.findByIdempotency(scope, key);
      if (existing) {
        if (existing.idempotency.requestDigest !== record.idempotency.requestDigest) {
          throw new EvaluationPersistenceError('idempotency-conflict', 'The idempotency key was already used for a different request.');
        }
        return { created: false, record: existing };
      }
      throw error;
    }
  }

  async get(jobId: EvaluationJobId): Promise<EvaluationJobRecord | null> {
    const rows = await this.repository.read('evaluationJobs', { id: jobId });
    return rows[0] ? toJobRecord(rows[0]) : null;
  }

  async transition(
    jobId: EvaluationJobId,
    expectedStates: readonly EvaluationJobState[],
    patch: EvaluationJobPatch,
    guard?: EvaluationTransitionGuard,
  ): Promise<EvaluationJobRecord | null> {
    return this.repository.transaction(async (tx) => {
      const currentRow = (await tx.read('evaluationJobs', { id: jobId }))[0];
      if (!currentRow || !expectedStates.includes(currentRow.state)) return null;
      if (guard?.executionToken !== undefined && currentRow.executionToken !== guard.executionToken) return null;
      if (!canTransitionEvaluationJob(currentRow.state, patch.state)) {
        throw new EvaluationPersistenceError('invalid-state', `Cannot transition job from ${currentRow.state} to ${patch.state}.`);
      }

      const values: Partial<EvaluationJobRow> = {
        state: patch.state,
        stateVersion: currentRow.stateVersion + 1,
        updatedAt: patch.updatedAt,
      };
      if (patch.cancellationReason !== undefined) values.cancellationReason = patch.cancellationReason;
      if (patch.cancellationRequestedAt !== undefined) values.cancellationRequestedAt = patch.cancellationRequestedAt;
      if (patch.executionToken !== undefined) values.executionToken = patch.executionToken;
      if (patch.completion !== undefined) values.completion = patch.completion;
      if (patch.failure !== undefined) values.failure = patch.failure;
      if (patch.completedAt !== undefined) values.completedAt = patch.completedAt;

      const where: Partial<EvaluationJobRow> = {
        id: jobId,
        state: currentRow.state,
        stateVersion: currentRow.stateVersion,
      };
      if (guard?.executionToken !== undefined) where.executionToken = guard.executionToken;
      const updated = await tx.update('evaluationJobs', where, values);
      return updated[0] ? toJobRecord(updated[0]) : null;
    });
  }

  async createOrClaimAttempt(input: CreateEvaluationAttemptInput): Promise<CreateEvaluationAttemptResult> {
    const now = input.now ?? this.clock();
    return this.repository.transaction(async (tx) => {
      const attempts = await tx.read('evaluationAttempts', { jobId: input.jobId });
      const byDelivery = attempts.find((attempt) => attempt.deliveryKey === input.deliveryKey);
      const active = attempts.find((attempt) => ACTIVE_ATTEMPT_STATES.includes(attempt.state));
      if (byDelivery && TERMINAL_ATTEMPT_STATES.includes(byDelivery.state)) {
        return { attempt: toAttempt(byDelivery), created: false, claimed: false };
      }
      if (active && active.id !== byDelivery?.id && !leaseExpired(active, now)) {
        return { attempt: toAttempt(active), created: false, claimed: false };
      }

      const leaseId = randomUUID();
      const leaseExpiresAt = addMilliseconds(now, input.leaseTtlMs);
      if (byDelivery) {
        if (byDelivery.state === 'created' || leaseExpired(byDelivery, now)) {
          const updated = await tx.update(
            'evaluationAttempts',
            { id: byDelivery.id, stateVersion: byDelivery.stateVersion },
            {
              state: byDelivery.state === 'created' ? 'claimed' : byDelivery.state,
              stateVersion: byDelivery.stateVersion + 1,
              workerId: input.workerId,
              workerLeaseId: leaseId,
              leaseExpiresAt,
              heartbeatAt: now,
              updatedAt: now,
            },
          );
          if (!updated[0]) return { attempt: toAttempt(byDelivery), created: false, claimed: false };
          return { attempt: toAttempt(updated[0]), created: false, claimed: true };
        }
        return { attempt: toAttempt(byDelivery), created: false, claimed: false };
      }
      if (active) return { attempt: toAttempt(active), created: false, claimed: false };

      const attemptNumber = attempts.reduce((max, attempt) => Math.max(max, attempt.attemptNumber), 0) + 1;
      const row: EvaluationAttemptRow = {
        id: randomUUID(),
        jobId: input.jobId,
        attemptNumber,
        deliveryKey: input.deliveryKey,
        state: 'claimed',
        stateVersion: 0,
        workerId: input.workerId,
        workerLeaseId: leaseId,
        leaseExpiresAt,
        heartbeatAt: now,
        startedAt: null,
        finishedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      await tx.insert('evaluationAttempts', [row]);
      return { attempt: toAttempt(row), created: true, claimed: true };
    });
  }

  async renewAttemptLease(input: RenewEvaluationAttemptLeaseInput): Promise<EvaluationAttempt | null> {
    const now = input.now ?? this.clock();
    return this.repository.transaction(async (tx) => {
      const current = (await tx.read('evaluationAttempts', { id: input.attemptId }))[0];
      if (!current || !ACTIVE_ATTEMPT_STATES.includes(current.state) || current.workerId !== input.workerId || current.workerLeaseId !== input.workerLeaseId) return null;
      const updated = await tx.update('evaluationAttempts', {
        id: current.id,
        stateVersion: current.stateVersion,
        workerId: input.workerId,
        workerLeaseId: input.workerLeaseId,
      }, {
        leaseExpiresAt: addMilliseconds(now, input.leaseTtlMs),
        heartbeatAt: now,
        updatedAt: now,
        stateVersion: current.stateVersion + 1,
      });
      return updated[0] ? toAttempt(updated[0]) : null;
    });
  }

  async transitionAttempt(input: TransitionEvaluationAttemptInput): Promise<EvaluationAttempt | null> {
    if (!canTransitionEvaluationAttempt(input.expectedState, input.nextState)) {
      throw new EvaluationPersistenceError('invalid-state', `Cannot transition attempt from ${input.expectedState} to ${input.nextState}.`);
    }
    return this.repository.transaction(async (tx) => {
      const current = (await tx.read('evaluationAttempts', { id: input.attemptId }))[0];
      if (!current || current.state !== input.expectedState || current.stateVersion !== input.expectedStateVersion) return null;
      if (current.workerId !== input.workerId || current.workerLeaseId !== input.workerLeaseId) return null;
      const updated = await tx.update('evaluationAttempts', {
        id: current.id,
        state: current.state,
        stateVersion: current.stateVersion,
        workerId: input.workerId,
        workerLeaseId: input.workerLeaseId,
      }, {
        state: input.nextState,
        stateVersion: current.stateVersion + 1,
        startedAt: input.startedAt === undefined ? current.startedAt : input.startedAt,
        finishedAt: input.finishedAt === undefined ? current.finishedAt : input.finishedAt,
        updatedAt: this.clock(),
        ...(TERMINAL_ATTEMPT_STATES.includes(input.nextState) ? { leaseExpiresAt: null, heartbeatAt: null } : {}),
      });
      return updated[0] ? toAttempt(updated[0]) : null;
    });
  }

  async createInvocation(input: CreateEvaluationInvocationInput): Promise<{ invocation: EvaluationInvocation; created: boolean }> {
    return this.repository.transaction(async (tx) => {
      const requestMatch = (await tx.read('evaluationInvocations', { requestId: input.requestId }))[0];
      const keyMatch = (await tx.read('evaluationInvocations', { idempotencyKey: input.idempotencyKey }))[0];
      const existing = requestMatch ?? keyMatch;
      if (existing) {
        if (existing.requestDigest !== input.requestDigest) throw new EvaluationPersistenceError('idempotency-conflict', 'The invocation request digest does not match the existing request.');
        return { invocation: toInvocation(existing), created: false };
      }
      const ordinalMatch = (await tx.read('evaluationInvocations', {
        attemptId: input.attemptId,
        invocationIndex: input.invocationIndex,
      }))[0];
      if (ordinalMatch) throw new EvaluationPersistenceError('duplicate', 'The invocation index already exists for this attempt.');
      const now = this.clock();
      const row: EvaluationInvocationRow = {
        id: input.id,
        jobId: input.jobId,
        attemptId: input.attemptId,
        invocationIndex: input.invocationIndex,
        requestId: input.requestId,
        idempotencyKey: input.idempotencyKey,
        providerScope: input.providerScope,
        providerId: input.providerId,
        modelId: input.modelId,
        requestDigest: input.requestDigest,
        state: 'pending',
        providerRequestId: null,
        usageRecordId: null,
        createdAt: now,
        updatedAt: now,
        startedAt: null,
        completedAt: null,
      };
      await tx.insert('evaluationInvocations', [row]);
      return { invocation: toInvocation(row), created: true };
    });
  }

  async startInvocation(input: StartEvaluationInvocationInput): Promise<EvaluationInvocation | null> {
    const now = input.now ?? this.clock();
    return this.repository.transaction(async (tx) => {
      const current = (await tx.read('evaluationInvocations', { id: input.invocationId }))[0];
      if (!current) return null;
      if (current.state === 'started') return toInvocation(current);
      if (!canTransitionEvaluationInvocation(current.state, 'started')) return null;
      const updated = await tx.update('evaluationInvocations', { id: current.id, state: current.state }, {
        state: 'started',
        startedAt: now,
        updatedAt: now,
      });
      return updated[0] ? toInvocation(updated[0]) : null;
    });
  }

  async finalizeInvocation(input: FinalizeEvaluationInvocationInput): Promise<{ invocation: EvaluationInvocation; usage: EvaluationUsageRecord }> {
    const now = input.now ?? this.clock();
    return this.repository.transaction(async (tx) => {
      const current = (await tx.read('evaluationInvocations', { id: input.invocationId }))[0];
      if (!current) throw new EvaluationPersistenceError('not-found', 'The evaluation invocation does not exist.');
      const existingUsage = (await tx.read('evaluationUsageRecords', { invocationId: input.invocationId }))[0];
      if (existingUsage) return { invocation: toInvocation(current), usage: toUsage(existingUsage) };
      if (!canTransitionEvaluationInvocation(current.state, input.state)) {
        throw new EvaluationPersistenceError('invalid-state', `Cannot finalize invocation from ${current.state} to ${input.state}.`);
      }
      if (input.usage.invocationId !== input.invocationId) throw new EvaluationPersistenceError('invalid-request', 'Usage must reference the finalized invocation.');
      await tx.insert('evaluationUsageRecords', [{ ...input.usage, recordedAt: input.usage.recordedAt || now }]);
      const updated = await tx.update('evaluationInvocations', { id: current.id, state: current.state }, {
        state: input.state,
        providerRequestId: input.providerRequestId ?? current.providerRequestId,
        usageRecordId: input.usage.id,
        completedAt: now,
        updatedAt: now,
      });
      if (!updated[0]) throw new EvaluationPersistenceError('stale-lease', 'The invocation changed before finalization.');
      return { invocation: toInvocation(updated[0]), usage: toUsage(input.usage) };
    });
  }

  async createBudgetReservation(input: CreateEvaluationBudgetReservationInput): Promise<EvaluationBudgetReservation> {
    const now = this.clock();
    return this.repository.transaction(async (tx) => {
      const existing = (await tx.read('evaluationBudgetReservations', { jobId: input.jobId }))[0];
      if (existing) throw new EvaluationPersistenceError('duplicate', 'The evaluation job already has a budget reservation.');
      const row: EvaluationBudgetReservationRow = {
        ...input,
        settledInputTokens: null,
        settledOutputTokens: null,
        settledToolCalls: null,
        settledExecutionMs: null,
        settledCostUsd: null,
        createdAt: now,
        updatedAt: now,
      };
      await tx.insert('evaluationBudgetReservations', [row]);
      return toBudget(row);
    });
  }

  async settleBudget(input: SettleEvaluationBudgetInput): Promise<EvaluationBudgetReservation | null> {
    const now = input.now ?? this.clock();
    return this.repository.transaction(async (tx) => {
      const current = (await tx.read('evaluationBudgetReservations', { jobId: input.jobId }))[0];
      if (!current || current.state !== input.expectedState) return null;
      const updated = await tx.update('evaluationBudgetReservations', { id: current.id, state: current.state }, {
        state: input.nextState,
        usageCertainty: input.usageCertainty,
        chargeability: input.chargeability,
        settledInputTokens: input.settledInputTokens,
        settledOutputTokens: input.settledOutputTokens,
        settledToolCalls: input.settledToolCalls,
        settledExecutionMs: input.settledExecutionMs,
        settledCostUsd: input.settledCostUsd,
        updatedAt: now,
      });
      return updated[0] ? toBudget(updated[0]) : null;
    });
  }

  async claimOutbox(input: ClaimEvaluationOutboxInput): Promise<EvaluationOutboxRow[]> {
    if (input.limit <= 0) return [];
    const now = input.now ?? this.clock();
    return this.repository.transaction(async (tx) => {
      const rows = (await tx.read('evaluationOutbox')).filter((row) => {
        if (row.status === 'pending') return row.availableAt <= now;
        return row.status === 'leased' && row.leaseExpiresAt !== null && row.leaseExpiresAt <= now;
      }).sort((left, right) => left.availableAt.localeCompare(right.availableAt) || left.id.localeCompare(right.id)).slice(0, input.limit);
      const claimed: EvaluationOutboxRow[] = [];
      for (const row of rows) {
        const leaseToken = randomUUID();
        const where: Partial<EvaluationOutboxRow> = row.status === 'pending'
          ? { id: row.id, status: 'pending' }
          : { id: row.id, status: 'leased', leaseToken: row.leaseToken };
        const updated = await tx.update('evaluationOutbox', where, {
          status: 'leased',
          leaseToken,
          leaseOwner: input.owner,
          leaseExpiresAt: addMilliseconds(now, input.leaseTtlMs),
          deliveryAttempts: row.deliveryAttempts + 1,
          updatedAt: now,
        });
        if (updated[0]) claimed.push(updated[0]);
      }
      return claimed;
    });
  }

  async markOutboxPublished(id: string, owner: string, leaseToken: string, now = this.clock()): Promise<boolean> {
    const updated = await this.repository.update('evaluationOutbox', { id, status: 'leased', leaseOwner: owner, leaseToken }, {
      status: 'published', publishedAt: now, updatedAt: now, leaseOwner: null, leaseToken: null, leaseExpiresAt: null,
    });
    return updated.length > 0;
  }

  async rescheduleOutbox(id: string, owner: string, leaseToken: string, errorCode: string, availableAt: string, now = this.clock()): Promise<boolean> {
    const updated = await this.repository.update('evaluationOutbox', { id, status: 'leased', leaseOwner: owner, leaseToken }, {
      status: 'pending', availableAt, lastErrorCode: errorCode, lastErrorAt: now, updatedAt: now, leaseOwner: null, leaseToken: null, leaseExpiresAt: null,
    });
    return updated.length > 0;
  }

  async deadLetterOutbox(id: string, owner: string, leaseToken: string, errorCode: string, now = this.clock()): Promise<boolean> {
    const updated = await this.repository.update('evaluationOutbox', { id, status: 'leased', leaseOwner: owner, leaseToken }, {
      status: 'dead-letter', lastErrorCode: errorCode, lastErrorAt: now, updatedAt: now, leaseOwner: null, leaseToken: null, leaseExpiresAt: null,
    });
    return updated.length > 0;
  }
}

async function associateCreationRun(
  repository: Repository,
  record: EvaluationJobRecord,
  jobId: string,
): Promise<void> {
  if (record.association.kind !== 'creation-run') return;

  const creationRunId = String(record.association.creationRunId);
  // The job row has already been inserted in this transaction, so claim the
  // nullable FK with one compare-and-set update. The outbox is inserted only
  // after this succeeds; a worker can therefore never consume an event while
  // the CreationRun still points at no job.
  const updated = await repository.update(
    'creationRuns',
    { id: creationRunId, ownerId: String(record.userId), evaluationJobId: null },
    { evaluationJobId: jobId },
  );
  if (updated[0]) return;

  const run = (await repository.read('creationRuns', { id: creationRunId }))[0];
  if (!run) {
    throw new EvaluationPersistenceError('not-found', 'The creation job points to a missing creation run.');
  }
  if (run.ownerId !== String(record.userId)) {
    throw new EvaluationPersistenceError('association-exists', 'The creation run belongs to a different user.');
  }
  if (run.evaluationJobId === jobId) return;
  throw new EvaluationPersistenceError('association-exists', 'The creation run is already associated with another evaluation job.');
}

function associationKind(record: EvaluationJobRecord): EvaluationJobRow['associationKind'] {
  return record.association.kind;
}

function businessRecordId(record: EvaluationJobRecord): string {
  return record.association.kind === 'competitive-run'
    ? record.association.runId
    : record.association.kind === 'self-test-run'
      ? record.association.selfTestRunId
      : record.association.kind === 'component-evaluation'
        ? record.association.componentEvaluationId
        : record.association.creationRunId;
}

function toJobRow(record: EvaluationJobRecord): EvaluationJobRow {
  return {
    id: record.id,
    userId: record.userId,
    purpose: record.purpose,
    associationKind: associationKind(record),
    businessRecordId: businessRecordId(record),
    competitiveRunId: record.association.kind === 'competitive-run' ? record.association.runId : null,
    associationVisibility: record.association.kind === 'competitive-run' ? record.association.visibility : null,
    snapshot: record.snapshot,
    snapshotDigest: record.snapshot.snapshotDigest,
    idempotencyScope: record.idempotency.scope,
    idempotencyKey: record.idempotency.key,
    requestDigest: record.idempotency.requestDigest,
    budgetReservationId: record.budgetReservationId,
    state: record.state,
    stateVersion: 0,
    executionToken: record.executionToken,
    cancellationReason: record.cancellationReason,
    cancellationRequestedAt: record.cancellationRequestedAt,
    completion: record.completion,
    failure: record.failure,
    acceptedAt: record.acceptedAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    completedAt: record.completedAt,
  };
}

function toJobRecord(row: EvaluationJobRow): EvaluationJobRecord {
  const association = row.associationKind === 'competitive-run'
    ? { kind: 'competitive-run' as const, runId: asOpaqueId<'run'>(row.businessRecordId), visibility: row.associationVisibility === 'public' ? 'public' as const : 'hidden' as const }
    : row.associationKind === 'self-test-run'
      ? { kind: 'self-test-run' as const, selfTestRunId: asOpaqueId<'self-test-run'>(row.businessRecordId) }
      : row.associationKind === 'component-evaluation'
        ? { kind: 'component-evaluation' as const, componentEvaluationId: asOpaqueId<'component-evaluation'>(row.businessRecordId) }
        : { kind: 'creation-run' as const, creationRunId: asOpaqueId<'creation-run'>(row.businessRecordId) };
  return {
    id: asOpaqueId<'evaluation-job'>(row.id),
    userId: asOpaqueId<'user'>(row.userId),
    purpose: row.purpose,
    association,
    state: row.state,
    snapshot: row.snapshot as EvaluationJobRecord['snapshot'],
    idempotency: { scope: row.idempotencyScope as EvaluationJobRecord['idempotency']['scope'], key: row.idempotencyKey, requestDigest: row.requestDigest },
    budgetReservationId: row.budgetReservationId ? asOpaqueId<'evaluation-budget-reservation'>(row.budgetReservationId) : null,
    cancellationReason: row.cancellationReason,
    acceptedAt: row.acceptedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    completedAt: row.completedAt,
    executionToken: row.executionToken,
    cancellationRequestedAt: row.cancellationRequestedAt,
    completion: row.completion as EvaluationCompletion | null,
    failure: row.failure as EvaluationFailure | null,
  };
}

function toIdempotencyRow(record: EvaluationJobRecord): EvaluationIdempotencyKeyRow {
  return {
    id: randomUUID(),
    scope: record.idempotency.scope,
    key: record.idempotency.key,
    requestDigest: record.idempotency.requestDigest,
    jobId: record.id,
    createdAt: record.createdAt,
    expiresAt: null,
  };
}

function toOutboxRow(event: EvaluationOutboxEvent): EvaluationOutboxRow {
  return {
    id: event.id,
    jobId: event.aggregateId,
    aggregateId: event.aggregateId,
    version: event.version,
    kind: event.kind,
    occurredAt: event.occurredAt,
    requestDigest: event.requestDigest,
    payload: event.payload,
    dedupeKey: event.id,
    status: 'pending',
    availableAt: event.occurredAt,
    leaseToken: null,
    leaseOwner: null,
    leaseExpiresAt: null,
    deliveryAttempts: 0,
    lastErrorCode: null,
    lastErrorAt: null,
    publishedAt: event.publishedAt,
    createdAt: event.occurredAt,
    updatedAt: event.occurredAt,
  };
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

function toInvocation(row: EvaluationInvocationRow): EvaluationInvocation {
  return {
    id: asOpaqueId<'evaluation-invocation'>(row.id),
    jobId: asOpaqueId<'evaluation-job'>(row.jobId),
    attemptId: asOpaqueId<'evaluation-attempt'>(row.attemptId),
    state: row.state,
    invocationIndex: row.invocationIndex,
    requestDigest: row.requestDigest,
    providerRequestId: row.providerRequestId,
    usageRecordId: row.usageRecordId ? asOpaqueId<'evaluation-usage-record'>(row.usageRecordId) : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toUsage(row: EvaluationUsageRecordRow): EvaluationUsageRecord {
  return {
    id: asOpaqueId<'evaluation-usage-record'>(row.id),
    jobId: asOpaqueId<'evaluation-job'>(row.jobId),
    attemptId: asOpaqueId<'evaluation-attempt'>(row.attemptId),
    invocationId: row.invocationId ? asOpaqueId<'evaluation-invocation'>(row.invocationId) : null,
    certainty: row.certainty,
    chargeability: row.chargeability,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    reasoningTokens: row.reasoningTokens,
    toolCalls: row.toolCalls,
    latencyMs: row.latencyMs,
    costUsd: row.costUsd,
    providerRequestId: row.providerRequestId,
    evidenceRef: row.evidenceRef,
    recordedAt: row.recordedAt,
  };
}

function toBudget(row: EvaluationBudgetReservationRow): EvaluationBudgetReservation {
  return {
    id: asOpaqueId<'evaluation-budget-reservation'>(row.id),
    jobId: asOpaqueId<'evaluation-job'>(row.jobId),
    purpose: row.purpose,
    kind: row.kind,
    state: row.state,
    reserved: {
      inputTokens: row.reservedInputTokens,
      outputTokens: row.reservedOutputTokens,
      toolCalls: row.reservedToolCalls,
      executionMs: row.reservedExecutionMs,
      costUsd: row.reservedCostUsd,
    },
    settled: {
      inputTokens: row.settledInputTokens,
      outputTokens: row.settledOutputTokens,
      toolCalls: row.settledToolCalls,
      executionMs: row.settledExecutionMs,
      costUsd: row.settledCostUsd,
    },
    usageCertainty: row.usageCertainty,
    chargeability: row.chargeability,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function leaseExpired(row: EvaluationAttemptRow, now: string): boolean {
  return row.leaseExpiresAt === null || row.leaseExpiresAt <= now;
}

function addMilliseconds(iso: string, milliseconds: number): string {
  return new Date(Date.parse(iso) + milliseconds).toISOString();
}
