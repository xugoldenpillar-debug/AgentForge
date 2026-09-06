import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import fs from 'node:fs';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppError, ERROR_CODES } from '../src/shared/errors.ts';
import { starterWorkflow } from '../src/shared/catalog.ts';
import { executeSafeTool } from '../src/lib/ai/tools-core.ts';
import {
  RUNTIME_EVENT_LIMITS,
  RUNTIME_EVENT_TYPES,
  validateRuntimeEvent,
  type AuthorizedRunContext,
  type RuntimeEvent
} from '../src/shared/runtime-contract.ts';
import { resolvePiRuntimeGate } from '../src/server/environment.ts';
import { PiRuntimeAdapter } from '../src/server/runtime/pi/adapter.ts';
import {
  expectedVersion,
  PI_CORE_PACKAGE,
  PI_MIN_NODE
} from '../src/server/runtime/pi/package.ts';
import {
  createBridgeAStreamFn,
  createBridgeBStreamFn,
  createFakeStreamFn,
  type ControlledStreamFn,
  type FakeStreamHold
} from '../src/server/runtime/pi/stream-fn.ts';
import { CALCULATOR_TOOL_PARAMETERS } from '../src/server/runtime/pi/tools.ts';
import {
  assertToolAllowed,
  PI_DENIED_CODING_AGENT_TOOLS
} from '../src/server/runtime/pi/policy.ts';
import { FakePiAgent, type FakePiAgentOptions } from './helpers/fake-pi-agent.ts';
import type { PiAgentOptionsLike } from '../src/server/runtime/pi/package.ts';

const here = dirname(fileURLToPath(import.meta.url));

function source(relative: string): string {
  return readFileSync(join(here, relative), 'utf8');
}

function makeContext(overrides: Partial<AuthorizedRunContext> = {}): AuthorizedRunContext {
  const signal = overrides.signal ?? new AbortController().signal;
  return {
    runId: 'run-1',
    identity: {
      runtime: 'pi',
      adapterVersion: expectedVersion,
      policyVersion: 'pi-calculator-poc-1'
    },
    definition: {
      kind: 'pi',
      task: {
        instructions: 'Use the calculator to compute the answer.',
        tools: ['calculator'],
        maxSteps: 4,
        maxToolCalls: 4
      }
    },
    input: 'What is 2+3 then 10*2?',
    constraints: {
      tokenBudget: 10000,
      toolCallLimit: 5,
      maxCost: 1,
      maxLatencyMs: 30000
    },
    signal,
    model: { __opaque: 'model' },
    tools: { __opaque: 'tool' },
    ...overrides
  };
}

async function collect(iterable: AsyncIterable<RuntimeEvent>): Promise<RuntimeEvent[]> {
  const events: RuntimeEvent[] = [];
  for await (const event of iterable) events.push(event);
  return events;
}

function assertAllowlistedEvents(events: RuntimeEvent[]): void {
  const allowed = new Set<string>(RUNTIME_EVENT_TYPES);
  const serialized = JSON.stringify(events);
  assert.equal(serialized.includes('assistantMessageEvent'), false);
  assert.equal(serialized.includes('sk-'), false);
  for (const event of events) {
    assert.equal(allowed.has(event.type), true);
    assert.deepEqual(validateRuntimeEvent(event), event);
    assert.ok(Buffer.byteLength(JSON.stringify(event), 'utf8') <= RUNTIME_EVENT_LIMITS.maxEventBytes);
    assert.equal('assistantMessageEvent' in event, false);
    assert.equal('stack' in event, false);
    assert.equal('rawPiMessage' in event, false);
    assert.equal('content' in event, false);
  }
}

function createHold(): { hold: FakeStreamHold; started: Promise<void>; release: () => void } {
  let notifyStarted = () => {};
  let releaseWait = () => {};
  const started = new Promise<void>((resolve) => {
    notifyStarted = resolve;
  });
  const wait = new Promise<void>((resolve) => {
    releaseWait = resolve;
  });
  return {
    hold: {
      notifyStarted: () => notifyStarted(),
      wait
    },
    started,
    release: () => releaseWait()
  };
}

