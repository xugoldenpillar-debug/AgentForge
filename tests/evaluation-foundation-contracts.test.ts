import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EVALUATION_SNAPSHOT_VERSION,
  EVALUATION_WORKER_CONTRACT,
  EVALUATION_WORKER_MESSAGE_VERSION,
  asOpaqueId,
  assertEvaluationAssociation,
  assertEvaluationJobContract,
  isTerminalEvaluationAttemptState,
  isTerminalEvaluationInvocationState,
  isTerminalEvaluationJobState,
  transitionEvaluationAttemptState,
  transitionEvaluationInvocationState,
  transitionEvaluationJobState,
  type EvaluationAssociation,
  type EvaluationJob,
  type EvaluationWorkerMessage
} from '../src/shared/evaluation-types.ts';
import {
  EVALUATION_ERROR_CODES,
  EvaluationContractError
} from '../src/shared/evaluation-errors.ts';

const timestamp = '2026-09-06T00:00:00.000Z';
const ids = {
  job: asOpaqueId<'evaluation-job'>('job-1'),
  user: asOpaqueId<'user'>('user-1'),
  run: asOpaqueId<'run'>('run-1'),
  buildVersion: asOpaqueId<'build-version'>('build-version-1'),
  suite: asOpaqueId<'test-suite-version'>('suite-1'),
  reservation: asOpaqueId<'evaluation-budget-reservation'>('reservation-1')
};

function rejectsWithCode(operation: () => unknown, code: typeof EVALUATION_ERROR_CODES[keyof typeof EVALUATION_ERROR_CODES]): void {
  assert.throws(operation, (error: unknown) => error instanceof EvaluationContractError && error.code === code);
}

function competitiveAssociation(): EvaluationAssociation {
  return { kind: 'competitive-run', runId: ids.run, visibility: 'hidden' };
}

function job(): EvaluationJob {
  return {
    id: ids.job,
    userId: ids.user,
    purpose: 'competitive',
    association: competitiveAssociation(),
    state: 'accepted',
    snapshot: {
      schemaVersion: EVALUATION_SNAPSHOT_VERSION,
      buildVersionId: ids.buildVersion,
      testSuiteVersionId: ids.suite,
      skillVersionId: null,
      runtimeAdapter: 'workflow-v1',
      modelOfferingId: 'verified-model-v1',
      policyVersion: 'evaluation-policy-v1',
      consentVersion: 'consent-v1',
      credentialAuthorizationId: null,
      snapshotDigest: 'sha256:snapshot',
      capturedAt: timestamp,
      metadata: { visibility: 'hidden' }
    },
    idempotency: {
      scope: 'evaluation-job-create',
      key: 'request-key-1',
      requestDigest: 'sha256:request'
    },
    budgetReservationId: ids.reservation,
    cancellationReason: null,
    acceptedAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
    completedAt: null
  };
}

test('state transitions allow the durable lifecycle and reject illegal jumps', () => {
  assert.equal(transitionEvaluationJobState('accepted', 'queued'), 'queued');
  assert.equal(transitionEvaluationJobState('queued', 'running'), 'running');
  assert.equal(transitionEvaluationJobState('running', 'unknown'), 'unknown');
  assert.equal(transitionEvaluationJobState('unknown', 'reconciling'), 'reconciling');
  assert.equal(transitionEvaluationJobState('reconciling', 'completed'), 'completed');

  assert.equal(transitionEvaluationAttemptState('created', 'claimed'), 'claimed');
  assert.equal(transitionEvaluationAttemptState('claimed', 'running'), 'running');
  assert.equal(transitionEvaluationAttemptState('running', 'incomplete'), 'incomplete');
  assert.equal(transitionEvaluationInvocationState('pending', 'started'), 'started');
  assert.equal(transitionEvaluationInvocationState('started', 'unknown'), 'unknown');
  assert.equal(transitionEvaluationInvocationState('unknown', 'reconciling'), 'reconciling');
  assert.equal(transitionEvaluationInvocationState('reconciling', 'failed'), 'failed');

  rejectsWithCode(() => transitionEvaluationJobState('accepted', 'completed'), EVALUATION_ERROR_CODES.INVALID_STATE_TRANSITION);
  rejectsWithCode(() => transitionEvaluationAttemptState('created', 'succeeded' as never), EVALUATION_ERROR_CODES.INVALID_STATE_TRANSITION);
  rejectsWithCode(() => transitionEvaluationInvocationState('pending', 'succeeded'), EVALUATION_ERROR_CODES.INVALID_STATE_TRANSITION);
});

