// Optional real-SDK suite: pnpm test:pi-runtime
// The .integration.ts suffix is excluded from the native tests/*.test.ts glob.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppError, ERROR_CODES } from '../src/shared/errors.ts';
import { executeSafeTool } from '../src/lib/ai/tools-core.ts';
import { createSerialRuntimeBudget } from '../src/lib/runtime/budget.ts';
import {
  createPiAdapterFromInstall,
  duckTypePiModule,
  loadPiCoreModule
} from '../src/server/runtime/pi/load.ts';
import {
  validatePiAgentTask,
  type AuthorizedRunContext
} from '../src/shared/runtime-contract.ts';
import {
  expectedVersion,
  PI_CORE_PACKAGE,
  PI_PLACEHOLDER_MODEL,
  type PiAgentLike,
  type PiAgentToolLike,
  type PiModule
} from '../src/server/runtime/pi/package.ts';
import { PI_DENIED_CODING_AGENT_TOOLS } from '../src/server/runtime/pi/policy.ts';
import { createFakeStreamFn } from '../src/server/runtime/pi/stream-fn.ts';
import { createCalculatorTool } from '../src/server/runtime/pi/tools.ts';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const UNAVAILABLE = ERROR_CODES.RUNTIME_UNAVAILABLE;
const ENABLED_ENV = { PI_RUNTIME_ENABLED: 'true' } as const;
const NODE_OK = '22.19.0';
const NODE_TOO_OLD = '22.16.0';

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

type PiProtocolStream = AsyncIterable<unknown> & {
  result: () => Promise<AssistantMessageLike>;
};

function source(relative: string): string {
  return readFileSync(join(here, relative), 'utf8');
}

function isModuleNotFound(error: unknown): boolean {
  if (!(error instanceof Error) || !('code' in error)) return false;
  const code = String((error as { code?: unknown }).code);
  return code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND';
}

function isPiCoreInstalled(): boolean {
  if (existsSync(join(repoRoot, 'node_modules', '@earendil-works', 'pi-agent-core', 'package.json'))) {
    return true;
  }
  try {
    createRequire(import.meta.url).resolve(PI_CORE_PACKAGE);
    return true;
  } catch (error) {
    if (isModuleNotFound(error)) return false;
    throw error;
  }
}

const installed = isPiCoreInstalled();
const required = process.env.PI_RUNTIME_REQUIRED === 'true';

function skipUnlessInstalled(t: { skip: (message?: string) => void }): boolean {
  if (installed) return false;
  if (required) {
    throw new Error(
      `${PI_CORE_PACKAGE} is required (PI_RUNTIME_REQUIRED=true) but is not installed`
    );
  }
  t.skip(
    `${PI_CORE_PACKAGE} is not installed; skipping real SDK tests. Set PI_RUNTIME_REQUIRED=true to fail instead of skip.`
  );
  return true;
}

function isUnavailable(error: unknown): boolean {
  return error instanceof AppError && error.code === UNAVAILABLE && error.status === 503;
}

