import { randomUUID } from 'node:crypto';
import { AppError, ERROR_CODES, ensure } from '../../shared/errors.ts';
import { ProviderResultUnknownError, type AIProvider, type AIResult } from '../../lib/ai/types.ts';
import type { SandboxHandle, SandboxProvider } from '../sandbox/types.ts';
import type { PiAgentLike, PiAgentOptionsLike, PiAgentToolLike, PiCreateAgent } from '../runtime/pi/package.ts';
import { PI_PLACEHOLDER_MODEL } from '../runtime/pi/package.ts';
import { toPiProtocolStreamFn } from '../runtime/pi/protocol.ts';
import type { ControlledStreamChunk, ControlledStreamFn } from '../runtime/pi/stream-fn.ts';

const WRITE_PARAMETERS = Object.freeze({
  type: 'object',
  properties: {
    path: { type: 'string' },
    content: { type: 'string' },
  },
  required: ['path', 'content'],
  additionalProperties: false,
});
const READ_PARAMETERS = Object.freeze({
  type: 'object',
  properties: { path: { type: 'string' } },
  required: ['path'],
  additionalProperties: false,
});

export interface CreationPiRunnerOptions {
  readonly createAgent: PiCreateAgent;
  readonly provider: AIProvider;
  readonly modelId: string;
  readonly sandbox: SandboxProvider;
  readonly sandboxHandle: SandboxHandle;
  readonly instructions: string;
  readonly brief: string;
  readonly skillInstructions?: readonly string[];
  readonly signal: AbortSignal;
  readonly assertAuthorized: () => Promise<void>;
  readonly maxTurns?: number;
  readonly maxTotalTokens?: number;
}

export interface CreationPiRunResult {
  readonly turns: number;
  readonly toolCalls: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly finalText: string;
}

type ModelAction =
  | { readonly kind: 'tool'; readonly name: 'artifact.write' | 'artifact.read'; readonly args: Record<string, unknown> }
  | { readonly kind: 'final'; readonly text: string };

function cancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new AppError('Run cancelled.', 499, ERROR_CODES.RUN_CANCELLED);
}

function preferredTerminalError(current: unknown, candidate: unknown): unknown {
  // A provider request with an unknown result must dominate deterministic local
  // failures. Pi can race one final provider dispatch with a tool-triggered
  // abort; treating that attempt as retry-safe could charge the user twice.
  if (candidate instanceof ProviderResultUnknownError) return candidate;
  return current ?? candidate;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stripFence(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu);
  return match ? match[1].trim() : trimmed;
}

function parseAction(text: string): ModelAction {
  const normalized = stripFence(text);
  if (/^(?:<!doctype\s+html|<html[\s>]|<svg[\s>])/iu.test(normalized)) {
    const content = /<html[\s>]|<!doctype\s+html/iu.test(normalized)
      ? normalized
      : `<!doctype html><html><head><meta charset="utf-8"><title>SVG animation</title></head><body>${normalized}</body></html>`;
    return { kind: 'tool', name: 'artifact.write', args: { path: 'index.html', content } };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(normalized);
  } catch {
    throw new AppError('The model returned an invalid Creation action.', 502, ERROR_CODES.PROVIDER_RESPONSE_INVALID);
  }
  ensure(record(parsed), 'The model returned an invalid Creation action.', 502, ERROR_CODES.PROVIDER_RESPONSE_INVALID);
  if (typeof parsed.final === 'string') return { kind: 'final', text: parsed.final.slice(0, 8_000) };
  const tool = parsed.tool;
  const args = parsed.arguments;
  ensure((tool === 'artifact.write' || tool === 'artifact.read') && record(args),
    'The model requested an unsupported Creation action.', 502, ERROR_CODES.PROVIDER_RESPONSE_INVALID);
  if (tool === 'artifact.write') {
    ensure(typeof args.path === 'string' && typeof args.content === 'string',
      'The model returned invalid artifact.write arguments.', 502, ERROR_CODES.PROVIDER_RESPONSE_INVALID);
  } else {
    ensure(typeof args.path === 'string', 'The model returned invalid artifact.read arguments.', 502, ERROR_CODES.PROVIDER_RESPONSE_INVALID);
  }
  return { kind: 'tool', name: tool, args };
}

