import { digestAgentBuildDefinition } from '../../lib/agent-build/digest.ts';
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
import type { CreationRun, Credential, Repository } from '../../shared/types.ts';
import type { CreationRunRef } from '../showcase/contracts.ts';
import type {
  CreateEvaluationJobInput,
  CreateEvaluationJobResult,
  EvaluationJobView,
  EvaluationTransitionResult,
} from '../evaluation/domain.ts';
import { toCreationBriefRecord, toCreationBriefVersionRow, toCreationRunRow } from '../creation-briefs.ts';
import { animationChallengeDigest } from '../animation-challenges.ts';
import { CREATION_ENVIRONMENT_DIGEST, CREATION_ENVIRONMENT_TEMPLATE } from './catalog.ts';
import { resolveCreationSkills } from './skills.ts';
import { creationProviderProvenance } from './provider-provenance.ts';

export interface CreationJobScheduler {
  createJob(input: CreateEvaluationJobInput): Promise<CreateEvaluationJobResult>;
  getJob(jobId: EvaluationJobView['id']): Promise<EvaluationJobView>;
  requestCancellation(jobId: EvaluationJobView['id'], reason?: 'user-requested'): Promise<EvaluationTransitionResult>;
  acknowledgeUnknown(jobId: EvaluationJobView['id']): Promise<EvaluationTransitionResult>;
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
  /** Grace period before a historical run without a durable job is treated as abandoned. */
  readonly orphanGraceMs?: number;
}

const ID = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$/u;
const DEFAULT_ORPHAN_GRACE_MS = 15 * 60 * 1000;

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
  if (state === 'running' || state === 'cancelling' || state === 'reconciling') return 'running';
  if (state === 'completed') return 'completed';
  if (state === 'cancelled') return 'cancelled';
  if (state === 'incomplete' || state === 'expired' || state === 'unknown') return 'incomplete';
  return 'failed';
}

export class CreationRunService {
  readonly #repository: Repository;
  readonly #scheduler: CreationJobScheduler;
  readonly #now: () => string;
  readonly #createId: () => string;
  readonly #orphanGraceMs: number;

