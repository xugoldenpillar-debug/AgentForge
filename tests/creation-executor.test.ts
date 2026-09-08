import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import type { AIProvider, AIRequest, AIResult } from '../src/lib/ai/types.ts';
import { digestAgentBuildDefinition } from '../src/lib/agent-build/digest.ts';
import { encryptCredential } from '../src/lib/crypto/credentials.ts';
import {
  digestCreationBriefVersion,
  digestCreationBuildContext,
  type CreationBriefVersionV1,
  type CreationBuildContextV1,
} from '../src/shared/artifact-contract.ts';
import { asOpaqueId, type EvaluationInputSnapshot } from '../src/shared/evaluation-types.ts';
import type { Credential, EvaluationJobRow } from '../src/shared/types.ts';
import { EvaluationRepositoryAdapter } from '../src/db/evaluation-repository.ts';
import { toCreationBriefVersionRow, toCreationRunRow } from '../src/server/creation-briefs.ts';
import {
  CREATION_AGENT_BUILD_CONTRACT,
  CREATION_ENVIRONMENT_DIGEST,
  CREATION_ENVIRONMENT_TEMPLATE,
} from '../src/server/creation/catalog.ts';
import { CreationEvaluationExecutor } from '../src/server/evaluation/creation-executor.ts';
import type { EvaluationJobRecord } from '../src/server/evaluation/domain.ts';
import type { EvaluationExecutionContext } from '../src/server/evaluation/queue/ports.ts';
import type { ArtifactStorageWriteRequest, ArtifactStorageWriteResult, ArtifactStorageWriter } from '../src/server/artifacts/access.ts';
import { InMemorySandboxProvider } from '../src/server/sandbox/in-memory.ts';
import type { SandboxControlResult, SandboxHandle } from '../src/server/sandbox/types.ts';
import { ANIMATION_CHALLENGE_VERSIONS } from '../src/server/animation-challenges.ts';
import { MemoryRepository } from './helpers/memory-repository.ts';

const NOW = '2026-09-08T02:00:00.000Z';
const OWNER = 'creation-executor-owner';
const BUILD_ID = 'creation-executor-build';
const BUILD_VERSION_ID = 'creation-executor-build-v1';
const BRIEF_ID = 'creation-executor-brief';
const BRIEF_VERSION_ID = 'creation-executor-brief-v1';
const RUN_ID = 'creation-executor-run';
const JOB_ID = 'creation-executor-job';
const ATTEMPT_ID = 'creation-executor-attempt';
const CREDENTIAL_ID = 'creation-executor-credential';
const MODEL_ID = 'model-executor-test';
const API_KEY = 'private-test-key-never-leak';
const challenge = ANIMATION_CHALLENGE_VERSIONS[0];
const definition = Object.freeze({
  mode: 'agent' as const,
  definitionSchemaVersion: 1 as const,
  instructions: 'Create a clear SVG animation with declarative motion.',
  ...CREATION_AGENT_BUILD_CONTRACT,
  skillRefs: [],
  requestedCapabilities: [],
  profileRef: null,
});

class TrackingSandbox extends InMemorySandboxProvider {
  createCalls = 0;
  disposeCalls = 0;
  failDispose = false;
  beforeDispose?: () => Promise<void>;

  override async create(...args: Parameters<InMemorySandboxProvider['create']>): Promise<SandboxHandle> {
    this.createCalls += 1;
    return super.create(...args);
  }

  override async dispose(sandbox: SandboxHandle): Promise<SandboxControlResult> {
    this.disposeCalls += 1;
    await this.beforeDispose?.();
    if (this.failDispose) throw new Error('sandbox cleanup unavailable');
    return super.dispose(sandbox);
  }
}

class MemoryArtifactWriter implements ArtifactStorageWriter {
  readonly writes: ArtifactStorageWriteRequest[] = [];
  readonly removals: Array<Pick<ArtifactStorageWriteRequest, 'storageKey' | 'objectVersion'>> = [];

