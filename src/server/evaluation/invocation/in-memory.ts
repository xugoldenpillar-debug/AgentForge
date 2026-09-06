import { asOpaqueId, type EvaluationInvocationId } from '../../../shared/evaluation-types.ts';
import {
  type DispatchEvaluationInvocationInput,
  type EvaluationInvocationBoundary,
  type EvaluationInvocationDispatchContext,
  type EvaluationInvocationDispatchResult,
  EvaluationInvocationError,
  type EvaluationInvocationOperationResult,
  type EvaluationInvocationReceipt,
  type EvaluationInvocationRecord,
  type EvaluationInvocationUsage,
  type EvaluationInvocationDispatcher,
  type FinalizeEvaluationInvocationInput,
  type PrepareEvaluationInvocationInput
} from './ports.ts';

export interface InMemoryEvaluationInvocationBoundaryOptions {
  readonly now?: () => string;
  readonly createId?: () => string;
}

/**
 * In-memory invocation boundary. The external dispatcher receives only stable
 * identities and digests; request bodies, credentials and model responses are
 * never stored in an invocation record or error.
 */
export class InMemoryEvaluationInvocationBoundary implements EvaluationInvocationBoundary {
  private readonly invocations = new Map<EvaluationInvocationId, EvaluationInvocationRecord>();
  private readonly byIdempotency = new Map<string, EvaluationInvocationId>();
  private readonly byRequestId = new Map<string, EvaluationInvocationId>();
  private readonly byOrdinal = new Map<string, EvaluationInvocationId>();
  private readonly locks = new Map<string, Promise<void>>();
  private readonly clock: () => string;
  private readonly createId: () => string;

  constructor(options: InMemoryEvaluationInvocationBoundaryOptions = {}) {
    this.clock = options.now ?? (() => new Date().toISOString());
    let sequence = 0;
    this.createId = options.createId ?? (() => `evaluation-invocation-${++sequence}`);
  }

  async prepare(input: PrepareEvaluationInvocationInput): Promise<EvaluationInvocationOperationResult> {
    validatePrepareInput(input);
    return this.withLock('prepare', async () => {
      const idempotentId = this.byIdempotency.get(input.idempotencyKey);
      if (idempotentId) {
        const existing = this.require(idempotentId);
        if (existing.requestDigest !== input.requestDigest) {
          throw new EvaluationInvocationError('IDEMPOTENCY_CONFLICT', 'The invocation identity was already used for a different request.');
        }
        return { changed: false, invocation: snapshotInvocation(existing) };
      }

      const existingIds = [
        this.byRequestId.get(input.requestId),
        this.byOrdinal.get(`${input.attemptId}:${input.invocationIndex}`)
      ].filter((id): id is EvaluationInvocationId => id !== undefined);
      const existingId = existingIds[0];
      if (existingIds.some((id) => id !== existingId)) {
        throw new EvaluationInvocationError('IDEMPOTENCY_CONFLICT', 'Invocation identity is already bound to another request.');
      }
      if (existingId) {
        const existing = this.require(existingId);
        if (existing.possiblyDispatched || existing.state === 'unknown') {
          throw new EvaluationInvocationError('REQUEST_ALREADY_UNCERTAIN', 'The upstream request may have been dispatched and cannot be replaced automatically.');
        }
        throw new EvaluationInvocationError('IDEMPOTENCY_CONFLICT', 'The invocation ordinal is already bound to another request.');
      }

      const now = input.preparedAt ?? this.clock();
      const id = input.invocationId ?? asOpaqueId<'evaluation-invocation'>(this.createId());
      if (this.invocations.has(id)) throw new EvaluationInvocationError('IDEMPOTENCY_CONFLICT', 'The invocation identity is already in use.');
      const invocation = freezeInvocation({
        id,
        jobId: input.jobId,
        attemptId: input.attemptId,
        state: 'pending',
        invocationIndex: input.invocationIndex,
        requestDigest: input.requestDigest,
        providerRequestId: null,
        usageRecordId: null,
        createdAt: now,
        updatedAt: now,
        requestId: input.requestId,
        idempotencyKey: input.idempotencyKey,
        providerScope: input.providerScope,
        providerId: input.providerId,
        modelId: input.modelId,
        queuedAt: input.queuedAt,
        preparedAt: now,
        dispatchedAt: null,
        completedAt: null,
        possiblyDispatched: false,
        timing: { queueWaitMs: null, executionDurationMs: null },
        receipt: null
      });
      this.invocations.set(id, invocation);
      this.byIdempotency.set(input.idempotencyKey, id);
      this.byRequestId.set(input.requestId, id);
      this.byOrdinal.set(`${input.attemptId}:${input.invocationIndex}`, id);
      return { changed: true, invocation: snapshotInvocation(invocation) };
    });
  }

