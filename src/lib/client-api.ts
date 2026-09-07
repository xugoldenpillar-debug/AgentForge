'use client';

import type { RunEvent } from '../shared/types.ts';

const MAX_ERROR_MESSAGE_LENGTH = 4000;

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function boundedMessage(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  return value.slice(0, MAX_ERROR_MESSAGE_LENGTH);
}

function stableCode(value: unknown): string | undefined {
  return typeof value === 'string' && /^[A-Z][A-Z0-9_]{1,99}$/.test(value) ? value : undefined;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status = 500, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/**
 * Accept the legacy `{ error: string }` envelope and the structured
 * `{ error: { code, message } }` envelope without ever stringifying an
 * arbitrary server object into the UI.
 */
export function normalizeApiError(payload: unknown, fallbackMessage: string, status = 500): ApiError {
  const envelope = isRecord(payload) && 'error' in payload ? payload.error : payload;
  if (typeof envelope === 'string') return new ApiError(boundedMessage(envelope, fallbackMessage), status);
  if (isRecord(envelope)) {
    return new ApiError(
      boundedMessage(envelope.message, fallbackMessage),
      status,
      stableCode(envelope.code)
    );
  }
  return new ApiError(fallbackMessage, status);
}

async function readPayload(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

export async function api<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/arena/${path}`, {
    credentials: 'same-origin',
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers }
  });
  const data = await readPayload(response);
  if (!response.ok) throw normalizeApiError(data, 'Request failed.', response.status);
  return data as T;
}

export const post = <T = unknown>(path: string, body: unknown) => api<T>(path, { method: 'POST', body: JSON.stringify(body) });

function parseRunEvent(line: string): RunEvent {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    throw new ApiError('Run stream returned invalid data.', 502, 'INTERNAL_SERVER_ERROR');
  }
  if (!isRecord(value)) throw new ApiError('Run stream returned invalid data.', 502, 'INTERNAL_SERVER_ERROR');
  if (value.type === 'error') throw normalizeApiError({ error: value }, 'Run failed.', 502);
  return value as RunEvent;
}

export async function consumeRun(body: unknown, onEvent: (event: RunEvent) => void, signal: AbortSignal): Promise<void> {
  const response = await fetch('/api/arena/runs', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal
  });
  if (!response.ok) {
    const data = await readPayload(response);
    throw normalizeApiError(data, 'Run failed.', response.status);
  }
  if (!response.body) throw new ApiError('No execution stream was returned.', 502, 'INTERNAL_SERVER_ERROR');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    let split: number;
    while ((split = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, split);
      buffer = buffer.slice(split + 1);
      if (line.trim()) onEvent(parseRunEvent(line));
    }
    if (done) break;
  }
  if (buffer.trim()) onEvent(parseRunEvent(buffer));
}

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

export interface EvaluationStatus {
  job: {
    id: string;
    purpose: 'competitive' | 'author-self-test' | 'component-evaluation' | 'creation';
    state: EvaluationJobState;
    association: {
      kind: 'competitive-run' | 'self-test-run' | 'component-evaluation' | 'creation-run';
      runId?: string;
      visibility?: 'public' | 'hidden';
      businessRecordId?: string;
    };
    snapshot: {
      schemaVersion: number;
      buildVersionId: string;
      testSuiteVersionId: string | null;
      runtimeAdapter: string;
      modelOfferingId: string | null;
      policyVersion: string;
      capturedAt: string;
    };
    snapshotDigest: string;
    cancellationReason: string | null;
    cancellationRequestedAt: string | null;
    acceptedAt: string;
    createdAt: string;
    updatedAt: string;
    completedAt: string | null;
    completion: { evidence: 'complete' | 'partial' } | null;
    failure: { code: string; retryable: boolean } | null;
  };
  attempts: Array<{
    id: string;
    number: number;
    state: EvaluationAttemptState;
    startedAt: string | null;
    finishedAt: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  run: RecordValue | null;
}

export interface CreateEvaluationResponse extends EvaluationStatus {
  created: boolean;
}

const TERMINAL_EVALUATION_STATES = new Set<EvaluationJobState>([
  'completed',
  'failed',
  'cancelled',
  'incomplete',
  'unknown',
  'expired',
]);

export function isEvaluationTerminal(state: EvaluationJobState): boolean {
  return TERMINAL_EVALUATION_STATES.has(state);
}

export async function createEvaluation(
  body: RecordValue,
  options: { idempotencyKey?: string; signal?: AbortSignal } = {},
): Promise<CreateEvaluationResponse> {
  const bodyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : '';
  const optionKey = options.idempotencyKey?.trim() || '';
  if (optionKey && bodyKey && optionKey !== bodyKey) {
    throw new ApiError('The idempotency key header does not match the request body.', 409, 'REQUEST_VALIDATION_FAILED');
  }
  const key = optionKey || bodyKey;
  if (!key) throw new ApiError('An idempotency key is required for asynchronous evaluations.', 400, 'REQUEST_VALIDATION_FAILED');
  const payload = { ...body, idempotencyKey: key };
  return api<CreateEvaluationResponse>('evaluation-jobs', {
    method: 'POST',
    body: JSON.stringify(payload),
    signal: options.signal,
    headers: { 'Idempotency-Key': key },
  });
}

export async function getEvaluation(jobId: string, signal?: AbortSignal): Promise<EvaluationStatus> {
  if (!jobId.trim()) throw new ApiError('An evaluation job ID is required.', 400, 'REQUEST_VALIDATION_FAILED');
  return api<EvaluationStatus>(`evaluation-jobs/${encodeURIComponent(jobId)}`, { signal });
}

/** Fetch the durable status again after a browser/request disconnect. */
export async function recoverEvaluation(jobId: string, signal?: AbortSignal): Promise<EvaluationStatus> {
  return getEvaluation(jobId, signal);
}

export async function cancelEvaluation(
  jobId: string,
  options: { signal?: AbortSignal } = {},
): Promise<EvaluationStatus & { cancellationRequested: boolean }> {
  if (!jobId.trim()) throw new ApiError('An evaluation job ID is required.', 400, 'REQUEST_VALIDATION_FAILED');
  return api<EvaluationStatus & { cancellationRequested: boolean }>(`evaluation-jobs/${encodeURIComponent(jobId)}/cancel`, {
    method: 'POST',
    body: JSON.stringify({ reason: 'user-requested' }),
    signal: options.signal,
  });
}

function waitForPoll(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason ?? new DOMException('The operation was aborted.', 'AbortError'));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, delayMs);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(signal.reason ?? new DOMException('The operation was aborted.', 'AbortError'));
    }, { once: true });
  });
}

function isRetryablePollError(error: unknown): boolean {
  return !isApiError(error) || error.status === 408 || error.status === 425 || error.status === 429 || error.status >= 500;
}

/**
 * Polls the authoritative status endpoint. Transient network/server failures
 * are retried so a dropped browser connection can resume from the stable job ID;
 * auth, ownership, validation, and not-found errors are never hidden.
 */
export async function pollEvaluation(
  jobId: string,
  options: {
    intervalMs?: number;
    maxIntervalMs?: number;
    signal?: AbortSignal;
    onUpdate?: (status: EvaluationStatus) => void;
  } = {},
): Promise<EvaluationStatus> {
  let delay = Math.max(100, options.intervalMs ?? 1000);
  const maxDelay = Math.max(delay, options.maxIntervalMs ?? 5000);
  for (;;) {
    let status: EvaluationStatus;
    try {
      status = await getEvaluation(jobId, options.signal);
    } catch (error) {
      if (!isRetryablePollError(error)) throw error;
      await waitForPoll(delay, options.signal);
      delay = Math.min(maxDelay, delay * 2);
      continue;
    }
    options.onUpdate?.(status);
    if (isEvaluationTerminal(status.job.state)) return status;
    await waitForPoll(delay, options.signal);
    delay = Math.min(maxDelay, delay * 2);
  }
}

export async function consumePiSelfTest(
  body: unknown,
  onEvent: (event: Record<string, unknown>) => void,
  signal: AbortSignal
): Promise<void> {
  const response = await fetch('/api/arena/pi-self-test', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal
  });
  if (!response.ok) {
    const data = await readPayload(response);
    throw normalizeApiError(data, 'Pi self-test failed.', response.status);
  }
  if (!response.body) throw new ApiError('No execution stream was returned.', 502, 'INTERNAL_SERVER_ERROR');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    let split: number;
    while ((split = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, split);
      buffer = buffer.slice(split + 1);
      if (!line.trim()) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        throw new ApiError('Run stream returned invalid data.', 502, 'INTERNAL_SERVER_ERROR');
      }
      if (!isRecord(parsed)) throw new ApiError('Run stream returned invalid data.', 502, 'INTERNAL_SERVER_ERROR');
      if (parsed.type === 'error') throw normalizeApiError({ error: parsed }, 'Pi self-test failed.', 502);
      onEvent(parsed);
    }
    if (done) break;
  }
  if (buffer.trim()) {
    const parsed = JSON.parse(buffer) as Record<string, unknown>;
    if (parsed.type === 'error') throw normalizeApiError({ error: parsed }, 'Pi self-test failed.', 502);
    onEvent(parsed);
  }
}
