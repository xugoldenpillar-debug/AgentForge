import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import test from 'node:test';
import {
  deriveGatewayIdempotencyKey, GATEWAY_ERROR_CODES, GATEWAY_LIMITS, GatewayContractError,
  hashGatewayIdempotencyKey, parseGatewayCapabilities, parseGatewayCompletion,
  parseGatewayCompletionHeaders, parseGatewayCompletionRequest, parseGatewayError,
  parseGatewayHeaders, parseGatewayInvocationContext, parseGatewayJson,
  parseGatewayReceipt, parseGatewayUsage, parseGatewayIdempotencyStatus,
} from '../src/lib/gateway-contract/index.ts';
import type { GatewayCompletion, GatewayInvocationContext } from '../src/lib/gateway-contract/index.ts';
import {
  validateExecutionReceipt, validateGatewayCapabilities,
  validateGatewayExecutionResult, validateGatewayRequest, validateGatewayCompletionResult, validateGatewayIdempotencyStatus,
} from '../src/lib/ai/execution-receipt.ts';

const now = 1_788_652_800_000;
const requestId = '01234567-89ab-4cde-8fab-0123456789ab';
const alias = 'verified/deepseek-v4-flash-nonthinking-v1';
const context: GatewayInvocationContext = {
  runId: 'run-1', caseId: 'case-1', nodeId: 'node-1', invocationIndex: 0,
  profileVersion: 'bp-2026-001', replicaIndex: 0,
};
const expected = { requestId, profileAlias: alias, gatewayConfigVersion: 'gw-2026-001', context };
const key = deriveGatewayIdempotencyKey(context);
const headers = {
  authorization: 'Bearer test-only-token',
  'x-agentforge-timestamp': String(now),
  'x-agentforge-request-id': requestId,
};
const completionHeaders = {
  ...headers,
  'x-agentforge-profile': alias,
  'x-agentforge-idempotency-key': key,
  'content-type': 'application/json',
};
const capabilities = {
  protocolVersion: '1', gatewayConfigVersion: expected.gatewayConfigVersion, profiles: [alias],
  supportsIdempotency: true, supportsResponseReplay: false, storesRawPrompts: false,
};
const request = {
  model: alias,
  messages: [{ role: 'system', content: 'private system' }, { role: 'user', content: 'private input' }],
  temperature: 0, stream: false, max_tokens: 100, thinking: { type: 'disabled' },
};

function completion(): GatewayCompletion {
  return {
    id: requestId, model: alias,
    choices: [{ index: 0, message: { role: 'assistant', content: 'private output' }, finish_reason: 'stop' }],
    usage: {
      prompt_tokens: 100, completion_tokens: 50, reasoning_tokens: 0,
      prompt_cache_hit_tokens: 30, prompt_cache_miss_tokens: 70,
    },
    agentforge: {
      protocol_version: '1', idempotency_key_hash: hashGatewayIdempotencyKey(key),
      profile_version: context.profileVersion, gateway_config_version: expected.gatewayConfigVersion,
      upstream_provider: 'deepseek', upstream_model: 'deepseek-v4-flash', thinking_enabled: false,
      actual_cost_usd: 0.0001, upstream_latency_ms: 740,
    },
  };
}

function rejected(operation: () => unknown): void {
  assert.throws(operation, (error: unknown) => {
    assert.ok(error instanceof GatewayContractError);
    assert.equal(Object.hasOwn(error, 'cause'), false);
    assert.ok(!JSON.stringify(error).includes('private'));
    return true;
  });
}

function omit(value: object, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));
}

test('strict contract validates capabilities, headers, request, completion and receipt', () => {
  assert.deepEqual(parseGatewayHeaders(headers, now), headers);
  assert.deepEqual(parseGatewayCompletionHeaders(completionHeaders, now), completionHeaders);
  assert.deepEqual(validateGatewayRequest(completionHeaders, request, expected, now).body, request);
  assert.deepEqual(validateGatewayCapabilities(capabilities, expected), capabilities);
  assert.deepEqual(parseGatewayCompletion(completion()), completion());
  const result = validateGatewayExecutionResult(completion(), expected, 100);
  assert.equal(result.text, 'private output');
  assert.equal(result.executionReceipt.receipt.actual_cost_usd, 0.0001);
  const serialized = JSON.stringify(result.executionReceipt);
  for (const forbidden of ['private', 'choices', 'authorization', 'messages', 'test-only-token']) {
    assert.ok(!serialized.includes(forbidden));
  }
});

