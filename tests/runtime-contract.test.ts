import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AppError, ERROR_CODES } from '../src/shared/errors.ts';
import { ERROR_MESSAGE_KEYS, errorMessageKey } from '../src/shared/i18n/error-messages.ts';
import { en, translateMessage, zhCN } from '../src/shared/i18n/messages.ts';
import { starterWorkflow } from '../src/shared/catalog.ts';
import {
  assertRuntimeEventCount,
  isDagRunDefinition,
  isPiRunDefinition,
  RUNTIME_EVENT_LIMITS,
  RUNTIME_EVENT_TYPES,
  validateExecutionIdentity,
  validatePiAgentTask,
  validateRunDefinition,
  validateRuntimeEvent,
  type PiAgentTask,
  type RunDefinition
} from '../src/shared/runtime-contract.ts';

function policyError(operation: () => unknown, message?: string | RegExp) {
  assert.throws(
    operation,
    (error: unknown) => {
      if (!(error instanceof AppError) || error.code !== ERROR_CODES.RUNTIME_POLICY_DENIED || error.status !== 400) {
        return false;
      }
      if (message === undefined) return true;
      return typeof message === 'string' ? error.message === message : message.test(error.message);
    }
  );
}

function validPiTask(): PiAgentTask {
  return {
    instructions: 'Add 1 and 2 using the calculator.',
    tools: ['calculator'],
    maxSteps: 4,
    maxToolCalls: 2
  };
}

test('unknown extra tools and missing instructions are rejected', () => {
  policyError(
    () => validatePiAgentTask({ ...validPiTask(), tools: ['calculator', 'bash'] }),
    'This runtime policy allows only the calculator tool.'
  );
  policyError(
    () => validatePiAgentTask({ ...validPiTask(), tools: ['json-validator'] }),
    'This runtime policy allows only the calculator tool.'
  );
  policyError(
    () => validatePiAgentTask({ ...validPiTask(), instructions: '' }),
    'Pi tasks require instructions.'
  );
  policyError(
    () => validatePiAgentTask({ ...validPiTask(), instructions: '   ' }),
    'Pi tasks require instructions.'
  );
  policyError(
    () => validatePiAgentTask({ tools: ['calculator'], maxSteps: 4, maxToolCalls: 2 }),
    'This run is not allowed by the current runtime policy.'
  );
  const accepted = validatePiAgentTask(validPiTask());
  assert.deepEqual(accepted.tools, ['calculator']);
  assert.equal(accepted.instructions, validPiTask().instructions);
});

test('DAG graphs and Pi tasks are disjoint recipes', () => {
  const workflow = starterWorkflow('json');
  const task = validPiTask();
  const dag = validateRunDefinition({ kind: 'dag', workflow });
  const pi = validateRunDefinition({ kind: 'pi', task });

  assert.equal(isDagRunDefinition(dag), true);
  assert.equal(isPiRunDefinition(dag), false);
  assert.equal(isPiRunDefinition(pi), true);
  assert.equal(isDagRunDefinition(pi), false);

  policyError(
    () => validatePiAgentTask(workflow),
    'A workflow graph cannot be used as a Pi task.'
  );
  policyError(
    () => validateRunDefinition({ kind: 'pi', task: workflow }),
    'A workflow graph cannot be used as a Pi task.'
  );
  policyError(
    () => validateRunDefinition({ kind: 'dag', workflow: task }),
    'A Pi task cannot be used as a workflow graph.'
  );
  policyError(() => validateRunDefinition({ kind: 'pi', workflow }));
  policyError(() => validateRunDefinition({ kind: 'dag', task }));
  policyError(() => validateRunDefinition({ kind: 'dag', workflow, task }));
  policyError(() => validateRunDefinition({ kind: 'pi', task, workflow }));

  const source = readFileSync(new URL('../src/shared/runtime-contract.ts', import.meta.url), 'utf8');
  assert.equal(/function\s+\w*convert\w*/i.test(source), false);
  assert.equal(source.includes('toPiTask'), false);
  assert.equal(source.includes('toWorkflow'), false);
});

