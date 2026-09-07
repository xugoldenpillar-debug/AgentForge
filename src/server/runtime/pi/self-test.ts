import { AppError, ERROR_CODES, ensure } from '../../../shared/errors.ts';
import type { Credential } from '../../../shared/types.ts';
import type { AuthorizedRunContext, ExecutionIdentity } from '../../../shared/runtime-contract.ts';
import { POLICY_VERSION } from '../../../lib/runtime/versions.ts';
import { executeSafeTool } from '../../../lib/ai/tools-core.ts';
import {
  isPiInvited,
  resolvePiRuntimeGate,
  type PiAccess
} from '../../environment.ts';
import { expectedVersion } from './package.ts';
import { PiRuntimeAdapter } from './adapter.ts';
import { FakePiAgent } from './scripted-agent.ts';
import { createFakeStreamFn } from './stream-fn.ts';
import { createPiAdapterFromInstall } from './load.ts';

export type PiSelfTestStatus = {
  invited: boolean;
  applied: boolean;
  canRun: boolean;
  reason: 'ok' | 'not_invited' | 'flag_off' | 'node_engine' | 'accounting_unavailable';
};

export function piExecutionIdentity(): ExecutionIdentity {
  return {
    runtime: 'pi',
    adapterVersion: expectedVersion,
    policyVersion: POLICY_VERSION
  };
}

export function piSelfTestStatusFor(
  email: string,
  access: string | null | undefined,
  env: Record<string, string | undefined>,
  nodeVersion = process.version
): PiSelfTestStatus {
  const invited = isPiInvited(email, access, env);
  const applied = access === 'applied' || invited;
  const gate = resolvePiRuntimeGate(env, nodeVersion);
  if (!invited) {
    return { invited: false, applied, canRun: false, reason: 'not_invited' };
  }
  if (!gate.ok) {
    return { invited: true, applied: true, canRun: false, reason: gate.reason };
  }
  return { invited: true, applied: true, canRun: true, reason: 'ok' };
}

function expressionFromPrompt(prompt: string): string {
  const match = prompt.match(/[0-9]+(?:\s*[+\-*/]\s*[0-9]+)+/);
  return match ? match[0].replace(/\s+/g, '') : '2+3';
}

export async function createDemoPiAdapter(
  env: Record<string, string | undefined>
): Promise<PiRuntimeAdapter> {
  let turn = 0;
  return new PiRuntimeAdapter({
    env,
    createAgent: (options) => new FakePiAgent(options),
    streamFn: async (model, context, options) => {
      const record = context && typeof context === 'object'
        ? context as { messages?: Array<{ content?: unknown }> }
        : {};
      const last = record.messages?.at(-1);
      const prompt = typeof last?.content === 'string' ? last.content : '2+3';
      const expression = expressionFromPrompt(prompt);
      const value = executeSafeTool('calculator', expression) as { result: number };
      const index = turn;
      turn += 1;
      const script = index === 0
        ? [{
            type: 'tool_call' as const,
            name: 'calculator',
            args: { expression },
            usage: { inputTokens: 8, outputTokens: 4 }
          }]
        : [{
            type: 'text' as const,
            text: String(value.result),
            usage: { inputTokens: 12, outputTokens: 2 }
          }];
      return createFakeStreamFn(script)(model, context, options);
    }
  });
}

export async function createLivePiAdapter(args: {
  credential: Credential;
  apiKey: string;
  env: Record<string, string | undefined>;
}): Promise<PiRuntimeAdapter> {
  return createPiAdapterFromInstall({
    env: args.env,
    wrapProtocol: true,
    streamSource: 'bridge-a',
    bridge: {
      apiKey: args.apiKey,
      baseUrl: args.credential.baseUrl,
      modelId: args.credential.modelId,
      maxTokens: 128
    }
  });
}

export function assertPiSelfTestAllowed(status: PiSelfTestStatus): void {
  if (status.reason === 'not_invited') {
    throw new AppError(
      'Pi self-test is invite-only. Submit an access request first.',
      403,
      ERROR_CODES.RUNTIME_POLICY_DENIED
    );
  }
  if (!status.canRun) {
    throw new AppError(
      'This runtime is not available in the current environment.',
      503,
      ERROR_CODES.RUNTIME_UNAVAILABLE
    );
  }
}

export function nextPiAccess(current: string | null | undefined): PiAccess {
  if (current === 'invited') return 'invited';
  return 'applied';
}

export function buildPiSelfTestContext(prompt: string, signal: AbortSignal): AuthorizedRunContext {
  ensure(prompt.trim().length > 0, 'Pi tasks require instructions.', 400, ERROR_CODES.RUNTIME_POLICY_DENIED);
  return {
    runId: `pi-self-test`,
    identity: piExecutionIdentity(),
    definition: {
      kind: 'pi',
      task: {
        instructions: 'Use only the calculator tool. Reply with the numeric result.',
        tools: ['calculator'],
        maxSteps: 4,
        maxToolCalls: 2
      }
    },
    input: prompt.trim().slice(0, 2000),
    constraints: { tokenBudget: 4000, toolCallLimit: 2, maxCost: 0.05, maxLatencyMs: 30000 },
    signal,
    model: { __opaque: 'model' },
    tools: { __opaque: 'tool' }
  };
}
