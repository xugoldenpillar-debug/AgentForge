import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError, ERROR_CODES } from '../src/shared/errors.ts';
import type { AIProvider, AIRequest, AIResult } from '../src/lib/ai/types.ts';
import { runCreationWithPi } from '../src/server/creation/runner.ts';
import { InMemorySandboxProvider, type FrozenEnvironment } from '../src/server/sandbox/index.ts';
import { loadPiCoreModule } from '../src/server/runtime/pi/load.ts';

const environment: FrozenEnvironment = {
  environmentId: 'artifact-animation-sandbox-v1',
  environmentDigest: `sha256:${'1'.repeat(64)}`,
  imageDigest: `sha256:${'2'.repeat(64)}`,
  runtime: 'pi',
  policyVersion: 'artifact-animation-v1',
  networkPolicy: 'deny',
  limits: {
    maxEntries: 16,
    maxFileBytes: 4 * 1024 * 1024,
    maxOutputBytes: 16 * 1024 * 1024,
    maxInvocations: 64,
    maxInvocationArgsBytes: 1024 * 1024,
  },
};

const fence = {
  ownerId: 'user-creation',
  jobId: 'job-creation',
  attemptId: 'attempt-creation',
  fenceToken: 'fence-creation',
};

class ScriptedProvider implements AIProvider {
  readonly id = 'scripted-creation';
  readonly pricing = { inputPrice: null, outputPrice: null };
  readonly requests: AIRequest[] = [];
  private readonly replies: readonly string[];
  private readonly tokens: readonly { input: number; output: number }[];

  constructor(
    replies: readonly string[],
    tokens: readonly { input: number; output: number }[] = [],
  ) {
    this.replies = replies;
    this.tokens = tokens;
  }

  async execute(request: AIRequest): Promise<AIResult> {
    this.requests.push(request);
    const index = this.requests.length - 1;
    const reply = this.replies[index];
    if (reply === undefined) throw new Error('Unexpected model turn.');
    const token = this.tokens[index] ?? { input: 20, output: 20 };
    return {
      text: reply,
      inputTokens: token.input,
      outputTokens: token.output,
      reasoningTokens: 0,
      toolCalls: 0,
      latency: 1,
      cost: null,
      estimated: false,
    };
  }
}

async function createAgent() {
  const loaded = await loadPiCoreModule({ env: { PI_RUNTIME_ENABLED: 'true' }, nodeVersion: 'v22.19.0' });
  return (options: ConstructorParameters<typeof loaded.Agent>[0]) => new loaded.Agent(options);
}

async function fixture(provider: AIProvider, signal = new AbortController().signal) {
  const sandbox = new InMemorySandboxProvider();
  const handle = await sandbox.create(environment, fence);
  const result = await runCreationWithPi({
    createAgent: await createAgent(),
    provider,
    modelId: 'user-model',
    sandbox,
    sandboxHandle: handle,
    instructions: 'Create an accessible animation.',
    brief: '创建一个HTML，内容是SVG绘制一个鹈鹕骑自行车的2D动画。',
    skillInstructions: ['Use clear silhouettes.'],
    signal,
    assertAuthorized: async () => undefined,
  });
  return { sandbox, handle, result };
}

async function textFile(sandbox: InMemorySandboxProvider, handle: string, path: string): Promise<string> {
  const snapshot = await sandbox.snapshot(handle);
  const entry = snapshot.entries.find((candidate) => candidate.relativePath === path);
  assert.ok(entry);
  const file = await sandbox.readSnapshotFile(handle, snapshot, path, entry.bytes);
  return new TextDecoder().decode(file.bytes);
}

test('Creation Pi writes, reads, and finalizes index.html through the restricted artifact tools', async () => {
  const html = '<!doctype html><html><body><svg><animate attributeName="opacity" values="0;1" dur="1s" repeatCount="indefinite"/></svg></body></html>';
  const provider = new ScriptedProvider([
    JSON.stringify({ tool: 'artifact.write', arguments: { path: 'index.html', content: html } }),
    JSON.stringify({ tool: 'artifact.read', arguments: { path: 'index.html' } }),
    JSON.stringify({ final: 'done' }),
  ]);
  const { sandbox, handle, result } = await fixture(provider);
  assert.equal(await textFile(sandbox, handle, 'index.html'), html);
  assert.deepEqual({ turns: result.turns, toolCalls: result.toolCalls, finalText: result.finalText }, { turns: 3, toolCalls: 2, finalText: 'done' });
  assert.equal(provider.requests[0]?.tools.length, 0);
  assert.match(provider.requests[0]?.systemPrompt ?? '', /do not have shell, network, browser/i);
});