function safeContext(context: unknown): string {
  let serialized = '';
  try { serialized = JSON.stringify(context); } catch { serialized = '[]'; }
  return serialized.length <= 48_000 ? serialized : serialized.slice(-48_000);
}

function systemPrompt(instructions: string, skills: readonly string[]): string {
  return [
    'You are the creation model inside AgentForge. You do not have shell, network, browser, or host filesystem access.',
    'Return exactly one JSON object per turn and no Markdown fencing.',
    'Allowed actions:',
    '{"tool":"artifact.write","arguments":{"path":"index.html","content":"..."}}',
    '{"tool":"artifact.read","arguments":{"path":"index.html"}}',
    '{"final":"short completion note"}',
    'You must create index.html. It must contain inline SVG and visible animation using only CSS keyframes or SVG declarative animation.',
    'Do not include scripts, event handlers, remote URLs, data URLs, iframe, object, embed, foreignObject, forms, or meta refresh.',
    'Write each output path at most once. README.md is optional.',
    instructions,
    ...skills.map((skill, index) => `Skill ${index + 1}: ${skill}`),
  ].join('\n');
}

async function readArtifactText(options: CreationPiRunnerOptions, path: string): Promise<string> {
  const snapshot = await options.sandbox.snapshot(options.sandboxHandle);
  const entry = snapshot.entries.find((candidate) => candidate.relativePath === path && candidate.kind === 'file');
  ensure(entry, 'Artifact file not found.', 404, ERROR_CODES.RESOURCE_NOT_FOUND);
  const file = await options.sandbox.readSnapshotFile(options.sandboxHandle, snapshot, path, Math.min(entry.bytes, 256 * 1024));
  return new TextDecoder('utf-8', { fatal: true }).decode(file.bytes);
}