  async write(request: ArtifactStorageWriteRequest): Promise<ArtifactStorageWriteResult> {
    this.writes.push({ ...request, bytes: new Uint8Array(request.bytes) });
    return { storageKey: request.storageKey, objectVersion: request.objectVersion };
  }

  async remove(request: Pick<ArtifactStorageWriteRequest, 'storageKey' | 'objectVersion'>): Promise<void> {
    this.removals.push({ ...request });
  }
}

class ScriptedProvider implements AIProvider {
  readonly id = 'creation-executor-provider';
  readonly pricing = { inputPrice: null, outputPrice: null };
  readonly requests: AIRequest[] = [];
  private replies: readonly (string | Error)[];

  constructor(replies: readonly (string | Error)[]) {
    this.replies = replies;
  }

  async execute(request: AIRequest): Promise<AIResult> {
    this.requests.push(request);
    const reply = this.replies[this.requests.length - 1];
    if (reply instanceof Error) throw reply;
    if (reply === undefined) throw new Error('Unexpected provider turn.');
    return {
      text: reply,
      inputTokens: 10,
      outputTokens: 20,
      reasoningTokens: 0,
      toolCalls: 0,
      latency: 5,
      cost: null,
      estimated: false,
    };
  }
}

interface FixtureOptions {
  readonly credential?: 'valid' | 'missing' | 'mismatch';
  readonly jobState?: EvaluationJobRow['state'];
  readonly replies?: readonly (string | Error)[];
  readonly disposeFailure?: boolean;
}

