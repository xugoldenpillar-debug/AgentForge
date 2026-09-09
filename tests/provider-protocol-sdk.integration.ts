// Offline protocol/wire verification: the replacement fetch never calls a network.
import assert from 'node:assert/strict';
import test from 'node:test';
import { byokProvider } from '../src/lib/ai/sdk-provider.ts';
import { PROVIDER_PROTOCOLS } from '../src/shared/provider-protocol.ts';
import type { ProviderProtocol } from '../src/shared/provider-protocol.ts';
import type { Credential } from '../src/shared/types.ts';
import type { AIRequest } from '../src/lib/ai/types.ts';

const key = 'offline-protocol-test-not-a-real-key';
function credential(protocol: ProviderProtocol): Credential {
  return {
    id: 'protocol-test', userId: 'protocol-owner', name: 'Protocol test', protocol,
    baseUrl: 'https://gateway.example.com/v1', modelId: 'test-model', ciphertext: 'not-used',
    lastFour: 'key!', inputPrice: null, outputPrice: null, createdAt: '2026-09-07T00:00:00.000Z',
  };
}
const request: AIRequest = {
  model: 'test-model', systemPrompt: 'Reply briefly.', userPrompt: 'Hello', tools: [],
  maxTokens: 128, temperature: 0, remainingTokens: 10000, remainingCost: 0, remainingToolCalls: 0,
};
function sse(events: unknown[], delayMs = 0): Response {
  const encoder = new TextEncoder();
  let cancelled = false;
  const timers: ReturnType<typeof setTimeout>[] = [];
  return new Response(new ReadableStream({
    start(controller) {
      events.forEach((event, index) => {
        const emit = () => {
          if (cancelled) return;
          controller.enqueue(encoder.encode(`data: ${typeof event === 'string' ? event : JSON.stringify(event)}\n\n`));
          if (index === events.length - 1) controller.close();
        };
        if (delayMs === 0) emit();
        else timers.push(setTimeout(emit, delayMs * (index + 1)));
      });
    },
    cancel() {
      cancelled = true;
      for (const timer of timers) clearTimeout(timer);
    },
  }), { headers: { 'content-type': 'text/event-stream' } });
}

