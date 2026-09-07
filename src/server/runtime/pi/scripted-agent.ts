import { AppError, ERROR_CODES } from '../../../shared/errors.ts';
import type {
  PiAgentLike,
  PiAgentOptionsLike,
  PiAgentStateLike,
  PiAgentToolLike,
  PiAgentToolResult,
  PiBeforeToolCall,
  PiToolExecutionMode
} from './package.ts';
import type {
  ControlledStreamChunk,
  ControlledStreamFn
} from './stream-fn.ts';
import { denyUnknownTool } from './policy.ts';

export type FakePiAgentOptions = PiAgentOptionsLike & {
  delayListenersMs?: number;
  ignoreSequentialToolHint?: boolean;
};

type ToolCallChunk = Extract<ControlledStreamChunk, { type: 'tool_call' }>;

type Listener = (event: unknown, signal?: AbortSignal) => unknown;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function asStreamFn(value: unknown): ControlledStreamFn {
  if (typeof value !== 'function') {
    throw new AppError(
      'This runtime is not available in the current environment.',
      503,
      ERROR_CODES.RUNTIME_UNAVAILABLE
    );
  }
  return value as ControlledStreamFn;
}

/**
 * In-process Agent double for PI1/PI2 offline tests. Not a product API.
 */
export class FakePiAgent implements PiAgentLike {
  readonly state: Required<Pick<PiAgentStateLike, 'systemPrompt' | 'tools' | 'messages'>> & {
    model?: unknown;
  };
  toolExecution: PiToolExecutionMode;
  aborted = false;
  readonly startedToolNames: string[] = [];
  readonly executedToolNames: string[] = [];
  readonly blockedToolNames: string[] = [];
  readonly completedToolResults: PiAgentToolResult[] = [];
  maxInFlightToolExecutes = 0;
  private inFlightToolExecutes = 0;

  private readonly streamFn: ControlledStreamFn;
  private readonly beforeToolCall?: PiBeforeToolCall;
  private readonly delayListenersMs: number;
  private readonly ignoreSequentialToolHint: boolean;
  private readonly listeners: Listener[] = [];
  private readonly abortController = new AbortController();
  private running?: Promise<void>;
  private lastToolBatchAllBlocked = false;