function usage(input: number, output: number): AssistantUsage {
  return {
    input,
    output,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: input + output,
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

function textProtocolStream(text: string, tokenUsage = usage(3, 1)): PiProtocolStream {
  const pending = assistantMessage([], 'pending', usage(0, 0));
  const withText = assistantMessage([{ type: 'text', text }], 'pending', usage(0, 0));
  const done = assistantMessage([{ type: 'text', text }], 'stop', tokenUsage);
  return createProtocolStream([
    { type: 'start', partial: pending },
    { type: 'text_start', contentIndex: 0, partial: pending },
    { type: 'text_delta', contentIndex: 0, delta: text, partial: withText },
    { type: 'text_end', contentIndex: 0, content: text, partial: withText },
    { type: 'done', reason: 'stop', message: done }
  ], done);
}

function toolProtocolStream(
  id: string,
  name: string,
  args: Record<string, unknown>,
  tokenUsage = usage(4, 2)
): PiProtocolStream {
  const toolCall = { type: 'toolCall', id, name, arguments: args };
  const pending = assistantMessage([], 'pending', usage(0, 0));
  const withTool = assistantMessage([toolCall], 'pending', usage(0, 0));
  const done = assistantMessage([toolCall], 'toolUse', tokenUsage);
  return createProtocolStream([
    { type: 'start', partial: pending },
    { type: 'toolcall_start', contentIndex: 0, partial: withTool },
    { type: 'toolcall_end', contentIndex: 0, toolCall, partial: withTool },
    { type: 'done', reason: 'toolUse', message: done }
  ], done);
}

function abortedProtocolStream(): PiProtocolStream {
  const error = assistantMessage([], 'aborted', usage(0, 0), 'aborted');
  return createProtocolStream([
    { type: 'start', partial: error },
    { type: 'error', reason: 'aborted', error }
  ], error);
}

function createHold(): { notifyStarted: () => void; started: Promise<void>; wait: Promise<void>; release: () => void } {
  let notifyStarted = () => {};
  let releaseWait = () => {};
  const started = new Promise<void>((resolve) => {
    notifyStarted = resolve;
  });
  const wait = new Promise<void>((resolve) => {
    releaseWait = resolve;
  });
  return { notifyStarted, started, wait, release: () => releaseWait() };
}

function waitForAbort(signal?: AbortSignal): Promise<void> {
  if (!signal) return new Promise(() => {});
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    signal.addEventListener('abort', () => resolve(), { once: true });
  });
}

function calculatorTool(): PiAgentToolLike {
  return createCalculatorTool(createSerialRuntimeBudget({
    constraints: { tokenBudget: 10000, toolCallLimit: 5, maxCost: 1, maxLatencyMs: 30000 },
    maxToolCalls: 4,
    pricing: { inputPrice: 1, outputPrice: 1 }
  }));
}

class StubAgent {
  subscribe(): () => void {
    return () => {};
  }
  async prompt(): Promise<void> {}
  abort(): void {}
  async waitForIdle(): Promise<void> {}
}

function stubModule(): PiModule {
  return { Agent: StubAgent as unknown as PiModule['Agent'] };
}