function streamResponse(protocol: ProviderProtocol): Response {
  switch (protocol) {
    case 'openai-chat':
      return sse([
        {
          id: 'chat-1', object: 'chat.completion.chunk', created: 1, model: 'test-model',
          choices: [{ index: 0, delta: { role: 'assistant', content: 'Hello.' }, finish_reason: null }],
        },
        {
          id: 'chat-1', object: 'chat.completion.chunk', created: 1, model: 'test-model',
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          usage: { prompt_tokens: 20, completion_tokens: 3 },
        },
        '[DONE]',
      ]);
    case 'openai-responses':
      return sse([
        { type: 'response.created', response: { id: 'resp-1', created_at: 1, model: 'test-model' } },
        { type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: 'msg-1' } },
        { type: 'response.output_text.delta', item_id: 'msg-1', delta: 'Hello.' },
        { type: 'response.output_item.done', output_index: 0, item: { type: 'message', id: 'msg-1' } },
        {
          type: 'response.completed',
          response: { incomplete_details: null, usage: { input_tokens: 20, output_tokens: 3, total_tokens: 23 } },
        },
      ]);
    case 'anthropic-messages':
      return sse([
        { type: 'message_start', message: { id: 'msg-1', model: 'test-model', role: 'assistant', usage: { input_tokens: 20 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello.' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 3 } },
        { type: 'message_stop' },
      ]);
    case 'google-generative-ai':
      return sse([{
        responseId: 'google-1',
        candidates: [{ content: { role: 'model', parts: [{ text: 'Hello.' }] }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 3, totalTokenCount: 23 },
      }]);
  }
}

test('four explicit BYOK protocols: headers, endpoint, usage, no cost fabrication or fallback', async t => {
  for (const protocol of PROVIDER_PROTOCOLS) {
    await t.test(protocol, async () => {
      const original = globalThis.fetch;
      const calls: Request[] = [];
      globalThis.fetch = async (input, init) => {
        calls.push(new Request(input, init));
        return streamResponse(protocol);
      };
      try {
        const result = await byokProvider(credential(protocol), key).execute(request);
        assert.equal(result.text, 'Hello.');
        assert.equal(result.inputTokens, 20);
        assert.equal(result.outputTokens, 3);
        assert.equal(result.cost, null);
        assert.equal(calls.length, 1);
        const wire = calls[0];
        const url = new URL(wire.url);
        assert.equal(url.origin, 'https://gateway.example.com');
        assert.equal(url.searchParams.has('key'), false); // Gemini credentials must stay out of the URL.
        if (protocol === 'anthropic-messages') {
          assert.equal(url.pathname, '/v1/messages');
          assert.equal(wire.headers.get('x-api-key'), key);
          assert.ok(wire.headers.get('anthropic-version'));
          assert.equal(wire.headers.get('authorization'), null);
        } else if (protocol === 'google-generative-ai') {
          assert.equal(url.pathname, '/v1/models/test-model:streamGenerateContent');
          assert.equal(url.searchParams.get('alt'), 'sse');
          assert.equal(wire.headers.get('x-goog-api-key'), key);
          assert.equal(wire.headers.get('authorization'), null);
        } else {
          assert.equal(url.pathname, protocol === 'openai-chat' ? '/v1/chat/completions' : '/v1/responses');
          assert.equal(wire.headers.get('authorization'), `Bearer ${key}`);
        }
        assert.equal((await wire.text()).includes(key), false);
      } finally {
        globalThis.fetch = original;
      }
    });
  }
});

test('protocol failure never retries a billed request, leaks raw upstream text, or switches protocol', async t => {
  for (const protocol of PROVIDER_PROTOCOLS) {
    await t.test(protocol, async () => {
      const original = globalThis.fetch;
      let calls = 0;
      globalThis.fetch = async () => {
        calls++;
        return Response.json({ error: { message: key } }, { status: 429 });
      };
      try {
        await assert.rejects(byokProvider(credential(protocol), key).execute(request), error => {
          assert.ok(error instanceof Error);
          assert.equal(error.message.includes(key), false);
          return true;
        });
        assert.equal(calls, 1);
      } finally {
        globalThis.fetch = original;
      }
    });
  }
});

test('each protocol propagates cancellation to the request without retry', async t => {
  for (const protocol of PROVIDER_PROTOCOLS) {
    await t.test(protocol, async () => {
      const original = globalThis.fetch;
      const controller = new AbortController();
      let calls = 0;
      globalThis.fetch = async (input, init) => {
        calls++;
        const wire = new Request(input, init);
        assert.ok(wire.signal);
        return new Promise<Response>((_resolve, reject) => {
          wire.signal.addEventListener('abort', () => reject(wire.signal.reason), { once: true });
          controller.abort();
        });
      };
      try {
        await assert.rejects(byokProvider(credential(protocol), key).execute({ ...request, signal: controller.signal }));
        assert.equal(calls, 1);
      } finally {
        globalThis.fetch = original;
      }
    });
  }
});

test('streaming progress can exceed the idle window while a stalled stream is aborted', async t => {
  await t.test('progress resets the idle timer', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async () => sse([
      {
        id: 'chat-1', object: 'chat.completion.chunk', created: 1, model: 'test-model',
        choices: [{ index: 0, delta: { role: 'assistant', content: 'Hel' }, finish_reason: null }],
      },
      {
        id: 'chat-1', object: 'chat.completion.chunk', created: 1, model: 'test-model',
        choices: [{ index: 0, delta: { content: 'lo.' }, finish_reason: null }],
      },
      {
        id: 'chat-1', object: 'chat.completion.chunk', created: 1, model: 'test-model',
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        usage: { prompt_tokens: 20, completion_tokens: 3 },
      },
      '[DONE]',
    ], 30);
    try {
      const result = await byokProvider(credential('openai-chat'), key, {
        idleTimeoutMs: 80,
        absoluteTimeoutMs: 1_000,
      }).execute(request);
      assert.equal(result.text, 'Hello.');
    } finally {
      globalThis.fetch = original;
    }
  });

  await t.test('no progress becomes result unknown without retry', async () => {
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async (input, init) => {
      calls++;
      const wire = new Request(input, init);
      const encoder = new TextEncoder();
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            id: 'chat-1', object: 'chat.completion.chunk', created: 1, model: 'test-model',
            choices: [{ index: 0, delta: { role: 'assistant', content: 'partial' }, finish_reason: null }],
          })}\n\n`));
          wire.signal.addEventListener('abort', () => controller.error(wire.signal.reason), { once: true });
        },
      }), { headers: { 'content-type': 'text/event-stream' } });
    };
    try {
      await assert.rejects(
        byokProvider(credential('openai-chat'), key, {
          idleTimeoutMs: 50,
          absoluteTimeoutMs: 1_000,
        }).execute(request),
        (error: unknown) => error instanceof Error && error.name === 'ProviderResultUnknownError',
      );
      assert.equal(calls, 1);
    } finally {
      globalThis.fetch = original;
    }
  });
});