  async dispatch(input: DispatchEvaluationInvocationInput): Promise<EvaluationInvocationOperationResult> {
    validateDispatchInput(input);
    return this.withLock(`invocation:${input.invocationId}`, async () => {
      const current = this.require(input.invocationId);
      if (current.state === 'unknown') {
        throw new EvaluationInvocationError('REQUEST_ALREADY_UNCERTAIN', 'The upstream request may already be in flight.');
      }
      if (current.state !== 'pending') return { changed: false, invocation: snapshotInvocation(current) };
      const queueWaitMs = elapsedMilliseconds(current.queuedAt, input.startedAt);
      const next = freezeInvocation({
        ...current,
        state: 'started',
        updatedAt: input.startedAt,
        dispatchedAt: input.startedAt,
        possiblyDispatched: true,
        timing: { queueWaitMs, executionDurationMs: null }
      });
      this.invocations.set(current.id, next);
      return { changed: true, invocation: snapshotInvocation(next) };
    });
  }

  async finalize(input: FinalizeEvaluationInvocationInput): Promise<EvaluationInvocationOperationResult> {
    validateFinalizeInput(input);
    return this.withLock(`invocation:${input.invocationId}`, async () => this.finalizeInternal(input, false));
  }

  async execute(input: DispatchEvaluationInvocationInput, dispatcher: EvaluationInvocationDispatcher): Promise<EvaluationInvocationOperationResult> {
    const started = await this.dispatch(input);
    if (started.invocation.state !== 'started') return started;
    const context: EvaluationInvocationDispatchContext = {
      invocationId: started.invocation.id,
      jobId: started.invocation.jobId,
      attemptId: started.invocation.attemptId,
      requestId: started.invocation.requestId,
      idempotencyKey: started.invocation.idempotencyKey,
      requestDigest: started.invocation.requestDigest
    };
    try {
      const result = await dispatcher.dispatch(context);
      return this.finalize({
        invocationId: started.invocation.id,
        state: result.state,
        requestDigest: started.invocation.requestDigest,
        responseDigest: result.responseDigest,
        providerRequestId: result.providerRequestId,
        usage: result.usage,
        completedAt: this.clock()
      });
    } catch {
      const unknown = await this.markUnknown(started.invocation.id, started.invocation.requestDigest);
      throw new EvaluationInvocationError('UPSTREAM_RESULT_UNKNOWN', unknown.invocation.receipt?.state === 'unknown'
        ? 'The upstream result is uncertain; automatic retry is forbidden.'
        : 'The upstream result could not be confirmed.');
    }
  }

  async reconcile(input: FinalizeEvaluationInvocationInput): Promise<EvaluationInvocationOperationResult> {
    validateFinalizeInput(input);
    if (input.state === 'unknown') throw new EvaluationInvocationError('INVALID_INPUT', 'Reconciliation requires a known terminal outcome.');
    return this.withLock(`invocation:${input.invocationId}`, async () => {
      const current = this.require(input.invocationId);
      if (current.requestDigest !== input.requestDigest) throw new EvaluationInvocationError('IDEMPOTENCY_CONFLICT', 'The invocation digest does not match.');
      if (current.state !== 'unknown') {
        if (isSameFinalization(current, input)) return { changed: false, invocation: snapshotInvocation(current) };
        throw new EvaluationInvocationError('INVALID_STATE', 'Only an unknown invocation can be reconciled.');
      }
      return this.finalizeInternal(input, true);
    });
  }

