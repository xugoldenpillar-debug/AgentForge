import { createHash } from 'node:crypto';
import type {
  GatewayCapabilities, GatewayCompletion, GatewayCompletionHeaders,
  GatewayCompletionRequest, GatewayErrorResponse, GatewayHeaders,
  GatewayInvocationContext, GatewayReceipt, GatewayUsage, GatewayProfileCapabilities,
} from './types.ts';
import { parseMessage, parseTools, validateToolHistory } from './tools.ts';
import { GATEWAY_ERROR_CODES } from './types.ts';
import {
  bounded, digest, finite, GATEWAY_LIMITS, identifier, integer,
  list, literal, record, reject, text, uuid,
} from './validation.ts';

export * from './types.ts';
export { GatewayContractError, GATEWAY_LIMITS, parseGatewayJson } from './validation.ts';

const headerKeys = ['authorization', 'x-agentforge-timestamp', 'x-agentforge-request-id'];

function baseHeaders(value: Record<string, unknown>, nowMs: number): GatewayHeaders {
  const authorization = text(value.authorization, 4_103);
  if (!/^Bearer [A-Za-z0-9._~+/-]+={0,2}$/.test(authorization)) reject('UNAUTHORIZED');
  const timestamp = text(value['x-agentforge-timestamp'], 16);
  if (!/^(0|[1-9][0-9]*)$/.test(timestamp)) reject('STALE_REQUEST');
  const time = integer(Number(timestamp));
  if (Math.abs(integer(nowMs) - time) > GATEWAY_LIMITS.timestampSkewMs) reject('STALE_REQUEST');
  return {
    authorization,
    'x-agentforge-timestamp': timestamp,
    'x-agentforge-request-id': uuid(value['x-agentforge-request-id']),
  };
}

/** Input is the explicit lowercase protocol-header projection, not all HTTP headers.
 * HTTP adapters must reject duplicate protocol headers before projecting them.
 * Freshness is checked here; replay uniqueness requires a gateway-side store.
 */
export function parseGatewayHeaders(value: unknown, nowMs: number): GatewayHeaders {
  return baseHeaders(record(value, headerKeys), nowMs);
}

export function parseGatewayCompletionHeaders(value: unknown, nowMs: number): GatewayCompletionHeaders {
  const object = record(value, [...headerKeys, 'x-agentforge-profile', 'x-agentforge-idempotency-key', 'content-type']);
  return {
    ...baseHeaders(object, nowMs),
    'x-agentforge-profile': identifier(object['x-agentforge-profile']),
    'x-agentforge-idempotency-key': digest(object['x-agentforge-idempotency-key']),
    'content-type': literal(object['content-type'], 'application/json'),
  };
}

export function parseGatewayCapabilities(value: unknown): GatewayCapabilities {
  const object = record(value, ['protocolVersion', 'gatewayConfigVersion', 'profiles', 'supportsIdempotency', 'supportsResponseReplay', 'storesRawPrompts']);
  const profiles = list(object.profiles, GATEWAY_LIMITS.profiles).map(identifier);
  if (!profiles.length || new Set(profiles).size !== profiles.length) reject();
  return {
    protocolVersion: literal(object.protocolVersion, '1'),
    gatewayConfigVersion: identifier(object.gatewayConfigVersion),
    profiles,
    supportsIdempotency: literal(object.supportsIdempotency, true),
    supportsResponseReplay: literal(object.supportsResponseReplay, false),
    storesRawPrompts: literal(object.storesRawPrompts, false),
  };
}

