import { AppError, ERROR_CODES, ensure } from '../../../shared/errors.ts';
import {
  assertRuntimeEventCount,
  isPiRunDefinition,
  RUNTIME_EVENT_LIMITS,
  validatePiAgentTask,
  type AuthorizedRunContext,
  type RuntimeAdapter,
  type RuntimeEvent
} from '../../../shared/runtime-contract.ts';
import { createSerialRuntimeBudget } from '../../../lib/runtime/budget.ts';
import type { Pricing } from '../../../lib/scoring/index.ts';
import { resolvePiRuntimeGate, type PiRuntimeGate } from '../../environment.ts';
import {
  expectedVersion,
  PI_CORE_PACKAGE,
  PI_PLACEHOLDER_MODEL,
  type PiAgentLike,
  type PiAgentOptionsLike,
  type PiCreateAgent
} from './package.ts';
import type { ControlledStreamChunk, ControlledStreamFn } from './stream-fn.ts';
import { createCalculatorTool } from './tools.ts';
import { assertIsolatedPiOptions, assertToolAllowed } from './policy.ts';
import {
  boundRuntimeEvent,
  mapPiLikeEvent,
  toFailedRuntimeEvent,
  type PiEventMapState
} from './events.ts';

export type PiRuntimeGateFn = (
  env: Record<string, string | undefined>,
  nodeVersion: string
) => PiRuntimeGate;

export interface PiRuntimeAdapterOptions {
  createAgent: PiCreateAgent;
  streamFn: ControlledStreamFn;
  resolveGate?: PiRuntimeGateFn;
  env?: Record<string, string | undefined>;
  nodeVersion?: string;
  pricing?: Pricing;
  now?: () => number;
}

const UNAVAILABLE_MESSAGE = 'This runtime is not available in the current environment.';
const POLICY_MESSAGE = 'This run is not allowed by the current runtime policy.';
const DEFAULT_PRICING: Pricing = { inputPrice: 1, outputPrice: 1 };

function isCancel(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  return error instanceof AppError && error.code === ERROR_CODES.RUN_CANCELLED;
}

async function* observeUsage(
  inner: AsyncIterable<ControlledStreamChunk>,
  hooks: {
    signal?: AbortSignal;
    onUsage: (usage: { inputTokens: number; outputTokens: number }) => void;
    onMissing: () => void;
  }
): AsyncGenerator<ControlledStreamChunk> {
  let usage: { inputTokens: number; outputTokens: number } | undefined;
  for await (const chunk of inner) {
    if (chunk.type === 'usage') {
      usage = { inputTokens: chunk.inputTokens, outputTokens: chunk.outputTokens };
    }
    yield chunk;
    if (hooks.signal?.aborted || chunk.type === 'aborted') return;
  }
  if (hooks.signal?.aborted) return;
  if (!usage) {
    hooks.onMissing();
    return;
  }
  hooks.onUsage(usage);
}

export class PiRuntimeAdapter implements RuntimeAdapter {
  readonly kind = 'pi' as const;
  readonly corePackage = PI_CORE_PACKAGE;
  readonly coreVersion = expectedVersion;

  private readonly createAgent: PiCreateAgent;
  private readonly streamFn: ControlledStreamFn;
  private readonly resolveGate: PiRuntimeGateFn;
  private readonly env: Record<string, string | undefined>;
  private readonly nodeVersion: string;
  private readonly pricing: Pricing;
  private readonly now?: () => number;

  constructor(options: PiRuntimeAdapterOptions) {
    ensure(typeof options.createAgent === 'function', UNAVAILABLE_MESSAGE, 503, ERROR_CODES.RUNTIME_UNAVAILABLE);
    ensure(typeof options.streamFn === 'function', UNAVAILABLE_MESSAGE, 503, ERROR_CODES.RUNTIME_UNAVAILABLE);
    this.createAgent = options.createAgent;
    this.streamFn = options.streamFn;
    this.resolveGate = options.resolveGate ?? resolvePiRuntimeGate;
    this.env = options.env ?? { PI_RUNTIME_ENABLED: 'true' };
    this.nodeVersion = options.nodeVersion ?? process.version;
    this.pricing = options.pricing ?? DEFAULT_PRICING;
    this.now = options.now;
  }

