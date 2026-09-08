import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { byokProvider } from '../src/lib/ai/sdk-provider.ts';
import { ProviderResultUnknownError, type AIRequest } from '../src/lib/ai/types.ts';
import type { Credential } from '../src/shared/types.ts';
import type { ProviderProtocol } from '../src/shared/provider-protocol.ts';
import { AppError, ERROR_CODES } from '../src/shared/errors.ts';

// SDK-only, offline suite: pnpm exec tsx --test tests/deepseek-sdk.integration.ts
// The replacement fetch below never calls the network or a paid model.
const dummyKey = 'offline-dummy-key-never-valid';
const defaultModel = 'deepseek-v4-flash';

function credential(
  baseUrl: string,
  modelId = defaultModel,
  protocol: ProviderProtocol = 'openai-chat',
): Credential {
  return {
    id: 'offline-deepseek',
    userId: 'offline-user',
    name: 'Offline fixture',
    protocol,
    baseUrl,
    modelId,
    ciphertext: 'unused-offline-ciphertext',
    lastFour: 'alid',
    inputPrice: 1,
    outputPrice: 2,
    createdAt: '2026-09-06T00:00:00.000Z',
  };
}

function request(modelId = defaultModel): AIRequest {
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

function chatCompletion(model = defaultModel, includeUsage = true): Response {
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
    ...(includeUsage ? {
      usage: {
        prompt_tokens: 40,
        completion_tokens: 6,
        total_tokens: 46,
        completion_tokens_details: { reasoning_tokens: 0 },
      },
    } : {}),
  });
}

function responsesCompletion(model = defaultModel): Response {
  return Response.json({
    id: 'offline-response',
    object: 'response',
    created_at: 1_788_652_800,
    model,
    status: 'completed',
    output: [{
      id: 'message-1',
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'output_text', text: 'Hello.', annotations: [] }],
    }],
    usage: { input_tokens: 40, output_tokens: 6, total_tokens: 46 },
    incomplete_details: null,
  });
}

describe('DeepSeek BYOK SDK adapter (offline)', { concurrency: false }, () => {
  let originalFetch: typeof globalThis.fetch;
  let calls: Request[];
  let respond: (wire: Request) => Response | Promise<Response>;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    calls = [];
    respond = () => chatCompletion();
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
    test(`${baseUrl}: honors explicit Chat Completions without platform-only options`, async () => {
      const result = await byokProvider(credential(baseUrl), dummyKey).execute(request());
      assert.equal(calls.length, 1);
      const wire = calls[0];
      assert.equal(wire.method, 'POST');
      const url = new URL(wire.url);
      assert.equal(url.origin, 'https://api.deepseek.com');
      assert.ok(['/chat/completions', '/v1/chat/completions'].includes(url.pathname));
      assert.equal(wire.headers.get('authorization'), `Bearer ${dummyKey}`);
      const body = await wire.json() as Record<string, unknown>;
      assert.equal(body.model, defaultModel);
      assert.equal(Object.hasOwn(body, 'thinking'), false);
      assert.equal(body.max_tokens, 128);
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

  for (const customModel of ['deepseek-chat', 'deepseek-reasoner', 'tenant/custom-model']) {
    test(`passes custom BYOK model ${customModel} through without a platform registry lookup`, async () => {
      respond = () => chatCompletion(customModel);
      const result = await byokProvider(
        credential('https://api.deepseek.com/v1', customModel),
        dummyKey,
      ).execute(request(customModel));
      assert.equal(calls.length, 1);
      assert.equal((await calls[0].json() as Record<string, unknown>).model, customModel);
      assert.equal(result.text, 'Hello.');
    });
  }

  test('honors an explicit Responses selection and never falls back to Chat Completions', async () => {
    const model = 'deepseek-responses-custom';
    respond = () => responsesCompletion(model);
    const result = await byokProvider(
      credential('https://api.deepseek.com/v1', model, 'openai-responses'),
      dummyKey,
    ).execute(request(model));
    assert.equal(calls.length, 1);
    assert.equal(new URL(calls[0].url).pathname, '/v1/responses');
    assert.equal((await calls[0].json() as Record<string, unknown>).model, model);
    assert.equal(result.text, 'Hello.');
  });

  test('treats a custom base path as an opaque provider prefix', async () => {
    const baseUrl = 'https://api.deepseek.com/tenant/proxy/v1';
    await byokProvider(credential(baseUrl), dummyKey).execute(request());
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `${baseUrl}/chat/completions`);
  });

  test('missing usage remains usable but is marked estimated with unknown cost', async () => {
    respond = () => chatCompletion(defaultModel, false);
    const result = await byokProvider(
      credential('https://api.deepseek.com/v1'),
      dummyKey,
    ).execute(request());
    assert.equal(result.text, 'Hello.');
    assert.equal(result.estimated, true);
    assert.equal(result.cost, null);
    assert.ok(result.inputTokens > 0);
    assert.ok(result.outputTokens > 0);
  });

  test('malformed successful responses fail as a known invalid response', async () => {
    respond = () => new Response('{', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    await assert.rejects(
      byokProvider(credential('https://api.deepseek.com/v1'), dummyKey).execute(request()),
      (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.code, ERROR_CODES.PROVIDER_RESPONSE_INVALID);
        assert.equal(error.status, 502);
        return true;
      },
    );
    assert.equal(calls.length, 1);
  });

  for (const status of [400, 401, 403, 404, 429, 500]) {
    test(`sanitizes known upstream HTTP ${status} without retrying`, async () => {
      const sensitive = `upstream-private-details ${dummyKey}`;
      respond = () => Response.json({ error: { message: sensitive, type: 'api_error' } }, { status });
      await assert.rejects(
        byokProvider(credential('https://api.deepseek.com/v1'), dummyKey).execute(request()),
        (error: unknown) => {
          assert.ok(error instanceof AppError);
          assert.equal(error.code, ERROR_CODES.PROVIDER_REQUEST_FAILED);
          assert.equal(error.status, 502);
          assert.doesNotMatch(
            `${error.message}\n${error.stack}\n${JSON.stringify(error)}`,
            /upstream-private-details|offline-dummy-key-never-valid/,
          );
          return true;
        },
      );
      assert.equal(calls.length, 1);
    });
  }

  test('transport loss is unknown, sanitized, and never retried', async () => {
    respond = () => { throw new Error(`transport-private-details ${dummyKey}`); };
    await assert.rejects(
      byokProvider(credential('https://api.deepseek.com/v1'), dummyKey).execute(request()),
      (error: unknown) => {
        assert.ok(error instanceof ProviderResultUnknownError);
        assert.equal(error.code, 'UPSTREAM_RESULT_UNKNOWN');
        assert.doesNotMatch(
          `${error.message}\n${error.stack}\n${JSON.stringify(error)}`,
          /transport-private-details|offline-dummy-key-never-valid/,
        );
        return true;
      },
    );
    assert.equal(calls.length, 1);
  });
});
