import { AppError, ERROR_CODES } from '../../../shared/errors.ts';
import type { ControlledStreamChunk, ControlledStreamFn } from './stream-fn.ts';

type AssistantUsage = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
};

type AssistantMessageLike = {
  role: 'assistant';
  content: unknown[];
  api: string;
  provider: string;
  model: string;
  usage: AssistantUsage;
  stopReason: string;
  errorMessage?: string;
  timestamp: number;
};

export type PiProtocolStream = AsyncIterable<unknown> & {
  result: () => Promise<AssistantMessageLike>;
};

// Metadata stays local to messages created by this bridge; SDK/provider text is never trusted.
const failures = new WeakMap<object, AppError>();
const FAILURE_MESSAGE = 'The model request could not be completed.';

export function piProtocolFailure(message: object): AppError {
  return failures.get(message) ?? new AppError(
    FAILURE_MESSAGE, 502, ERROR_CODES.PROVIDER_REQUEST_FAILED
  );
}

function emptyUsage(): AssistantUsage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
  };
}

function usageFromTokens(inputTokens: number, outputTokens: number): AssistantUsage {
  return {
    input: inputTokens,
    output: outputTokens,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: inputTokens + outputTokens,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
  };
}

function assistantMessage(
  content: unknown[],
  stopReason: string,
  tokenUsage: AssistantUsage,
  errorMessage?: string
): AssistantMessageLike {
  const message: AssistantMessageLike = {
    role: 'assistant',
    content,
    api: 'unknown',
    provider: 'unknown',
    model: 'unknown',
    usage: tokenUsage,
    stopReason,
    timestamp: Date.now()
  };
  if (errorMessage) message.errorMessage = errorMessage;
  return message;
}

function createProtocolStream(
  events: unknown[],
  finalMessage: AssistantMessageLike
): PiProtocolStream {
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of events) yield event;
    },
    result: async () => finalMessage
  };
}

/**
 * Map the platform ControlledStreamFn onto the Pi Agent streamFn protocol.
 * Failures are encoded as protocol error events; the function itself does not throw.
 */
export function toPiProtocolStreamFn(streamFn: ControlledStreamFn): (
  model: unknown,
  context: unknown,
  options?: { signal?: AbortSignal }
) => Promise<PiProtocolStream> {
  return async (model, context, options) => {
    try {
      const events: unknown[] = [];
      const content: unknown[] = [];
      let text = '';
      let usage: AssistantUsage | undefined;
      let aborted = false;
      const pending = assistantMessage([], 'pending', emptyUsage());
      events.push({ type: 'start', partial: pending });

      for await (const chunk of await streamFn(model, context, options)) {
        if (chunk.type === 'aborted' || options?.signal?.aborted) {
          aborted = true;
          break;
        }
        if (chunk.type === 'text_delta') {
          const index = content.length;
          text += chunk.text;
          const withText = assistantMessage([{ type: 'text', text }], 'pending', emptyUsage());
          events.push({ type: 'text_start', contentIndex: index, partial: pending });
          events.push({
            type: 'text_delta',
            contentIndex: index,
            delta: chunk.text,
            partial: withText
          });
          events.push({
            type: 'text_end',
            contentIndex: index,
            content: chunk.text,
            partial: withText
          });
          content.push({ type: 'text', text: chunk.text });
        } else if (chunk.type === 'tool_call') {
          const index = content.length;
          const toolCall = { type: 'toolCall', id: chunk.id, name: chunk.name, arguments: chunk.args };
          const withTool = assistantMessage([...content, toolCall], 'pending', emptyUsage());
          events.push({ type: 'toolcall_start', contentIndex: index, partial: withTool });
          events.push({
            type: 'toolcall_end',
            contentIndex: index,
            toolCall,
            partial: withTool
          });
          content.push(toolCall);
        } else if (chunk.type === 'usage') {
          usage = usageFromTokens(chunk.inputTokens, chunk.outputTokens);
        }
      }

      if (aborted || options?.signal?.aborted) {
        const error = assistantMessage(content, 'aborted', usage ?? emptyUsage(), 'aborted');
        events.push({ type: 'error', reason: 'aborted', error });
        return createProtocolStream(events, error);
      }
      if (!usage) {
        const error = assistantMessage([], 'error', emptyUsage(), FAILURE_MESSAGE);
        failures.set(error, new AppError(FAILURE_MESSAGE, 502, ERROR_CODES.PROVIDER_RESPONSE_INVALID));
        events.push({ type: 'error', reason: 'error', error });
        return createProtocolStream(events, error);
      }
      const stopReason = content.some(
        (entry) => Boolean(entry && typeof entry === 'object' && (entry as { type?: unknown }).type === 'toolCall')
      ) ? 'toolUse' : 'stop';
      const done = assistantMessage(content, stopReason, usage);
      events.push({ type: 'done', reason: stopReason, message: done });
      return createProtocolStream(events, done);
    } catch (error) {
      const failed = assistantMessage([], 'error', emptyUsage(), FAILURE_MESSAGE);
      failures.set(failed, new AppError(
        FAILURE_MESSAGE,
        error instanceof AppError ? error.status : 502,
        error instanceof AppError && error.code ? error.code : ERROR_CODES.PROVIDER_REQUEST_FAILED
      ));
      return createProtocolStream([
        { type: 'start', partial: failed },
        { type: 'error', reason: 'error', error: failed }
      ], failed);
    }
  };
}
