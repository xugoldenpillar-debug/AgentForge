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
  const payload = lines.join('\n\n');
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

test('Bridge A maps unsupported models to a safe configuration error', () => {
  assert.throws(() => createBridgeAStreamFn({
    apiKey: key,
    baseUrl: 'https://api.deepseek.com',
    modelId: 'unsupported-private-model',
    maxTokens: 16
  }), (error: unknown) => error instanceof AppError
    && error.code === ERROR_CODES.PROVIDER_CONFIGURATION_INVALID
    && !error.message.includes('unsupported-private-model'));
});

for (const ending of ['', '\n', '\r\n', '\r']) {
  test(`Bridge A discards an unterminated SSE usage event at EOF (${JSON.stringify(ending)})`, async () => {
    const stream = createBridgeAStreamFn({
      apiKey: key, baseUrl: 'https://api.deepseek.com', modelId: model, maxTokens: 16,
      providerFetch: async () => new Response(
        'data: {"usage":{"prompt_tokens":1,"completion_tokens":1}}' + ending
      )
    });
    await assert.rejects(() => stream({}, { messages: [{ role: 'user', content: 'offline' }] }), (error: unknown) => error instanceof AppError
      && error.code === ERROR_CODES.PROVIDER_RESPONSE_INVALID);
  });
}

for (const newline of ['\n', '\r\n', '\r']) {
  test(`Bridge A accepts framed multiline SSE split across bytes (${JSON.stringify(newline)})`, async () => {
    const payload = [
      ': comment', 'data: {"choices":[{"delta":{"content":"你好"}}],',
      'data: "usage":{"prompt_tokens":1,"completion_tokens":2}}', '', ''
    ].join(newline);
    const bytes = new TextEncoder().encode(payload);
    const stream = createBridgeAStreamFn({
      apiKey: key, baseUrl: 'https://api.deepseek.com', modelId: model, maxTokens: 16,
      providerFetch: async () => new Response(new ReadableStream({
        start(controller) {
          for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
          controller.close();
        }
      }))
    });
    const chunks = [];
    for await (const chunk of await stream({}, { messages: [{ role: 'user', content: 'offline' }] })) chunks.push(chunk);
    assert.deepEqual(chunks, [
      { type: 'text_delta', text: '你好' },
      { type: 'usage', inputTokens: 1, outputTokens: 2 }
    ]);
  });
}

const offlineContext = { messages: [{ role: 'user', content: 'offline' }] };
const usageFrame = 'data: {"usage":{"prompt_tokens":1,"completion_tokens":2}}\n\n';

test('Bridge A handles BOM/comments/fields and stops at framed DONE without waiting for EOF', async () => {
  let cancelled = 0;
  const response = new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(
        '\uFEFF: heartbeat\r\nid: 7\r\nevent: message\r\nretry: 1000\r\ndata\r\n\r\n'
          + usageFrame + 'data: [DONE]\n\n'
          + 'data: {"choices":[{"delta":{"content":"ignored after DONE"}}]}\n\n'
      ));
    },
    cancel() { cancelled += 1; }
  }));
  const stream = createBridgeAStreamFn({
    apiKey: key, baseUrl: 'https://api.deepseek.com', modelId: model, maxTokens: 16,
    providerFetch: async () => response
  });
  const chunks = [];
  for await (const chunk of await stream({}, offlineContext)) chunks.push(chunk);
  assert.deepEqual(chunks, [{ type: 'usage', inputTokens: 1, outputTokens: 2 }]);
  assert.equal(cancelled, 1);
  assert.equal(response.body?.locked, false);
});

for (const reason of ['caller', 'timeout'] as const) {
  test(`Bridge A ${reason} interrupts pending reads and releases the response`, async (t) => {
    const controller = new AbortController();
    if (reason === 'timeout') {
      t.mock.method(AbortSignal, 'timeout', (ms: number) => {
        assert.equal(ms, 30_000);
        return controller.signal;
      });
    }
    let cancelled = 0;
    const response = new Response(new ReadableStream({
      start(stream) {
        stream.enqueue(new TextEncoder().encode(usageFrame));
      },
      pull() {
        queueMicrotask(() => controller.abort(new Error('private timeout detail')));
      },
      cancel() { cancelled += 1; }
    }));
    const stream = createBridgeAStreamFn({
      apiKey: key, baseUrl: 'https://api.deepseek.com', modelId: model, maxTokens: 16,
      providerFetch: async () => response
    });
    const result = stream({}, offlineContext, reason === 'caller' ? { signal: controller.signal } : undefined);
    if (reason === 'timeout') {
      await assert.rejects(() => result, (error: unknown) => error instanceof AppError
        && error.code === ERROR_CODES.PROVIDER_REQUEST_FAILED
        && !error.message.includes('private timeout detail'));
    } else {
      const chunks = [];
      for await (const chunk of await result) chunks.push(chunk);
      assert.deepEqual(chunks, [{ type: 'aborted' }]);
    }
    assert.equal(cancelled, 1);
    assert.equal(response.body?.locked, false);
  });
}

test('Bridge A cancels HTTP error bodies and sanitizes body-read errors', async () => {
  let cancelled = 0;
  const response = new Response(new ReadableStream({
    cancel() { cancelled += 1; }
  }), { status: 503 });
  const failedResponse = new Response(new ReadableStream({
    start(controller) { controller.error(new Error('private body error')); }
  }));
  for (const body of [response, failedResponse]) {
    const stream = createBridgeAStreamFn({
      apiKey: key, baseUrl: 'https://api.deepseek.com', modelId: model, maxTokens: 16,
      providerFetch: async () => body
    });
    await assert.rejects(() => stream({}, offlineContext), (error: unknown) => error instanceof AppError
      && error.code === ERROR_CODES.PROVIDER_REQUEST_FAILED
      && !error.message.includes('private body error'));
    assert.equal(body.body?.locked, false);
  }
  assert.equal(cancelled, 1);
});
