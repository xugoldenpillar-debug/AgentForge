import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, api, consumeRun, normalizeApiError } from '../src/lib/client-api.ts';
import { handleArena, readJson } from '../src/server/http.ts';
import { AppError, ERROR_CODES, safeError } from '../src/shared/errors.ts';
import { validateWorkflow } from '../src/lib/workflow/validate.ts';

test('AppError keeps legacy constructor calls and safeError exposes a stable code', () => {
  const legacy = new AppError('Legacy message', 409);
  assert.equal(legacy.status, 409);
  assert.equal(legacy.code, undefined);
  assert.deepEqual(safeError(legacy), { code: ERROR_CODES.UNKNOWN_ERROR, message: 'Legacy message', status: 409 });

  const coded = new AppError('This build changed in another tab. Reload before saving.', 409, ERROR_CODES.BUILD_VERSION_CONFLICT);
  assert.deepEqual(safeError(coded), {
    code: ERROR_CODES.BUILD_VERSION_CONFLICT,
    message: 'This build changed in another tab. Reload before saving.',
    status: 409
  });
});

test('Unknown errors use the generic safe server response and do not leak details', () => {
  const safe = safeError(new Error('provider secret sk-test-should-not-appear'));
  assert.deepEqual(safe, {
    code: ERROR_CODES.INTERNAL_SERVER_ERROR,
    message: 'The request could not be completed. Check your configuration and try again.',
    status: 500
  });
  assert(!safe.message.includes('sk-test'));
});

test('Arena HTTP errors use structured envelopes while preserving status codes', async () => {
  const service = { limit: async () => undefined };
  const response = await handleArena(
    new Request('http://localhost:3000/api/arena/builds', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    }),
    { service: service as never, origin: 'http://localhost:3000' }
  );
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: { code: ERROR_CODES.AUTH_REQUIRED, message: 'Sign in to continue.' } });

  const notFound = await handleArena(new Request('http://localhost:3000/api/arena/not-a-route'), {
    service: service as never,
    origin: 'http://localhost:3000'
  });
  assert.equal(notFound.status, 404);
  assert.deepEqual(await notFound.json(), { error: { code: ERROR_CODES.ENDPOINT_NOT_FOUND, message: 'Endpoint not found.' } });
});

test('Run stream errors carry a code without exposing arbitrary exception objects', async () => {
  const service = {
    limit: async () => undefined,
    run: async () => {
      throw new AppError('Cost budget exceeded.', 400, ERROR_CODES.BUDGET_EXCEEDED);
    }
  };
  const response = await handleArena(
    new Request('http://localhost:3000/api/arena/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    }),
    { service: service as never, userId: 'user-1', origin: 'http://localhost:3000' }
  );
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(await response.text()), {
    type: 'error',
    code: ERROR_CODES.BUDGET_EXCEEDED,
    message: 'Cost budget exceeded.'
  });
});

test('Workflow validation failures expose the invalid-workflow code', () => {
  assert.throws(
    () => validateWorkflow({ nodes: [], edges: [] }),
    (error: unknown) => error instanceof AppError && error.code === ERROR_CODES.INVALID_WORKFLOW && error.message === 'Use 3 to 24 nodes.'
  );
});

test('readJson assigns a code to malformed JSON', async () => {
  await assert.rejects(
    () => readJson(new Request('http://localhost:3000/api/arena/builds', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' })),
    (error: unknown) => error instanceof AppError && error.code === ERROR_CODES.INVALID_JSON_BODY && error.status === 400
  );
});

test('Client normalizes structured and legacy string error envelopes', () => {
  const structured = normalizeApiError(
    { error: { code: ERROR_CODES.BUILD_VERSION_CONFLICT, message: 'This build changed in another tab. Reload before saving.' } },
    'Request failed.',
    409
  );
  assert(structured instanceof ApiError);
  assert.equal(structured.code, ERROR_CODES.BUILD_VERSION_CONFLICT);
  assert.equal(structured.status, 409);
  assert.equal(structured.message, 'This build changed in another tab. Reload before saving.');

  const legacy = normalizeApiError({ error: 'Legacy server message.' }, 'Request failed.', 400);
  assert.equal(legacy.code, undefined);
  assert.equal(legacy.message, 'Legacy server message.');

  const arbitrary = normalizeApiError({ error: { details: { secret: 'do-not-display' } } }, 'Request failed.', 500);
  assert.equal(arbitrary.message, 'Request failed.');
  assert(!arbitrary.message.includes('do-not-display'));
});

test('api and consumeRun throw coded ApiError values for server failures', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ error: { code: ERROR_CODES.PROVIDER_NOT_CONFIGURED, message: 'Provider is not configured.' } }), { status: 503 });
    await assert.rejects(
      () => api('providers'),
      (error: unknown) => error instanceof ApiError && error.code === ERROR_CODES.PROVIDER_NOT_CONFIGURED && error.status === 503 && error.message === 'Provider is not configured.'
    );

    globalThis.fetch = async () => new Response(JSON.stringify({ type: 'error', code: ERROR_CODES.BUDGET_EXCEEDED, message: 'Energy budget exceeded.' }) + '\n', {
      status: 200,
      headers: { 'Content-Type': 'application/x-ndjson' }
    });
    await assert.rejects(
      () => consumeRun({}, () => undefined, new AbortController().signal),
      (error: unknown) => error instanceof ApiError && error.code === ERROR_CODES.BUDGET_EXCEEDED && error.message === 'Energy budget exceeded.'
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