  constructor(options: FakePiAgentOptions) {
    this.streamFn = asStreamFn(options.streamFn);
    this.beforeToolCall = options.beforeToolCall;
    this.toolExecution = options.toolExecution ?? 'parallel';
    this.delayListenersMs = options.delayListenersMs ?? 0;
    this.ignoreSequentialToolHint = options.ignoreSequentialToolHint === true;
    this.state = {
      systemPrompt: options.initialState?.systemPrompt ?? '',
      model: options.initialState?.model,
      tools: [...(options.initialState?.tools ?? [])],
      messages: [...(options.initialState?.messages ?? [])]
    };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index >= 0) this.listeners.splice(index, 1);
    };
  }

  async prompt(input: unknown): Promise<void> {
    const text = typeof input === 'string' ? input : '';
    this.state.messages.push({ role: 'user', content: text, timestamp: Date.now() });
    this.running = this.loop();
    try {
      await this.running;
    } finally {
      this.running = undefined;
    }
  }

  abort(): void {
    this.aborted = true;
    if (!this.abortController.signal.aborted) this.abortController.abort();
  }

  async waitForIdle(): Promise<void> {
    if (this.running) await this.running;
  }

  private async emit(event: unknown): Promise<void> {
    for (const listener of this.listeners) {
      const result = listener(event, this.abortController.signal);
      if (this.delayListenersMs > 0) await sleep(this.delayListenersMs);
      await result;
    }
  }

  private toolByName(name: string): PiAgentToolLike | undefined {
    return this.state.tools.find((tool) => tool.name === name);
  }

  private sequentialBatch(calls: ToolCallChunk[]): boolean {
    if (this.ignoreSequentialToolHint) return this.toolExecution === 'sequential';
    if (this.toolExecution === 'sequential') return true;
    return calls.some((call) => this.toolByName(call.name)?.executionMode === 'sequential');
  }

  private async runTool(call: ToolCallChunk): Promise<PiAgentToolResult> {
    this.inFlightToolExecutes += 1;
    this.maxInFlightToolExecutes = Math.max(this.maxInFlightToolExecutes, this.inFlightToolExecutes);
    this.executedToolNames.push(call.name);
    try {
      const tool = this.toolByName(call.name);
      if (!tool) denyUnknownTool(call.name);
      const result = await tool.execute(call.id, call.args, this.abortController.signal);
      this.completedToolResults.push(result);
      this.state.messages.push({
        role: 'toolResult',
        toolCallId: call.id,
        toolName: call.name,
        content: result.content
      });
      await this.emit({
        type: 'tool_execution_end',
        toolCallId: call.id,
        toolName: call.name,
        result,
        isError: false
      });
      return result;
    } finally {
      this.inFlightToolExecutes -= 1;
    }
  }

  private async executeToolCalls(calls: ToolCallChunk[]): Promise<void> {
    const allowed: ToolCallChunk[] = [];
    let blockedError: unknown;
    for (const call of calls) {
      this.startedToolNames.push(call.name);
      await this.emit({
        type: 'tool_execution_start',
        toolCallId: call.id,
        toolName: call.name,
        args: call.args
      });
      try {
        const decision = await this.beforeToolCall?.({
          toolCall: { id: call.id, name: call.name },
          args: call.args
        });
        if (decision?.block) {
          this.blockedToolNames.push(call.name);
          await this.emit({
            type: 'tool_execution_end',
            toolCallId: call.id,
            toolName: call.name,
            isError: true,
            result: { blocked: true, reason: decision.reason }
          });
          continue;
        }
        allowed.push(call);
      } catch (error) {
        this.blockedToolNames.push(call.name);
        blockedError = error;
        await this.emit({
          type: 'tool_execution_end',
          toolCallId: call.id,
          toolName: call.name,
          isError: true
        });
      }
    }

    if (this.sequentialBatch(allowed)) {
      for (const call of allowed) {
        if (this.aborted) break;
        await this.runTool(call);
      }
    } else {
      await Promise.all(allowed.map((call) => this.runTool(call)));
    }

    this.lastToolBatchAllBlocked = allowed.length === 0 && calls.length > 0;
    if (blockedError) throw blockedError;
  }

  private async loop(): Promise<void> {
    await this.emit({ type: 'agent_start' });
    try {
      while (!this.aborted) {
        await this.emit({ type: 'turn_start' });
        const stream = await this.streamFn(
          this.state.model,
          {
            systemPrompt: this.state.systemPrompt,
            messages: this.state.messages,
            tools: this.state.tools
          },
          { signal: this.abortController.signal }
        );
        let text = '';
        const toolCalls: ToolCallChunk[] = [];
        let usage: { inputTokens: number; outputTokens: number } | undefined;
        for await (const chunk of stream) {
          if (this.aborted || chunk.type === 'aborted') {
            this.aborted = true;
            break;
          }
          if (chunk.type === 'text_delta') text += chunk.text;
          if (chunk.type === 'tool_call') toolCalls.push(chunk);
          if (chunk.type === 'usage') {
            usage = { inputTokens: chunk.inputTokens, outputTokens: chunk.outputTokens };
          }
        }
        if (this.aborted) break;

        const assistant = {
          role: 'assistant',
          content: text,
          toolCalls,
          usage,
          timestamp: Date.now()
        };
        this.state.messages.push(assistant);
        await this.emit({ type: 'message_start', message: assistant });
        await this.emit({
          type: 'message_update',
          message: assistant,
          assistantMessageEvent: { type: 'text_delta', delta: text }
        });
        await this.emit({ type: 'message_end', message: assistant });

        if (toolCalls.length > 0) await this.executeToolCalls(toolCalls);
        await this.emit({ type: 'turn_end', message: assistant, toolResults: this.completedToolResults });
        if (toolCalls.length === 0 || this.lastToolBatchAllBlocked) break;
      }
    } finally {
      await this.emit({ type: 'agent_end', messages: this.state.messages });
    }
  }
}