function createHarness(args: {
  streamFn: ControlledStreamFn;
  agentOptions?: Partial<FakePiAgentOptions>;
  env?: Record<string, string | undefined>;
  nodeVersion?: string;
  resolveGate?: typeof resolvePiRuntimeGate;
}): {
  adapter: PiRuntimeAdapter;
  agents: FakePiAgent[];
  lastOptions: () => PiAgentOptionsLike | undefined;
} {
  const agents: FakePiAgent[] = [];
  let lastOptions: PiAgentOptionsLike | undefined;
  const adapter = new PiRuntimeAdapter({
    env: args.env ?? { PI_RUNTIME_ENABLED: 'true' },
    nodeVersion: args.nodeVersion ?? '22.19.0',
    resolveGate: args.resolveGate ?? resolvePiRuntimeGate,
    streamFn: args.streamFn,
    createAgent: (opts) => {
      lastOptions = opts;
      const agent = new FakePiAgent({ ...opts, ...args.agentOptions });
      agents.push(agent);
      return agent;
    }
  });
  return { adapter, agents, lastOptions: () => lastOptions };
}

test('multi-turn calculator loop sums usage and matches executeSafeTool', async () => {
  const streamFn = createFakeStreamFn([
    {
      type: 'tool_call',
      name: 'calculator',
      args: { expression: '2+3' },
      usage: { inputTokens: 11, outputTokens: 4 }
    },
    {
      type: 'tool_call',
      name: 'calculator',
      args: { expression: '10*2' },
      usage: { inputTokens: 13, outputTokens: 5 }
    },
    { type: 'text', text: '20', usage: { inputTokens: 7, outputTokens: 2 } }
  ]);
  const { adapter, agents, lastOptions } = createHarness({ streamFn });
  const events = await collect(adapter.execute(makeContext()));
  assertAllowlistedEvents(events);
  assert.equal(adapter.kind, 'pi');
  assert.equal(adapter.coreVersion, '0.85.1');
  assert.equal(adapter.corePackage, PI_CORE_PACKAGE);
  assert.equal(expectedVersion, '0.85.1');
  assert.equal(PI_MIN_NODE, '22.19.0');

  const usage = events.filter((event) => event.type === 'usage');
  assert.equal(usage.length, 3);
  assert.equal(usage.reduce((sum, event) => sum + event.inputTokens, 0), 31);
  assert.equal(usage.reduce((sum, event) => sum + event.outputTokens, 0), 11);

  const completed = events.find((event) => event.type === 'completed');
  assert.ok(completed && completed.type === 'completed');
  assert.equal(completed.output, '20');

  const agent = agents[0];
  assert.ok(agent);
  assert.deepEqual(
    JSON.parse(agent.completedToolResults[0]?.content[0]?.text ?? ''),
    executeSafeTool('calculator', '2+3')
  );
  assert.deepEqual(
    JSON.parse(agent.completedToolResults[1]?.content[0]?.text ?? ''),
    executeSafeTool('calculator', '10*2')
  );
  assert.equal(lastOptions()?.initialState?.tools?.[0]?.executionMode, 'sequential');
  assert.deepEqual(
    lastOptions()?.initialState?.tools?.[0]?.parameters,
    CALCULATOR_TOOL_PARAMETERS
  );
});

test('events are allowlisted RuntimeEvents and strip assistantMessageEvent', async () => {
  const streamFn = createFakeStreamFn([
    { type: 'text', text: '4', usage: { inputTokens: 3, outputTokens: 1 } }
  ]);
  const { adapter } = createHarness({ streamFn });
  const events = await collect(adapter.execute(makeContext({ input: '2+2' })));
  assertAllowlistedEvents(events);
  assert.equal(events[0]?.type, 'started');
  assert.equal(events.some((event) => event.type === 'completed'), true);
  assert.equal(source('../src/server/runtime/pi/events.ts').includes('RunEvent'), false);
  assert.equal(source('../src/server/runtime/pi/adapter.ts').includes('RunEvent'), false);
});