test('headers enforce explicit freshness boundary, safe timestamp, auth and UUID', () => {
  parseGatewayHeaders(headers, now + GATEWAY_LIMITS.timestampSkewMs);
  parseGatewayHeaders(headers, now - GATEWAY_LIMITS.timestampSkewMs);
  rejected(() => parseGatewayHeaders(headers, now + GATEWAY_LIMITS.timestampSkewMs + 1));
  rejected(() => parseGatewayHeaders(headers, now - GATEWAY_LIMITS.timestampSkewMs - 1));
  for (const timestamp of ['', '1e12', '01', '-1', '1.5', '9007199254740992', 'private']) {
    rejected(() => parseGatewayHeaders({ ...headers, 'x-agentforge-timestamp': timestamp }, now));
  }
  for (const authorization of ['', 'Basic private', 'Bearer private\r\nX: bad', ['Bearer private'], `Bearer ${'a'.repeat(4097)}`]) {
    rejected(() => parseGatewayHeaders({ ...headers, authorization }, now));
  }
  rejected(() => parseGatewayHeaders({ ...headers, 'x-agentforge-request-id': 'private' }, now));
  rejected(() => parseGatewayHeaders({ ...headers, 'x-agentforge-request-id': [requestId, requestId] }, now));
  rejected(() => parseGatewayHeaders({ ...headers, unexpected: 'private' }, now));
  rejected(() => parseGatewayCompletionHeaders({ ...completionHeaders, 'content-type': 'text/plain' }, now));
  rejected(() => parseGatewayCompletionHeaders({ ...completionHeaders, 'x-agentforge-idempotency-key': 'private' }, now));
});

test('headers and body must bind the exact trusted invocation', () => {
  for (const field of ['x-agentforge-request-id', 'x-agentforge-profile', 'x-agentforge-idempotency-key']) {
    const replacement = field === 'x-agentforge-request-id' ? '11234567-89ab-4cde-8fab-0123456789ab'
      : field === 'x-agentforge-profile' ? 'other-profile' : `sha256:${'0'.repeat(64)}`;
    rejected(() => validateGatewayRequest({ ...completionHeaders, [field]: replacement }, request, expected, now));
  }
  rejected(() => validateGatewayRequest(completionHeaders, { ...request, model: 'deepseek-v4-flash' }, expected, now));
});

test('capabilities fail closed on unsupported privacy/protocol or config/alias', () => {
  for (const [field, value] of Object.entries({
    protocolVersion: '2', supportsIdempotency: false, supportsResponseReplay: true,
    storesRawPrompts: true, profiles: [], upstream_error: 'private',
  })) rejected(() => parseGatewayCapabilities({ ...capabilities, [field]: value }));
  rejected(() => parseGatewayCapabilities({ ...capabilities, profiles: [alias, alias] }));
  rejected(() => parseGatewayCapabilities({ ...capabilities, profiles: Array(129).fill(alias) }));
  rejected(() => validateGatewayCapabilities({ ...capabilities, gatewayConfigVersion: 'other' }, expected));
  rejected(() => validateGatewayCapabilities({ ...capabilities, profiles: ['other'] }, expected));
});

test('completion request rejects thinking/streaming/tools/retry and conflicting parameters', () => {
  for (const [field, value] of Object.entries({
    model: 'deepseek-v4-flash', temperature: 1, stream: true, max_tokens: 0,
    thinking: { type: 'enabled' }, tools: [], retry: 1, reasoning_effort: 'high',
  })) rejected(() => parseGatewayCompletionRequest({ ...request, [field]: value }, alias));
  for (const count of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER, 65_537]) {
    rejected(() => parseGatewayCompletionRequest({ ...request, max_tokens: count }, alias));
  }
  rejected(() => parseGatewayCompletionRequest({ ...request, thinking: { type: 'disabled', private: true } }, alias));
  for (const messages of [[], [{ role: 'tool', content: 'private' }], [{ role: 'user', content: 'private', name: 'x' }], Array(65).fill(request.messages[1])]) {
    rejected(() => parseGatewayCompletionRequest({ ...request, messages }, alias));
  }
});

