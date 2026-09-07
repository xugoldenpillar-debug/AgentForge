import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DemoProvider } from '../src/lib/ai/demo.ts';
import { executeWorkflow, type ExecutionResult } from '../src/lib/workflow/engine.ts';
import {
  DagRuntimeAdapter,
  DAG_ADAPTER_VERSION,
  POLICY_VERSION,
  assertRuntimeEventCount,
  dagExecutionIdentity,
  validateRuntimeEvent,
  type AuthorizedRunContext,
  type RuntimeEvent
} from '../src/lib/runtime/index.ts';
import { AppError, ERROR_CODES } from '../src/shared/errors.ts';
import { starterWorkflow } from '../src/shared/catalog.ts';
import type { Constraints, Workflow } from '../src/shared/types.ts';
import { MemoryRepository } from './helpers/memory-repository.ts';

const constraints: Constraints = {
  tokenBudget: 10000,
  toolCallLimit: 5,
  maxCost: 0.05,
  maxLatencyMs: 30000
};

const resolve = async () => ({ provider: new DemoProvider(), model: 'demo-forge' });

function dagContext(overrides: Partial<AuthorizedRunContext> = {}): AuthorizedRunContext {
  return {
    runId: 'run-dag-1',
    identity: dagExecutionIdentity(),
    definition: { kind: 'dag', workflow: starterWorkflow('json') },
    input: 'My name is Ada.',
    constraints,
    signal: new AbortController().signal,
    model: { __opaque: 'model' },
    tools: { __opaque: 'tool' },
    ...overrides
  };
}

async function collectAdapter(
  execute: AsyncGenerator<RuntimeEvent, ExecutionResult>
): Promise<{ events: RuntimeEvent[]; result: ExecutionResult }> {
  const events: RuntimeEvent[] = [];
  let step = await execute.next();
  while (!step.done) {
    events.push(step.value);
    step = await execute.next();
  }
  return { events, result: step.value };
}

function executionSnapshot(result: ExecutionResult) {
  return {
    text: result.text,
    valid: result.valid,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    reasoningTokens: result.reasoningTokens,
    toolCalls: result.toolCalls,
    latency: result.latency,
    cost: result.cost,
    estimated: result.estimated,
    nodeOrder: result.trace.map((trace) => trace.nodeId),
    trace: result.trace
  };
}

function isAppError(error: unknown, code: string, message?: RegExp): boolean {
  if (!(error instanceof AppError) || error.code !== code) return false;
  return message === undefined ? true : message.test(error.message);
}

test('DAG adapter result deep-equals direct executeWorkflow for the starter DemoProvider run', async () => {
  const workflow: Workflow = starterWorkflow('json');
  const input = 'My name is Ada.';
  const adapter = new DagRuntimeAdapter({ resolve });

  const direct = await executeWorkflow({
    workflow: structuredClone(workflow),
    input,
    constraints,
    resolve
  });
  const { events, result } = await collectAdapter(adapter.execute(dagContext({
    definition: { kind: 'dag', workflow: structuredClone(workflow) },
    input,
    constraints
  })));

  assert.deepEqual(executionSnapshot(result), executionSnapshot(direct));
  assert.deepEqual(result, direct);
  assert.equal(result.text, '{"name":"Ada","age":null,"city":null}');
  assert.deepEqual(
    result.trace.filter((trace) => trace.state === 'done').map((trace) => trace.nodeId),
    ['input', 'prompt', 'model', 'output']
  );

  assert.equal(adapter.kind, 'dag');
  assert.equal(adapter.identity.runtime, 'dag');
  assert.equal(adapter.identity.adapterVersion, DAG_ADAPTER_VERSION);
  assert.equal(adapter.identity.policyVersion, POLICY_VERSION);

  assert.equal(events[0]?.type, 'started');
  const last = events.at(-1);
  assert.equal(last?.type, 'completed');
  if (last?.type === 'completed') assert.equal(last.output, direct.text);

  const types = events.map((event) => event.type);
  assert.deepEqual([...new Set(types)].sort(), ['completed', 'progress', 'started']);
  assert.equal(events.filter((event) => event.type === 'progress').length, result.trace.length);
  assert.equal(events.filter((event) => event.type !== 'progress').map((event) => event.type).join(','), 'started,completed');

  events.forEach((event, index) => {
    assert.equal(event.runId, 'run-dag-1');
    assert.equal(event.sequence, index);
    validateRuntimeEvent(event);
  });
  assertRuntimeEventCount(events.length);
});

