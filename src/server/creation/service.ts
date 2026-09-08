import { createHash, randomUUID } from 'node:crypto';
import { AppError, ERROR_CODES, ensure } from '../../shared/errors.ts';
import {
  CREATION_RUN_CONTRACT_VERSION,
  digestCreationBriefVersion,
  digestCreationBuildContext,
  type CreationBriefVersionV1,
  type CreationBuildContextV1,
} from '../../shared/artifact-contract.ts';
import { validateConfiguredAgentBuild } from '../../shared/agent-build-contract.ts';
import {
  asOpaqueId,
  EVALUATION_SNAPSHOT_VERSION,
  type EvaluationInputSnapshot,
} from '../../shared/evaluation-types.ts';
import type { CreationRun, Repository } from '../../shared/types.ts';
import type { CreationRunRef } from '../showcase/contracts.ts';
import type {
  CreateEvaluationJobInput,
  CreateEvaluationJobResult,
  EvaluationJobView,
  EvaluationTransitionResult,
} from '../evaluation/domain.ts';
import { toCreationBriefRecord, toCreationBriefVersionRow, toCreationRunRow } from '../creation-briefs.ts';
import { ANIMATION_CHALLENGE_VERSIONS } from '../animation-challenges.ts';
import { CREATION_ENVIRONMENT_DIGEST, CREATION_ENVIRONMENT_TEMPLATE } from './catalog.ts';

export interface CreationJobScheduler {
  createJob(input: CreateEvaluationJobInput): Promise<CreateEvaluationJobResult>;
  getJob(jobId: EvaluationJobView['id']): Promise<EvaluationJobView>;
  requestCancellation(jobId: EvaluationJobView['id'], reason?: 'user-requested'): Promise<EvaluationTransitionResult>;
}

export interface ScheduleCreationRunInput {
  readonly buildVersionId: string;
  readonly challengeVersionId: string;
  readonly credentialId: string;
  readonly idempotencyKey: string;
}

export interface CreationRunView {
  readonly id: string;
  readonly buildId: string;
  readonly buildVersionId: string;
  readonly challengeVersionId: string | null;
  readonly evaluationJobId: string | null;
  readonly artifactBundleId: string | null;
  readonly status: CreationRun['status'];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
}

export interface CreationJobStatusView {
  readonly id: string;
  readonly state: EvaluationJobView['state'];
  readonly modelOfferingId: string | null;
  readonly snapshotDigest: string;
  readonly cancellationRequestedAt: string | null;
  readonly acceptedAt: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt: string | null;
  readonly completion: EvaluationJobView['completion'];
  readonly failure: EvaluationJobView['failure'];
}

export interface CreationRunStatusView {
  readonly run: CreationRunView;
  readonly job: CreationJobStatusView | null;
}

export interface CreationRunServiceOptions {
  readonly scheduler: CreationJobScheduler;
  readonly now?: () => string;
  readonly createId?: () => string;
}

const ID = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$/u;