/** The caller supplies a frozen, trusted alias; discovery alone cannot authorize it. */
export function parseGatewayCompletionRequest(
  value: unknown,
  expectedProfileAlias: string,
  capabilities: GatewayProfileCapabilities = { supportsTools: false, supportsJson: false, maxOutputTokens: GATEWAY_LIMITS.maxOutputTokens },
): GatewayCompletionRequest {
  const object = record(value, ['model', 'messages', 'temperature', 'stream', 'max_tokens', 'thinking', 'tools', 'tool_choice', 'response_format'], ['tools', 'tool_choice', 'response_format']);
  const profile = parseGatewayProfileCapabilities(capabilities);
  const model = identifier(object.model);
  if (model !== identifier(expectedProfileAlias)) reject('UNKNOWN_PROFILE');
  const messages = list(object.messages, GATEWAY_LIMITS.messages).map(parseMessage);
  if (!messages.length || !messages.some((message) => message.role === 'user')) reject();
  const thinking = record(object.thinking, ['type']);
  const maxTokens = integer(object.max_tokens, profile.maxOutputTokens);
  if (!maxTokens) reject();
  const result: GatewayCompletionRequest = {
    model, messages,
    temperature: literal(object.temperature, 0),
    stream: literal(object.stream, false),
    max_tokens: maxTokens,
    thinking: { type: literal(thinking.type, 'disabled') },
  };
  if (Object.hasOwn(object, 'tools')) {
    if (!profile.supportsTools) reject('PROFILE_CONFLICT');
    result.tools = parseTools(object.tools);
  }
  if (Object.hasOwn(object, 'tool_choice')) {
    if (!result.tools || (object.tool_choice !== 'auto' && object.tool_choice !== 'none' && object.tool_choice !== 'required')) reject();
    result.tool_choice = object.tool_choice;
  }
  if (Object.hasOwn(object, 'response_format')) {
    if (!profile.supportsJson) reject('PROFILE_CONFLICT');
    const format = record(object.response_format, ['type']);
    result.response_format = { type: literal(format.type, 'json_object') };
  }
  validateToolHistory(messages, result.tools ?? []);
  return bounded(result);
}

export function parseGatewayUsage(value: unknown): GatewayUsage {
  const object = record(value, ['prompt_tokens', 'completion_tokens', 'reasoning_tokens', 'prompt_cache_hit_tokens', 'prompt_cache_miss_tokens'], ['reasoning_tokens']);
  const prompt = integer(object.prompt_tokens);
  const completion = integer(object.completion_tokens);
  const hit = integer(object.prompt_cache_hit_tokens);
  const miss = integer(object.prompt_cache_miss_tokens);
  // Subtraction avoids accepting a rounded overflowing hit+miss sum.
  if (hit > prompt || miss !== prompt - hit || completion > Number.MAX_SAFE_INTEGER - prompt) reject();
  const result: GatewayUsage = {
    prompt_tokens: prompt,
    completion_tokens: completion,
    prompt_cache_hit_tokens: hit,
    prompt_cache_miss_tokens: miss,
  };
  if (Object.hasOwn(object, 'reasoning_tokens')) {
    integer(object.reasoning_tokens, 0);
    result.reasoning_tokens = literal(object.reasoning_tokens, 0);
  }
  return result;
}

export function parseGatewayReceipt(value: unknown): GatewayReceipt {
  const object = record(value, [
    'protocol_version', 'idempotency_key_hash', 'profile_version', 'gateway_config_version',
    'upstream_provider', 'upstream_model', 'thinking_enabled', 'actual_cost_usd', 'upstream_latency_ms',
  ]);
  return {
    protocol_version: literal(object.protocol_version, '1'),
    idempotency_key_hash: digest(object.idempotency_key_hash),
    profile_version: identifier(object.profile_version),
    gateway_config_version: identifier(object.gateway_config_version),
    upstream_provider: literal(object.upstream_provider, 'deepseek'),
    upstream_model: literal(object.upstream_model, 'deepseek-v4-flash'),
    thinking_enabled: literal(object.thinking_enabled, false),
    actual_cost_usd: finite(object.actual_cost_usd),
    upstream_latency_ms: finite(object.upstream_latency_ms),
  };
}

export function parseGatewayCompletion(value: unknown): GatewayCompletion {
  const object = record(value, ['id', 'model', 'choices', 'usage', 'agentforge']);
  const choices = list(object.choices, 1).map((entry): GatewayCompletion['choices'][number] => {
    const choice = record(entry, ['index', 'message', 'finish_reason']);
    const message = parseMessage(choice.message);
    if (message.role !== 'assistant') reject();
    const finish = choice.finish_reason;
    if (finish !== 'stop' && finish !== 'length' && finish !== 'tool_calls') reject();
    if ((finish === 'tool_calls') !== Boolean(message.tool_calls)) reject();
    return { index: literal(choice.index, 0), message, finish_reason: finish };
  });
  // Empty choices are valid receipt-only reconciliation data, NOT a model result.
  return bounded({
    id: uuid(object.id),
    model: identifier(object.model),
    choices,
    usage: parseGatewayUsage(object.usage),
    agentforge: parseGatewayReceipt(object.agentforge),
  });
}

