import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentCreationEvaluationAdapter } from '../src/server/evaluation/adapters/agent-creation.ts';
import type { EvaluationCapacityProvider, EvaluationBudgetProvider } from '../src/server/evaluation/domain.ts';
import type { EvaluationInvocationBoundary } from '../src/server/evaluation/invocation/ports.ts';
import { UnavailableSandboxProvider } from '../src/server/sandbox/provider.ts';
import { ERROR_CODES } from '../src/shared/errors.ts';

const digest = `sha256:${'a'.repeat(64)}`;
const definition = {
  mode: 'agent',
  definitionSchemaVersion: 1,
  instructions: 'Create a static artifact.',
  modelSelection: { id: 'model', versionId: 'model-v1', contentDigest: digest },
  skillRefs: [],
  requestedCapabilities: [],
  outputContractRef: { id: 'output', versionId: 'output-v1', contentDigest: digest },
  profileRef: null,
  environmentRef: { id: 'environment', versionId: 'environment-v1', contentDigest: digest },
  runtimeSelection: { kind: 'pi', adapterVersion: 'pi-v1', policyVersion: 'policy-v1' },
} as const;

const input = {
  definition,
  ownerId: 'owner-1',
  buildId: 'build-1',
  buildVersionId: 'build-version-1',
  creationRunId: 'creation-run-1',
};

const capacity: EvaluationCapacityProvider = {
  reserve: async () => undefined,
  release: async () => undefined,
};
const budget: EvaluationBudgetProvider = {
  reserve: async () => undefined,
  release: async () => undefined,
};
const usage = {} as EvaluationInvocationBoundary;
const sandbox = new UnavailableSandboxProvider();

function assertUnavailable(error: unknown, message: RegExp): void {
  assert.equal(error && typeof error === 'object' && 'code' in error ? error.code : undefined, ERROR_CODES.RUNTIME_UNAVAILABLE);
  assert.equal(error && typeof error === 'object' && 'status' in error ? error.status : undefined, 503);
  assert.match(error instanceof Error ? error.message : String(error), message);
}

test('Agent Creation admission validates private B2 configuration before fail-closed dependencies', async () => {
  const adapter = new AgentCreationEvaluationAdapter();
  assert.deepEqual(adapter.missingDependencies(), ['budget-reservation', 'usage-accounting', 'sandbox']);

  await assert.rejects(
    adapter.admit(input),
    (error: unknown) => {
      assertUnavailable(error, /durable budget reservations/);
      return true;
    },
  );

  await assert.rejects(
    adapter.admit({ ...input, definition: { ...definition, runtimeSelection: null } }),
    (error: unknown) => {
      assert.equal(error && typeof error === 'object' && 'code' in error ? error.code : undefined, ERROR_CODES.REQUEST_VALIDATION_FAILED);
      assert.equal(error && typeof error === 'object' && 'status' in error ? error.status : undefined, 400);
      return true;
    },
  );
});

test('each missing CreationRun dependency remains an explicit runtime-unavailable gate', async () => {
  const cases = [
    {
      name: 'capacity',
      ports: { budget, usage, sandbox },
      missing: ['budget-reservation'],
    },
    {
      name: 'budget',
      ports: { capacity, usage, sandbox },
      missing: ['budget-reservation'],
    },
    {
      name: 'usage',
      ports: { capacity, budget, sandbox },
      missing: ['usage-accounting'],
    },
    {
      name: 'sandbox',
      ports: { capacity, budget, usage },
      missing: ['sandbox'],
    },
  ] as const;

  for (const testCase of cases) {
    const adapter = new AgentCreationEvaluationAdapter(testCase.ports);
    assert.deepEqual(adapter.missingDependencies(), testCase.missing, testCase.name);
    await assert.rejects(
      adapter.admit(input),
      (error: unknown) => {
        assertUnavailable(error, /durable budget reservations/);
        return true;
      },
      testCase.name,
    );
  }
});

test('CreationRun is not admitted even when all foundation ports are present', async () => {
  const adapter = new AgentCreationEvaluationAdapter({ capacity, budget, usage, sandbox });
  assert.deepEqual(adapter.missingDependencies(), []);

  await assert.rejects(
    adapter.admit(input),
    (error: unknown) => {
      assertUnavailable(error, /versioned evaluation purpose/);
      return true;
    },
  );
});

test('the admission seam does not invoke capacity, usage, sandbox, or model work', async () => {
  let calls = 0;
  const noExecutionCapacity: EvaluationCapacityProvider = {
    reserve: async () => { calls += 1; throw new Error('capacity must not be called'); },
    release: async () => { calls += 1; throw new Error('capacity must not be called'); },
  };
  const noExecutionBudget: EvaluationBudgetProvider = {
    reserve: async () => { calls += 1; throw new Error('budget must not be called'); },
    release: async () => { calls += 1; throw new Error('budget must not be called'); },
  };
  const adapter = new AgentCreationEvaluationAdapter({
    capacity: noExecutionCapacity,
    budget: noExecutionBudget,
    usage,
    sandbox,
  });

  await assert.rejects(adapter.admit(input), (error: unknown) => {
    assertUnavailable(error, /versioned evaluation purpose/);
    return true;
  });
  assert.equal(calls, 0);
});