  async get(invocationId: EvaluationInvocationId): Promise<EvaluationInvocationRecord | null> {
    const record = this.invocations.get(invocationId);
    return record ? snapshotInvocation(record) : null;
  }

  async getByIdempotency(idempotencyKey: string): Promise<EvaluationInvocationRecord | null> {
    const id = this.byIdempotency.get(idempotencyKey);
    return id ? this.get(id) : null;
  }

  async getReceipt(invocationId: EvaluationInvocationId): Promise<EvaluationInvocationReceipt | null> {
    const record = this.invocations.get(invocationId);
    return record?.receipt ? snapshotReceipt(record.receipt) : null;
  }

  private async markUnknown(invocationId: EvaluationInvocationId, requestDigest: string): Promise<EvaluationInvocationOperationResult> {
    return this.withLock(`invocation:${invocationId}`, async () => this.finalizeInternal({
      invocationId,
      state: 'unknown',
      requestDigest,
      responseDigest: null,
      providerRequestId: null,
      usage: unknownUsage(),
      completedAt: this.clock()
    }, false));
  }

  private finalizeInternal(input: FinalizeEvaluationInvocationInput, reconciling: boolean): EvaluationInvocationOperationResult {
    const current = this.require(input.invocationId);
    if (current.requestDigest !== input.requestDigest) throw new EvaluationInvocationError('IDEMPOTENCY_CONFLICT', 'The invocation digest does not match.');
    if (current.receipt && !reconciling) {
      if (isSameFinalization(current, input)) return { changed: false, invocation: snapshotInvocation(current) };
      if (current.state === 'unknown') throw new EvaluationInvocationError('REQUEST_ALREADY_UNCERTAIN', 'The upstream result is uncertain and requires explicit reconciliation.');
      throw new EvaluationInvocationError('INVOCATION_ALREADY_FINALIZED', 'The invocation already has a terminal receipt.');
    }
    if (current.receipt && reconciling && current.state !== 'unknown') {
      if (isSameFinalization(current, input)) return { changed: false, invocation: snapshotInvocation(current) };
      throw new EvaluationInvocationError('INVOCATION_ALREADY_FINALIZED', 'The invocation already has a terminal receipt.');
    }
    if (current.state !== 'started' && !(reconciling && current.state === 'unknown')) {
      throw new EvaluationInvocationError('INVALID_STATE', 'Only a dispatched invocation can be finalized.');
    }
    validateUsage(input.usage);
    const completedAt = input.completedAt;
    const executionDurationMs = current.dispatchedAt === null ? null : elapsedMilliseconds(current.dispatchedAt, completedAt);
    const receipt: EvaluationInvocationReceipt = freezeReceipt({
      invocationId: current.id,
      jobId: current.jobId,
      attemptId: current.attemptId,
      requestDigest: current.requestDigest,
      responseDigest: input.responseDigest ?? null,
      providerRequestId: input.providerRequestId ?? null,
      state: input.state,
      usage: cloneUsage(input.usage),
      timing: {
        queueWaitMs: current.timing.queueWaitMs,
        executionDurationMs
      },
      recordedAt: completedAt
    });
    const next = freezeInvocation({
      ...current,
      state: input.state,
      providerRequestId: input.providerRequestId ?? null,
      usageRecordId: asOpaqueId<'evaluation-usage-record'>(`usage:${current.id}`),
      updatedAt: completedAt,
      completedAt,
      possiblyDispatched: input.state === 'unknown',
      timing: receipt.timing,
      receipt
    });
    this.invocations.set(current.id, next);
    return { changed: true, invocation: snapshotInvocation(next) };
  }