test('execution identity requires runtime, adapterVersion, and policyVersion', () => {
  const identity = validateExecutionIdentity({
    runtime: 'pi',
    adapterVersion: 'poc-1',
    policyVersion: 'policy-1',
    modelVersion: 'demo-forge'
  });
  assert.equal(identity.runtime, 'pi');
  assert.equal(identity.adapterVersion, 'poc-1');
  assert.equal(identity.policyVersion, 'policy-1');
  assert.equal(identity.modelVersion, 'demo-forge');

  policyError(() => validateExecutionIdentity({ adapterVersion: 'poc-1', policyVersion: 'policy-1' }), 'Runtime identity is incomplete.');
  policyError(() => validateExecutionIdentity({ runtime: 'pi', policyVersion: 'policy-1' }), 'Runtime identity is incomplete.');
  policyError(() => validateExecutionIdentity({ runtime: 'pi', adapterVersion: 'poc-1' }), 'Runtime identity is incomplete.');
  policyError(() => validateExecutionIdentity({ runtime: 'pi', adapterVersion: '', policyVersion: 'policy-1' }), 'Runtime identity is incomplete.');
  policyError(() => validateExecutionIdentity({ runtime: 'other', adapterVersion: 'poc-1', policyVersion: 'policy-1' }), 'Runtime identity is incomplete.');
});

test('runtime events reject unknown fields and stay within size limits', () => {
  const started = validateRuntimeEvent({ type: 'started', runId: 'run-1', sequence: 0 });
  assert.equal(started.type, 'started');
  assert.equal(started.sequence, 0);

  policyError(
    () => validateRuntimeEvent({ type: 'started', runId: 'run-1', sequence: 0, stack: 'Error: secret' }),
    'Runtime event is invalid.'
  );
  policyError(
    () => validateRuntimeEvent({ type: 'trace', runId: 'run-1', sequence: 0 }),
    'Runtime event is invalid.'
  );
  policyError(
    () => validateRuntimeEvent({ type: 'completed', runId: 'run-1', sequence: 1, output: 'ok', rawPiMessage: { content: 'x' } }),
    'Runtime event is invalid.'
  );

  assert.equal(RUNTIME_EVENT_TYPES.length, 8);
  assert.ok(RUNTIME_EVENT_LIMITS.maxEvents >= 1);
  assert.ok(RUNTIME_EVENT_LIMITS.maxEventBytes >= 256);
  assertRuntimeEventCount(0);
  assertRuntimeEventCount(RUNTIME_EVENT_LIMITS.maxEvents);
  policyError(() => assertRuntimeEventCount(RUNTIME_EVENT_LIMITS.maxEvents + 1));
});

test('runtime contract source does not import pi-agent-core', () => {
  const source = readFileSync(new URL('../src/shared/runtime-contract.ts', import.meta.url), 'utf8');
  assert.equal(source.includes('pi-agent-core'), false);
  assert.equal(source.includes('@earendil-works'), false);
  assert.equal(source.includes('@mariozechner'), false);
  assert.equal(/from ['"]next['"]/.test(source), false);
  assert.equal(/from ['"]react['"]/.test(source), false);
});

test('new runtime error codes map to safe i18n strings', () => {
  assert.equal(ERROR_MESSAGE_KEYS[ERROR_CODES.RUNTIME_UNAVAILABLE], 'errors.runtimeUnavailable');
  assert.equal(ERROR_MESSAGE_KEYS[ERROR_CODES.RUNTIME_POLICY_DENIED], 'errors.runtimePolicyDenied');
  assert.equal(errorMessageKey(ERROR_CODES.RUNTIME_UNAVAILABLE), 'errors.runtimeUnavailable');
  assert.equal(errorMessageKey(ERROR_CODES.RUNTIME_POLICY_DENIED), 'errors.runtimePolicyDenied');

  const unavailableEn = translateMessage('en', 'errors.runtimeUnavailable');
  const deniedEn = translateMessage('en', 'errors.runtimePolicyDenied');
  const unavailableZh = translateMessage('zh-CN', 'errors.runtimeUnavailable');
  const deniedZh = translateMessage('zh-CN', 'errors.runtimePolicyDenied');

  assert.equal(unavailableEn, en['errors.runtimeUnavailable']);
  assert.equal(deniedEn, en['errors.runtimePolicyDenied']);
  assert.equal(unavailableZh, zhCN['errors.runtimeUnavailable']);
  assert.equal(deniedZh, zhCN['errors.runtimePolicyDenied']);
  assert.notEqual(unavailableZh, unavailableEn);
  assert.notEqual(deniedZh, deniedEn);

  const combined = `${unavailableEn} ${deniedEn} ${unavailableZh} ${deniedZh}`;
  assert.equal(/pi-agent-core|@earendil-works|@mariozechner|22\.19\.0|stack/i.test(combined), false);
});

test('RunDefinition keeps typed kind discriminants without a converter', () => {
  const definition: RunDefinition = { kind: 'pi', task: validPiTask() };
  if (definition.kind === 'pi') {
    assert.equal('task' in definition, true);
    assert.equal('workflow' in definition, false);
  }
  const dag: RunDefinition = { kind: 'dag', workflow: starterWorkflow('json') };
  if (dag.kind === 'dag') {
    assert.equal('workflow' in dag, true);
    assert.equal('task' in dag, false);
  }
});
