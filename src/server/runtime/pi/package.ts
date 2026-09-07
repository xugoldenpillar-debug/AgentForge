export const PI_CORE_PACKAGE = '@earendil-works/pi-agent-core';
export const PI_MIN_NODE = '22.19.0';
export const expectedVersion = '0.85.1';

export const PI_PLACEHOLDER_MODEL = Object.freeze({
  id: 'unknown',
  api: 'unknown',
  provider: 'unknown'
});

export type PiToolExecutionMode = 'sequential' | 'parallel';

export type PiAgentToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  details?: Record<string, unknown>;
  terminate?: boolean;
};

export type PiAgentToolUpdateCallback = (partialResult: PiAgentToolResult) => void;

export type PiAgentToolLike = {
  name: string;
  label?: string;
  description?: string;
  parameters?: unknown;
  executionMode?: PiToolExecutionMode;
  execute: (
    toolCallId: string,
    params: unknown,
    signal?: AbortSignal,
    onUpdate?: PiAgentToolUpdateCallback
  ) => Promise<PiAgentToolResult>;
};

export type PiBeforeToolCallInput = {
  toolCall: { id: string; name: string };
  args: unknown;
  context?: unknown;
};

export type PiBeforeToolCallResult = {
  block?: boolean;
  reason?: string;
  terminate?: boolean;
};

export type PiBeforeToolCall = (
  input: PiBeforeToolCallInput
) => PiBeforeToolCallResult | void | Promise<PiBeforeToolCallResult | void>;

export type PiAgentStateLike = {
  systemPrompt?: string;
  model?: unknown;
  tools?: PiAgentToolLike[];
  messages?: unknown[];
};

export type PiAgentOptionsLike = {
  initialState?: PiAgentStateLike;
  streamFn?: unknown;
  beforeToolCall?: PiBeforeToolCall;
  afterToolCall?: unknown;
  toolExecution?: PiToolExecutionMode;
  shouldStopAfterTurn?: unknown;
  resourceLoader?: unknown;
  cwd?: unknown;
  sessionDir?: unknown;
  agentsFilesOverride?: unknown;
  getApiKey?: unknown;
};

export type PiAgentLike = {
  subscribe: (
    listener: (event: unknown, signal?: AbortSignal) => unknown
  ) => () => void;
  prompt: (input: unknown) => Promise<unknown>;
  abort: () => void;
  waitForIdle: () => Promise<void>;
  toolExecution?: PiToolExecutionMode;
  state?: PiAgentStateLike;
};

export type PiModule = {
  Agent: new (options: PiAgentOptionsLike) => PiAgentLike;
};

export type PiCreateAgent = (options: PiAgentOptionsLike) => PiAgentLike;
