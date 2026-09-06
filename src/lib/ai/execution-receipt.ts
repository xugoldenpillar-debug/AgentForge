import {
  deriveGatewayIdempotencyKey, hashGatewayIdempotencyKey,
  parseGatewayCapabilities, parseGatewayCompletion, parseGatewayCompletionHeaders,
  parseGatewayCompletionRequest, parseGatewayInvocationContext, parseGatewayIdempotencyStatus,
} from '../gateway-contract/index.ts';
import type {
  GatewayCapabilities, GatewayCompletion, GatewayCompletionHeaders,
  GatewayCompletionRequest, GatewayInvocationContext, GatewayReceipt, GatewayUsage, GatewayProfileCapabilities, GatewayToolCall,
} from '../gateway-contract/index.ts';
import { validateToolArguments } from '../gateway-contract/tools.ts';
import { identifier, integer, record, reject, uuid } from '../gateway-contract/validation.ts';

export interface ExecutionReceiptExpectation {
  requestId: string;
  profileAlias: string;
  gatewayConfigVersion: string;
  context: GatewayInvocationContext;
}

/** Safe to persist as audit metadata; never contains choices, prompts or headers. */
export interface ValidatedExecutionReceipt {
  requestId: string;
  profileAlias: string;
  context: GatewayInvocationContext;
  usage: GatewayUsage;
  receipt: GatewayReceipt;
}

function expectation(value: ExecutionReceiptExpectation): ExecutionReceiptExpectation {
  const object = record(value, ['requestId', 'profileAlias', 'gatewayConfigVersion', 'context']);
  return {
    requestId: uuid(object.requestId),
    profileAlias: identifier(object.profileAlias),
    gatewayConfigVersion: identifier(object.gatewayConfigVersion),
    context: parseGatewayInvocationContext(object.context),
  };
}

export function validateGatewayCapabilities(value: unknown, expected: ExecutionReceiptExpectation): GatewayCapabilities {
  const binding = expectation(expected);
  const capabilities = parseGatewayCapabilities(value);
  if (capabilities.gatewayConfigVersion !== binding.gatewayConfigVersion || !capabilities.profiles.includes(binding.profileAlias)) reject();
  return capabilities;
}

/** Bind independently parsed headers/body to the trusted frozen invocation. */
export function validateGatewayRequest(
  headers: unknown,
  body: unknown,
  expected: ExecutionReceiptExpectation,
  nowMs: number,
  capabilities?: GatewayProfileCapabilities,
): { headers: GatewayCompletionHeaders; body: GatewayCompletionRequest } {
  const binding = expectation(expected);
  const parsedHeaders = parseGatewayCompletionHeaders(headers, nowMs);
  const parsedBody = parseGatewayCompletionRequest(body, binding.profileAlias, capabilities);
  if (parsedHeaders['x-agentforge-request-id'] !== binding.requestId
    || parsedHeaders['x-agentforge-profile'] !== binding.profileAlias
    || parsedHeaders['x-agentforge-idempotency-key'] !== deriveGatewayIdempotencyKey(binding.context)) reject();
  return { headers: parsedHeaders, body: parsedBody };
}

function bindCompletion(completion: GatewayCompletion, binding: ExecutionReceiptExpectation): ValidatedExecutionReceipt {
  const receipt = completion.agentforge;
  if (completion.id !== binding.requestId
    || completion.model !== binding.profileAlias
    || receipt.profile_version !== binding.context.profileVersion
    || receipt.gateway_config_version !== binding.gatewayConfigVersion
    || receipt.idempotency_key_hash !== hashGatewayIdempotencyKey(deriveGatewayIdempotencyKey(binding.context))) reject();
  return {
    requestId: completion.id,
    profileAlias: completion.model,
    context: binding.context,
    usage: completion.usage,
    receipt,
  };
}

/** Receipt-only responses may be audited, but cannot resume workflow execution. */
export function validateExecutionReceipt(value: unknown, expected: ExecutionReceiptExpectation): ValidatedExecutionReceipt {
  return bindCompletion(parseGatewayCompletion(value), expectation(expected));
}

/** Normal execution requires an actual choice and enforces the sent output budget. */
export function validateGatewayExecutionResult(
  value: unknown,
  expected: ExecutionReceiptExpectation,
  maxOutputTokens: number,
): { text: string; finishReason: 'stop' | 'length'; executionReceipt: ValidatedExecutionReceipt } {
  const completion = parseGatewayCompletion(value);
  const executionReceipt = bindCompletion(completion, expectation(expected));
  const maximum = integer(maxOutputTokens);
  if (!maximum || completion.choices.length !== 1 || completion.usage.completion_tokens > maximum) reject();
  const choice = completion.choices[0]!;
  if (choice.finish_reason === 'tool_calls' || choice.message.tool_calls || choice.message.content === null) reject();
  return { text: choice.message.content, finishReason: choice.finish_reason, executionReceipt };
}

/** Tool-aware adapter boundary: validate against the exact request sent, not just
 * advertised capability. This returns instructions, and NEVER executes tools.
 */
export function validateGatewayCompletionResult(
  value: unknown,
  expected: ExecutionReceiptExpectation,
  sentRequest: unknown,
  capabilities: GatewayProfileCapabilities,
): {
  content: string | null;
  toolCalls: GatewayToolCall[];
  finishReason: 'stop' | 'length' | 'tool_calls';
  executionReceipt: ValidatedExecutionReceipt;
} {
  const binding = expectation(expected);
  const request = parseGatewayCompletionRequest(sentRequest, binding.profileAlias, capabilities);
  const completion = parseGatewayCompletion(value);
  const executionReceipt = bindCompletion(completion, binding);
  if (completion.choices.length !== 1 || completion.usage.completion_tokens > request.max_tokens) reject();
  const choice = completion.choices[0]!;
  const toolCalls = choice.message.tool_calls ?? [];
  const names = new Set((request.tools ?? []).map((tool) => tool.function.name));
  if (toolCalls.some((call) => !names.has(call.function.name))
    || (toolCalls.length && request.tool_choice === 'none')
    || (!toolCalls.length && request.tool_choice === 'required')) reject();
  const historicalCallIds = new Set(request.messages.flatMap((message) =>
    message.role === 'assistant' ? (message.tool_calls ?? []).map((call) => call.id) : []));
  for (const call of toolCalls) {
    if (historicalCallIds.has(call.id)) reject();
    const tool = request.tools?.find((candidate) => candidate.function.name === call.function.name);
    if (!tool) reject();
    validateToolArguments(call.function.arguments, tool.function.parameters);
  }
  if (request.response_format && !toolCalls.length) {
    if (choice.message.content === null) reject();
    let json: unknown;
    try {
      json = JSON.parse(choice.message.content) as unknown;
    } catch {
      reject();
    }
    if (json === null || typeof json !== 'object' || Array.isArray(json)) reject();
  }
  return { content: choice.message.content, toolCalls, finishReason: choice.finish_reason, executionReceipt };
}

/** Reconciliation is metadata-only and never grants permission to retry upstream. */
export function validateGatewayIdempotencyStatus(
  value: unknown,
  expected: ExecutionReceiptExpectation,
): ReturnType<typeof parseGatewayIdempotencyStatus> {
  const binding = expectation(expected);
  const status = parseGatewayIdempotencyStatus(value);
  if (status.request_id !== binding.requestId
    || status.idempotency_key_hash !== hashGatewayIdempotencyKey(deriveGatewayIdempotencyKey(binding.context))) reject();
  if ('execution' in status && status.execution) {
    bindCompletion({ ...status.execution, choices: [] }, binding);
  }
  return status;
}