function createTools(
  options: CreationPiRunnerOptions,
  onTool: () => void,
  onWriteSuccess: (path: string) => void,
  onError: (error: unknown) => void,
): PiAgentToolLike[] {
  const write: PiAgentToolLike = {
    name: 'artifact.write',
    label: 'Write artifact',
    description: 'Write one immutable file beneath the sandbox output directory.',
    parameters: WRITE_PARAMETERS,
    executionMode: 'sequential',
    execute: async (toolCallId, params, signal) => {
      try {
        cancelled(options.signal);
        if (signal?.aborted) cancelled(signal);
        ensure(record(params) && typeof params.path === 'string' && typeof params.content === 'string',
          'Invalid artifact.write arguments.', 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
        await options.assertAuthorized();
        onTool();
        const result = await options.sandbox.invoke(options.sandboxHandle, {
          toolId: 'artifact.write', versionId: 'artifact-write-v1', capability: 'write',
        }, { path: params.path, content: params.content }, toolCallId || randomUUID());
        onWriteSuccess(params.path);
        return { content: [{ type: 'text', text: JSON.stringify({
          written: params.path,
          bytes: result.outputBytes,
          digest: result.outputDigest,
        }) }] };
      } catch (error) {
        onError(error);
        throw error;
      }
    },
  };
  const read: PiAgentToolLike = {
    name: 'artifact.read',
    label: 'Read artifact',
    description: 'Read a previously written output file for verification.',
    parameters: READ_PARAMETERS,
    executionMode: 'sequential',
    execute: async (_toolCallId, params, signal) => {
      try {
        cancelled(options.signal);
        if (signal?.aborted) cancelled(signal);
        ensure(record(params) && typeof params.path === 'string', 'Invalid artifact.read arguments.', 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
        await options.assertAuthorized();
        onTool();
        const content = await readArtifactText(options, params.path);
        return { content: [{ type: 'text', text: content.slice(0, 256 * 1024) }] };
      } catch (error) {
        onError(error);
        throw error;
      }
    },
  };
  return [write, read];
}

export async function runCreationWithPi(options: CreationPiRunnerOptions): Promise<CreationPiRunResult> {
  const maxTurns = options.maxTurns ?? 12;
  const maxTotalTokens = options.maxTotalTokens ?? 32_768;
  let turns = 0;
  let toolCalls = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let finalText = '';
  let terminalError: unknown;
  let agent: PiAgentLike | undefined;
  let requiredOutputWritten = false;

  const controlled: ControlledStreamFn = async (_model, context, streamOptions) => {
    try {
      cancelled(options.signal);
      if (requiredOutputWritten) {
        finalText = 'index.html created.';
        async function* completion(): AsyncGenerator<ControlledStreamChunk> {
          yield { type: 'text_delta', text: finalText };
          yield { type: 'usage', inputTokens: 0, outputTokens: 0 };
        }
        return completion();
      }
      await options.assertAuthorized();
      turns += 1;
      ensure(turns <= maxTurns, 'Creation turn budget exceeded.', 429, ERROR_CODES.BUDGET_EXCEEDED);
      const combinedSignal = AbortSignal.any([options.signal, ...(streamOptions?.signal ? [streamOptions.signal] : [])]);
      const remaining = maxTotalTokens - inputTokens - outputTokens;
      ensure(remaining >= 256, 'Creation token budget exceeded.', 429, ERROR_CODES.BUDGET_EXCEEDED);
      const result: AIResult = await options.provider.execute({
        model: options.modelId,
        systemPrompt: systemPrompt(options.instructions, options.skillInstructions ?? []),
        userPrompt: `Creation brief:
${options.brief}

Current Pi conversation state:
${safeContext(context)}`,
        tools: [],
        maxTokens: Math.min(8_192, remaining),
        temperature: 0.4,
        remainingTokens: remaining,
        remainingToolCalls: Math.max(0, 64 - toolCalls),
        remainingCost: 1_000_000,
        signal: combinedSignal,
      });
      inputTokens += result.inputTokens;
      outputTokens += result.outputTokens;
      ensure(inputTokens + outputTokens <= maxTotalTokens, 'Creation token budget exceeded.', 429, ERROR_CODES.BUDGET_EXCEEDED);
      const action = parseAction(result.text);
      async function* chunks(): AsyncGenerator<ControlledStreamChunk> {
        if (action.kind === 'tool') {
          yield { type: 'tool_call', id: `creation-tool-${turns}`, name: action.name, args: action.args };
        } else {
          finalText = action.text;
          yield { type: 'text_delta', text: action.text };
        }
        yield { type: 'usage', inputTokens: result.inputTokens, outputTokens: result.outputTokens };
      }
      return chunks();
    } catch (error) {
      terminalError = preferredTerminalError(terminalError, error);
      throw error;
    }
  };

  const tools = createTools(options, () => { toolCalls += 1; }, (path) => {
    if (path === 'index.html') requiredOutputWritten = true;
  }, (error) => {
    terminalError = preferredTerminalError(terminalError, error);
    agent?.abort();
  });
  const agentOptions: PiAgentOptionsLike = {
    initialState: {
      systemPrompt: systemPrompt(options.instructions, options.skillInstructions ?? []),
      model: PI_PLACEHOLDER_MODEL,
      tools,
      messages: [],
    },
    streamFn: toPiProtocolStreamFn(controlled),
    beforeToolCall: ({ toolCall }) => {
      if (toolCall.name !== 'artifact.write' && toolCall.name !== 'artifact.read') {
        return { block: true, terminate: true, reason: 'Only artifact.read and artifact.write are allowed.' };
      }
      cancelled(options.signal);
    },
    toolExecution: 'sequential',
  };

  const onAbort = () => agent?.abort();
  options.signal.addEventListener('abort', onAbort, { once: true });
  try {
    cancelled(options.signal);
    agent = options.createAgent(agentOptions);
    await agent.prompt(options.brief);
    await agent.waitForIdle();
    if (terminalError) throw terminalError;
    cancelled(options.signal);
    return { turns, toolCalls, inputTokens, outputTokens, finalText };
  } finally {
    options.signal.removeEventListener('abort', onAbort);
  }
}