test('unregistered tool names are denied before execute', async () => {
  const streamFn = createFakeStreamFn([
    {
      type: 'tool_call',
      name: 'web_search',
      args: { query: 'secret' },
      usage: { inputTokens: 4, outputTokens: 1 }
    }
  ]);
  const { adapter, agents } = createHarness({ streamFn });
  const events = await collect(adapter.execute(makeContext()));
  assertAllowlistedEvents(events);
  const failed = events.find((event) => event.type === 'failed');
  assert.ok(failed && failed.type === 'failed');
  assert.equal(failed.code, ERROR_CODES.RUNTIME_POLICY_DENIED);
  assert.equal(agents[0]?.executedToolNames.length, 0);
  assert.equal(agents[0]?.completedToolResults.length, 0);
});

test('parallel double tool-call with remainingToolCalls=1 blocks the second before execute', async () => {
  const streamFn = createFakeStreamFn([
    {
      type: 'tool_calls',
      calls: [
        { name: 'calculator', args: { expression: '1+1' } },
        { name: 'calculator', args: { expression: '9+9' } }
      ],
      usage: { inputTokens: 6, outputTokens: 2 }
    }
  ]);
  const { adapter, agents } = createHarness({
    streamFn,
    agentOptions: { toolExecution: 'parallel', ignoreSequentialToolHint: true }
  });
  const events = await collect(adapter.execute(makeContext({
    constraints: { tokenBudget: 10000, toolCallLimit: 1, maxCost: 1, maxLatencyMs: 30000 },
    definition: {
      kind: 'pi',
      task: {
        instructions: 'Add numbers.',
        tools: ['calculator'],
        maxSteps: 3,
        maxToolCalls: 1
      }
    }
  })));
  assertAllowlistedEvents(events);
  const agent = agents[0];
  assert.ok(agent);
  assert.equal(agent.startedToolNames.length, 2);
  assert.equal(agent.executedToolNames.length, 1);
  assert.equal(agent.completedToolResults.length, 1);
  assert.deepEqual(
    JSON.parse(agent.completedToolResults[0]?.content[0]?.text ?? ''),
    executeSafeTool('calculator', '1+1')
  );
  assert.equal(JSON.stringify(agent.completedToolResults).includes('18'), false);
  const failed = events.find((event) => event.type === 'failed');
  assert.ok(failed && failed.type === 'failed');
  assert.equal(failed.code, ERROR_CODES.BUDGET_EXCEEDED);
});

test('abort mid-stream yields cancelled and does not start another turn', async () => {
  const gate = createHold();
  const streamFn = createFakeStreamFn([
    {
      type: 'text',
      text: 'partial',
      usage: { inputTokens: 2, outputTokens: 1 },
      hold: gate.hold
    },
    { type: 'text', text: 'should-not-run', usage: { inputTokens: 2, outputTokens: 1 } }
  ]);
  const { adapter } = createHarness({ streamFn });
  const ac = new AbortController();
  const running = collect(adapter.execute(makeContext({ signal: ac.signal, input: 'abort me' })));
  await gate.started;
  ac.abort();
  gate.release();
  const events = await running;
  assertAllowlistedEvents(events);
  assert.equal(streamFn.turnCount(), 1);
  assert.equal(events.at(-1)?.type, 'cancelled');
  assert.equal(events.some((event) => event.type === 'completed'), false);
  assert.equal(JSON.stringify(events).includes('should-not-run'), false);
});

test('missing usage fails closed instead of zero-filling', async () => {
  const streamFn = createFakeStreamFn([
    { type: 'missing_usage', text: '4' }
  ]);
  const { adapter } = createHarness({ streamFn });
  const events = await collect(adapter.execute(makeContext({ input: '2+2' })));
  assertAllowlistedEvents(events);
  assert.equal(events.some((event) => event.type === 'usage'), false);
  const failed = events.find((event) => event.type === 'failed');
  assert.ok(failed && failed.type === 'failed');
  assert.equal(failed.code, ERROR_CODES.PROVIDER_RESPONSE_INVALID);
  assert.equal(events.some((event) => event.type === 'completed'), false);
});

