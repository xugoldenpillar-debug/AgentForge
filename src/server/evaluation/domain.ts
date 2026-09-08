import { createHash, randomUUID } from 'node:crypto';
import {
  EVALUATION_SNAPSHOT_VERSION,
  EVALUATION_WORKER_MESSAGE_VERSION,
  assertEvaluationAssociation,
  isTerminalEvaluationJobState,
  transitionEvaluationJobState
} from '../../shared/evaluation-types.ts';
import { EvaluationContractError } from '../../shared/evaluation-errors.ts';
import type {
  EvaluationInputSnapshot,
  EvaluationJob,
  EvaluationJobId,
  EvaluationJobState,
  EvaluationOutboxEvent,
  EvaluationPurpose,
  EvaluationAssociation,
  EvaluationBudgetReservationId,
  EvaluationIdempotencyScope,
  JsonObject,
  JsonValue,
  UserId
} from '../../shared/evaluation-types.ts';
import { asOpaqueId } from '../../shared/evaluation-types.ts';

export interface EvaluationCompletion {
  /** A safe summary/evidence projection; raw model responses and hidden inputs do not belong here. */
  readonly summary?: JsonObject;
  readonly evidence: 'complete' | 'partial';
}

export interface EvaluationFailure {
  /** A stable, non-sensitive error code, not a provider exception or message. */
  readonly code: string;
  readonly retryable: boolean;
}

export interface EvaluationJobRecord extends EvaluationJob {
  /** Internal worker fencing token. Never include this in user-facing projections. */
  readonly executionToken: string | null;
  readonly cancellationRequestedAt: string | null;
  readonly completion: EvaluationCompletion | null;
  readonly failure: EvaluationFailure | null;
}

export type EvaluationJobView = Omit<EvaluationJobRecord, 'executionToken'>;

export interface CreateEvaluationJobInput {
  readonly userId: UserId;
  readonly purpose: EvaluationPurpose;
  readonly association: EvaluationAssociation;
  readonly snapshot: EvaluationInputSnapshot;
  readonly idempotencyKey: string;
  readonly idempotencyScope?: EvaluationIdempotencyScope;
  readonly budgetReservationId?: EvaluationBudgetReservationId | null;
}

export interface EvaluationJobStore {
  /** Must be atomic with respect to the scoped idempotency key. */
  findByIdempotency(scope: EvaluationIdempotencyScope, key: string): Promise<EvaluationJobRecord | null>;
  /** Returns the existing record when another creator won the race. */
  createIfAbsent(
    record: EvaluationJobRecord,
    acceptedEvent: EvaluationOutboxEvent
  ): Promise<{ readonly created: boolean; readonly record: EvaluationJobRecord }>;
  get(jobId: EvaluationJobId): Promise<EvaluationJobRecord | null>;
  /** Expected-state and execution-token checks must happen atomically in the concrete store. */
  transition(
    jobId: EvaluationJobId,
    expectedStates: readonly EvaluationJobState[],
    patch: EvaluationJobPatch,
    guard?: EvaluationTransitionGuard
  ): Promise<EvaluationJobRecord | null>;
}

/** A durable outbox publisher or queue adapter. It must deduplicate by event id. */
export interface EvaluationDispatchSink {
  enqueue(event: EvaluationOutboxEvent): Promise<void>;
}

/** Capacity and budget policy stay injected; this module invents no numeric limits. */
export interface EvaluationCapacityProvider {
  reserve(input: { readonly userId: UserId; readonly purpose: EvaluationPurpose; readonly jobId: EvaluationJobId }): Promise<void>;
  release(input: { readonly jobId: EvaluationJobId }): Promise<void>;
}

export interface EvaluationBudgetProvider {
  reserve(input: { readonly userId: UserId; readonly purpose: EvaluationPurpose; readonly jobId: EvaluationJobId }): Promise<void>;
  release(input: { readonly jobId: EvaluationJobId }): Promise<void>;
}