  private require(invocationId: EvaluationInvocationId): EvaluationInvocationRecord {
    const record = this.invocations.get(invocationId);
    if (!record) throw new EvaluationInvocationError('INVOCATION_NOT_FOUND', 'The invocation was not found.');
    return record;
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

function validatePrepareInput(input: PrepareEvaluationInvocationInput): void {
  if (!input.jobId || !input.attemptId || input.invocationIndex < 1 || !Number.isInteger(input.invocationIndex) || input.requestId.trim().length === 0 || input.idempotencyKey.trim().length === 0 || input.requestDigest.trim().length === 0 || input.providerScope.trim().length === 0 || input.providerId.trim().length === 0 || input.modelId.trim().length === 0) {
    throw new EvaluationInvocationError('INVALID_INPUT', 'A complete invocation identity is required.');
  }
  if (Number.isNaN(Date.parse(input.queuedAt)) || (input.preparedAt !== undefined && Number.isNaN(Date.parse(input.preparedAt)))) {
    throw new EvaluationInvocationError('INVALID_INPUT', 'Invocation timestamps must be valid ISO timestamps.');
  }
}

function validateDispatchInput(input: DispatchEvaluationInvocationInput): void {
  if (!input.invocationId || Number.isNaN(Date.parse(input.startedAt))) {
    throw new EvaluationInvocationError('INVALID_INPUT', 'A valid dispatch timestamp is required.');
  }
}

function validateFinalizeInput(input: FinalizeEvaluationInvocationInput): void {
  if (!input.invocationId || input.requestDigest.trim().length === 0 || Number.isNaN(Date.parse(input.completedAt))) {
    throw new EvaluationInvocationError('INVALID_INPUT', 'A complete invocation finalization is required.');
  }
  validateUsage(input.usage);
}

function validateUsage(usage: EvaluationInvocationUsage): void {
  for (const value of [usage.inputTokens, usage.outputTokens, usage.reasoningTokens, usage.toolCalls, usage.latencyMs, usage.costUsd]) {
    if (value !== null && (!Number.isFinite(value) || value < 0)) {
      throw new EvaluationInvocationError('INVALID_INPUT', 'Invocation usage must be finite and non-negative.');
    }
  }
}

function unknownUsage(): EvaluationInvocationUsage {
  return {
    certainty: 'unknown',
    chargeability: 'uncertain',
    inputTokens: null,
    outputTokens: null,
    reasoningTokens: null,
    toolCalls: null,
    latencyMs: null,
    costUsd: null
  };
}

function elapsedMilliseconds(start: string, end: string): number {
  const value = Date.parse(end) - Date.parse(start);
  if (!Number.isFinite(value) || value < 0) throw new EvaluationInvocationError('INVALID_INPUT', 'Invocation timestamps must be monotonic.');
  return value;
}

function isSameFinalization(record: EvaluationInvocationRecord, input: FinalizeEvaluationInvocationInput): boolean {
  const receipt = record.receipt;
  return receipt !== null
    && receipt.state === input.state
    && receipt.requestDigest === input.requestDigest
    && receipt.responseDigest === (input.responseDigest ?? null)
    && receipt.providerRequestId === (input.providerRequestId ?? null);
}

function cloneUsage(usage: EvaluationInvocationUsage): EvaluationInvocationUsage {
  return { ...usage };
}

function snapshotInvocation(record: EvaluationInvocationRecord): EvaluationInvocationRecord {
  return freezeInvocation({
    ...record,
    timing: { ...record.timing },
    receipt: record.receipt ? snapshotReceipt(record.receipt) : null
  });
}

function snapshotReceipt(receipt: EvaluationInvocationReceipt): EvaluationInvocationReceipt {
  return freezeReceipt({
    ...receipt,
    usage: cloneUsage(receipt.usage),
    timing: { ...receipt.timing }
  });
}

function freezeInvocation(record: EvaluationInvocationRecord): EvaluationInvocationRecord {
  Object.freeze(record.timing);
  if (record.receipt) Object.freeze(record.receipt);
  return Object.freeze(record);
}

function freezeReceipt(receipt: EvaluationInvocationReceipt): EvaluationInvocationReceipt {
  Object.freeze(receipt.usage);
  Object.freeze(receipt.timing);
  return Object.freeze(receipt);
}