test('oversized payloads are stripped or fail within event limits', async () => {
  const streamFn = createFakeStreamFn([
    {
      type: 'oversized',
      chars: 20000,
      usage: { inputTokens: 8, outputTokens: 40 }
    }
  ]);
  const { adapter } = createHarness({ streamFn });
  const events = await collect(adapter.execute(makeContext({ input: 'write a lot' })));
  assertAllowlistedEvents(events);
  const serialized = JSON.stringify(events);
  assert.equal(serialized.includes('x'.repeat(5000)), false);
  const terminal = events.at(-1);
  assert.ok(terminal && (terminal.type === 'completed' || terminal.type === 'failed'));
});

test('two concurrent execute calls do not share message state', async () => {
  const streamFn: ControlledStreamFn = async (_model, context) => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    const record = context as { messages?: Array<{ content?: unknown }> };
    const last = record.messages?.[record.messages.length - 1];
    const text = typeof last?.content === 'string' ? last.content : '';
    return (async function* () {
      yield { type: 'text_delta' as const, text: `out:${text}` };
      yield { type: 'usage' as const, inputTokens: 2, outputTokens: 2 };
    })();
  };
  const { adapter, agents } = createHarness({ streamFn });
  const [left, right] = await Promise.all([
    collect(adapter.execute(makeContext({ runId: 'run-a', input: 'alpha' }))),
    collect(adapter.execute(makeContext({ runId: 'run-b', input: 'beta' })))
  ]);
  assertAllowlistedEvents(left);
  assertAllowlistedEvents(right);
  assert.equal(agents.length, 2);
  assert.notEqual(agents[0]?.state.messages, agents[1]?.state.messages);
  const leftDump = JSON.stringify(agents[0]?.state.messages);
  const rightDump = JSON.stringify(agents[1]?.state.messages);
  assert.equal(leftDump.includes('alpha'), true);
  assert.equal(leftDump.includes('beta'), false);
  assert.equal(rightDump.includes('beta'), true);
  assert.equal(rightDump.includes('alpha'), false);
  const leftDone = left.find((event) => event.type === 'completed');
  const rightDone = right.find((event) => event.type === 'completed');
  assert.ok(leftDone && leftDone.type === 'completed');
  assert.ok(rightDone && rightDone.type === 'completed');
  assert.equal(leftDone.output, 'out:alpha');
  assert.equal(rightDone.output, 'out:beta');
});