export interface EvaluationJobPatch {
  readonly state: EvaluationJobState;
  readonly cancellationReason?: EvaluationJobRecord['cancellationReason'];
  readonly cancellationRequestedAt?: string | null;
  readonly executionToken?: string | null;
  readonly completion?: EvaluationCompletion | null;
  readonly failure?: EvaluationFailure | null;
  readonly completedAt?: string | null;
  readonly updatedAt: string;
}

export interface EvaluationTransitionGuard {
  readonly executionToken?: string;
}

export interface EvaluationServiceOptions {
  readonly now?: () => string;
  readonly createId?: () => string;
  readonly digest?: (value: JsonValue) => string;
  readonly capacity?: EvaluationCapacityProvider;
  readonly budget?: EvaluationBudgetProvider;
}

export interface CreateEvaluationJobResult {
  readonly created: boolean;
  readonly job: EvaluationJobView;
}

export interface EvaluationClaimResult {
  readonly claimed: boolean;
  readonly reason: 'claimed' | 'already_claimed' | 'cancelling' | 'terminal' | 'not_queued';
  readonly job: EvaluationJobView;
  /** Only returned to an internal executor that successfully claimed the job. */
  readonly executionToken: string | null;
}

export interface EvaluationTransitionResult {
  readonly applied: boolean;
  readonly job: EvaluationJobView;
}

export type EvaluationServiceErrorCode =
  | 'INVALID_REQUEST'
  | 'UNSAFE_SNAPSHOT'
  | 'INVALID_ASSOCIATION'
  | 'IDEMPOTENCY_CONFLICT'
  | 'JOB_NOT_FOUND'
  | 'STALE_EXECUTION'
  | 'INVALID_STATE_TRANSITION';

export class EvaluationServiceError extends Error {
  readonly code: EvaluationServiceErrorCode;

  constructor(code: EvaluationServiceErrorCode, message: string) {
    super(message);
    this.name = 'EvaluationServiceError';
    this.code = code;
  }
}

const FORBIDDEN_SNAPSHOT_KEY = /(?:^|_)(?:secret|password|token|cookie|ciphertext|private[_-]?key|authorization)(?:$|_)|api[_-]?key|access[_-]?token|refresh[_-]?token/i;