test('DAG adapter refuses a Pi definition without calling the provider', async () => {
  let called = false;
  const adapter = new DagRuntimeAdapter({
    resolve: async () => {
      called = true;
      return { provider: new DemoProvider(), model: 'demo-forge' };
    }
  });
  await assert.rejects(
    () => collectAdapter(adapter.execute(dagContext({
      definition: {
        kind: 'pi',
        task: {
          instructions: 'Add 1 and 2 using the calculator.',
          tools: ['calculator'],
          maxSteps: 4,
          maxToolCalls: 2
        }
      }
    }))),
    (error: unknown) => isAppError(error, ERROR_CODES.RUNTIME_POLICY_DENIED)
  );
  assert.equal(called, false);
});

test('A cancelled DAG adapter run does not call the provider', async () => {
  const abort = new AbortController();
  abort.abort();
  let called = false;
  const adapter = new DagRuntimeAdapter({
    resolve: async () => {
      called = true;
      return { provider: new DemoProvider(), model: 'demo-forge' };
    }
  });
  await assert.rejects(
    () => collectAdapter(adapter.execute(dagContext({ signal: abort.signal, input: 'hello' }))),
    (error: unknown) => isAppError(error, ERROR_CODES.RUN_CANCELLED, /cancelled/)
  );
  assert.equal(called, false);
});

test('DAG adapter budget errors keep BUDGET_EXCEEDED', async () => {
  const adapter = new DagRuntimeAdapter({ resolve });
  await assert.rejects(
    () => collectAdapter(adapter.execute(dagContext({
      input: 'hello',
      constraints: { ...constraints, tokenBudget: 10 }
    }))),
    (error: unknown) => isAppError(error, ERROR_CODES.BUDGET_EXCEEDED, /Energy/)
  );

  const workflow = starterWorkflow('json');
  workflow.nodes.splice(3, 0, {
    id: 'tool',
    kind: 'tool',
    label: 'Check',
    x: 700,
    y: 200,
    config: { toolId: 'json-validator' }
  });
  workflow.edges = workflow.nodes.slice(1).map((node, index) => ({
    id: `e${index}`,
    source: workflow.nodes[index].id,
    target: node.id
  }));
  await assert.rejects(
    () => collectAdapter(adapter.execute(dagContext({
      definition: { kind: 'dag', workflow },
      input: 'My name is Ada.',
      constraints: { ...constraints, toolCallLimit: 0 }
    }))),
    (error: unknown) => isAppError(error, ERROR_CODES.BUDGET_EXCEEDED, /Tool-call/)
  );
});

test('DAG adapter does not write runs or submissions', async () => {
  const repo = new MemoryRepository();
  const adapter = new DagRuntimeAdapter({ resolve });
  const { result } = await collectAdapter(adapter.execute(dagContext()));
  assert.ok(result.text.length > 0);
  assert.deepEqual(await repo.read('runs'), []);
  assert.deepEqual(await repo.read('submissions'), []);

  const adapterSource = readFileSync(new URL('../src/lib/runtime/dag-adapter.ts', import.meta.url), 'utf8');
  const indexSource = readFileSync(new URL('../src/lib/runtime/index.ts', import.meta.url), 'utf8');
  const versionsSource = readFileSync(new URL('../src/lib/runtime/versions.ts', import.meta.url), 'utf8');
  for (const source of [adapterSource, indexSource, versionsSource]) {
    assert.equal(source.includes("insert('runs'"), false);
    assert.equal(source.includes('submissions'), false);
    assert.equal(source.includes('pi-agent-core'), false);
    assert.equal(source.includes('@earendil-works'), false);
    assert.equal(source.includes("from './budget"), false);
    assert.equal(source.includes('src/server/runtime'), false);
    assert.equal(source.includes('../server/service'), false);
  }
});