test('adapter does not read HOME AGENTS.md or install a resource loader', async () => {
  const home = mkdtempSync(join(tmpdir(), 'pi-poc-home-'));
  mkdirSync(join(home, '.pi', 'agent'), { recursive: true });
  writeFileSync(join(home, 'AGENTS.md'), 'SECRET_HOST_CONTEXT');
  writeFileSync(join(home, '.pi', 'agent', 'AGENTS.md'), 'SECRET_HOST_CONTEXT');
  const reads: string[] = [];
  const track = (path: unknown) => {
    reads.push(String(path));
  };
  const original = {
    readFileSync: fs.readFileSync,
    readFile: fs.readFile,
    promisesReadFile: fs.promises.readFile
  };
  fs.readFileSync = ((path: fs.PathOrFileDescriptor, ...rest: unknown[]) => {
    track(path);
    return (original.readFileSync as (...args: unknown[]) => unknown)(path, ...rest);
  }) as typeof fs.readFileSync;
  fs.readFile = ((path: fs.PathOrFileDescriptor, ...rest: unknown[]) => {
    track(path);
    return (original.readFile as (...args: unknown[]) => unknown)(path, ...rest);
  }) as typeof fs.readFile;
  fs.promises.readFile = ((path: fs.PathLike, ...rest: unknown[]) => {
    track(path);
    return (original.promisesReadFile as (...args: unknown[]) => unknown)(path, ...rest);
  }) as typeof fs.promises.readFile;

  const previousHome = process.env.HOME;
  process.env.HOME = home;
  try {
    const streamFn = createFakeStreamFn([
      { type: 'text', text: 'ok', usage: { inputTokens: 1, outputTokens: 1 } }
    ]);
    const { adapter, lastOptions } = createHarness({ streamFn });
    const events = await collect(adapter.execute(makeContext({ input: 'hello' })));
    assertAllowlistedEvents(events);
    assert.equal(lastOptions()?.resourceLoader, undefined);
    assert.equal(lastOptions()?.cwd, undefined);
    assert.equal(
      reads.some((path) => path.includes('AGENTS.md') || path.includes(`${home}/.pi`)),
      false
    );
  } finally {
    process.env.HOME = previousHome;
    fs.readFileSync = original.readFileSync;
    fs.readFile = original.readFile;
    fs.promises.readFile = original.promisesReadFile;
  }

  for (const relative of [
    '../src/server/runtime/pi/adapter.ts',
    '../src/server/runtime/pi/policy.ts',
    '../src/server/runtime/pi/package.ts',
    '../src/server/runtime/pi/tools.ts',
    '../src/server/runtime/pi/stream-fn.ts',
    '../src/server/runtime/pi/events.ts'
  ]) {
    const text = source(relative);
    assert.equal(text.includes('ResourceLoader'), false);
    assert.equal(text.includes('AGENTS.md'), false);
    assert.equal(text.includes('homedir'), false);
  }
});

test('createFakeStreamFn does not call fetch and bridges stay unavailable', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
    fetchCalls += 1;
    return originalFetch(...args);
  }) as typeof fetch;
  try {
    const streamFn = createFakeStreamFn([
      { type: 'text', text: 'ok', usage: { inputTokens: 1, outputTokens: 1 } }
    ]);
    const chunks: unknown[] = [];
    for await (const chunk of await streamFn({ id: 'unknown' }, {}, {})) {
      chunks.push(chunk);
    }
    assert.equal(fetchCalls, 0);
    assert.ok(chunks.length > 0);
    assert.equal(source('../src/server/runtime/pi/stream-fn.ts').includes('createFakeStreamFn'), true);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.throws(
    () => createBridgeAStreamFn(),
    (error: unknown) => error instanceof AppError && error.code === ERROR_CODES.RUNTIME_UNAVAILABLE
  );
  assert.throws(
    () => createBridgeBStreamFn(),
    (error: unknown) => error instanceof AppError && error.code === ERROR_CODES.RUNTIME_UNAVAILABLE
  );
});

test('flag off and Node 22.16.0 refuse Pi through the injected gate', async () => {
  const streamFn = createFakeStreamFn([
    { type: 'text', text: 'ok', usage: { inputTokens: 1, outputTokens: 1 } }
  ]);
  const flagOff = createHarness({
    streamFn,
    env: {},
    nodeVersion: '22.19.0',
    resolveGate: resolvePiRuntimeGate
  });
  await assert.rejects(
    () => collect(flagOff.adapter.execute(makeContext())),
    (error: unknown) => error instanceof AppError && error.code === ERROR_CODES.RUNTIME_UNAVAILABLE
  );

  const oldNode = createHarness({
    streamFn,
    env: { PI_RUNTIME_ENABLED: 'true' },
    nodeVersion: '22.16.0',
    resolveGate: resolvePiRuntimeGate
  });
  await assert.rejects(
    () => collect(oldNode.adapter.execute(makeContext())),
    (error: unknown) => error instanceof AppError && error.code === ERROR_CODES.RUNTIME_UNAVAILABLE
  );
  assert.deepEqual(resolvePiRuntimeGate({}, '22.19.0'), { ok: false, reason: 'flag_off' });
  assert.deepEqual(
    resolvePiRuntimeGate({ PI_RUNTIME_ENABLED: 'true' }, '22.16.0'),
    { ok: false, reason: 'node_engine' }
  );
});