test('all required fields reject absence rather than estimating or defaulting', () => {
  const contracts: [object, (value: unknown) => unknown][] = [
    [headers, (value) => parseGatewayHeaders(value, now)],
    [completionHeaders, (value) => parseGatewayCompletionHeaders(value, now)],
    [capabilities, parseGatewayCapabilities],
    [request, (value) => parseGatewayCompletionRequest(value, alias)],
    [completion(), parseGatewayCompletion],
    [completion().agentforge, parseGatewayReceipt],
    [context, parseGatewayInvocationContext],
  ];
  for (const [object, parse] of contracts) {
    for (const field of Object.keys(object)) rejected(() => parse(omit(object, field)));
    rejected(() => parse({ ...object, unknown: 'private' }));
  }
  for (const field of Object.keys(completion().usage).filter((field) => field !== 'reasoning_tokens')) {
    rejected(() => parseGatewayUsage(omit(completion().usage, field)));
  }
});

test('usage requires safe nonnegative integers and internally consistent cache accounting', () => {
  for (const field of ['prompt_tokens', 'completion_tokens', 'prompt_cache_hit_tokens', 'prompt_cache_miss_tokens']) {
    for (const value of [-1, -0, 0.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '1', null]) {
      rejected(() => parseGatewayUsage({ ...completion().usage, [field]: value }));
    }
  }
  for (const usage of [
    { prompt_tokens: 100, completion_tokens: 0, prompt_cache_hit_tokens: 101, prompt_cache_miss_tokens: 0 },
    { ...completion().usage, prompt_cache_miss_tokens: 69 },
    { ...completion().usage, total_tokens: 150 },
    { prompt_tokens: Number.MAX_SAFE_INTEGER, completion_tokens: 1, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: Number.MAX_SAFE_INTEGER },
  ]) rejected(() => parseGatewayUsage(usage));
  assert.equal(parseGatewayUsage({ prompt_tokens: 0, completion_tokens: 0, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 0 }).prompt_tokens, 0);
  for (const hit of [0, 100]) {
    assert.equal(parseGatewayUsage({ ...completion().usage, prompt_cache_hit_tokens: hit, prompt_cache_miss_tokens: 100 - hit }).prompt_tokens, 100);
  }
});

test('reasoning must be absent or exactly zero, never coerced/estimated', () => {
  assert.equal(parseGatewayUsage(omit(completion().usage, 'reasoning_tokens')).reasoning_tokens, undefined);
  for (const reasoning of [1, -1, -0, undefined, null, '0', false, 0.5, NaN, Infinity]) {
    rejected(() => parseGatewayUsage({ ...completion().usage, reasoning_tokens: reasoning }));
  }
});

test('spend and latency require finite nonnegative numbers and allow fractional/zero values', () => {
  for (const field of ['actual_cost_usd', 'upstream_latency_ms']) {
    for (const value of [-1, -0, NaN, Infinity, -Infinity, '0', null]) {
      rejected(() => parseGatewayReceipt({ ...completion().agentforge, [field]: value }));
    }
    for (const value of [0, 0.25]) {
      assert.equal(parseGatewayReceipt({ ...completion().agentforge, [field]: value })[field as 'actual_cost_usd' | 'upstream_latency_ms'], value);
    }
  }
});

test('receipt rejects wrong upstream, thinking and every exact binding mismatch', () => {
  for (const [field, value] of Object.entries({
    protocol_version: '2', upstream_provider: 'other', upstream_model: 'deepseek-v4-pro',
    thinking_enabled: true, profile_version: 'other', gateway_config_version: 'other',
    idempotency_key_hash: `sha256:${'0'.repeat(64)}`,
  })) {
    rejected(() => validateExecutionReceipt({ ...completion(), agentforge: { ...completion().agentforge, [field]: value } }, expected));
  }
  rejected(() => validateExecutionReceipt({ ...completion(), id: '11234567-89ab-4cde-8fab-0123456789ab' }, expected));
  rejected(() => validateExecutionReceipt({ ...completion(), model: 'other' }, expected));
  for (const field of Object.keys(context)) {
    const changed = { ...context, [field]: typeof context[field as keyof GatewayInvocationContext] === 'number' ? 1 : 'other' };
    rejected(() => validateExecutionReceipt(completion(), { ...expected, context: changed }));
  }
});

