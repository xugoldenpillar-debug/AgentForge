import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentShowcaseJudgeAdapter, type AgentShowcaseJudgeAdmissionRequest, type AgentShowcaseJudgePolicy, type HiddenAgentJudgeInput, type HiddenAgentJudgePort } from '../src/server/evaluation/adapters/agent-showcase.ts';
import { AppError, ERROR_CODES } from '../src/shared/errors.ts';

const digest = `sha256:${'a'.repeat(64)}`;
const refs = {
  model: { id: 'model-catalog', versionId: 'model-v1', contentDigest: digest },
  output: { id: 'output-contract', versionId: 'output-v1', contentDigest: digest },
  profile: { id: 'profile-pelican', versionId: 'profile-v1', contentDigest: digest },
  environment: { id: 'env-static-pi', versionId: 'env-v1', contentDigest: digest },
  judge: { id: 'judge-static-v1', versionId: 'judge-v1', contentDigest: digest },
  season: { id: 'season-2026-09', versionId: 'season-v1', contentDigest: digest },
};

const definition = {
  mode: 'agent',
  definitionSchemaVersion: 1,
  instructions: 'Create a static artifact for the hidden challenge.',
  modelSelection: refs.model,
  skillRefs: [],
  requestedCapabilities: [],
  outputContractRef: refs.output,
  profileRef: refs.profile,
  environmentRef: refs.environment,
  runtimeSelection: { kind: 'pi', adapterVersion: 'pi-v1', policyVersion: 'policy-v1' },
} as const;

const request: AgentShowcaseJudgeAdmissionRequest = {
  ownerId: 'owner-1',
  buildId: 'build-1',
  buildVersionId: 'build-version-1',
  hiddenRunId: 'hidden-run-1',
  hiddenAttemptId: 'hidden-attempt-1',
  runtime: 'pi',
  trustLane: 'platform',
  environmentVersionId: refs.environment.versionId,
  environmentDigest: refs.environment.contentDigest,
  definition,
};

const evidence = {
  kind: 'sealed-hidden-agent-output' as const,
  bundleStatus: 'sealed' as const,
  executionStatus: 'completed' as const,
  attemptId: 'hidden-attempt-1',
  hiddenBundleId: 'hidden-bundle-1',
  manifestDigest: digest,
  outputDigest: `sha256:${'b'.repeat(64)}`,
};

function evidenceResolver(value = evidence) {
  return {
    async resolve() {
      return value;
    },
  };
}

const policy: AgentShowcaseJudgePolicy = {
  profile: {
    profileId: refs.profile.id,
    versionId: refs.profile.versionId,
    contentDigest: refs.profile.contentDigest,
    components: [
      { id: 'functional', weight: 0.6 },
      { id: 'safety', weight: 0.4 },
    ],
  },
  judge: refs.judge,
  season: refs.season,
  environment: refs.environment,
  runtime: { kind: 'pi', adapterVersion: 'pi-v1', policyVersion: 'policy-v1' },
  trustLane: 'platform',
  comparatorKey: 'pelican:profile-v1:season-v1:platform:pi:env-v1',
};

function unavailable(adapter: AgentShowcaseJudgeAdapter, operation: 'admit' | 'score' = 'admit'): Promise<unknown> {
  return operation === 'admit' ? adapter.admit(request) : adapter.score(request);
}

function assertRuntimeUnavailable(error: unknown, message: RegExp): void {
  assert.ok(error instanceof AppError);
  assert.equal(error.status, 503);
  assert.equal(error.code, ERROR_CODES.RUNTIME_UNAVAILABLE);
  assert.match(error.message, message);
}

function resolver(): { readonly resolve: (input: { request: AgentShowcaseJudgeAdmissionRequest; definition: typeof definition }) => Promise<AgentShowcaseJudgePolicy> } {
  return {
    async resolve() {
      return policy;
    },
  };
}

function judge(calls: HiddenAgentJudgeInput[]): HiddenAgentJudgePort {
  return {
    kind: 'hidden-agent-judge',
    id: refs.judge.id,
    versionId: refs.judge.versionId,
    contentDigest: refs.judge.contentDigest,
    async evaluate(input) {
      calls.push(input);
      return {
        judge: refs.judge,
        evidence: 'complete',
        components: { functional: 0.75, safety: 0.5 },
      };
    },
  };
}

test('AA-T8 fails closed when the server-owned resolver is absent', async () => {
  await assert.rejects(
    unavailable(new AgentShowcaseJudgeAdapter()),
    (error: unknown) => {
      assertRuntimeUnavailable(error, /Profile\/Season resolver/);
      return true;
    },
  );
});

test('AA-T8 fails closed when server-owned hidden evidence is not configured', async () => {
  const adapter = new AgentShowcaseJudgeAdapter({ resolver: resolver(), judge: judge([]) });
  await assert.rejects(
    unavailable(adapter),
    (error: unknown) => {
      assertRuntimeUnavailable(error, /server-owned hidden evidence/);
      return true;
    },
  );
});

test('AA-T8 fails closed when a resolver exists but no real hidden judge is configured', async () => {
  const adapter = new AgentShowcaseJudgeAdapter({ resolver: resolver(), evidenceResolver: evidenceResolver() });
  await assert.rejects(
    unavailable(adapter),
    (error: unknown) => {
      assertRuntimeUnavailable(error, /approved hidden Agent judge/);
      return true;
    },
  );
});

