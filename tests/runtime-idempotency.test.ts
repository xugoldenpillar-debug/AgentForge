import test from 'node:test';
import assert from 'node:assert/strict';
import { AppError, ERROR_CODES } from '../src/shared/errors.ts';
import { dagExecutionIdentity } from '../src/lib/runtime/index.ts';
import {
  bindRuntimeIdempotency,
  memoryIdempotencyStore,
  runtimeRequestDigest
} from '../src/lib/runtime/idempotency.ts';
import { starterWorkflow } from '../src/shared/catalog.ts';

const definition = { kind: 'dag' as const, workflow: starterWorkflow('json') };

test('idempotent replay is allowed; conflicting frozen content is rejected', () => {
  const store = memoryIdempotencyStore();
  const identity = dagExecutionIdentity();
  const digest = runtimeRequestDigest({
    userId: 'user-1',
    requestKey: 'req-1',
    identity,
    definition,
    prompt: 'Ada'
  });
  assert.equal(bindRuntimeIdempotency(store, 'user-1:req-1', digest).replay, false);
  assert.equal(bindRuntimeIdempotency(store, 'user-1:req-1', digest).replay, true);
  const other = runtimeRequestDigest({
    userId: 'user-1',
    requestKey: 'req-1',
    identity,
    definition,
    prompt: 'Grace'
  });
  assert.throws(
    () => bindRuntimeIdempotency(store, 'user-1:req-1', other),
    (error: unknown) => error instanceof AppError && error.code === ERROR_CODES.REQUEST_VALIDATION_FAILED && error.status === 409
  );
});