test('idempotency is stable, domain-separated, collision-safe and hashes no prompts', () => {
  assert.equal(key, deriveGatewayIdempotencyKey({ ...context }));
  assert.equal(hashGatewayIdempotencyKey(key), `sha256:${createHash('sha256').update(key).digest('hex')}`);
  assert.match(key, /^sha256:[a-f0-9]{64}$/);
  const reordered = Object.fromEntries(Object.entries(context).reverse());
  assert.equal(key, deriveGatewayIdempotencyKey(parseGatewayInvocationContext(reordered)));
  for (const field of Object.keys(context)) {
    const changed = { ...context, [field]: typeof context[field as keyof GatewayInvocationContext] === 'number' ? 1 : 'other' };
    assert.notEqual(key, deriveGatewayIdempotencyKey(changed));
  }
  assert.notEqual(
    deriveGatewayIdempotencyKey({ ...context, runId: 'a:b', caseId: 'c' }),
    deriveGatewayIdempotencyKey({ ...context, runId: 'a', caseId: 'b:c' }),
  );
  rejected(() => deriveGatewayIdempotencyKey({ ...context, prompt: 'private' } as GatewayInvocationContext));
  for (const invocationIndex of [-1, 0.1, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    rejected(() => deriveGatewayIdempotencyKey({ ...context, invocationIndex }));
  }
});

test('completion bounds and nested unknown keys reject upstream data leaks', () => {
  const response = completion();
  for (const invalid of [
    { ...response, upstream_error: 'private' },
    { ...response, usage: { ...response.usage, private: 'input' } },
    { ...response, agentforge: { ...response.agentforge, raw_response: 'private' } },
    { ...response, choices: [{ ...response.choices[0], private: 'input' }] },
    { ...response, choices: [{ ...response.choices[0], message: { role: 'assistant', content: 'x', reasoning_content: 'private' } }] },
    { ...response, choices: [response.choices[0], response.choices[0]] },
    { ...response, choices: [{ ...response.choices[0], finish_reason: 'tool_calls' }] },
    { ...response, choices: [{ ...response.choices[0], index: 1 }] },
  ]) rejected(() => parseGatewayCompletion(invalid));
});

test('receipt-only data cannot become a model output or exceed sent completion budget', () => {
  const receiptOnly = { ...completion(), choices: [] };
  assert.equal(validateExecutionReceipt(receiptOnly, expected).requestId, requestId);
  rejected(() => validateGatewayExecutionResult(receiptOnly, expected, 100));
  rejected(() => validateGatewayExecutionResult(completion(), expected, 49));
  const result = validateGatewayExecutionResult({ ...completion(), choices: [{ ...completion().choices[0], finish_reason: 'length' }] }, expected, 50);
  assert.equal(result.finishReason, 'length');
});

test('JSON and text bounds enforce bytes, malformed errors never echo response bodies', () => {
  assert.deepEqual(parseGatewayJson(Buffer.from(JSON.stringify(completion()))), completion());
  rejected(() => parseGatewayJson('private invalid JSON'));
  rejected(() => parseGatewayJson(new Uint8Array([0xff])));
  rejected(() => parseGatewayJson(' '.repeat(GATEWAY_LIMITS.jsonBytes + 1)));
  const body = { ...request, messages: [{ role: 'user', content: '界'.repeat(90_000) }] };
  rejected(() => parseGatewayCompletionRequest(body, alias));
  const combined = { ...request, messages: Array.from({ length: 5 }, () => ({ role: 'user', content: 'x'.repeat(GATEWAY_LIMITS.textBytes) })) };
  rejected(() => parseGatewayCompletionRequest(combined, alias));
  const large = completion();
  large.choices[0]!.message.content = 'x'.repeat(GATEWAY_LIMITS.textBytes + 1);
  rejected(() => parseGatewayCompletion(large));
});

test('error contract permits only public error code and correlated request ID', () => {
  for (const code of GATEWAY_ERROR_CODES) {
    assert.equal(parseGatewayError({ error: { code, request_id: requestId } }).error.code, code);
  }
  for (const error of [
    { code: 'UPSTREAM_FAILURE', request_id: requestId, message: 'private' },
    { code: 'private upstream response', request_id: requestId },
    { code: 'UPSTREAM_FAILURE', request_id: requestId, cause: { private: true } },
  ]) rejected(() => parseGatewayError({ error }));
});

test('strict structural validation rejects prototypes, accessors, symbols and sparse arrays', () => {
  rejected(() => parseGatewayCapabilities(null));
  rejected(() => parseGatewayCapabilities(Object.assign(Object.create({ secret: 'private' }), capabilities)));
  rejected(() => parseGatewayCapabilities({ ...capabilities, [Symbol('private')]: true }));
  const accessor = { ...capabilities };
  Object.defineProperty(accessor, 'profiles', { get() { throw new Error('private getter was called'); } });
  rejected(() => parseGatewayCapabilities(accessor));
  rejected(() => parseGatewayCapabilities({ ...capabilities, profiles: Array(1) }));
  const profiles = [alias];
  Object.defineProperty(profiles, 'private', { value: true });
  rejected(() => parseGatewayCapabilities({ ...capabilities, profiles }));
});

test('isolated Zod companion shares strict native validators (optional dependency)', async (t) => {
  const require = createRequire(import.meta.url);
  try {
    require.resolve('zod');
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'MODULE_NOT_FOUND') throw error;
    t.skip('Zod is not installed; native contract tests remain dependency-free');
    return;
  }
  const schemas = await import('../src/lib/gateway-contract/zod.ts');
  assert.deepEqual(schemas.gatewayCompletionSchema.parse(completion()), completion());
  assert.deepEqual(schemas.gatewayCapabilitiesSchema.parse(capabilities), capabilities);
  assert.deepEqual(schemas.gatewayCompletionRequestSchema(alias).parse(request), request);
  assert.deepEqual(schemas.gatewayHeadersSchema(now).parse(headers), headers);
  assert.deepEqual(schemas.gatewayCompletionHeadersSchema(now).parse(completionHeaders), completionHeaders);
  assert.deepEqual(schemas.gatewayReceiptSchema.parse(completion().agentforge), completion().agentforge);
  assert.deepEqual(schemas.gatewayUsageSchema.parse(completion().usage), completion().usage);
  assert.deepEqual(schemas.gatewayInvocationContextSchema.parse(context), context);
  assert.equal(schemas.gatewayErrorSchema.safeParse({ error: { code: 'UPSTREAM_FAILURE', request_id: requestId } }).success, true);
  for (const invalid of [{ ...completion(), private: true }, { ...completion(), usage: { ...completion().usage, reasoning_tokens: 1 } }]) {
    const result = schemas.gatewayCompletionSchema.safeParse(invalid);
    assert.equal(result.success, false);
    if (!result.success) assert.ok(!result.error.message.includes('private'));
  }
});