  private assertAvailable(): void {
    const gate = this.resolveGate(this.env, this.nodeVersion);
    if (!gate.ok) {
      throw new AppError(UNAVAILABLE_MESSAGE, 503, ERROR_CODES.RUNTIME_UNAVAILABLE);
    }
  }

  async *execute(context: AuthorizedRunContext): AsyncIterable<RuntimeEvent> {
    this.assertAvailable();
    ensure(context.identity.runtime === 'pi', POLICY_MESSAGE, 400, ERROR_CODES.RUNTIME_POLICY_DENIED);
    if (!isPiRunDefinition(context.definition)) {
      throw new AppError(POLICY_MESSAGE, 400, ERROR_CODES.RUNTIME_POLICY_DENIED);
    }
    const task = validatePiAgentTask(context.definition.task);

    const events: RuntimeEvent[] = [];
    const state: PiEventMapState = {
      runId: context.runId,
      sequence: 0,
      maxSteps: task.maxSteps,
      turnsCompleted: 0,
      output: ''
    };
    let terminal = false;
    let agent: PiAgentLike | undefined;

    const push = (event: RuntimeEvent): void => {
      if (terminal) return;
      try {
        assertRuntimeEventCount(events.length + 1);
      } catch (error) {
        terminal = true;
        events.push(toFailedRuntimeEvent(error, context.runId, state.sequence++));
        agent?.abort();
        return;
      }
      const bounded = boundRuntimeEvent(event);
      events.push(bounded);
      if (bounded.type === 'failed' || bounded.type === 'completed' || bounded.type === 'cancelled') {
        terminal = true;
        if (bounded.type !== 'completed') agent?.abort();
      }
    };

    push({ type: 'started', runId: context.runId, sequence: state.sequence++ });

    const budget = createSerialRuntimeBudget({
      constraints: context.constraints,
      maxToolCalls: Math.min(task.maxToolCalls, context.constraints.toolCallLimit),
      pricing: this.pricing,
      now: this.now
    });
    const tools = task.tools.includes('calculator') ? [createCalculatorTool(budget)] : [];
    const guardedStreamFn: ControlledStreamFn = async (model, streamContext, options) => {
      budget.assertCanStartModelStep(task.maxSteps);
      budget.beginModelStep();
      const inner = await this.streamFn(model, streamContext, options);
      return observeUsage(inner, {
        signal: options?.signal,
        onUsage: (usage) => {
          budget.consumeUsage(usage.inputTokens, usage.outputTokens);
          push({
            type: 'usage',
            runId: context.runId,
            sequence: state.sequence++,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens
          });
        },
        onMissing: () => budget.rejectMissingUsage()
      });
    };

    const agentOptions: PiAgentOptionsLike = {
      initialState: {
        systemPrompt: task.instructions,
        model: PI_PLACEHOLDER_MODEL,
        tools,
        messages: []
      },
      streamFn: guardedStreamFn,
      beforeToolCall: ({ toolCall }) => {
        assertToolAllowed(toolCall.name);
        budget.reserveToolCall(toolCall.id);
      },
      toolExecution: 'sequential'
    };
    assertIsolatedPiOptions(agentOptions);

    const onAbort = () => agent?.abort();
    try {
      agent = this.createAgent(agentOptions);
      if (context.signal.aborted) {
        agent.abort();
        push({ type: 'cancelled', runId: context.runId, sequence: state.sequence++ });
      } else {
        context.signal.addEventListener('abort', onAbort);
        agent.subscribe((rawEvent) => {
          const mapped = mapPiLikeEvent(rawEvent, state);
          if (mapped) push(mapped);
        });
        await agent.prompt(context.input);
        await agent.waitForIdle();
        if (context.signal.aborted) {
          push({ type: 'cancelled', runId: context.runId, sequence: state.sequence++ });
        } else {
          const output = state.output.length > RUNTIME_EVENT_LIMITS.maxOutputChars
            ? state.output.slice(0, RUNTIME_EVENT_LIMITS.maxOutputChars)
            : state.output;
          push({
            type: 'completed',
            runId: context.runId,
            sequence: state.sequence++,
            output
          });
        }
      }
    } catch (error) {
      if (isCancel(error, context.signal)) {
        push({ type: 'cancelled', runId: context.runId, sequence: state.sequence++ });
      } else {
        push(toFailedRuntimeEvent(error, context.runId, state.sequence++));
      }
    } finally {
      context.signal.removeEventListener('abort', onAbort);
    }

    for (const event of events) yield event;
  }
}
