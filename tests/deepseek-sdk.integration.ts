import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { byokProvider } from '../src/lib/ai/sdk-provider.ts';
import type { AIRequest } from '../src/lib/ai/types.ts';
import type { Credential } from '../src/shared/types.ts';
import { AppError, ERROR_CODES } from '../src/shared/errors.ts';

// SDK-only, offline suite: pnpm exec tsx --test tests/deepseek-sdk.integration.ts
// The .integration.ts suffix deliberately excludes the native *.test.ts suite.
const dummyKey = 'offline-dummy-key-never-valid';
const model = 'deepseek-v4-flash';

function credential(baseUrl: string, modelId = model): Credential {
  return {
    id: 'offline-deepseek',
    userId: 'offline-user',
    name: 'Offline fixture',
    baseUrl,
    modelId,
    ciphertext: 'unused-offline-ciphertext',
    lastFour: 'alid',
    inputPrice: 1,
    outputPrice: 2,
    createdAt: '2026-09-06T00:00:00.000Z',
  };
}

function request(modelId = model): AIRequest {
  return {
    model: modelId,
    systemPrompt: 'Reply briefly. Do not use tools.',
    userPrompt: 'Say hello.',
    tools: [],
    maxTokens: 128,
    temperature: 0,
    remainingTokens: 10_000,
    remainingCost: 1,
    remainingToolCalls: 0,
  };
}

function completion(): Response {
  return Response.json({
    id: 'offline-completion',
    object: 'chat.completion',
    created: 1_788_652_800,
    model,
    choices: [{
      index: 0,
      message: { role: 'assistant', content: 'Hello.' },
      finish_reason: 'stop',
    }],
    usage: {
      prompt_tokens: 40,
      completion_tokens: 6,
      total_tokens: 46,
      prompt_cache_hit_tokens: 0,
      prompt_cache_miss_tokens: 40,
      completion_tokens_details: { reasoning_tokens: 0 },
    },
  });
}