const toolProfile = { supportsTools: true, supportsJson: true, maxOutputTokens: 100 };
const toolRequest = {
  ...request,
  tools: [{ type: 'function', function: {
    name: 'lookup', description: 'Look up a bounded value',
    parameters: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'], additionalProperties: false },
  } }],
  tool_choice: 'auto',
};
const toolCall = { id: 'call-1', type: 'function', function: { name: 'lookup', arguments: '{"key":"value"}' } };
function toolCompletion() {
  return { ...completion(), choices: [{ index: 0, message: { role: 'assistant', content: null, tool_calls: [toolCall] }, finish_reason: 'tool_calls' }] };
}

test('profile-gated bounded JSON and tools support activation canaries', () => {
  assert.equal(parseGatewayCompletionRequest(toolRequest, alias, toolProfile).tools?.[0]?.function.name, 'lookup');
  assert.equal(validateGatewayRequest(completionHeaders, toolRequest, expected, now, toolProfile).body.tools?.length, 1);
  const result = validateGatewayCompletionResult(toolCompletion(), expected, toolRequest, toolProfile);
  assert.equal(result.toolCalls.length, 1);
  assert.equal(result.content, null);
  assert.equal(result.finishReason, 'tool_calls');
  assert.ok(!JSON.stringify(result.executionReceipt).includes('arguments'));
  rejected(() => validateGatewayExecutionResult(toolCompletion(), expected, 100));
  const jsonRequest = { ...request, response_format: { type: 'json_object' } };
  const response = completion();
  response.choices[0]!.message.content = '{"ok":true}';
  assert.equal(validateGatewayCompletionResult(response, expected, jsonRequest, toolProfile).content, '{"ok":true}');
  for (const content of ['private invalid JSON', '[]', 'null', '1']) {
    response.choices[0]!.message.content = content;
    rejected(() => validateGatewayCompletionResult(response, expected, jsonRequest, toolProfile));
  }
  rejected(() => parseGatewayCompletionRequest(jsonRequest, alias));
  rejected(() => parseGatewayCompletionRequest(toolRequest, alias));
  rejected(() => parseGatewayCompletionRequest(toolRequest, alias, { ...toolProfile, maxOutputTokens: 99 }));
  rejected(() => parseGatewayCompletionRequest({ ...jsonRequest, response_format: { type: 'json_object', schema: 'private' } }, alias, toolProfile));
});

