import test from 'node:test';
import assert from 'node:assert/strict';
import { AppError, ERROR_CODES } from '../src/shared/errors.ts';
import { createBridgeAStreamFn, createBridgeBStreamFn } from '../src/server/runtime/pi/stream-fn.ts';

const key = 'offline-dummy-key-never-valid';
const model = 'deepseek-v4-flash';

function sse(text: string, usage: Record<string, unknown> | null = {
  prompt_tokens: 12,
  completion_tokens: 3,
  total_tokens: 15,
  prompt_cache_hit_tokens: 0,
  prompt_cache_miss_tokens: 12,
  completion_tokens_details: { reasoning_tokens: 0 }
}): Response {
  const lines = [
    `data: ${JSON.stringify({
      choices: [{ delta: { content: text }, finish_reason: null }]
    })}`
  ];
  const stop: Record<string, unknown> = {
    choices: [{ delta: {}, finish_reason: 'stop' }]
  };
  if (usage) stop.usage = usage;
  lines.push(`data: ${JSON.stringify(stop)}`, 'data: [DONE]', '');
  const payload = lines.join('\n');
  return new Response(payload, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' }
  });
}

test('Bridge A reuses official Flash wire policy and maps usage without calling Pi model APIs', async () => {
  const calls: Request[] = [];
  const streamFn = createBridgeAStreamFn({
    apiKey: key,
    baseUrl: 'https://api.deepseek.com',
    modelId: model,
    maxTokens: 128,
    providerFetch: async (input, init) => {
      const request = new Request(input, init);
      calls.push(request);
      return sse('ok');
    }
  });
  const chunks: Array<{ type: string }> = [];
  for await (const chunk of await streamFn({ id: 'unused' }, {
    systemPrompt: 'Reply briefly.',
    messages: [{ role: 'user', content: 'Say hello.', timestamp: 1 }]
  })) {
    chunks.push(chunk);
  }
  assert.equal(calls.length, 1);
  const wire = calls[0];
  assert.equal(new URL(wire.url).pathname, '/chat/completions');
  assert.equal(wire.headers.get('authorization'), `Bearer ${key}`);
  const body = await wire.json() as Record<string, unknown>;
  assert.equal(body.model, model);
  assert.deepEqual(body.thinking, { type: 'disabled' });
  assert.equal(body.stream, true);
  assert.equal(body.max_tokens, 128);
  assert.equal(body.tools, undefined);
  assert.deepEqual(chunks, [
    { type: 'text_delta', text: 'ok' },
    { type: 'usage', inputTokens: 12, outputTokens: 3 }
  ]);
});

test('Bridge A fails closed on missing usage and rejects non-Flash endpoints', async () => {
  const streamFn = createBridgeAStreamFn({
    apiKey: key,
    baseUrl: 'https://api.deepseek.com/v1',
    modelId: model,
    maxTokens: 64,
    providerFetch: async () => sse('ok', null)
  });
  await assert.rejects(
    () => streamFn({}, { messages: [{ role: 'user', content: 'x' }] }),
    (error: unknown) => error instanceof AppError && error.code === ERROR_CODES.PROVIDER_RESPONSE_INVALID
  );
  assert.throws(
    () => createBridgeAStreamFn({
      apiKey: key,
      baseUrl: 'https://evil.example/v1',
      modelId: model,
      maxTokens: 16
    }),
    (error: unknown) => error instanceof AppError && error.code === ERROR_CODES.PROVIDER_CONFIGURATION_INVALID
  );
  assert.throws(
    () => createBridgeBStreamFn(),
    (error: unknown) => error instanceof AppError && error.code === ERROR_CODES.RUNTIME_UNAVAILABLE
  );
});