describe('DeepSeek SDK adapter (offline)', { concurrency: false }, () => {
  let originalFetch: typeof globalThis.fetch;
  let calls: Request[];
  let respond: (wire: Request) => Response | Promise<Response>;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    calls = [];
    respond = () => completion();
    // Never delegate to the original fetch, including failure and rejection tests.
    globalThis.fetch = async (input, init) => {
      const wire = new Request(input, init);
      calls.push(wire);
      return respond(wire);
    };
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  for (const baseUrl of ['https://api.deepseek.com', 'https://api.deepseek.com/v1']) {
    test(`${baseUrl}: sends non-thinking, bounded, tool-free completion and maps actual usage`, async () => {
      const result = await byokProvider(credential(baseUrl), dummyKey).execute(request());
      assert.equal(calls.length, 1);
      const wire = calls[0];
      assert.equal(wire.method, 'POST');
      const url = new URL(wire.url);
      assert.equal(url.origin, 'https://api.deepseek.com');
      assert.ok(['/chat/completions', '/v1/chat/completions'].includes(url.pathname));
      assert.equal(wire.headers.get('authorization'), `Bearer ${dummyKey}`);
      const body = await wire.json() as Record<string, unknown>;
      assert.equal(body.model, model);
      assert.deepEqual(body.thinking, { type: 'disabled' });
      assert.equal(typeof body.max_tokens, 'number');
      assert.ok(Number.isInteger(body.max_tokens));
      assert.ok((body.max_tokens as number) >= 16 && (body.max_tokens as number) <= 128);
      assert.ok(body.tools === undefined || (Array.isArray(body.tools) && body.tools.length === 0));
      assert.equal(body.functions, undefined);
      assert.deepEqual(body.messages, [
        { role: 'system', content: 'Reply briefly. Do not use tools.' },
        { role: 'user', content: 'Say hello.' },
      ]);
      assert.equal(result.text, 'Hello.');
      assert.equal(result.inputTokens, 40);
      assert.equal(result.outputTokens, 6);
      assert.equal(result.reasoningTokens, 0);
      assert.equal(result.toolCalls, 0);
      assert.equal(result.estimated, false);
      assert.equal(result.cost, 52 / 1_000_000);
    });
  }

  const invalidUsageCases: Array<{
    name: string;
    mutate: (payload: Record<string, unknown>) => void;
  }> = [
    {
      name: 'missing usage',
      mutate: (payload) => { delete payload.usage; },
    },
    ...['prompt_tokens', 'completion_tokens'].map((field) => ({
      name: `negative ${field}`,
      mutate: (payload: Record<string, unknown>) => {
        const usage = payload.usage as Record<string, unknown>;
        usage[field] = -1;
        usage.total_tokens = field === 'prompt_tokens' ? 5 : 39;
      },
    })),
    {
      name: 'positive reasoning usage',
      mutate: (payload) => {
        const usage = payload.usage as Record<string, unknown>;
        usage.completion_tokens_details = { reasoning_tokens: 2 };
      },
    },
  ];

  for (const { name, mutate } of invalidUsageCases) {
    test(`official provider fails closed on ${name}`, async () => {
      respond = async () => {
        const payload = await completion().json() as Record<string, unknown>;
        mutate(payload);
        return Response.json(payload);
      };
      await assert.rejects(async () => {
        await byokProvider(credential('https://api.deepseek.com'), dummyKey).execute(request());
      }, (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.code, ERROR_CODES.PROVIDER_RESPONSE_INVALID);
        assert.equal(error.status, 502);
        return true;
      });
      assert.equal(calls.length, 1);
    });
  }

  test('non-DeepSeek BYOK preserves its model without forcing thinking options', async () => {
    const baseUrl = 'https://compatible.example/v1';
    const compatibleModel = 'existing-compatible-model';
    respond = async () => {
      const payload = await completion().json() as Record<string, unknown>;
      payload.model = compatibleModel;
      return Response.json(payload);
    };
    const result = await byokProvider(credential(baseUrl, compatibleModel), dummyKey)
      .execute(request(compatibleModel));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `${baseUrl}/chat/completions`);
    const body = await calls[0].json() as Record<string, unknown>;
    assert.equal(body.model, compatibleModel);
    assert.equal(Object.hasOwn(body, 'thinking'), false);
    assert.equal(result.text, 'Hello.');
    assert.equal(result.inputTokens, 40);
    assert.equal(result.outputTokens, 6);
    assert.equal(result.estimated, false);
    assert.equal(result.toolCalls, 0);
  });

  for (const unsupportedModel of ['deepseek-chat', 'deepseek-reasoner', 'unregistered-model']) {
    test(`rejects unsupported official model ${unsupportedModel} before fetch`, async () => {
      await assert.rejects(async () => {
        await byokProvider(credential('https://api.deepseek.com', unsupportedModel), dummyKey)
          .execute(request(unsupportedModel));
      });
      assert.equal(calls.length, 0);
    });
  }

  test('cannot bypass model validation with a valid credential and unsupported request model', async () => {
    await assert.rejects(async () => {
      await byokProvider(credential('https://api.deepseek.com'), dummyKey)
        .execute(request('deepseek-reasoner'));
    });
    assert.equal(calls.length, 0);
  });

  for (const path of ['/v2', '/v1/chat/completions', '/arbitrary']) {
    test(`rejects unsupported official URL path ${path} before fetch`, async () => {
      await assert.rejects(async () => {
        await byokProvider(credential(`https://api.deepseek.com${path}`), dummyKey)
          .execute(request());
      });
      assert.equal(calls.length, 0);
    });
  }

  for (const status of [401, 429, 500]) {
    test(`sanitizes upstream HTTP ${status} without retrying`, async () => {
      const sensitive = `upstream-private-details ${dummyKey}`;
      respond = () => Response.json({ error: { message: sensitive, type: 'api_error' } }, { status });
      await assert.rejects(async () => {
        await byokProvider(credential('https://api.deepseek.com'), dummyKey).execute(request());
      }, (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.code, ERROR_CODES.PROVIDER_REQUEST_FAILED);
        assert.equal(error.status, 502);
        assert.doesNotMatch(`${error.message}\n${error.stack}\n${JSON.stringify(error)}`, /upstream-private-details|offline-dummy-key-never-valid/);
        return true;
      });
      assert.equal(calls.length, 1);
    });
  }

  test('sanitizes transport exceptions without retrying', async () => {
    respond = () => { throw new Error(`transport-private-details ${dummyKey}`); };
    await assert.rejects(async () => {
      await byokProvider(credential('https://api.deepseek.com'), dummyKey).execute(request());
    }, (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, ERROR_CODES.PROVIDER_REQUEST_FAILED);
      assert.equal(error.status, 502);
      assert.doesNotMatch(`${error.message}\n${error.stack}\n${JSON.stringify(error)}`, /transport-private-details|offline-dummy-key-never-valid/);
      return true;
    });
    assert.equal(calls.length, 1);
  });
});