test('AA-T8 admits and scores only through the independent Agent judge port', async () => {
  const calls: HiddenAgentJudgeInput[] = [];
  const adapter = new AgentShowcaseJudgeAdapter({ resolver: resolver(), evidenceResolver: evidenceResolver(), judge: judge(calls) });
  const result = await adapter.score(request);

  assert.equal(result.kind, 'agent-showcase-score');
  assert.equal(result.scoreVersion, 'agent-showcase-score-v1');
  assert.equal(result.total, 650);
  assert.deepEqual(result.components, { functional: 0.75, safety: 0.5 });
  assert.equal(result.legacySubmissionId, null);
  assert.equal(result.runtime.kind, 'pi');
  assert.equal(result.trustLane, 'platform');
  assert.equal(calls.length, 1);
  assert.equal('expected' in calls[0], false);
  assert.equal('actual' in calls[0], false);
  assert.equal('publicBundleId' in calls[0], false);
  assert.equal('publicBundle' in calls[0], false);
  assert.equal('hiddenAnswer' in calls[0], false);
  assert.equal('answer' in calls[0], false);
  assert.equal(Object.isFrozen(result), true);
});

test('AA-T8 passes a canonical frozen build definition to admission resolvers', async () => {
  const mutableDefinition = { ...definition };
  let resolvedDefinition: unknown;
  const adapter = new AgentShowcaseJudgeAdapter({
    resolver: {
      async resolve(input) {
        resolvedDefinition = input.request.definition;
        return policy;
      },
    },
    evidenceResolver: evidenceResolver(),
    judge: judge([]),
  });

  const pending = adapter.admit({ ...request, definition: mutableDefinition });
  mutableDefinition.instructions = 'tampered after validation';
  await pending;

  assert.notEqual(resolvedDefinition, mutableDefinition);
  assert.equal((resolvedDefinition as typeof definition).instructions, definition.instructions);
  assert.equal(Object.isFrozen(resolvedDefinition), true);
});

test('AA-T8 uses only canonical evidence from the server-owned resolver', async () => {
  const calls: HiddenAgentJudgeInput[] = [];
  const adapter = new AgentShowcaseJudgeAdapter({
    resolver: resolver(),
    evidenceResolver: evidenceResolver({ ...evidence, attemptId: 'other-attempt' }),
    judge: judge(calls),
  });

  await assert.rejects(
    adapter.score(request),
    (error: unknown) => {
      assertRuntimeUnavailable(error, /configuration is invalid/);
      return true;
    },
  );
  assert.equal(calls.length, 0);

  await assert.rejects(
    adapter.score({ ...request, evidence }),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.status, 400);
      assert.equal(error.code, ERROR_CODES.REQUEST_VALIDATION_FAILED);
      return true;
    },
  );
});

test('AA-T8 rejects public-bundle or answer-shaped input instead of passing it to a judge', async () => {
  const calls: HiddenAgentJudgeInput[] = [];
  const adapter = new AgentShowcaseJudgeAdapter({ resolver: resolver(), evidenceResolver: evidenceResolver(), judge: judge(calls) });

  await assert.rejects(
    adapter.score({ ...request, publicBundleId: 'public-bundle-1' }),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.status, 400);
      assert.equal(error.code, ERROR_CODES.REQUEST_VALIDATION_FAILED);
      return true;
    },
  );
  await assert.rejects(
    adapter.score({ ...request, evidence: { ...evidence, expected: 'hidden answer' } }),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.status, 400);
      assert.equal(error.code, ERROR_CODES.REQUEST_VALIDATION_FAILED);
      return true;
    },
  );
  assert.equal(calls.length, 0);
});

test('AA-T8 rejects legacy DAG score components and does not reinterpret them as Agent scores', async () => {
  const calls: HiddenAgentJudgeInput[] = [];
  const adapter = new AgentShowcaseJudgeAdapter({
    resolver: {
      async resolve() {
        return {
          ...policy,
          profile: {
            ...policy.profile,
            components: [
              { id: 'accuracy', weight: 0.45 },
              { id: 'robustness', weight: 0.2 },
              { id: 'security', weight: 0.15 },
              { id: 'efficiency', weight: 0.1 },
              { id: 'elegance', weight: 0.1 },
            ],
          },
        };
      },
    },
    evidenceResolver: evidenceResolver(),
    judge: judge(calls),
  });

  await assert.rejects(
    adapter.score(request),
    (error: unknown) => {
      assertRuntimeUnavailable(error, /configuration is invalid/);
      return true;
    },
  );
  assert.equal(calls.length, 0);
});

test('AA-T8 binds the injected judge to the complete server-owned judge reference', async () => {
  const calls: HiddenAgentJudgeInput[] = [];
  const mismatchedJudge = {
    ...judge(calls),
    id: 'different-judge',
  };
  const adapter = new AgentShowcaseJudgeAdapter({
    resolver: resolver(),
    evidenceResolver: evidenceResolver(),
    judge: mismatchedJudge,
  });

  await assert.rejects(
    adapter.score(request),
    (error: unknown) => {
      assertRuntimeUnavailable(error, /configuration is invalid/);
      return true;
    },
  );
  assert.equal(calls.length, 0);
});

test('AA-T8 rejects resolver identity drift before judge execution', async () => {
  const calls: HiddenAgentJudgeInput[] = [];
  const adapter = new AgentShowcaseJudgeAdapter({
    resolver: {
      async resolve() {
        return {
          ...policy,
          environment: { ...policy.environment, versionId: 'env-other-v1' },
        };
      },
    },
    evidenceResolver: evidenceResolver(),
    judge: judge(calls),
  });

  await assert.rejects(
    adapter.score(request),
    (error: unknown) => {
      assertRuntimeUnavailable(error, /configuration is invalid/);
      return true;
    },
  );
  assert.equal(calls.length, 0);
});
