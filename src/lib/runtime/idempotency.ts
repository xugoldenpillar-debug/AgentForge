import { createHash } from 'node:crypto';
import { AppError, ERROR_CODES } from '../../shared/errors.ts';
import type { ExecutionIdentity, RunDefinition } from '../../shared/runtime-contract.ts';

export type RuntimeIdempotencyRecord = {
  digest: string;
  createdAt: string;
};

export type RuntimeIdempotencyStore = {
  get(key: string): RuntimeIdempotencyRecord | undefined;
  set(key: string, record: RuntimeIdempotencyRecord): void;
};

const CONFLICT_MESSAGE = 'This runtime request conflicts with a previous idempotent run.';

export function runtimeRequestDigest(input: {
  userId: string;
  requestKey: string;
  identity: ExecutionIdentity;
  definition: RunDefinition;
  prompt: string;
}): string {
  return createHash('sha256')
    .update(JSON.stringify({
      userId: input.userId,
      requestKey: input.requestKey,
      identity: input.identity,
      definition: input.definition,
      prompt: input.prompt
    }))
    .digest('hex');
}

/**
 * Bind a user-scoped request key to a frozen digest.
 * Same key + same digest is a replay. Same key + different digest is a conflict.
 * This helper is in-process; durable workers belong to evaluation-foundation, not Pi.
 */
export function bindRuntimeIdempotency(
  store: RuntimeIdempotencyStore,
  key: string,
  digest: string,
  now = () => new Date().toISOString()
): { replay: boolean } {
  const existing = store.get(key);
  if (!existing) {
    store.set(key, { digest, createdAt: now() });
    return { replay: false };
  }
  if (existing.digest !== digest) {
    throw new AppError(CONFLICT_MESSAGE, 409, ERROR_CODES.REQUEST_VALIDATION_FAILED);
  }
  return { replay: true };
}

export function memoryIdempotencyStore(): RuntimeIdempotencyStore {
  const records = new Map<string, RuntimeIdempotencyRecord>();
  return {
    get: (key) => records.get(key),
    set: (key, record) => {
      records.set(key, record);
    }
  };
}