test('terminal states are immutable while same-state delivery remains idempotent', () => {
  assert.equal(transitionEvaluationJobState('completed', 'completed'), 'completed');
  assert.equal(transitionEvaluationAttemptState('failed', 'failed'), 'failed');
  assert.equal(transitionEvaluationInvocationState('cancelled', 'cancelled'), 'cancelled');

  rejectsWithCode(() => transitionEvaluationJobState('completed', 'failed'), EVALUATION_ERROR_CODES.TERMINAL_STATE_IMMUTABLE);
  rejectsWithCode(() => transitionEvaluationAttemptState('expired', 'running'), EVALUATION_ERROR_CODES.TERMINAL_STATE_IMMUTABLE);
  rejectsWithCode(() => transitionEvaluationInvocationState('succeeded', 'unknown'), EVALUATION_ERROR_CODES.TERMINAL_STATE_IMMUTABLE);

  assert.equal(isTerminalEvaluationJobState('completed'), true);
  assert.equal(isTerminalEvaluationAttemptState('incomplete'), true);
  assert.equal(isTerminalEvaluationInvocationState('succeeded'), true);
  assert.equal(isTerminalEvaluationJobState('unknown'), false);
});

test('a job purpose accepts only its one business association', () => {
  assert.doesNotThrow(() => assertEvaluationAssociation('competitive', competitiveAssociation()));
  assert.doesNotThrow(() => assertEvaluationAssociation('author-self-test', {
    kind: 'self-test-run',
    selfTestRunId: asOpaqueId<'self-test-run'>('self-test-1')
  }));
  assert.doesNotThrow(() => assertEvaluationAssociation('component-evaluation', {
    kind: 'component-evaluation',
    componentEvaluationId: asOpaqueId<'component-evaluation'>('component-evaluation-1')
  }));

  rejectsWithCode(() => assertEvaluationAssociation('competitive', {
    kind: 'self-test-run',
    selfTestRunId: asOpaqueId<'self-test-run'>('self-test-1')
  }), EVALUATION_ERROR_CODES.PURPOSE_ASSOCIATION_MISMATCH);
  rejectsWithCode(() => assertEvaluationAssociation('author-self-test', {
    kind: 'competitive-run',
    runId: ids.run,
    visibility: 'hidden'
  }), EVALUATION_ERROR_CODES.PURPOSE_ASSOCIATION_MISMATCH);
  rejectsWithCode(() => assertEvaluationAssociation('component-evaluation', {
    kind: 'component-evaluation',
    componentEvaluationId: asOpaqueId<'component-evaluation'>('component-evaluation-1'),
    extra: 'not allowed'
  } as never), EVALUATION_ERROR_CODES.INVALID_ASSOCIATION);
});

test('job contract includes a frozen snapshot and request digest without non-JSON values', () => {
  const value = job();
  assert.doesNotThrow(() => assertEvaluationJobContract(value));
  const serialized = JSON.stringify(value);
  assert.equal(typeof serialized, 'string');
  assert.deepEqual(JSON.parse(serialized), value);
  assert.equal(serialized.includes('undefined'), false);
  assert.equal(serialized.includes('[object Object]'), false);
  assert.equal(value.idempotency.requestDigest, 'sha256:request');
  assert.equal(value.snapshot.snapshotDigest, 'sha256:snapshot');

  assert.throws(() => asOpaqueId<'run'>('   '), EvaluationContractError);
});

test('worker messages are explicitly versioned and contain the idempotency digest', () => {
  const message: EvaluationWorkerMessage = {
    contract: EVALUATION_WORKER_CONTRACT,
    version: EVALUATION_WORKER_MESSAGE_VERSION,
    kind: 'execute-attempt',
    messageId: asOpaqueId<'evaluation-message'>('message-1'),
    jobId: ids.job,
    attemptId: asOpaqueId<'evaluation-attempt'>('attempt-1'),
    requestDigest: 'sha256:request',
    snapshotDigest: 'sha256:snapshot',
    issuedAt: timestamp
  };
  assert.deepEqual(JSON.parse(JSON.stringify(message)), message);
  assert.equal(message.version, 1);
  assert.equal(message.requestDigest, valueDigest(message));
});

function valueDigest(message: EvaluationWorkerMessage): string {
  return message.requestDigest;
}