test('Creation Pi adapts direct HTML and direct SVG responses to index.html', async () => {
  const htmlProvider = new ScriptedProvider([
    '<!doctype html><html><body><svg><animate attributeName="x" values="0;1"/></svg></body></html>',
    '{"final":"html saved"}',
  ]);
  const htmlRun = await fixture(htmlProvider);
  assert.match(await textFile(htmlRun.sandbox, htmlRun.handle, 'index.html'), /<!doctype html>/i);

  const svgProvider = new ScriptedProvider([
    '<svg viewBox="0 0 10 10"><animate attributeName="opacity" values="0;1"/></svg>',
    '{"final":"svg saved"}',
  ]);
  const svgRun = await fixture(svgProvider);
  const wrapped = await textFile(svgRun.sandbox, svgRun.handle, 'index.html');
  assert.match(wrapped, /<!doctype html>/i);
  assert.match(wrapped, /<svg viewBox=/i);
});

test('Creation Pi rejects shell and unknown model actions', async () => {
  const provider = new ScriptedProvider([
    JSON.stringify({ tool: 'shell', arguments: { command: 'cat /etc/passwd' } }),
  ]);
  await assert.rejects(
    () => fixture(provider),
    (error: unknown) => error instanceof AppError && error.code === ERROR_CODES.PROVIDER_RESPONSE_INVALID,
  );
});

test('Creation Pi rejects a second write to the same immutable output path', async () => {
  const provider = new ScriptedProvider([
    JSON.stringify({ tool: 'artifact.write', arguments: { path: 'index.html', content: '<html><svg/></html>' } }),
    JSON.stringify({ tool: 'artifact.write', arguments: { path: 'index.html', content: '<html>changed</html>' } }),
  ]);
  await assert.rejects(
    () => fixture(provider),
    (error: unknown) => error instanceof AppError && error.code === ERROR_CODES.RUNTIME_POLICY_DENIED,
  );
});

test('Creation Pi enforces turn and token budgets', async () => {
  const sandbox = new InMemorySandboxProvider();
  const handle = await sandbox.create(environment, fence);
  const provider = new ScriptedProvider([
    JSON.stringify({ tool: 'artifact.read', arguments: { path: 'missing.html' } }),
  ]);
  const create = await createAgent();
  await assert.rejects(() => runCreationWithPi({
    createAgent: create, provider, modelId: 'm', sandbox, sandboxHandle: handle,
    instructions: '', brief: 'brief', signal: new AbortController().signal, assertAuthorized: async () => undefined,
    maxTurns: 0,
  }), (error: unknown) => error instanceof AppError && error.code === ERROR_CODES.BUDGET_EXCEEDED);

  const tokenProvider = new ScriptedProvider(['{"final":"too expensive"}'], [{ input: 200, output: 100 }]);
  await assert.rejects(() => runCreationWithPi({
    createAgent: create, provider: tokenProvider, modelId: 'm', sandbox, sandboxHandle: handle,
    instructions: '', brief: 'brief', signal: new AbortController().signal, assertAuthorized: async () => undefined,
    maxTotalTokens: 256,
  }), (error: unknown) => error instanceof AppError && error.code === ERROR_CODES.BUDGET_EXCEEDED);
});

test('Creation Pi observes cancellation and never sends an API key into model prompts or sandbox state', async () => {
  const secret = 'sk-user-secret-must-not-leak';
  const controller = new AbortController();
  const provider: AIProvider = {
    id: 'cancellable', pricing: { inputPrice: null, outputPrice: null },
    async execute(request) {
      assert.doesNotMatch(JSON.stringify(request), new RegExp(secret));
      controller.abort();
      throw new AppError('Run cancelled.', 499, ERROR_CODES.RUN_CANCELLED);
    },
  };
  await assert.rejects(() => fixture(provider, controller.signal), (error: unknown) => {
    assert.doesNotMatch(String(error), new RegExp(secret));
    return error instanceof AppError && error.code === ERROR_CODES.RUN_CANCELLED;
  });
});
