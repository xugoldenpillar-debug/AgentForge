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
