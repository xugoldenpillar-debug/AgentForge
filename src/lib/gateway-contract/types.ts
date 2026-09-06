/** Version 1 is deliberately non-streaming, non-thinking with optional profile-gated JSON/tools. */
export interface GatewayHeaders {
  authorization: string;
  'x-agentforge-timestamp': string;
  'x-agentforge-request-id': string;
}

export interface GatewayCompletionHeaders extends GatewayHeaders {
  'x-agentforge-profile': string;
  'x-agentforge-idempotency-key': string;
  'content-type': 'application/json';
}

export interface GatewayCapabilities {
  protocolVersion: '1';
  gatewayConfigVersion: string;
  profiles: string[];
  supportsIdempotency: true;
  supportsResponseReplay: false;
  storesRawPrompts: false;
}

export interface GatewayToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export type GatewayMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: GatewayToolCall[] }
  | { role: 'tool'; content: string; tool_call_id: string };

/** Deliberately bounded JSON Schema subset; no references or remote resolution. */
export interface GatewayJsonSchema {
  type: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null';
  description?: string;
  properties?: Record<string, GatewayJsonSchema>;
  required?: string[];
  additionalProperties?: false;
  items?: GatewayJsonSchema;
  enum?: (string | number | boolean | null)[];
}

export interface GatewayTool {
  type: 'function';
  function: { name: string; description?: string; parameters: GatewayJsonSchema };
}

export interface GatewayProfileCapabilities {
  supportsTools: boolean;
  supportsJson: boolean;
  maxOutputTokens: number;
}

export interface GatewayCompletionRequest {
  model: string;
  messages: GatewayMessage[];
  temperature: 0;
  stream: false;
  max_tokens: number;
  thinking: { type: 'disabled' };
  tools?: GatewayTool[];
  tool_choice?: 'auto' | 'none' | 'required';
  response_format?: { type: 'json_object' };
}

export interface GatewayUsage {
  prompt_tokens: number;
  completion_tokens: number;
  reasoning_tokens?: 0;
  prompt_cache_hit_tokens: number;
  prompt_cache_miss_tokens: number;
}

export interface GatewayReceipt {
  protocol_version: '1';
  idempotency_key_hash: string;
  profile_version: string;
  gateway_config_version: string;
  upstream_provider: 'deepseek';
  upstream_model: 'deepseek-v4-flash';
  thinking_enabled: false;
  actual_cost_usd: number;
  upstream_latency_ms: number;
}

export interface GatewayCompletion {
  id: string;
  model: string;
  choices: {
    index: 0;
    message: { role: 'assistant'; content: string | null; tool_calls?: GatewayToolCall[] };
    finish_reason: 'stop' | 'length' | 'tool_calls';
  }[];
  usage: GatewayUsage;
  agentforge: GatewayReceipt;
}

/** Context only: never add prompts, case inputs, outputs or credentials here. */
export interface GatewayInvocationContext {
  runId: string;
  caseId: string;
  nodeId: string;
  invocationIndex: number;
  profileVersion: string;
  replicaIndex: number;
}

export const GATEWAY_ERROR_CODES = [
  'INVALID_REQUEST', 'UNAUTHORIZED', 'STALE_REQUEST', 'REPLAY_DETECTED',
  'UNKNOWN_PROFILE', 'PROFILE_CONFLICT', 'IDEMPOTENCY_CONFLICT',
  'REQUEST_PENDING', 'RESULT_UNAVAILABLE', 'BUDGET_EXCEEDED',
  'RATE_LIMITED', 'UPSTREAM_FAILURE', 'UPSTREAM_TIMEOUT',
  'PROTOCOL_MISMATCH', 'PAYLOAD_TOO_LARGE',
] as const;

export type GatewayErrorCode = typeof GATEWAY_ERROR_CODES[number];

/** No free-form message/details/cause: upstream errors may contain hidden inputs. */
export interface GatewayErrorResponse {
  error: { code: GatewayErrorCode; request_id: string };
}

/** Metadata only: this endpoint must never include choices or model output. */
export interface GatewayReceiptMetadata {
  id: string;
  model: string;
  usage: GatewayUsage;
  agentforge: GatewayReceipt;
}

export type GatewayIdempotencyStatus =
  | { status: 'pending'; request_id: string; idempotency_key_hash: string }
  | { status: 'completed'; request_id: string; idempotency_key_hash: string; execution: GatewayReceiptMetadata }
  | { status: 'failed'; request_id: string; idempotency_key_hash: string; error_code: GatewayErrorCode; execution?: GatewayReceiptMetadata };
