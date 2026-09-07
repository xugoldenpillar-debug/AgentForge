import { AppError, ERROR_CODES } from '../../../shared/errors.ts';

export type ControlledStreamChunk =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_call'; id: string; name: string; args: Record<string, unknown> }
  | { type: 'usage'; inputTokens: number; outputTokens: number }
  | { type: 'aborted' };

export type ControlledStreamFn = (
  model: unknown,
  context: unknown,
  options?: { signal?: AbortSignal }
) => AsyncIterable<ControlledStreamChunk> | Promise<AsyncIterable<ControlledStreamChunk>>;

export type FakeStreamHold = {
  notifyStarted: () => void;
  wait: Promise<void>;
};

export type FakeStreamTurn =
  | {
      type: 'text';
      text: string;
      usage?: { inputTokens: number; outputTokens: number };
      delayMs?: number;
      hold?: FakeStreamHold;
    }
  | {
      type: 'tool_call';
      name: string;
      args: Record<string, unknown>;
      id?: string;
      usage?: { inputTokens: number; outputTokens: number };
      delayMs?: number;
      hold?: FakeStreamHold;
    }
  | {
      type: 'tool_calls';
      calls: Array<{ name: string; args: Record<string, unknown>; id?: string }>;
      usage?: { inputTokens: number; outputTokens: number };
      delayMs?: number;
      hold?: FakeStreamHold;
    }
  | {
      type: 'abort';
      delayMs?: number;
      hold?: FakeStreamHold;
    }
  | {
      type: 'missing_usage';
      text?: string;
      delayMs?: number;
      hold?: FakeStreamHold;
    }
  | {
      type: 'oversized';
      chars: number;
      usage?: { inputTokens: number; outputTokens: number };
      delayMs?: number;
      hold?: FakeStreamHold;
    };

export type FakeStreamFn = ControlledStreamFn & {
  turnCount(): number;
};

function unavailable(): never {
  throw new AppError(
    'This runtime is not available in the current environment.',
    503,
    ERROR_CODES.RUNTIME_UNAVAILABLE
  );
}

export { createBridgeAStreamFn, type BridgeAConfig, type BridgeAWire } from './bridge-a.ts';

export function createBridgeBStreamFn(): ControlledStreamFn {
  unavailable();
}

async function wait(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  await new Promise<void>((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function applyHold(turn: FakeStreamTurn, signal?: AbortSignal): Promise<void> {
  if (turn.delayMs) await wait(turn.delayMs, signal);
  if (!turn.hold) return;
  turn.hold.notifyStarted();
  if (signal?.aborted) return;
  await Promise.race([
    turn.hold.wait,
    new Promise<void>((resolve) => {
      if (!signal) return;
      if (signal.aborted) {
        resolve();
        return;
      }
      signal.addEventListener('abort', () => resolve(), { once: true });
    })
  ]);
}

function usageChunk(
  usage: { inputTokens: number; outputTokens: number } | undefined
): ControlledStreamChunk | undefined {
  if (!usage) return undefined;
  return { type: 'usage', inputTokens: usage.inputTokens, outputTokens: usage.outputTokens };
}

async function* chunksForTurn(
  turn: FakeStreamTurn,
  index: number,
  signal?: AbortSignal
): AsyncGenerator<ControlledStreamChunk> {
  await applyHold(turn, signal);
  if (signal?.aborted || turn.type === 'abort') {
    yield { type: 'aborted' };
    return;
  }
  if (turn.type === 'text') {
    yield { type: 'text_delta', text: turn.text };
    const usage = usageChunk(turn.usage);
    if (usage) yield usage;
    return;
  }
  if (turn.type === 'missing_usage') {
    yield { type: 'text_delta', text: turn.text ?? '' };
    return;
  }
  if (turn.type === 'oversized') {
    yield { type: 'text_delta', text: 'x'.repeat(Math.max(0, turn.chars)) };
    const usage = usageChunk(turn.usage);
    if (usage) yield usage;
    return;
  }
  if (turn.type === 'tool_call') {
    yield {
      type: 'tool_call',
      id: turn.id ?? `tool-${index}-0`,
      name: turn.name,
      args: turn.args
    };
    const usage = usageChunk(turn.usage);
    if (usage) yield usage;
    return;
  }
  let callIndex = 0;
  for (const call of turn.calls) {
    yield {
      type: 'tool_call',
      id: call.id ?? `tool-${index}-${callIndex}`,
      name: call.name,
      args: call.args
    };
    callIndex += 1;
  }
  const usage = usageChunk(turn.usage);
  if (usage) yield usage;
}

export function createFakeStreamFn(script: readonly FakeStreamTurn[]): FakeStreamFn {
  let turnCount = 0;
  const streamFn: FakeStreamFn = async function fakeStreamFn(
    _model,
    _context,
    options
  ) {
    const index = turnCount;
    turnCount += 1;
    const turn = script[index];
    if (!turn) {
      throw new AppError(
        'This runtime is not available in the current environment.',
        503,
        ERROR_CODES.RUNTIME_UNAVAILABLE
      );
    }
    return chunksForTurn(turn, index, options?.signal);
  };
  streamFn.turnCount = () => turnCount;
  return streamFn;
}