test('tool structures reject unknown names, schemas, excess calls and orphan history', () => {
  rejected(() => validateGatewayCompletionResult(toolCompletion(), expected, request, toolProfile));
  rejected(() => validateGatewayCompletionResult(toolCompletion(), expected, { ...toolRequest, tool_choice: 'none' }, toolProfile));
  rejected(() => validateGatewayCompletionResult(completion(), expected, { ...toolRequest, tool_choice: 'required' }, toolProfile));
  const roundTrip = {
    ...toolRequest,
    messages: [...request.messages,
      { role: 'assistant', content: null, tool_calls: [toolCall] },
      { role: 'tool', content: 'tool output', tool_call_id: 'call-1' }],
  };
  assert.equal(parseGatewayCompletionRequest(roundTrip, alias, toolProfile).messages.length, 4);
  rejected(() => parseGatewayCompletionRequest({ ...roundTrip, messages: roundTrip.messages.slice(0, -1) }, alias, toolProfile));
  rejected(() => parseGatewayCompletionRequest({ ...toolRequest, messages: [...request.messages, { role: 'tool', content: 'private', tool_call_id: 'missing' }] }, alias, toolProfile));
  for (const parameters of [
    { type: 'object', $ref: 'https://private.invalid' },
    { type: 'object', additionalProperties: true },
    { type: 'object', required: ['absent'] },
    { type: 'object', properties: { key: { type: 'string', enum: ['x', 'x'] } } },
    { type: 'object', properties: { key: { type: 'array' } } },
  ]) rejected(() => parseGatewayCompletionRequest({ ...toolRequest, tools: [{ type: 'function', function: { name: 'lookup', parameters } }] }, alias, toolProfile));
  rejected(() => parseGatewayCompletionRequest({ ...toolRequest, tools: Array(17).fill(toolRequest.tools[0]) }, alias, toolProfile));
  const response = toolCompletion();
  rejected(() => parseGatewayCompletion({ ...response, choices: [{ ...response.choices[0], message: { ...response.choices[0]!.message, tool_calls: Array(17).fill(toolCall) } }] }));
  rejected(() => parseGatewayCompletion({ ...response, choices: [{ ...response.choices[0], message: { role: 'assistant', content: null, tool_calls: [{ ...toolCall, private: true }] } }] }));
});

test('explicit idempotency terminal states contain metadata only and never execute', () => {
  const base = { request_id: requestId, idempotency_key_hash: hashGatewayIdempotencyKey(key) };
  const response = completion();
  const execution = { id: response.id, model: response.model, usage: response.usage, agentforge: response.agentforge };
  for (const status of [
    { ...base, status: 'pending' },
    { ...base, status: 'completed', execution },
    { ...base, status: 'failed', error_code: 'UPSTREAM_TIMEOUT' },
    { ...base, status: 'failed', error_code: 'RESULT_UNAVAILABLE', execution },
  ]) {
    assert.deepEqual(parseGatewayIdempotencyStatus(status), status);
    assert.deepEqual(validateGatewayIdempotencyStatus(status, expected), status);
    rejected(() => validateGatewayIdempotencyStatus(status, { ...expected, context: { ...context, replicaIndex: 1 } }));
    rejected(() => validateGatewayExecutionResult(status, expected, 100));
  }
  for (const status of [
    { ...base, status: 'pending', execution },
    { ...base, status: 'completed' },
    { ...base, status: 'completed', execution: response },
    { ...base, status: 'completed', execution: { ...execution, id: '11234567-89ab-4cde-8fab-0123456789ab' } },
    { ...base, status: 'failed', error_code: 'private message' },
    { ...base, status: 'failed', error_code: 'UPSTREAM_FAILURE', message: 'private upstream body' },
  ]) rejected(() => parseGatewayIdempotencyStatus(status));
});

