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
function payload(protocol: ProviderProtocol) {
  switch (protocol) {
    case 'openai-chat': return {
      id: 'chat-1', object: 'chat.completion', created: 1, model: 'test-model',
      choices: [{ index: 0, message: { role: 'assistant', content: 'Hello.' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 20, completion_tokens: 3 },
    };
    case 'openai-responses': return {
      id: 'resp-1', object: 'response', created_at: 1, model: 'test-model', status: 'completed',
      output: [{ id: 'msg-1', type: 'message', role: 'assistant', status: 'completed',
        content: [{ type: 'output_text', text: 'Hello.', annotations: [] }] }],
      usage: { input_tokens: 20, output_tokens: 3, total_tokens: 23 },
      incomplete_details: null,
    };
    case 'anthropic-messages': return {
      id: 'msg-1', type: 'message', role: 'assistant', model: 'test-model',
      content: [{ type: 'text', text: 'Hello.' }], stop_reason: 'end_turn', stop_sequence: null,
      usage: { input_tokens: 20, output_tokens: 3 },
    };
    case 'google-generative-ai': return {
      candidates: [{ content: { role: 'model', parts: [{ text: 'Hello.' }] }, finishReason: 'STOP', index: 0 }],
      usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 3, totalTokenCount: 23 },
    };
  }
}

test('four explicit BYOK protocols: headers, endpoint, usage, no cost fabrication or fallback', async t => {
  for (const protocol of PROVIDER_PROTOCOLS) {
    await t.test(protocol, async () => {
      const original = globalThis.fetch;
      const calls: Request[] = [];
      globalThis.fetch = async (input, init) => {
        calls.push(new Request(input, init));
        return Response.json(payload(protocol));
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
        assert.equal(url.search, ''); // In particular Gemini must not put the key in query strings.
        if (protocol === 'anthropic-messages') {
          assert.equal(url.pathname, '/v1/messages');
          assert.equal(wire.headers.get('x-api-key'), key);
          assert.ok(wire.headers.get('anthropic-version'));
          assert.equal(wire.headers.get('authorization'), null);
        } else if (protocol === 'google-generative-ai') {
          assert.equal(url.pathname, '/v1/models/test-model:generateContent');
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