function requiredId(value: unknown, label: string): string {
  ensure(typeof value === 'string' && ID.test(value), `A valid ${label} is required.`, 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
  return value;
}

function idempotency(value: unknown): string {
  ensure(typeof value === 'string' && value.trim().length > 0 && value.length <= 160,
    'An idempotency key is required.', 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
  return value.trim();
}

function deterministicId(prefix: string, ownerId: string, key: string): string {
  return `${prefix}-${createHash('sha256').update(`${ownerId}\0${key}`).digest('hex').slice(0, 32)}`;
}

function project(run: CreationRun): CreationRunView {
  return {
    id: run.id,
    buildId: run.buildId,
    buildVersionId: run.buildVersionId,
    challengeVersionId: run.challengeVersionId,
    evaluationJobId: run.evaluationJobId,
    artifactBundleId: run.artifactBundleId,
    status: run.status,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
  };
}

function projectJob(job: EvaluationJobView): CreationJobStatusView {
  return {
    id: String(job.id),
    state: job.state,
    modelOfferingId: job.snapshot.modelOfferingId,
    snapshotDigest: job.snapshot.snapshotDigest,
    cancellationRequestedAt: job.cancellationRequestedAt,
    acceptedAt: job.acceptedAt,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt,
    completion: job.completion,
    failure: job.failure,
  };
}

function jobStateToRunStatus(state: EvaluationJobView['state']): CreationRun['status'] {
  if (state === 'accepted' || state === 'queued') return 'queued';
  if (state === 'running' || state === 'cancelling' || state === 'reconciling' || state === 'unknown') return 'running';
  if (state === 'completed') return 'completed';
  if (state === 'cancelled') return 'cancelled';
  if (state === 'incomplete' || state === 'expired') return 'incomplete';
  return 'failed';
}

export class CreationRunService {
  readonly #repository: Repository;
  readonly #scheduler: CreationJobScheduler;
  readonly #now: () => string;
  readonly #createId: () => string;

  constructor(repository: Repository, options: CreationRunServiceOptions) {
    this.#repository = repository;
    this.#scheduler = options.scheduler;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#createId = options.createId ?? randomUUID;
  }

  async schedule(ownerId: string, input: ScheduleCreationRunInput): Promise<{ created: boolean; run: CreationRunView; job: CreationJobStatusView }> {
    requiredId(ownerId, 'owner');
    const buildVersionId = requiredId(input.buildVersionId, 'build version');
    const challengeVersionId = requiredId(input.challengeVersionId, 'challenge version');
    const credentialId = requiredId(input.credentialId, 'credential');
    const key = idempotency(input.idempotencyKey);

    const buildVersion = (await this.#repository.read('buildVersions', { id: buildVersionId }))[0];
    ensure(buildVersion && (buildVersion.mode ?? 'workflow') === 'agent', 'Agent Build version not found.', 404, ERROR_CODES.VERSION_NOT_FOUND);
    ensure(buildVersion.animationChallengeVersionId === challengeVersionId,
      'The Build is pinned to a different animation challenge version.', 409, ERROR_CODES.RUNTIME_POLICY_DENIED);
    const build = (await this.#repository.read('builds', { id: buildVersion.buildId, userId: ownerId }))[0];
    ensure(build, 'Agent Build version not found.', 404, ERROR_CODES.VERSION_NOT_FOUND);
    const definition = validateConfiguredAgentBuild(buildVersion.agentDefinition, buildVersion.visibility, {
      requireModel: true,
      requireEnvironment: true,
      requireOutputContract: true,
      requireRuntime: true,
    });
    ensure(buildVersion.definitionDigest && definition.environmentRef?.id === CREATION_ENVIRONMENT_TEMPLATE.templateId
      && definition.environmentRef.versionId === CREATION_ENVIRONMENT_TEMPLATE.versionId
      && definition.environmentRef.contentDigest === CREATION_ENVIRONMENT_DIGEST,
    'The Build does not use the approved animation sandbox.', 409, ERROR_CODES.RUNTIME_POLICY_DENIED);
    ensure(definition.runtimeSelection?.adapterVersion === CREATION_ENVIRONMENT_TEMPLATE.runtime.adapterVersion
      && definition.runtimeSelection.policyVersion === CREATION_ENVIRONMENT_TEMPLATE.runtime.policyVersion,
    'The Build runtime does not match the approved animation sandbox.', 409, ERROR_CODES.RUNTIME_POLICY_DENIED);

    const challenge = ANIMATION_CHALLENGE_VERSIONS.find((candidate) => candidate.id === challengeVersionId);
    ensure(challenge, 'Animation challenge version not found.', 404, ERROR_CODES.RESOURCE_NOT_FOUND);
    const credential = (await this.#repository.read('credentials', { id: credentialId, userId: ownerId }))[0];
    ensure(credential, 'A selected provider was deleted or is not yours.', 404, ERROR_CODES.PROVIDER_NOT_FOUND);

    const runId = deterministicId('creation-run', ownerId, key);
    const briefId = deterministicId('creation-brief', ownerId, runId);
    const briefVersionId = `${briefId}-v1`;
    const capturedAt = this.#now();
    const brief: CreationBriefVersionV1 = {
      schemaVersion: 1,
      briefId,
      versionId: briefVersionId,
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
    const context: CreationBuildContextV1 = {
      schemaVersion: CREATION_RUN_CONTRACT_VERSION,
      kind: 'creation',
      buildRef: { buildId: build.id, versionId: buildVersion.id, definitionDigest: buildVersion.definitionDigest },
      briefVersionRef: { briefId, versionId: briefVersionId, contentDigest: digestCreationBriefVersion(brief) },
      environmentVersionRef: {
        templateId: CREATION_ENVIRONMENT_TEMPLATE.templateId,
        versionId: CREATION_ENVIRONMENT_TEMPLATE.versionId,
        contentDigest: CREATION_ENVIRONMENT_DIGEST,
      },
      runtimeSelection: CREATION_ENVIRONMENT_TEMPLATE.runtime,
      trustLane: 'byok',
      outputContractRef: definition.outputContractRef,
    };

    let run = (await this.#repository.read('creationRuns', { id: runId, ownerId }))[0];
    if (!run) {
      run = toCreationRunRow({
        id: runId,
        ownerId,
        buildId: build.id,
        buildVersionId: buildVersion.id,
        briefId,
        briefVersionId,
        challengeVersionId,
        environmentTemplateId: CREATION_ENVIRONMENT_TEMPLATE.templateId,
        environmentTemplateVersionId: CREATION_ENVIRONMENT_TEMPLATE.versionId,
        status: 'queued',
        context,
        createdAt: capturedAt,
      });
      await this.#repository.transaction(async (tx) => {
        if (!(await tx.read('creationBriefs', { id: briefId }))[0]) {
          await tx.insert('creationBriefs', [toCreationBriefRecord(briefId, ownerId, capturedAt)]);
          await tx.insert('creationBriefVersions', [toCreationBriefVersionRow(brief, ownerId, capturedAt)]);
        }
        if (!(await tx.read('creationRuns', { id: runId }))[0]) await tx.insert('creationRuns', [run!]);
      });
    } else {
      ensure(run.buildVersionId === buildVersionId && run.challengeVersionId === challengeVersionId,
        'The idempotency key was already used for a different creation request.', 409, ERROR_CODES.REQUEST_VALIDATION_FAILED);
      if (run.evaluationJobId) {
        const existingJob = await this.#scheduler.getJob(asOpaqueId<'evaluation-job'>(run.evaluationJobId));
        this.#assertAssociatedJob(run, existingJob);
        ensure(existingJob.snapshot.credentialAuthorizationId === credential.id
          && existingJob.snapshot.modelOfferingId === credential.modelId,
        'The idempotency key was already used with a different provider authorization.',
        409, ERROR_CODES.REQUEST_VALIDATION_FAILED);
        const synced = await this.#syncRun(run, existingJob);
        return { created: false, run: project(synced), job: projectJob(existingJob) };
      }
    }

    const snapshot = createSnapshot(run, credential.modelId, credential.id, run.createdAt);
    const accepted = await this.#scheduler.createJob({
      userId: asOpaqueId<'user'>(ownerId),
      purpose: 'creation',
      association: { kind: 'creation-run', creationRunId: asOpaqueId<'creation-run'>(run.id) },
      snapshot,
      idempotencyKey: `creation:${key}`,
      budgetReservationId: null,
    });
    const updated = await this.#repository.update('creationRuns', { id: run.id, ownerId }, {
      evaluationJobId: String(accepted.job.id),
      status: jobStateToRunStatus(accepted.job.state),
      updatedAt: this.#now(),
    });
    return { created: accepted.created, run: project(updated[0] ?? run), job: projectJob(accepted.job) };
  }

  async getCreationRun(runId: string, ownerId: string): Promise<CreationRunRef | null> {
    requiredId(ownerId, 'owner');
    const run = (await this.#repository.read('creationRuns', {
      id: requiredId(runId, 'creation run'),
      ownerId,
    }))[0];
    if (!run) return null;
    return {
      id: run.id,
      ownerId: run.ownerId,
      purpose: 'creation',
      status: run.status,
      artifactBundleId: run.artifactBundleId,
      buildVersionId: run.buildVersionId,
      briefVersionId: run.briefVersionId,
    };
  }

  async get(ownerId: string, runId: string): Promise<CreationRunStatusView> {
    const run = await this.#readOwnedRun(ownerId, runId);
    if (!run.evaluationJobId) return { run: project(run), job: null };
    const job = await this.#scheduler.getJob(asOpaqueId<'evaluation-job'>(run.evaluationJobId));
    this.#assertAssociatedJob(run, job);
    const synced = await this.#syncRun(run, job);
    return { run: project(synced), job: projectJob(job) };
  }

  async cancel(ownerId: string, runId: string): Promise<CreationRunStatusView> {
    const run = await this.#readOwnedRun(ownerId, runId);
    ensure(run.evaluationJobId, 'Creation run has no evaluation job.', 409, ERROR_CODES.RUNTIME_POLICY_DENIED);
    const before = await this.#scheduler.getJob(asOpaqueId<'evaluation-job'>(run.evaluationJobId));
    this.#assertAssociatedJob(run, before);
    const result = await this.#scheduler.requestCancellation(asOpaqueId<'evaluation-job'>(run.evaluationJobId), 'user-requested');
    const synced = await this.#syncRun(run, result.job);
    return { run: project(synced), job: projectJob(result.job) };
  }

  async retry(ownerId: string, runId: string, idempotencyKey: string): Promise<{ created: boolean; run: CreationRunView; job: CreationJobStatusView }> {
    const run = await this.#readOwnedRun(ownerId, runId);
    ensure(run.evaluationJobId, 'Creation run has no evaluation job.', 409, ERROR_CODES.RUNTIME_POLICY_DENIED);
    const job = await this.#scheduler.getJob(asOpaqueId<'evaluation-job'>(run.evaluationJobId));
    this.#assertAssociatedJob(run, job);
    ensure(['failed', 'cancelled', 'incomplete', 'expired'].includes(job.state),
      'Only a terminal unsuccessful creation run can be retried.', 409, ERROR_CODES.RUNTIME_POLICY_DENIED);
    ensure(job.snapshot.credentialAuthorizationId, 'The original provider authorization is no longer available.', 409, ERROR_CODES.PROVIDER_NOT_FOUND);
    return this.schedule(ownerId, {
      buildVersionId: run.buildVersionId,
      challengeVersionId: requiredId(run.challengeVersionId, 'challenge version'),
      credentialId: job.snapshot.credentialAuthorizationId,
      idempotencyKey: idempotency(idempotencyKey),
    });
  }

  async #readOwnedRun(ownerId: string, runId: string): Promise<CreationRun> {
    requiredId(ownerId, 'owner');
    const run = (await this.#repository.read('creationRuns', { id: requiredId(runId, 'creation run'), ownerId }))[0];
    ensure(run, 'Creation run not found.', 404, ERROR_CODES.RESOURCE_NOT_FOUND);
    return run;
  }

  #assertAssociatedJob(run: CreationRun, job: EvaluationJobView): void {
    ensure(job.userId === run.ownerId && job.purpose === 'creation'
      && job.association.kind === 'creation-run' && String(job.association.creationRunId) === run.id,
    'Creation evaluation association is invalid.', 409, ERROR_CODES.RUNTIME_POLICY_DENIED);
  }

  async #syncRun(run: CreationRun, job: EvaluationJobView): Promise<CreationRun> {
    if (run.status === 'completed' && run.artifactBundleId) return run;
    const status = jobStateToRunStatus(job.state);
    const completedBundleId = status === 'completed'
      && typeof job.completion?.summary?.artifactBundleId === 'string'
      && ID.test(job.completion.summary.artifactBundleId)
      ? job.completion.summary.artifactBundleId
      : null;
    if (status === run.status
      && (!job.completedAt || run.completedAt === job.completedAt)
      && (!completedBundleId || run.artifactBundleId === completedBundleId)) return run;
    const updated = await this.#repository.update('creationRuns', { id: run.id, ownerId: run.ownerId }, {
      status,
      updatedAt: this.#now(),
      ...(job.completedAt ? { completedAt: job.completedAt } : {}),
      ...(completedBundleId ? { artifactBundleId: completedBundleId } : {}),
    });
    return updated[0] ?? run;
  }
}

function createSnapshot(run: CreationRun, modelId: string, credentialId: string, capturedAt: string): EvaluationInputSnapshot {
  const body = {
    schemaVersion: EVALUATION_SNAPSHOT_VERSION,
    buildVersionId: asOpaqueId<'build-version'>(run.buildVersionId),
    testSuiteVersionId: null,
    skillVersionId: null,
    runtimeAdapter: run.context.runtimeSelection.adapterVersion,
    modelOfferingId: modelId,
    policyVersion: run.context.runtimeSelection.policyVersion,
    consentVersion: 'byok-creation-v1',
    credentialAuthorizationId: credentialId,
    capturedAt,
    metadata: {
      creationRunId: run.id,
      challengeVersionId: run.challengeVersionId,
      contextDigest: digestCreationBuildContext(run.context),
      environmentVersionId: run.environmentTemplateVersionId,
    },
  } as const;
  return Object.freeze({
    ...body,
    snapshotDigest: createHash('sha256').update(JSON.stringify(body)).digest('hex'),
  });
}