export function stableJson(value: JsonValue): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new EvaluationServiceError('INVALID_REQUEST', 'Request payload must contain finite numbers.');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const entries = Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`);
  return `{${entries.join(',')}}`;
}

export function defaultEvaluationDigest(value: JsonValue): string {
  return `sha256:${createHash('sha256').update(stableJson(value)).digest('hex')}`;
}

export function isEvaluationJobStateTerminal(state: EvaluationJobState): boolean {
  return isTerminalEvaluationJobState(state);
}

export class EvaluationService {
  private readonly store: EvaluationJobStore;
  private readonly dispatch: EvaluationDispatchSink;
  private readonly now: () => string;
  private readonly createId: () => string;
  private readonly digest: (value: JsonValue) => string;

  constructor(
    store: EvaluationJobStore,
    dispatch: EvaluationDispatchSink,
    options: EvaluationServiceOptions = {}
  ) {
    this.store = store;
    this.dispatch = dispatch;
    this.now = options.now ?? (() => new Date().toISOString());
    this.createId = options.createId ?? randomUUID;
    this.digest = options.digest ?? defaultEvaluationDigest;
  }

  async createJob(input: CreateEvaluationJobInput): Promise<CreateEvaluationJobResult> {
    const association = validateAssociation(input.purpose, input.association);
    validateCreateInput(input);
    const snapshot = freezeInputSnapshot(input.snapshot);
    const scope = input.idempotencyScope ?? 'evaluation-job-create';
    if (scope !== 'evaluation-job-create') {
      throw new EvaluationServiceError('INVALID_REQUEST', 'Evaluation job creation must use the evaluation-job-create scope.');
    }

    const scopedIdempotencyKey = stableJson([input.userId, input.idempotencyKey]);
    const requestDigest = this.digest(structuredClone({
      userId: input.userId,
      purpose: input.purpose,
      association,
      snapshot,
      budgetReservationId: input.budgetReservationId ?? null
    }) as unknown as JsonObject);

    const existing = await this.store.findByIdempotency(scope, scopedIdempotencyKey);
    if (existing) {
      ensureDigestMatches(existing, requestDigest);
      return this.finishExistingCreate(existing);
    }

    const now = this.now();
    const jobId = asOpaqueId<'evaluation-job'>(this.createId()) as EvaluationJobId;
    const record: EvaluationJobRecord = deepFreeze({
      id: jobId,
      userId: input.userId,
      purpose: input.purpose,
      association,
      state: 'accepted',
      snapshot,
      idempotency: { scope, key: scopedIdempotencyKey, requestDigest },
      budgetReservationId: input.budgetReservationId ?? null,
      cancellationReason: null,
      acceptedAt: now,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      executionToken: null,
      cancellationRequestedAt: null,
      completion: null,
      failure: null
    });

    const persisted = await this.store.createIfAbsent(record, this.acceptedEvent(record));
    ensureDigestMatches(persisted.record, requestDigest);
    if (persisted.record.state !== 'accepted') {
      return { created: persisted.created, job: toPublicJob(persisted.record) };
    }

    await this.enqueueAccepted(persisted.record);
    return { created: persisted.created, job: toPublicJob(await this.readRequired(persisted.record.id)) };
  }

  async getJob(jobId: EvaluationJobId): Promise<EvaluationJobView> {
    return toPublicJob(await this.readRequired(jobId));
  }

  /** Moves a queued job to running exactly once. Invoke the model only when claimed=true. */
  async claimForExecution(jobId: EvaluationJobId, workerId: string): Promise<EvaluationClaimResult> {
    if (!workerId) throw new EvaluationServiceError('INVALID_REQUEST', 'A worker identity is required.');
    const current = await this.readRequired(jobId);
    if (current.state === 'running') return this.claimResult(false, 'already_claimed', current);
    if (current.state === 'cancelling') return this.claimResult(false, 'cancelling', current);
    if (isTerminalEvaluationJobState(current.state)) return this.claimResult(false, 'terminal', current);
    if (current.state !== 'queued') return this.claimResult(false, 'not_queued', current);

    const executionToken = `${workerId}:${this.createId()}`;
    const transitioned = await this.store.transition(
      jobId,
      ['queued'],
      this.patch('running', { executionToken }),
      {}
    );
    if (!transitioned) {
      const afterRace = await this.readRequired(jobId);
      const reason = afterRace.state === 'running'
        ? 'already_claimed'
        : afterRace.state === 'cancelling'
          ? 'cancelling'
          : isTerminalEvaluationJobState(afterRace.state)
            ? 'terminal'
            : 'not_queued';
      return this.claimResult(false, reason, afterRace);
    }
    return { claimed: true, reason: 'claimed', job: toPublicJob(transitioned), executionToken };
  }

  async requestCancellation(
    jobId: EvaluationJobId,
    reason: NonNullable<EvaluationJobRecord['cancellationReason']> = 'user-requested'
  ): Promise<EvaluationTransitionResult> {
    const current = await this.readRequired(jobId);
    if (isTerminalEvaluationJobState(current.state) || current.state === 'unknown') return { applied: false, job: toPublicJob(current) };
    if (current.state === 'cancelling') return { applied: false, job: toPublicJob(current) };
    if (!['accepted', 'queued', 'running'].includes(current.state)) {
      throw new EvaluationServiceError('INVALID_STATE_TRANSITION', `Cannot request cancellation from ${current.state}.`);
    }

    const transitioned = await this.store.transition(
      jobId,
      ['accepted', 'queued', 'running'],
      this.patch('cancelling', { cancellationReason: reason, cancellationRequestedAt: this.now() })
    );
    if (transitioned) return { applied: true, job: toPublicJob(transitioned) };
    return { applied: false, job: toPublicJob(await this.readRequired(jobId)) };
  }

  /** The executor confirms cancellation after observing its own stop point. */
  async confirmCancellation(jobId: EvaluationJobId, executionToken?: string): Promise<EvaluationTransitionResult> {
    const current = await this.readRequired(jobId);
    if (current.state === 'cancelled') return { applied: false, job: toPublicJob(current) };
    if (current.state !== 'cancelling') {
      if (isTerminalEvaluationJobState(current.state)) return { applied: false, job: toPublicJob(current) };
      throw new EvaluationServiceError('INVALID_STATE_TRANSITION', `Cannot confirm cancellation from ${current.state}.`);
    }
    ensureExecutionToken(current, executionToken);
    const transitioned = await this.store.transition(jobId, ['cancelling'], this.patch('cancelled', { executionToken: null }));
    if (transitioned) return { applied: true, job: toPublicJob(transitioned) };
    return { applied: false, job: toPublicJob(await this.readRequired(jobId)) };
  }

  async completeJob(
    jobId: EvaluationJobId,
    executionToken: string,
    completion: EvaluationCompletion
  ): Promise<EvaluationTransitionResult> {
    const safeCompletion = validateCompletion(completion);
    const targetState: EvaluationJobState = safeCompletion.evidence === 'partial' ? 'incomplete' : 'completed';
    return this.finish(jobId, executionToken, targetState, { completion: safeCompletion, failure: null });
  }

  async failJob(
    jobId: EvaluationJobId,
    executionToken: string,
    failure: EvaluationFailure
  ): Promise<EvaluationTransitionResult> {
    return this.finish(jobId, executionToken, 'failed', { completion: null, failure: validateFailure(failure) });
  }

  /** Unknown upstream state is recorded and is not automatically retried. */
  async markUnknown(jobId: EvaluationJobId, executionToken: string): Promise<EvaluationTransitionResult> {
    return this.finish(jobId, executionToken, 'unknown', { completion: null, failure: { code: 'UPSTREAM_RESULT_UNKNOWN', retryable: false } });
  }

  /**
   * Lets the owning product flow close an unknown result after the user has
   * explicitly acknowledged that the dispatched provider request may already
   * have incurred cost. This never replays the invocation.
   */
  async acknowledgeUnknown(jobId: EvaluationJobId): Promise<EvaluationTransitionResult> {
    const current = await this.readRequired(jobId);
    if (current.state === 'incomplete') return { applied: false, job: toPublicJob(current) };
    if (current.state !== 'unknown') {
      throw new EvaluationServiceError('INVALID_STATE_TRANSITION', `Cannot acknowledge an unknown result from ${current.state}.`);
    }
    const transitioned = await this.store.transition(
      jobId,
      ['unknown'],
      this.patch('incomplete', {
        executionToken: null,
        completedAt: this.now(),
        completion: {
          evidence: 'partial',
          summary: { upstreamResult: 'unknown', userAcknowledgedPotentialCharge: true },
        },
        failure: { code: 'UPSTREAM_RESULT_UNKNOWN_ACKNOWLEDGED', retryable: false },
      }),
    );
    if (transitioned) return { applied: true, job: toPublicJob(transitioned) };
    return { applied: false, job: toPublicJob(await this.readRequired(jobId)) };
  }

  private async finish(
    jobId: EvaluationJobId,
    executionToken: string,
    targetState: Extract<EvaluationJobState, 'completed' | 'incomplete' | 'failed' | 'unknown'>,
    data: { readonly completion: EvaluationCompletion | null; readonly failure: EvaluationFailure | null }
  ): Promise<EvaluationTransitionResult> {
    const current = await this.readRequired(jobId);
    if (isTerminalEvaluationJobState(current.state)) return { applied: false, job: toPublicJob(current) };
    if (current.state !== 'running' && current.state !== 'cancelling') {
      throw new EvaluationServiceError('INVALID_STATE_TRANSITION', `Cannot finish a job from ${current.state}.`);
    }
    ensureExecutionToken(current, executionToken);
    transitionEvaluationJobState(current.state, targetState);

    const transitioned = await this.store.transition(
      jobId,
      ['running', 'cancelling'],
      this.patch(targetState, {
        ...data,
        executionToken: null,
        completedAt: targetState === 'unknown' ? null : this.now()
      }),
      { executionToken }
    );
    if (transitioned) return { applied: true, job: toPublicJob(transitioned) };
    const afterRace = await this.readRequired(jobId);
    if (isTerminalEvaluationJobState(afterRace.state)) return { applied: false, job: toPublicJob(afterRace) };
    throw new EvaluationServiceError('STALE_EXECUTION', 'The execution lease no longer owns this job.');
  }

  private async finishExistingCreate(existing: EvaluationJobRecord): Promise<CreateEvaluationJobResult> {
    if (existing.state === 'accepted') await this.enqueueAccepted(existing);
    return { created: false, job: toPublicJob(await this.readRequired(existing.id)) };
  }

  private async enqueueAccepted(record: EvaluationJobRecord): Promise<void> {
    await this.dispatch.enqueue(this.acceptedEvent(record));
    const transitioned = await this.store.transition(record.id, ['accepted'], this.patch('queued'));
    if (transitioned) return;
    const afterRace = await this.readRequired(record.id);
    if (afterRace.state === 'accepted') {
      throw new EvaluationServiceError('INVALID_STATE_TRANSITION', 'The accepted job could not be moved to the queue.');
    }
  }

  private acceptedEvent(record: EvaluationJobRecord): EvaluationOutboxEvent {
    return deepFreeze({
      id: asOpaqueId<'evaluation-outbox-event'>(`evaluation-job-accepted:${record.id}`),
      version: EVALUATION_WORKER_MESSAGE_VERSION,
      kind: 'evaluation-job-accepted',
      aggregateId: record.id,
      occurredAt: record.acceptedAt,
      requestDigest: record.idempotency.requestDigest,
      payload: {
        jobId: record.id,
        userId: record.userId,
        purpose: record.purpose,
        association: record.association as unknown as JsonValue,
        snapshot: record.snapshot as unknown as JsonValue,
        snapshotDigest: record.snapshot.snapshotDigest
      },
      publishedAt: null
    });
  }

  private patch(
    state: EvaluationJobState,
    values: Omit<Partial<EvaluationJobPatch>, 'state' | 'updatedAt'> = {}
  ): EvaluationJobPatch {
    return { state, updatedAt: this.now(), ...values };
  }

  private claimResult(
    claimed: boolean,
    reason: EvaluationClaimResult['reason'],
    record: EvaluationJobRecord
  ): EvaluationClaimResult {
    return { claimed, reason, job: toPublicJob(record), executionToken: null };
  }

  private async readRequired(jobId: EvaluationJobId): Promise<EvaluationJobRecord> {
    const record = await this.store.get(jobId);
    if (!record) throw new EvaluationServiceError('JOB_NOT_FOUND', `Evaluation job ${jobId} was not found.`);
    return record;
  }
}

function validateCreateInput(input: CreateEvaluationJobInput): void {
  if (typeof input.userId !== 'string' || input.userId.trim().length === 0) {
    throw new EvaluationServiceError('INVALID_REQUEST', 'A user identity is required.');
  }
  if (typeof input.idempotencyKey !== 'string' || input.idempotencyKey.trim().length === 0) {
    throw new EvaluationServiceError('INVALID_REQUEST', 'An idempotency key is required.');
  }
  if (input.snapshot.schemaVersion !== EVALUATION_SNAPSHOT_VERSION) {
    throw new EvaluationServiceError('INVALID_REQUEST', `Unsupported snapshot version '${String(input.snapshot.schemaVersion)}'.`);
  }
}

function validateAssociation(purpose: EvaluationPurpose, association: EvaluationAssociation): EvaluationAssociation {
  if (!isRecord(association)) {
    throw new EvaluationServiceError('INVALID_REQUEST', 'A valid evaluation association is required.');
  }
  try {
    assertEvaluationAssociation(purpose, association);
  } catch (error) {
    if (error instanceof EvaluationContractError) {
      throw new EvaluationServiceError(
        'INVALID_ASSOCIATION',
        error.message
      );
    }
    throw error;
  }
  validateAssociationValues(association);
  return deepFreeze(structuredClone(association));
}

function validateAssociationValues(association: EvaluationAssociation): void {
  const values = association.kind === 'competitive-run'
    ? [association.runId]
    : association.kind === 'self-test-run'
      ? [association.selfTestRunId]
      : association.kind === 'component-evaluation'
        ? [association.componentEvaluationId]
        : [association.creationRunId];
  if (values.some((value) => typeof value !== 'string' || value.trim().length === 0)) {
    throw new EvaluationServiceError('INVALID_ASSOCIATION', 'Association identifiers must not be empty.');
  }
}

function ensureDigestMatches(record: EvaluationJobRecord, digest: string): void {
  if (record.idempotency.requestDigest !== digest) {
    throw new EvaluationServiceError('IDEMPOTENCY_CONFLICT', 'The idempotency key was already used for a different request.');
  }
}

function ensureExecutionToken(record: EvaluationJobRecord, token: string | undefined): void {
  if (record.executionToken === null) {
    if (token !== undefined) throw new EvaluationServiceError('STALE_EXECUTION', 'The execution lease does not own this job.');
    return;
  }
  if (!token || record.executionToken !== token) {
    throw new EvaluationServiceError('STALE_EXECUTION', 'The execution lease does not own this job.');
  }
}

function validateFailure(failure: EvaluationFailure): EvaluationFailure {
  if (!failure || typeof failure.code !== 'string' || failure.code.trim().length === 0 || typeof failure.retryable !== 'boolean') {
    throw new EvaluationServiceError('INVALID_REQUEST', 'A stable failure code and retryability flag are required.');
  }
  return deepFreeze({ code: failure.code, retryable: failure.retryable });
}

function validateCompletion(completion: EvaluationCompletion): EvaluationCompletion {
  if (!completion || (completion.evidence !== 'complete' && completion.evidence !== 'partial')) {
    throw new EvaluationServiceError('INVALID_REQUEST', 'A completion evidence state is required.');
  }
  const summary = completion.summary === undefined ? undefined : freezeSafeJsonObject(completion.summary);
  return deepFreeze({ evidence: completion.evidence, ...(summary === undefined ? {} : { summary }) });
}

function freezeInputSnapshot(snapshot: EvaluationInputSnapshot): EvaluationInputSnapshot {
  validateSafeJson(snapshot, '$snapshot');
  return deepFreeze(structuredClone(snapshot));
}

function freezeSafeJsonObject(value: JsonObject): JsonObject {
  validateSafeJson(value, '$summary');
  return deepFreeze(structuredClone(value));
}

function validateSafeJson(value: unknown, path: string): asserts value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new EvaluationServiceError('UNSAFE_SNAPSHOT', `Value at ${path} must be finite.`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => validateSafeJson(entry, `${path}[${index}]`));
    return;
  }
  if (!isRecord(value)) throw new EvaluationServiceError('UNSAFE_SNAPSHOT', `Value at ${path} must be JSON data.`);
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_SNAPSHOT_KEY.test(key)) {
      throw new EvaluationServiceError('UNSAFE_SNAPSHOT', `Forbidden field at ${path}.${key}.`);
    }
    validateSafeJson(child, `${path}.${key}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return value;
}

function toPublicJob(record: EvaluationJobRecord): EvaluationJobView {
  const { executionToken: _executionToken, ...view } = record;
  return deepFreeze(structuredClone(view));
}