async function fixture(options: FixtureOptions = {}) {
  const repository = new MemoryRepository();
  const evaluationRepository = new EvaluationRepositoryAdapter(repository, () => NOW);
  const sandbox = new TrackingSandbox();
  sandbox.failDispose = options.disposeFailure ?? false;
  const storage = new MemoryArtifactWriter();
  const encryptionKey = randomBytes(32).toString('base64');
  const provider = new ScriptedProvider(options.replies ?? [
    '<!doctype html><html><body><svg><animate attributeName="opacity" values="0;1" dur="1s" repeatCount="indefinite"/></svg></body></html>',
    '{"final":"done"}',
  ]);
  let receivedApiKey: string | null = null;

  const brief: CreationBriefVersionV1 = {
    schemaVersion: 1,
    briefId: BRIEF_ID,
    versionId: BRIEF_VERSION_ID,
    versionNumber: 1,
    title: challenge.title,
    instructions: challenge.instructions,
    inputAttachments: [],
    outputPolicy: {
      allowedMediaTypes: ['text/html', 'image/svg+xml', 'text/css', 'text/markdown', 'text/plain'],
      maxArtifacts: 16,
      maxArtifactBytes: 4 * 1024 * 1024,
      maxTotalBytes: 16 * 1024 * 1024,
      requiredPaths: ['index.html'],
    },
  };
  const contextValue: CreationBuildContextV1 = {
    schemaVersion: 1,
    kind: 'creation',
    buildRef: { buildId: BUILD_ID, versionId: BUILD_VERSION_ID, definitionDigest: digestAgentBuildDefinition(definition) },
    briefVersionRef: { briefId: BRIEF_ID, versionId: BRIEF_VERSION_ID, contentDigest: digestCreationBriefVersion(brief) },
    environmentVersionRef: {
      templateId: CREATION_ENVIRONMENT_TEMPLATE.templateId,
      versionId: CREATION_ENVIRONMENT_TEMPLATE.versionId,
      contentDigest: CREATION_ENVIRONMENT_DIGEST,
    },
    runtimeSelection: CREATION_ENVIRONMENT_TEMPLATE.runtime,
    trustLane: 'byok',
    outputContractRef: definition.outputContractRef,
  };
  const snapshotBody = {
    schemaVersion: 1 as const,
    buildVersionId: asOpaqueId<'build-version'>(BUILD_VERSION_ID),
    testSuiteVersionId: null,
    skillVersionId: null,
    runtimeAdapter: CREATION_ENVIRONMENT_TEMPLATE.runtime.adapterVersion,
    modelOfferingId: MODEL_ID,
    policyVersion: CREATION_ENVIRONMENT_TEMPLATE.runtime.policyVersion,
    consentVersion: 'byok-creation-v1',
    credentialAuthorizationId: CREDENTIAL_ID,
    capturedAt: NOW,
    metadata: {
      creationRunId: RUN_ID,
      challengeVersionId: challenge.id,
      contextDigest: digestCreationBuildContext(contextValue),
      environmentVersionId: CREATION_ENVIRONMENT_TEMPLATE.versionId,
    },
  };
  const snapshot: EvaluationInputSnapshot = {
    ...snapshotBody,
    snapshotDigest: `sha256:${'a'.repeat(64)}`,
  };
  const job: EvaluationJobRecord = {
    id: asOpaqueId<'evaluation-job'>(JOB_ID),
    userId: asOpaqueId<'user'>(OWNER),
    purpose: 'creation',
    association: { kind: 'creation-run', creationRunId: asOpaqueId<'creation-run'>(RUN_ID) },
    state: options.jobState ?? 'running',
    snapshot,
    idempotency: { scope: 'evaluation-job-create', key: 'creation-executor-request', requestDigest: `sha256:${'b'.repeat(64)}` },
    budgetReservationId: null,
    cancellationReason: options.jobState === 'cancelling' ? 'user-requested' : null,
    acceptedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    completedAt: null,
    executionToken: 'execution-token-not-secret',
    cancellationRequestedAt: options.jobState === 'cancelling' ? NOW : null,
    completion: null,
    failure: null,
  };
  const jobRow: EvaluationJobRow = {
    id: JOB_ID,
    userId: OWNER,
    purpose: 'creation',
    associationKind: 'creation-run',
    businessRecordId: RUN_ID,
    competitiveRunId: null,
    associationVisibility: null,
    snapshot,
    snapshotDigest: snapshot.snapshotDigest,
    idempotencyScope: 'evaluation-job-create',
    idempotencyKey: 'creation-executor-request',
    requestDigest: `sha256:${'b'.repeat(64)}`,
    budgetReservationId: null,
    state: options.jobState ?? 'running',
    stateVersion: 1,
    executionToken: job.executionToken,
    cancellationReason: job.cancellationReason,
    cancellationRequestedAt: job.cancellationRequestedAt,
    completion: null,
    failure: null,
    acceptedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    completedAt: null,
  };
  await repository.insert('buildVersions', [{
    id: BUILD_VERSION_ID,
    buildId: BUILD_ID,
    revision: 1,
    title: 'Executor build',
    visibility: 'private',
    createdAt: NOW,
    mode: 'agent',
    agentDefinition: definition,
    definitionDigest: digestAgentBuildDefinition(definition),
    animationChallengeVersionId: challenge.id,
  }]);
  await repository.insert('creationBriefVersions', [toCreationBriefVersionRow(brief, OWNER, NOW)]);
  await repository.insert('environmentTemplateVersions', [{
    id: CREATION_ENVIRONMENT_TEMPLATE.versionId,
    templateId: CREATION_ENVIRONMENT_TEMPLATE.templateId,
    versionNumber: CREATION_ENVIRONMENT_TEMPLATE.versionNumber,
    name: CREATION_ENVIRONMENT_TEMPLATE.name,
    description: CREATION_ENVIRONMENT_TEMPLATE.description,
    runtimeKind: 'pi',
    runtimeAdapterVersion: CREATION_ENVIRONMENT_TEMPLATE.runtime.adapterVersion,
    runtimePolicyVersion: CREATION_ENVIRONMENT_TEMPLATE.runtime.policyVersion,
    capabilities: CREATION_ENVIRONMENT_TEMPLATE.capabilities,
    limits: CREATION_ENVIRONMENT_TEMPLATE.limits,
    artifactPolicy: CREATION_ENVIRONMENT_TEMPLATE.artifactPolicy,
    contentDigest: CREATION_ENVIRONMENT_DIGEST,
    createdAt: NOW,
  }]);
  await repository.insert('creationRuns', [toCreationRunRow({
    id: RUN_ID,
    ownerId: OWNER,
    buildId: BUILD_ID,
    buildVersionId: BUILD_VERSION_ID,
    briefId: BRIEF_ID,
    briefVersionId: BRIEF_VERSION_ID,
    challengeVersionId: challenge.id,
    environmentTemplateId: CREATION_ENVIRONMENT_TEMPLATE.templateId,
    environmentTemplateVersionId: CREATION_ENVIRONMENT_TEMPLATE.versionId,
    evaluationJobId: JOB_ID,
    status: 'queued',
    context: contextValue,
    createdAt: NOW,
  })]);
  await repository.insert('evaluationJobs', [jobRow]);
  if (options.credential !== 'missing') {
    const credential: Credential = {
      id: CREDENTIAL_ID,
      userId: OWNER,
      protocol: 'openai-chat',
      name: 'Executor credential',
      baseUrl: 'https://api.example.invalid/v1',
      modelId: options.credential === 'mismatch' ? 'different-model' : MODEL_ID,
      ciphertext: encryptCredential(API_KEY, encryptionKey, OWNER, CREDENTIAL_ID),
      lastFour: 'leak',
      inputPrice: null,
      outputPrice: null,
      createdAt: NOW,
    };
    await repository.insert('credentials', [credential]);
  }

  const executor = new CreationEvaluationExecutor({
    repository,
    evaluationRepository,
    sandbox,
    storage,
    encryptionKey,
    sandboxImageDigest: `sha256:${'c'.repeat(64)}`,
    createProvider: (_credential, apiKey) => {
      receivedApiKey = apiKey;
      return provider;
    },
    now: () => NOW,
    pollCancellationMs: 5,
  });
  const execution: EvaluationExecutionContext = {
    job,
    attempt: {
      id: asOpaqueId<'evaluation-attempt'>(ATTEMPT_ID),
      jobId: job.id,
      number: 1,
      state: 'running',
      workerLeaseId: 'lease-one',
      startedAt: NOW,
      finishedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    },
    workerId: 'worker-one',
    executionToken: job.executionToken!,
    message: {
      eventId: asOpaqueId<'evaluation-outbox-event'>('creation-executor-event'),
      version: 1,
      kind: 'evaluation-job-accepted',
      jobId: job.id,
      requestDigest: job.idempotency.requestDigest,
      payload: { jobId: job.id, snapshotDigest: snapshot.snapshotDigest },
      enqueuedAt: NOW,
    },
  };
  let runStatusAtDispose: string | undefined;
  sandbox.beforeDispose = async () => {
    runStatusAtDispose = (await repository.read('creationRuns', { id: RUN_ID }))[0]?.status;
  };
  return {
    repository,
    evaluationRepository,
    sandbox,
    storage,
    provider,
    executor,
    execution,
    getReceivedApiKey: () => receivedApiKey,
    getRunStatusAtDispose: () => runStatusAtDispose,
  };
}