test('coding-agent tool names are denied', () => {
  for (const name of PI_DENIED_CODING_AGENT_TOOLS) {
    assert.throws(
      () => assertToolAllowed(name),
      (error: unknown) => error instanceof AppError && error.code === ERROR_CODES.RUNTIME_POLICY_DENIED
    );
  }
});

test('coding-agent bash is denied before execute in the adapter loop', async () => {
  const streamFn = createFakeStreamFn([
    {
      type: 'tool_call',
      name: 'bash',
      args: { command: 'rm -rf /' },
      usage: { inputTokens: 4, outputTokens: 1 }
    }
  ]);
  const { adapter, agents } = createHarness({ streamFn });
  const events = await collect(adapter.execute(makeContext()));
  assertAllowlistedEvents(events);
  const failed = events.find((event) => event.type === 'failed');
  assert.ok(failed && failed.type === 'failed');
  assert.equal(failed.code, ERROR_CODES.RUNTIME_POLICY_DENIED);
  assert.equal(agents[0]?.executedToolNames.length, 0);
});

test('thrown secrets are redacted from failed RuntimeEvents', async () => {
  const adapter = new PiRuntimeAdapter({
    env: { PI_RUNTIME_ENABLED: 'true' },
    nodeVersion: '22.19.0',
    streamFn: createFakeStreamFn([
      { type: 'text', text: 'ok', usage: { inputTokens: 1, outputTokens: 1 } }
    ]),
    createAgent: () => ({
      subscribe: () => () => {},
      prompt: async () => {
        throw new Error('upstream failed sk-secret-12345');
      },
      abort: () => {},
      waitForIdle: async () => {}
    })
  });
  const events = await collect(adapter.execute(makeContext({ input: 'leak' })));
  assertAllowlistedEvents(events);
  const failed = events.find((event) => event.type === 'failed');
  assert.ok(failed && failed.type === 'failed');
  assert.equal(failed.code, ERROR_CODES.INTERNAL_SERVER_ERROR);
  assert.equal(JSON.stringify(events).includes('sk-'), false);
  assert.equal(failed.message.includes('sk-'), false);
  assert.equal(failed.message.includes('sk-secret-12345'), false);
});

test('dag definitions are refused and do not fall back', async () => {
  const streamFn = createFakeStreamFn([
    { type: 'text', text: 'ok', usage: { inputTokens: 1, outputTokens: 1 } }
  ]);
  const { adapter } = createHarness({ streamFn });
  await assert.rejects(
    () => collect(adapter.execute(makeContext({
      definition: { kind: 'dag', workflow: starterWorkflow('json') }
    }))),
    (error: unknown) => error instanceof AppError && error.code === ERROR_CODES.RUNTIME_POLICY_DENIED
  );
});

test('owned sources do not import the Pi npm package or ArenaService', () => {
  const files = [
    '../src/lib/runtime/budget.ts',
    '../src/server/runtime/pi/package.ts',
    '../src/server/runtime/pi/stream-fn.ts',
    '../src/server/runtime/pi/tools.ts',
    '../src/server/runtime/pi/events.ts',
    '../src/server/runtime/pi/policy.ts',
    '../src/server/runtime/pi/adapter.ts',
    '../tests/helpers/fake-pi-agent.ts',
    '../tests/runtime-pi-fake.test.ts'
  ];
  for (const file of files) {
    const text = source(file);
    assert.equal(/from ['"]@earendil-works\/pi-agent-core['"]/.test(text), false);
    assert.equal(/import\(['"]@earendil-works\/pi-agent-core['"]\)/.test(text), false);
    assert.equal(/from ['"]@mariozechner\//.test(text), false);
    assert.equal(/from ['"][^'"]*server\/service\.ts['"]/.test(text), false);
    assert.equal(/from ['"][^'"]*workflow\/engine/.test(text), false);
  }
  assert.equal(source('../src/server/runtime/pi/adapter.ts').includes('shouldStopAfterTurn'), false);
});