  constructor(repository: Repository, options: CreationRunServiceOptions) {
    this.#repository = repository;
    this.#scheduler = options.scheduler;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#createId = options.createId ?? randomUUID;
    this.#orphanGraceMs = options.orphanGraceMs ?? DEFAULT_ORPHAN_GRACE_MS;
    ensure(Number.isSafeInteger(this.#orphanGraceMs) && this.#orphanGraceMs > 0,
      'Creation orphan grace period must be a positive safe integer.', 500, ERROR_CODES.RUNTIME_POLICY_DENIED);
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
      'The Build is pinned to a different creation challenge version.', 409, ERROR_CODES.RUNTIME_POLICY_DENIED);
    const build = (await this.#repository.read('builds', { id: buildVersion.buildId, userId: ownerId }))[0];
    ensure(build, 'Agent Build version not found.', 404, ERROR_CODES.VERSION_NOT_FOUND);
    const definition = validateConfiguredAgentBuild(buildVersion.agentDefinition, buildVersion.visibility, {
      requireModel: true,
      requireEnvironment: true,
      requireOutputContract: true,
      requireRuntime: true,
    });
    ensure(buildVersion.definitionDigest === digestAgentBuildDefinition(definition),
      'Build definition digest mismatch.', 409, ERROR_CODES.RUNTIME_POLICY_DENIED);
    ensure(definition.requestedCapabilities.length === 0 && definition.profileRef === null,
      'Custom execution capabilities are not enabled.', 409, ERROR_CODES.RUNTIME_POLICY_DENIED);
    ensure(buildVersion.definitionDigest && definition.environmentRef?.id === CREATION_ENVIRONMENT_TEMPLATE.templateId
      && definition.environmentRef.versionId === CREATION_ENVIRONMENT_TEMPLATE.versionId
      && definition.environmentRef.contentDigest === CREATION_ENVIRONMENT_DIGEST,
    'The Build does not use the approved creation sandbox.', 409, ERROR_CODES.RUNTIME_POLICY_DENIED);
    ensure(definition.runtimeSelection?.adapterVersion === CREATION_ENVIRONMENT_TEMPLATE.runtime.adapterVersion
      && definition.runtimeSelection.policyVersion === CREATION_ENVIRONMENT_TEMPLATE.runtime.policyVersion,
    'The Build runtime does not match the approved creation sandbox.', 409, ERROR_CODES.RUNTIME_POLICY_DENIED);

    // Runtime lookup is repository-driven. The two launch challenges are merely
    // seed data now; newly reviewed challenge versions require no code change.
    const challenge = (await this.#repository.read('animationChallengeVersions', { id: challengeVersionId }))[0];
    ensure(challenge && challenge.contentDigest === animationChallengeDigest(challenge),
      'Creation challenge version not found or failed integrity validation.', 404, ERROR_CODES.RESOURCE_NOT_FOUND);
    const challengeRecord = (await this.#repository.read('animationChallenges', { id: challenge.challengeId, status: 'published' }))[0];
    ensure(challengeRecord, 'Creation challenge is not published.', 409, ERROR_CODES.RUNTIME_POLICY_DENIED);

    const skills = await resolveCreationSkills(this.#repository, ownerId, definition.skillRefs);
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

    const snapshot = createSnapshot(run, credential, run.createdAt, skills.map((skill) => ({
      componentId: skill.ref.componentId,
      versionId: skill.ref.versionId,
      contentDigest: skill.ref.contentDigest,
      name: skill.name,
      description: skill.description,
    })));
    let accepted: CreateEvaluationJobResult;
    try {
      accepted = await this.#scheduler.createJob({
        userId: asOpaqueId<'user'>(ownerId),
        purpose: 'creation',
        association: { kind: 'creation-run', creationRunId: asOpaqueId<'creation-run'>(run.id) },
        snapshot,
        idempotencyKey: `creation:${key}`,
        budgetReservationId: null,
      });
    } catch (error) {
      // The CreationRun must exist before the evaluation transaction can claim
      // its foreign key. If scheduling is rejected (for example another active
      // job owns the user's slot), do not leave a phantom queued run behind.
      await this.#repository.update(
        'creationRuns',
        { id: run.id, ownerId, evaluationJobId: null },
        { status: 'failed', completedAt: this.#now(), updatedAt: this.#now() },
      );
      throw error;
    }
    const jobId = String(accepted.job.id);
    let associatedRun = (await this.#repository.read('creationRuns', { id: run.id, ownerId }))[0] ?? run;
    if (!associatedRun.evaluationJobId) {
      const claimed = await this.#repository.update(
        'creationRuns',
        { id: run.id, ownerId, evaluationJobId: null },
        { evaluationJobId: jobId, updatedAt: this.#now() },
      );
      associatedRun = claimed[0]
        ?? (await this.#repository.read('creationRuns', { id: run.id, ownerId }))[0]
        ?? associatedRun;
    }
    ensure(associatedRun.evaluationJobId === jobId,
      'Creation evaluation association is invalid.', 409, ERROR_CODES.RUNTIME_POLICY_DENIED);
    return { created: accepted.created, run: project(associatedRun), job: projectJob(accepted.job) };
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
    let run = await this.#readOwnedRun(ownerId, runId);
    if (!run.evaluationJobId) run = await this.#recoverAbandonedRun(run);
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

  async acknowledgeUnknown(ownerId: string, runId: string, acknowledgePotentialCharge: boolean): Promise<CreationRunStatusView> {
    ensure(acknowledgePotentialCharge === true,
      'Confirm that the provider request may already have incurred cost.', 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
    const run = await this.#readOwnedRun(ownerId, runId);
    ensure(run.evaluationJobId, 'Creation run has no evaluation job.', 409, ERROR_CODES.RUNTIME_POLICY_DENIED);
    const before = await this.#scheduler.getJob(asOpaqueId<'evaluation-job'>(run.evaluationJobId));
    this.#assertAssociatedJob(run, before);
    ensure(before.state === 'unknown',
      'Only an unknown upstream result can be acknowledged.', 409, ERROR_CODES.RUNTIME_POLICY_DENIED);
    const result = await this.#scheduler.acknowledgeUnknown(asOpaqueId<'evaluation-job'>(run.evaluationJobId));
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

  async #recoverAbandonedRun(run: CreationRun): Promise<CreationRun> {
    if (run.evaluationJobId || (run.status !== 'queued' && run.status !== 'running')) return run;
    const now = this.#now();
    const updatedAtMs = Date.parse(run.updatedAt);
    const nowMs = Date.parse(now);
    if (!Number.isFinite(updatedAtMs) || !Number.isFinite(nowMs) || nowMs - updatedAtMs < this.#orphanGraceMs) return run;

    // A committed job with this business association is authoritative even if
    // a legacy row missed the reverse FK. Never mark or replay such a run.
    const associatedJobs = (await this.#repository.read('evaluationJobs', {
      associationKind: 'creation-run',
      businessRecordId: run.id,
    })).filter((job) => job.userId === run.ownerId && job.purpose === 'creation');
    if (associatedJobs.length === 1) {
      const repaired = await this.#repository.update('creationRuns', {
        id: run.id,
        ownerId: run.ownerId,
        evaluationJobId: null,
        status: run.status,
        updatedAt: run.updatedAt,
      }, {
        evaluationJobId: associatedJobs[0].id,
        updatedAt: now,
      });
      return repaired[0] ?? (await this.#repository.read('creationRuns', { id: run.id, ownerId: run.ownerId }))[0] ?? run;
    }
    // Ambiguous historical data is left untouched for operator inspection.
    if (associatedJobs.length > 1) return run;

    const recovered = await this.#repository.update('creationRuns', {
      id: run.id,
      ownerId: run.ownerId,
      evaluationJobId: null,
      status: run.status,
      updatedAt: run.updatedAt,
    }, {
      status: 'failed',
      completedAt: now,
      updatedAt: now,
    });
    return recovered[0] ?? (await this.#repository.read('creationRuns', { id: run.id, ownerId: run.ownerId }))[0] ?? run;
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

function createSnapshot(
  run: CreationRun,
  credential: Credential,
  capturedAt: string,
  skills: readonly { componentId: string; versionId: string; contentDigest: string; name: string; description: string }[],
): EvaluationInputSnapshot {
  const provider = creationProviderProvenance(credential);
  const body = {
    schemaVersion: EVALUATION_SNAPSHOT_VERSION,
    buildVersionId: asOpaqueId<'build-version'>(run.buildVersionId),
    testSuiteVersionId: null,
    skillVersionId: skills.length === 1 ? asOpaqueId<'skill-version'>(skills[0].versionId) : null,
    runtimeAdapter: run.context.runtimeSelection.adapterVersion,
    modelOfferingId: credential.modelId,
    policyVersion: run.context.runtimeSelection.policyVersion,
    consentVersion: 'byok-creation-v2-public-provenance',
    credentialAuthorizationId: credential.id,
    capturedAt,
    metadata: {
      creationRunId: run.id,
      challengeVersionId: run.challengeVersionId,
      contextDigest: digestCreationBuildContext(run.context),
      environmentVersionId: run.environmentTemplateVersionId,
      providerClass: provider.providerClass,
      providerId: provider.providerId,
      providerHost: provider.providerHost,
      providerProtocol: provider.protocol,
      systemPromptVersion: 'creation-pi-v1',
      skills: skills.map((skill) => ({ ...skill })),
    },
  } as const;
  return Object.freeze({
    ...body,
    snapshotDigest: createHash('sha256').update(JSON.stringify(body)).digest('hex'),
  });
}