export function parseGatewayInvocationContext(value: unknown): GatewayInvocationContext {
  const object = record(value, ['runId', 'caseId', 'nodeId', 'invocationIndex', 'profileVersion', 'replicaIndex']);
  return {
    runId: identifier(object.runId),
    caseId: identifier(object.caseId),
    nodeId: identifier(object.nodeId),
    invocationIndex: integer(object.invocationIndex),
    profileVersion: identifier(object.profileVersion),
    replicaIndex: integer(object.replicaIndex),
  };
}

export function deriveGatewayIdempotencyKey(value: GatewayInvocationContext): string {
  const context = parseGatewayInvocationContext(value);
  // Fixed-position JSON with a domain/version prefix avoids delimiter collisions.
  return sha256(JSON.stringify([
    'agentforge.gateway.invocation.v1', context.runId, context.caseId, context.nodeId,
    context.invocationIndex, context.profileVersion, context.replicaIndex,
  ]));
}

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

/** Receipt hashes the exact transmitted idempotency key, not the original context. */
export function hashGatewayIdempotencyKey(key: string): string {
  return sha256(digest(key));
}

export function parseGatewayError(value: unknown): GatewayErrorResponse {
  const object = record(value, ['error']);
  const error = record(object.error, ['code', 'request_id']);
  const code = GATEWAY_ERROR_CODES.find((candidate) => candidate === error.code);
  if (!code) reject();
  return { error: { code, request_id: uuid(error.request_id) } };
}

export function parseGatewayProfileCapabilities(value: unknown): GatewayProfileCapabilities {
  const object = record(value, ['supportsTools', 'supportsJson', 'maxOutputTokens']);
  if (typeof object.supportsTools !== 'boolean' || typeof object.supportsJson !== 'boolean') reject();
  const maximum = integer(object.maxOutputTokens, GATEWAY_LIMITS.maxOutputTokens);
  if (!maximum) reject();
  return { supportsTools: object.supportsTools, supportsJson: object.supportsJson, maxOutputTokens: maximum };
}

/** Terminal status is explicit; metadata cannot be mistaken for a completion. */
export function parseGatewayIdempotencyStatus(value: unknown): import('./types.ts').GatewayIdempotencyStatus {
  const object = record(value, ['status', 'request_id', 'idempotency_key_hash', 'execution', 'error_code'], ['execution', 'error_code']);
  const requestId = uuid(object.request_id);
  const hash = digest(object.idempotency_key_hash);
  if (object.status !== 'pending' && object.status !== 'completed' && object.status !== 'failed') reject();
  if (object.status === 'pending') {
    if (Object.hasOwn(object, 'execution') || Object.hasOwn(object, 'error_code')) reject();
    return { status: 'pending', request_id: requestId, idempotency_key_hash: hash };
  }
  let execution: import('./types.ts').GatewayReceiptMetadata | undefined;
  if (Object.hasOwn(object, 'execution')) {
    const metadata = record(object.execution, ['id', 'model', 'usage', 'agentforge']);
    const parsed = parseGatewayCompletion({ ...metadata, choices: [] });
    if (parsed.id !== requestId || parsed.agentforge.idempotency_key_hash !== hash) reject();
    execution = { id: parsed.id, model: parsed.model, usage: parsed.usage, agentforge: parsed.agentforge };
  }
  if (object.status === 'completed') {
    if (!execution || Object.hasOwn(object, 'error_code')) reject();
    return { status: 'completed', request_id: requestId, idempotency_key_hash: hash, execution };
  }
  const code = GATEWAY_ERROR_CODES.find((candidate) => candidate === object.error_code);
  if (!code) reject();
  const result: import('./types.ts').GatewayIdempotencyStatus = {
    status: 'failed', request_id: requestId, idempotency_key_hash: hash, error_code: code,
  };
  if (execution) result.execution = execution;
  return result;
}
