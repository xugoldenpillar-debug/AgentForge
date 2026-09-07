import type { ProviderResolver } from '../ai/types.ts';
import { executeWorkflow, type ExecutionResult } from '../workflow/engine.ts';
import { AppError, ensure, ERROR_CODES } from '../../shared/errors.ts';
import type { Trace } from '../../shared/types.ts';
import {
  isDagRunDefinition,
  validateExecutionIdentity,
  validateRunDefinition,
  type AuthorizedRunContext,
  type ExecutionIdentity,
  type RuntimeAdapter,
  type RuntimeEvent
} from '../../shared/runtime-contract.ts';
import { DAG_ADAPTER_VERSION, POLICY_VERSION } from './versions.ts';

export interface DagRuntimeAdapterOptions {
  resolve: ProviderResolver;
  serverSystem?: string;
  onTrace?: (trace: Trace) => void;
}

const DAG_ONLY_MESSAGE = 'This adapter executes DAG workflows only.';

export function dagExecutionIdentity(): ExecutionIdentity {
  return {
    runtime: 'dag',
    adapterVersion: DAG_ADAPTER_VERSION,
    policyVersion: POLICY_VERSION
  };
}

function progressEvents(runId: string, traces: readonly Trace[], total: number): RuntimeEvent[] {
  let completed = 0;
  return traces.map((trace, index) => {
    if (trace.state === 'done' || trace.state === 'failed') completed += 1;
    const event: RuntimeEvent = {
      type: 'progress',
      runId,
      sequence: index + 1,
      completed,
      total
    };
    return event;
  });
}

export class DagRuntimeAdapter implements RuntimeAdapter {
  readonly kind = 'dag';
  readonly identity: ExecutionIdentity;
  private readonly options: DagRuntimeAdapterOptions;

  constructor(options: DagRuntimeAdapterOptions) {
    this.options = options;
    this.identity = Object.freeze(dagExecutionIdentity());
  }

  async *execute(context: AuthorizedRunContext): AsyncGenerator<RuntimeEvent, ExecutionResult> {
    const identity = validateExecutionIdentity(context.identity);
    ensure(identity.runtime === 'dag', DAG_ONLY_MESSAGE, 400, ERROR_CODES.RUNTIME_POLICY_DENIED);
    ensure(
      identity.adapterVersion === DAG_ADAPTER_VERSION,
      DAG_ONLY_MESSAGE,
      400,
      ERROR_CODES.RUNTIME_POLICY_DENIED
    );
    ensure(
      identity.policyVersion === POLICY_VERSION,
      DAG_ONLY_MESSAGE,
      400,
      ERROR_CODES.RUNTIME_POLICY_DENIED
    );

    const definition = validateRunDefinition(context.definition);
    if (!isDagRunDefinition(definition)) {
      throw new AppError(DAG_ONLY_MESSAGE, 400, ERROR_CODES.RUNTIME_POLICY_DENIED);
    }

    ensure(
      context.model.__opaque === 'model' && context.tools.__opaque === 'tool',
      'This run is not allowed by the current runtime policy.',
      400,
      ERROR_CODES.RUNTIME_POLICY_DENIED
    );

    const runId = context.runId;
    const total = definition.workflow.nodes.length;
    const traces: Trace[] = [];

    yield { type: 'started', runId, sequence: 0 };

    let result: ExecutionResult;
    try {
      result = await executeWorkflow({
        workflow: definition.workflow,
        input: context.input,
        constraints: context.constraints,
        resolve: this.options.resolve,
        serverSystem: this.options.serverSystem,
        signal: context.signal,
        onTrace: (trace) => {
          traces.push(trace);
          this.options.onTrace?.(trace);
        }
      });
    } catch (error) {
      for (const event of progressEvents(runId, traces, total)) yield event;
      throw error;
    }

    for (const event of progressEvents(runId, traces, total)) yield event;
    yield {
      type: 'completed',
      runId,
      sequence: traces.length + 1,
      output: result.text
    };
    return result;
  }
}

export async function executeDagAdapter(
  adapter: DagRuntimeAdapter,
  context: AuthorizedRunContext
): Promise<ExecutionResult> {
  const iterator = adapter.execute(context);
  let step = await iterator.next();
  while (!step.done) {
    step = await iterator.next();
  }
  return step.value;
}