test('load.ts stays fail-closed and never statically imports the Pi package', () => {
  const text = source('../src/server/runtime/pi/load.ts');
  assert.equal(/from ['"]@earendil-works\/pi-agent-core['"]/.test(text), false);
  assert.equal(/import\(['"]@earendil-works\/pi-agent-core['"]\)/.test(text), false);
  assert.equal(/from ['"]@mariozechner\//.test(text), false);
  assert.equal(text.includes('createModels'), false);
  assert.equal(text.includes('DefaultResourceLoader'), false);
  assert.equal(text.includes('createAgentSession'), false);
  assert.equal(text.includes('AGENTS.md'), false);
  assert.equal(text.includes('homedir'), false);
  assert.equal(/from ['"][^'"]*server\/service\.ts['"]/.test(text), false);
  assert.equal(/from ['"][^'"]*workflow\/engine/.test(text), false);
  assert.equal(text.includes('PI_CORE_PACKAGE'), true);
  assert.equal(/"@earendil-works\/pi-agent-core": "0\.85\.1"/.test(source('../package.json')), true);
  assert.equal(source('../package.json').includes('pi-coding-agent'), false);
});

test('native tests do not import the optional Pi loader', () => {
  for (const name of readdirSync(here)) {
    if (!name.endsWith('.test.ts')) continue;
    const text = readFileSync(join(here, name), 'utf8');
    assert.equal(text.includes('runtime/pi/load'), false, name);
    assert.equal(name.includes('pi-runtime.integration'), false);
  }
});

test('flag off and Node 22.16.0 refuse Pi before import', async () => {
  let imported = false;
  const importModule = async () => {
    imported = true;
    return stubModule();
  };

  await assert.rejects(
    () => loadPiCoreModule({ env: {}, nodeVersion: NODE_OK, importModule }),
    isUnavailable
  );
  await assert.rejects(
    () => loadPiCoreModule({
      env: { PI_RUNTIME_ENABLED: 'TRUE' },
      nodeVersion: NODE_OK,
      importModule
    }),
    isUnavailable
  );
  await assert.rejects(
    () => loadPiCoreModule({
      env: ENABLED_ENV,
      nodeVersion: NODE_TOO_OLD,
      importModule
    }),
    isUnavailable
  );
  assert.equal(imported, false);
});

test('import failure and invalid exports are RUNTIME_UNAVAILABLE', async () => {
  await assert.rejects(
    () => loadPiCoreModule({
      env: ENABLED_ENV,
      nodeVersion: NODE_OK,
      importModule: async () => {
        throw new Error('simulated missing package');
      }
    }),
    isUnavailable
  );
  await assert.rejects(
    () => loadPiCoreModule({
      env: ENABLED_ENV,
      nodeVersion: NODE_OK,
      importModule: async () => ({ createBashTool: () => {} })
    }),
    isUnavailable
  );
  assert.throws(() => duckTypePiModule({}), isUnavailable);
});

test('missing package dynamic import is RUNTIME_UNAVAILABLE', async (t) => {
  if (installed) {
    t.skip(`${PI_CORE_PACKAGE} is installed; import-miss path is covered by the injected importer`);
    return;
  }
  await assert.rejects(
    () => loadPiCoreModule({ env: ENABLED_ENV, nodeVersion: NODE_OK }),
    isUnavailable
  );
});

test('Bridge A/B and omitted streamFn stay RUNTIME_UNAVAILABLE', async () => {
  const loaded = stubModule();
  await assert.rejects(
    () => createPiAdapterFromInstall({
      env: ENABLED_ENV,
      nodeVersion: NODE_OK,
      importModule: async () => loaded,
      streamSource: 'bridge-a'
    }),
    isUnavailable
  );
  await assert.rejects(
    () => createPiAdapterFromInstall({
      env: ENABLED_ENV,
      nodeVersion: NODE_OK,
      importModule: async () => loaded,
      streamSource: 'bridge-b'
    }),
    isUnavailable
  );
  await assert.rejects(
    () => createPiAdapterFromInstall({
      env: ENABLED_ENV,
      nodeVersion: NODE_OK,
      importModule: async () => loaded
    }),
    isUnavailable
  );
});

test('injected streamFn wires a Pi adapter from a duck-typed Agent', async () => {
  const adapter = await createPiAdapterFromInstall({
    env: ENABLED_ENV,
    nodeVersion: NODE_OK,
    importModule: async (specifier) => {
      assert.equal(specifier, PI_CORE_PACKAGE);
      return stubModule();
    },
    streamFn: createFakeStreamFn([
      { type: 'text', text: 'ok', usage: { inputTokens: 1, outputTokens: 1 } }
    ])
  });
  assert.equal(adapter.kind, 'pi');
  assert.equal(adapter.corePackage, PI_CORE_PACKAGE);
  assert.equal(adapter.coreVersion, expectedVersion);
});

test('optional pi-agent-core is present when required', () => {
  if (required) {
    assert.equal(
      installed,
      true,
      `${PI_CORE_PACKAGE} is required (PI_RUNTIME_REQUIRED=true) but is not installed`
    );
  }
});

test('real Agent subscribe/prompt/tool loop uses calculator only', async (t) => {
  if (skipUnlessInstalled(t)) return;

  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    throw new Error('network is disabled in pi runtime integration tests');
  }) as typeof fetch;

  const previousHome = process.env.HOME;
  const tool = calculatorTool();
  let turn = 0;
  const loaded = await loadPiCoreModule({ env: ENABLED_ENV, nodeVersion: NODE_OK });
  const events: Array<{ type?: unknown }> = [];

  try {
    const agent: PiAgentLike = new loaded.Agent({
      initialState: {
        systemPrompt: 'Use the calculator.',
        model: PI_PLACEHOLDER_MODEL,
        tools: [tool],
        messages: []
      },
      streamFn: async (_model, _context, options) => {
        if (options?.signal?.aborted) return abortedProtocolStream();
        const index = turn;
        turn += 1;
        if (index === 0) {
          return toolProtocolStream('call-1', 'calculator', { expression: '2+3' });
        }
        if (index === 1) {
          return textProtocolStream('5', usage(5, 1));
        }
        throw new Error('unexpected extra model turn');
      },
      toolExecution: 'sequential'
    });

    const toolNames = (agent.state?.tools ?? []).map((entry) => entry.name);
    assert.deepEqual(toolNames, ['calculator']);
    for (const name of PI_DENIED_CODING_AGENT_TOOLS) {
      assert.equal(toolNames.includes(name), false);
    }

    const unsubscribe = agent.subscribe((event) => {
      events.push(event as { type?: unknown });
    });
    await agent.prompt('What is 2+3?');
    await agent.waitForIdle();
    unsubscribe();

    assert.equal(turn, 2);
    assert.equal(fetchCalls, 0);
    assert.equal(events.some((event) => event.type === 'agent_start'), true);
    assert.equal(events.some((event) => event.type === 'tool_execution_start'), true);
    assert.equal(events.some((event) => event.type === 'tool_execution_end'), true);
    assert.equal(events.some((event) => event.type === 'turn_end'), true);
    assert.equal(events.some((event) => event.type === 'agent_end'), true);
    assert.equal(JSON.stringify(events).toLowerCase().includes('flash'), false);

    const toolResult = (agent.state?.messages ?? []).find((message) => {
      return Boolean(
        message
        && typeof message === 'object'
        && 'role' in message
        && (message as { role?: unknown }).role === 'toolResult'
      );
    }) as { content?: Array<{ text?: string }>; toolName?: string } | undefined;
    assert.equal(toolResult?.toolName, 'calculator');
    assert.deepEqual(
      JSON.parse(toolResult?.content?.[0]?.text ?? ''),
      executeSafeTool('calculator', '2+3')
    );
  } finally {
    globalThis.fetch = originalFetch;
    process.env.HOME = previousHome;
  }
});

test('real Agent abort does not start another turn', async (t) => {
  if (skipUnlessInstalled(t)) return;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error('network is disabled in pi runtime integration tests');
  }) as typeof fetch;

  const hold = createHold();
  let turn = 0;
  const loaded = await loadPiCoreModule({ env: ENABLED_ENV, nodeVersion: NODE_OK });

  try {
    const agent: PiAgentLike = new loaded.Agent({
      initialState: {
        systemPrompt: 'Stop when asked.',
        model: PI_PLACEHOLDER_MODEL,
        tools: [calculatorTool()],
        messages: []
      },
      streamFn: async (_model, _context, options) => {
        const index = turn;
        turn += 1;
        if (index === 0) {
          hold.notifyStarted();
          await Promise.race([hold.wait, waitForAbort(options?.signal)]);
          if (options?.signal?.aborted) return abortedProtocolStream();
          return textProtocolStream('should-not-complete');
        }
        throw new Error('abort must not start another turn');
      }
    });

    const running = agent.prompt('abort me');
    await hold.started;
    agent.abort();
    hold.release();
    await running;
    await agent.waitForIdle();
    assert.equal(turn, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('real Agent plus wrapProtocol runs a fake calculator loop without network', async (t) => {
  if (skipUnlessInstalled(t)) return;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error('network is disabled in pi runtime integration tests');
  }) as typeof fetch;

  try {
    const adapter = await createPiAdapterFromInstall({
      env: ENABLED_ENV,
      nodeVersion: NODE_OK,
      wrapProtocol: true,
      streamFn: createFakeStreamFn([
        { type: 'tool_call', name: 'calculator', args: { expression: '1+1' }, usage: { inputTokens: 4, outputTokens: 2 } },
        { type: 'text', text: '2', usage: { inputTokens: 6, outputTokens: 1 } }
      ])
    });
    const events: Array<{ type: string }> = [];
    const context: AuthorizedRunContext = {
      runId: 'pi-wrap-1',
      identity: {
        runtime: 'pi',
        adapterVersion: 'poc-pi-v1',
        policyVersion: 'poc-t4-v1'
      },
      definition: {
        kind: 'pi',
        task: validatePiAgentTask({
          instructions: 'Use the calculator.',
          tools: ['calculator'],
          maxSteps: 4,
          maxToolCalls: 2
        })
      },
      input: '1+1',
      constraints: { tokenBudget: 10000, toolCallLimit: 5, maxCost: 1, maxLatencyMs: 30000 },
      signal: new AbortController().signal,
      model: { __opaque: 'model' },
      tools: { __opaque: 'tool' }
    };
    for await (const event of adapter.execute(context)) {
      events.push(event);
    }
    assert.equal(events[0]?.type, 'started');
    assert.equal(events.at(-1)?.type, 'completed');
    assert.equal(events.some((event) => event.type === 'tool_started'), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// These cases exercise the installed Agent's resolved prompt() failure path, not FakePiAgent.
test('installed SDK wrapProtocol preserves safe terminal failures offline', async (t) => {
  assert.equal(isPiCoreInstalled(), true, 'The pinned SDK must be installed for this regression gate.');
  const { buildPiSelfTestContext } = await import('../src/server/runtime/pi/self-test.ts');
  const cases = [
    { name: 'provider exception', code: ERROR_CODES.PROVIDER_REQUEST_FAILED,
      streamFn: async () => { throw new Error('private-provider-detail token=secret'); } },
    { name: 'structured exception', code: ERROR_CODES.PROVIDER_NETWORK_REJECTED,
      streamFn: async () => { throw new AppError('private-provider-detail token=secret', 502, ERROR_CODES.PROVIDER_NETWORK_REJECTED); } },
    { name: 'missing usage', code: ERROR_CODES.PROVIDER_RESPONSE_INVALID,
      streamFn: createFakeStreamFn([{ type: 'text', text: 'must not complete' }]) },
    { name: 'token budget', code: ERROR_CODES.BUDGET_EXCEEDED,
      streamFn: createFakeStreamFn([{ type: 'text', text: 'must not complete', usage: { inputTokens: 5000, outputTokens: 1 } }]) },
    { name: 'cost budget', code: ERROR_CODES.BUDGET_EXCEEDED,
      streamFn: createFakeStreamFn([{ type: 'text', text: 'must not complete', usage: { inputTokens: 10, outputTokens: 1 } }]), maxCost: 0 },
    { name: 'model step budget', code: ERROR_CODES.BUDGET_EXCEEDED,
      streamFn: createFakeStreamFn([
        { type: 'tool_call', name: 'calculator', args: { expression: '1+1' }, usage: { inputTokens: 1, outputTokens: 1 } },
        { type: 'text', text: 'must not complete', usage: { inputTokens: 1, outputTokens: 1 } }
      ]), maxSteps: 1 },
    { name: 'iterator exception', code: ERROR_CODES.PROVIDER_REQUEST_FAILED,
      streamFn: async function* () {
        yield { type: 'text_delta' as const, text: 'partial' };
        throw new Error('private-provider-detail token=secret');
      } },
    { name: 'abort chunk', code: null,
      streamFn: createFakeStreamFn([{ type: 'abort' }]) }
  ];
  let networkCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    networkCalls += 1;
    throw new Error('Network forbidden');
  };
  try {
    for (const scenario of cases) {
      await t.test(scenario.name, async () => {
        const adapter = await createPiAdapterFromInstall({
          env: ENABLED_ENV, nodeVersion: NODE_OK, wrapProtocol: true, streamFn: scenario.streamFn
        });
        const context = buildPiSelfTestContext('offline', new AbortController().signal);
        if (scenario.maxCost !== undefined) context.constraints.maxCost = scenario.maxCost;
        if (scenario.maxSteps !== undefined && context.definition.kind === 'pi') {
          context.definition.task.maxSteps = scenario.maxSteps;
        }
        const events = [];
        for await (const event of adapter.execute(context)) events.push(event);
        const terminal = events.filter((event) => ['completed', 'failed', 'cancelled'].includes(event.type));
        assert.equal(terminal.length, 1);
        assert.equal(terminal[0].type, scenario.code === null ? 'cancelled' : 'failed');
        if (terminal[0].type === 'failed') assert.equal(terminal[0].code, scenario.code);
        assert.equal(JSON.stringify(events).includes('private-provider-detail'), false);
        assert.equal(JSON.stringify(events).includes('token=secret'), false);
      });
    }
    assert.equal(networkCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('protocol wrapper never passes raw exception text into SDK messages', async () => {
  const { toPiProtocolStreamFn } = await import('../src/server/runtime/pi/protocol.ts');
  const stream = await toPiProtocolStreamFn(async () => {
    throw new AppError('private-provider-detail token=secret', 502, ERROR_CODES.PROVIDER_REQUEST_FAILED);
  })({}, {});
  const events = [];
  for await (const event of stream) events.push(event);
  const message = await stream.result();
  assert.equal(message.stopReason, 'error');
  assert.equal(JSON.stringify({ events, message }).includes('private-provider-detail'), false);
  assert.equal(JSON.stringify({ events, message }).includes('token=secret'), false);
});

test('failure metadata is out-of-band and cannot be forged by serializable message properties', async () => {
  const { toPiProtocolStreamFn, piProtocolFailure } = await import('../src/server/runtime/pi/protocol.ts');
  const stream = await toPiProtocolStreamFn(async () => {
    throw new AppError('private metadata', 400, ERROR_CODES.BUDGET_EXCEEDED);
  })({}, {});
  const message = await stream.result();
  assert.equal(piProtocolFailure(message).code, ERROR_CODES.BUDGET_EXCEEDED);
  assert.deepEqual(Reflect.ownKeys(message).sort(), [
    'api', 'content', 'errorMessage', 'model', 'provider', 'role', 'stopReason', 'timestamp', 'usage'
  ]);
  const serialized = JSON.stringify(message);
  assert.equal(serialized.includes(ERROR_CODES.BUDGET_EXCEEDED), false);
  assert.equal(serialized.includes('private metadata'), false);
  assert.equal(piProtocolFailure({ ...message, code: ERROR_CODES.BUDGET_EXCEEDED }).code,
    ERROR_CODES.PROVIDER_REQUEST_FAILED);
});

for (const reason of ['caller', 'timeout'] as const) {
  test(`installed SDK Bridge A ${reason} yields exactly one terminal event offline`, async (t) => {
    assert.equal(isPiCoreInstalled(), true);
    const { createBridgeAStreamFn } = await import('../src/server/runtime/pi/bridge-a.ts');
    const { buildPiSelfTestContext } = await import('../src/server/runtime/pi/self-test.ts');
    const controller = new AbortController();
    if (reason === 'timeout') {
      t.mock.method(AbortSignal, 'timeout', () => controller.signal);
    }
    let cancelled = 0;
    let modelCalls = 0;
    const response = new Response(new ReadableStream({
      pull() { queueMicrotask(() => controller.abort(new Error('private abort reason'))); },
      cancel() { cancelled += 1; }
    }, { highWaterMark: 0 }));
    const adapter = await createPiAdapterFromInstall({
      env: ENABLED_ENV, nodeVersion: NODE_OK, wrapProtocol: true,
      streamFn: createBridgeAStreamFn({
        apiKey: 'offline-dummy', baseUrl: 'https://api.deepseek.com',
        modelId: 'deepseek-v4-flash', maxTokens: 16,
        providerFetch: async () => { modelCalls += 1; return response; }
      })
    });
    const context = buildPiSelfTestContext('offline',
      reason === 'caller' ? controller.signal : new AbortController().signal);
    const events = [];
    for await (const event of adapter.execute(context)) events.push(event);
    const terminals = events.filter((event) => ['failed', 'cancelled', 'completed'].includes(event.type));
    assert.equal(terminals.length, 1);
    assert.equal(terminals[0].type, reason === 'caller' ? 'cancelled' : 'failed');
    if (terminals[0].type === 'failed') assert.equal(terminals[0].code, ERROR_CODES.PROVIDER_REQUEST_FAILED);
    assert.equal(events.at(-1), terminals[0]);
    assert.equal(JSON.stringify(events).includes('private abort reason'), false);
    assert.equal(modelCalls, 1);
    assert.equal(cancelled, 1);
    assert.equal(response.body?.locked, false);
  });
}