test('Creation executor seals the final bundle, links the run, records usage, disposes the sandbox, and does not leak the API key', async () => {
  const f = await fixture();
  const outcome = await f.executor.execute(f.execution);
  assert.equal(outcome.kind, 'completed');
  const run = (await f.repository.read('creationRuns', { id: RUN_ID }))[0];
  assert.equal(run?.status, 'completed');
  assert.ok(run?.artifactBundleId);
  assert.equal((await f.repository.read('artifactBundles', { id: run!.artifactBundleId! })).length, 1);
  assert.equal((await f.repository.read('artifacts', { bundleId: run!.artifactBundleId! })).length, 1);
  const invocations = await f.repository.read('evaluationInvocations', { jobId: JOB_ID });
  assert.equal(invocations.length, 1);
  assert.deepEqual(invocations.map((invocation) => invocation.invocationIndex), [1]);
  assert.equal((await f.repository.read('evaluationUsageRecords', { jobId: JOB_ID })).length, 1);
  assert.equal(f.provider.requests.length, 1);
  assert.equal(f.sandbox.createCalls, 1);
  assert.equal(f.sandbox.disposeCalls, 1);
  assert.equal(f.getRunStatusAtDispose(), 'running');
  assert.equal(f.getReceivedApiKey(), API_KEY);

  const publicEvidence = JSON.stringify({
    state: f.repository.state,
    requests: f.provider.requests,
    writes: f.storage.writes,
    outcome,
  });
  assert.doesNotMatch(publicEvidence, new RegExp(API_KEY));
});