test('tool-result arguments must be an object matching the declared schema before return', () => {
  function execute(argumentsJson: string, sentRequest: unknown = toolRequest) {
    const response = toolCompletion();
    response.choices[0]!.message.tool_calls = [{ ...toolCall, function: { ...toolCall.function, arguments: argumentsJson } }];
    return validateGatewayCompletionResult(response, expected, sentRequest, toolProfile);
  }
  assert.equal(execute('{"key":"value"}').toolCalls.length, 1);
  for (const args of ['private malformed JSON', '[]', 'null', '"private"', '{}',
    '{"key":1}', '{"key":null}', '{"key":"ok","extra":"private"}',
    '{"key":"ok","__proto__":{"private":true}}']) {
    rejected(() => execute(args));
  }
  const schemaRequest = {
    ...toolRequest,
    tools: [{ type: 'function', function: {
      name: 'lookup', parameters: {
        type: 'object', additionalProperties: false, required: ['records', 'flag', 'empty', 'score'],
        properties: {
          records: { type: 'array', items: {
            type: 'object', additionalProperties: false, required: ['count', 'kind'],
            properties: { count: { type: 'integer' }, kind: { type: 'string', enum: ['allowed'] } },
          } },
          flag: { type: 'boolean', enum: [true] }, empty: { type: 'null' }, score: { type: 'number' },
        },
      },
    } }],
  };
  const valid = { records: [{ count: -2, kind: 'allowed' }], flag: true, empty: null, score: -0.5 };
  assert.equal(execute(JSON.stringify(valid), schemaRequest).toolCalls.length, 1);
  for (const invalid of [
    { ...valid, records: {} }, { ...valid, records: [null] },
    { ...valid, records: [{ count: 1.5, kind: 'allowed' }] },
    { ...valid, records: [{ count: Number.MAX_SAFE_INTEGER + 1, kind: 'allowed' }] },
    { ...valid, records: [{ count: 1, kind: 'other' }] },
    { ...valid, records: [{ count: 1, kind: 'allowed', extra: true }] },
    { ...valid, records: [{ count: 1 }] },
    { ...valid, flag: 'true' }, { ...valid, flag: false },
    { ...valid, empty: {} }, { ...valid, score: '1' },
  ]) rejected(() => execute(JSON.stringify(invalid), schemaRequest));
  rejected(() => execute(JSON.stringify(valid).replace('"score":-0.5', '"score":1e999'), schemaRequest));
});

test('tool-result call IDs must be fresh relative to all assistant history', () => {
  const sent = {
    ...toolRequest,
    messages: [...request.messages,
      { role: 'assistant', content: null, tool_calls: [toolCall] },
      { role: 'tool', content: 'result', tool_call_id: toolCall.id }],
  };
  rejected(() => validateGatewayCompletionResult(toolCompletion(), expected, sent, toolProfile));
  const response = toolCompletion();
  response.choices[0]!.message.tool_calls = [{ ...toolCall, id: 'call-fresh' }];
  const result = validateGatewayCompletionResult(response, expected, sent, toolProfile);
  assert.equal(result.toolCalls[0]!.id, 'call-fresh');
  const nextRequest = {
    ...sent,
    messages: [...sent.messages,
      { role: 'assistant', content: result.content, tool_calls: result.toolCalls },
      { role: 'tool', content: 'next result', tool_call_id: 'call-fresh' }],
  };
  assert.equal(parseGatewayCompletionRequest(nextRequest, alias, toolProfile).messages.length, 6);
  rejected(() => validateGatewayCompletionResult(toolCompletion(), expected, nextRequest, toolProfile));
});