test('Creation executor rejects missing or changed credentials before creating a sandbox', async () => {
  for (const credential of ['missing', 'mismatch'] as const) {
    const f = await fixture({ credential });
    const outcome = await f.executor.execute(f.execution);
    assert.deepEqual(outcome, { kind: 'failed', failure: { code: 'PROVIDER_AUTHORIZATION_REVOKED', retryable: false } });
    assert.equal((await f.repository.read('creationRuns', { id: RUN_ID }))[0]?.status, 'failed');
    assert.equal(f.sandbox.createCalls, 0);
    assert.equal(f.sandbox.disposeCalls, 0);
  }
});

test('Unknown provider results leave the CreationRun incomplete and are never treated as retry-safe', async () => {
  const f = await fixture({ replies: [new Error('provider may have accepted the request')] });
  const outcome = await f.executor.execute(f.execution);
  assert.deepEqual(outcome, { kind: 'unknown', code: 'UPSTREAM_RESULT_UNKNOWN' });
  assert.equal((await f.repository.read('creationRuns', { id: RUN_ID }))[0]?.status, 'incomplete');
  assert.equal((await f.repository.read('evaluationUsageRecords', { jobId: JOB_ID }))[0]?.certainty, 'unknown');
  assert.equal(f.sandbox.disposeCalls, 1);
  assert.equal('failure' in outcome, false);
});

test('Creation executor disposes the sandbox after output failure and cancellation', async () => {
  const failed = await fixture({ replies: ['{"final":"no artifact written"}'] });
  const failedOutcome = await failed.executor.execute(failed.execution);
  assert.equal(failedOutcome.kind, 'failed');
  assert.equal((await failed.repository.read('creationRuns', { id: RUN_ID }))[0]?.status, 'failed');
  assert.equal(failed.sandbox.disposeCalls, 1);

  const cancelled = await fixture({ jobState: 'cancelling' });
  const cancelledOutcome = await cancelled.executor.execute(cancelled.execution);
  assert.deepEqual(cancelledOutcome, { kind: 'cancelled' });
  assert.equal((await cancelled.repository.read('creationRuns', { id: RUN_ID }))[0]?.status, 'cancelled');
  assert.equal(cancelled.sandbox.createCalls, 1);
  assert.equal(cancelled.sandbox.disposeCalls, 1);
  assert.equal(cancelled.provider.requests.length, 0);
});


test('Creation executor leaves sealed evidence incomplete when sandbox cleanup cannot be verified', async () => {
  const f = await fixture({ disposeFailure: true });
  const outcome = await f.executor.execute(f.execution);
  assert.equal(outcome.kind, 'incomplete');
  assert.equal(outcome.kind === 'incomplete' ? outcome.completion.evidence : undefined, 'partial');
  assert.equal(outcome.kind === 'incomplete' ? outcome.completion.summary?.cleanupStatus : undefined, 'unverified');
  assert.equal(outcome.kind === 'incomplete' ? outcome.completion.summary?.failureCode : undefined, 'SANDBOX_CLEANUP_UNVERIFIED');

  const run = (await f.repository.read('creationRuns', { id: RUN_ID }))[0];
  assert.equal(run?.status, 'incomplete');
  assert.ok(run?.artifactBundleId);
  assert.equal(outcome.kind === 'incomplete' ? outcome.completion.summary?.artifactBundleId : undefined, run?.artifactBundleId);
  assert.equal((await f.repository.read('artifactBundles', { id: run!.artifactBundleId! })).length, 1);
  assert.equal(f.getRunStatusAtDispose(), 'running');
  assert.equal(f.sandbox.disposeCalls, 1);
});
