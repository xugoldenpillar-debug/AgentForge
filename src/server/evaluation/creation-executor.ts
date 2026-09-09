import { createHash } from 'node:crypto';
import { AppError, ERROR_CODES, ensure } from '../../shared/errors.ts';
import { validateConfiguredAgentBuild } from '../../shared/agent-build-contract.ts';
import { digestAgentBuildDefinition } from '../../lib/agent-build/digest.ts';
import { digestCreationBuildContext, parseCreationBriefVersion } from '../../shared/artifact-contract.ts';
import { decryptCredential } from '../../lib/crypto/credentials.ts';
import type { AIProvider } from '../../lib/ai/types.ts';
import type { CreationRun, Credential, Repository } from '../../shared/types.ts';
import { collectArtifacts } from '../artifacts/collector.ts';
import { sealArtifactBundle } from '../artifacts/seal.ts';
import type { ArtifactStorageWriter } from '../artifacts/access.ts';
import { loadPiCoreModule } from '../runtime/pi/load.ts';
import { runCreationWithPi } from '../creation/runner.ts';
import { CREATION_ENVIRONMENT_DIGEST, CREATION_ENVIRONMENT_TEMPLATE } from '../creation/catalog.ts';
import type { SandboxHandle, SandboxProvider } from '../sandbox/types.ts';
import type { EvaluationAttemptExecutor, EvaluationExecutionContext, EvaluationExecutionOutcome } from './queue/ports.ts';
import type { EvaluationRepository } from '../../db/evaluation-repository.ts';
import { InvocationRecordingProvider, UnknownProviderResultError } from './invocation/recording-provider.ts';

export interface CreationEvaluationExecutorOptions {
  readonly repository: Repository;
  readonly evaluationRepository: EvaluationRepository;
  readonly sandbox: SandboxProvider;
  readonly storage: ArtifactStorageWriter;
  readonly encryptionKey: string;
  readonly sandboxImageDigest: string;
  readonly createProvider: (credential: Credential, apiKey: string) => AIProvider;
  readonly now?: () => string;
  readonly pollCancellationMs?: number;
}

function failure(code: string, retryable = false): EvaluationExecutionOutcome {
  return { kind: 'failed', failure: { code, retryable } };
}

function isCancelled(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (error instanceof AppError && error.code === ERROR_CODES.RUN_CANCELLED);
}

type CreationExecutionStage =
  | 'state-update'
  | 'pi-load'
  | 'sandbox-start'
  | 'sandbox-mount'
  | 'pi-run'
  | 'artifact-stop'
  | 'artifact-snapshot'
  | 'artifact-collect'
  | 'artifact-seal';

class CreationExecutionAuthorizationLostError extends AppError {
  constructor() {
    super('Creation execution lease is no longer authorized.', 409, ERROR_CODES.RUNTIME_POLICY_DENIED);
    this.name = 'CreationExecutionAuthorizationLostError';
  }
}

function creationFailureCode(error: unknown, stage: CreationExecutionStage): string {
  if (error instanceof CreationExecutionAuthorizationLostError) {
    return 'CREATION_EXECUTION_AUTHORIZATION_LOST';
  }
  if (error instanceof AppError) {
    const artifactInputFailure = error.code === ERROR_CODES.RUNTIME_POLICY_DENIED
      || error.code === ERROR_CODES.REQUEST_VALIDATION_FAILED
      || error.code === ERROR_CODES.REQUEST_BODY_TOO_LARGE
      || error.code === ERROR_CODES.RESOURCE_NOT_FOUND;
    if (stage === 'pi-run' && artifactInputFailure) return 'CREATION_ARTIFACT_POLICY_DENIED';
    if ((stage === 'artifact-stop' || stage === 'artifact-snapshot' || stage === 'artifact-collect')
      && artifactInputFailure) {
      return 'CREATION_ARTIFACT_COLLECTION_FAILED';
    }
    if (stage === 'artifact-seal' && artifactInputFailure) return 'CREATION_ARTIFACT_SEAL_FAILED';
    if (error.code === ERROR_CODES.RUNTIME_UNAVAILABLE) {
      if (stage === 'sandbox-start' || stage === 'sandbox-mount') return 'CREATION_SANDBOX_START_FAILED';
      if (stage === 'artifact-stop' || stage === 'artifact-snapshot' || stage === 'artifact-collect') {
        return 'CREATION_ARTIFACT_COLLECTION_FAILED';
      }
      if (stage === 'artifact-seal') return 'CREATION_ARTIFACT_SEAL_FAILED';
      return 'CREATION_PI_RUNTIME_FAILED';
    }
    if (error.code) return error.code;
  }
  if (stage === 'pi-load' || stage === 'pi-run') return 'CREATION_PI_RUNTIME_FAILED';
  if (stage === 'sandbox-start' || stage === 'sandbox-mount') return 'CREATION_SANDBOX_START_FAILED';
  if (stage === 'artifact-stop' || stage === 'artifact-snapshot' || stage === 'artifact-collect') {
    return 'CREATION_ARTIFACT_COLLECTION_FAILED';
  }
  if (stage === 'artifact-seal') return 'CREATION_ARTIFACT_SEAL_FAILED';
  return 'CREATION_EXECUTION_FAILED';
}

export class CreationEvaluationExecutor implements EvaluationAttemptExecutor {
  readonly #options: CreationEvaluationExecutorOptions;
  readonly #now: () => string;

  constructor(options: CreationEvaluationExecutorOptions) {
    this.#options = options;
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  async execute(context: EvaluationExecutionContext): Promise<EvaluationExecutionOutcome> {
    if (context.job.purpose !== 'creation' || context.job.association.kind !== 'creation-run') {
      return failure('UNSUPPORTED_EVALUATION_PURPOSE');
    }
    const runId = String(context.job.association.creationRunId);
    const ownerId = String(context.job.userId);
    const jobId = String(context.job.id);
    let run = (await this.#options.repository.read('creationRuns', { id: runId, ownerId }))[0];
    if (!run) return failure('CREATION_RUN_NOT_FOUND');
    if (!run.evaluationJobId) {
      // Older releases could publish the durable job before writing the reverse
      // CreationRun association. The job itself already carries the immutable
      // run id and owner, so claim only a still-null link before doing any
      // provider work. A conflicting non-null link remains a hard failure.
      const repaired = await this.#options.repository.update(
        'creationRuns',
        { id: runId, ownerId, evaluationJobId: null },
        { evaluationJobId: jobId, updatedAt: this.#now() },
      );
      run = repaired[0]
        ?? (await this.#options.repository.read('creationRuns', { id: runId, ownerId }))[0]
        ?? run;
    }
    if (run.evaluationJobId !== jobId) return failure('CREATION_JOB_ASSOCIATION_MISMATCH');
    if (context.job.snapshot.snapshotDigest !== context.message.payload.snapshotDigest) return failure('EVALUATION_SNAPSHOT_DIGEST_MISMATCH');

    const buildVersion = (await this.#options.repository.read('buildVersions', { id: run.buildVersionId, buildId: run.buildId }))[0];
    const briefRow = (await this.#options.repository.read('creationBriefVersions', { id: run.briefVersionId, briefId: run.briefId, ownerId: run.ownerId }))[0];
    const environment = (await this.#options.repository.read('environmentTemplateVersions', { id: run.environmentTemplateVersionId, templateId: run.environmentTemplateId }))[0];
    const credentialId = context.job.snapshot.credentialAuthorizationId;
    if (!buildVersion || !briefRow || !environment || !credentialId) return failure('CREATION_SNAPSHOT_DEPENDENCY_MISSING');

    try {
      const definition = validateConfiguredAgentBuild(buildVersion.agentDefinition, buildVersion.visibility, {
        requireModel: true, requireEnvironment: true, requireOutputContract: true, requireRuntime: true,
      });
      ensure(buildVersion.definitionDigest === digestAgentBuildDefinition(definition), 'Build definition digest mismatch.', 409, ERROR_CODES.RUNTIME_POLICY_DENIED);
      ensure(digestCreationBuildContext(run.context) === run.contextDigest, 'Creation context digest mismatch.', 409, ERROR_CODES.RUNTIME_POLICY_DENIED);
      ensure(environment.contentDigest === CREATION_ENVIRONMENT_DIGEST && environment.id === CREATION_ENVIRONMENT_TEMPLATE.versionId,
        'Creation environment is not approved.', 409, ERROR_CODES.RUNTIME_POLICY_DENIED);
      ensure(context.job.snapshot.buildVersionId === run.buildVersionId
        && context.job.snapshot.runtimeAdapter === run.context.runtimeSelection.adapterVersion
        && context.job.snapshot.policyVersion === run.context.runtimeSelection.policyVersion,
      'Creation evaluation snapshot mismatch.', 409, ERROR_CODES.RUNTIME_POLICY_DENIED);

      const credential = (await this.#options.repository.read('credentials', { id: credentialId, userId: run.ownerId }))[0];
      ensure(credential && credential.modelId === context.job.snapshot.modelOfferingId,
        'Provider authorization is missing or changed.', 409, ERROR_CODES.PROVIDER_NOT_FOUND);
      const brief = parseCreationBriefVersion({
        schemaVersion: 1,
        briefId: briefRow.briefId,
        versionId: briefRow.id,
        versionNumber: briefRow.versionNumber,
        title: briefRow.title,
        instructions: briefRow.instructions,
        inputAttachments: briefRow.inputAttachments,
        outputPolicy: briefRow.outputPolicy,
      });
      const apiKey = decryptCredential(credential.ciphertext, this.#options.encryptionKey, run.ownerId, credential.id);
      const provider = this.#options.createProvider(credential, apiKey);
      return await this.#executeAuthorized(context, run, definition.instructions, brief.instructions, provider, credential.modelId);
    } catch (error) {
      await this.#markRun(run.id, run.ownerId, 'failed');
      if (error instanceof AppError && error.code === ERROR_CODES.PROVIDER_NOT_FOUND) return failure('PROVIDER_AUTHORIZATION_REVOKED');
      if (error instanceof AppError && error.code === ERROR_CODES.RUNTIME_POLICY_DENIED) return failure('CREATION_SNAPSHOT_INVALID');
      return failure('CREATION_CONFIGURATION_INVALID');
    }
  }

  async #executeAuthorized(
    context: EvaluationExecutionContext,
    run: CreationRun & { id: string; ownerId: string },
    instructions: string,
    brief: string,
    provider: AIProvider,
    modelId: string,
  ): Promise<EvaluationExecutionOutcome> {
    const abort = new AbortController();
    let sandboxHandle: SandboxHandle | undefined;
    let timer: NodeJS.Timeout | undefined;
    let sealedBundleId: string | undefined;
    let outcome: EvaluationExecutionOutcome;
    let stage: CreationExecutionStage = 'state-update';
    const assertAuthorized = async (): Promise<void> => {
      const job = await this.#options.repository.read('evaluationJobs', { id: String(context.job.id), userId: String(context.job.userId) });
      const state = job[0]?.state;
      if (state === 'cancelling' || state === 'cancelled') {
        abort.abort();
        throw new AppError('Run cancelled.', 499, ERROR_CODES.RUN_CANCELLED);
      }
      if (state !== 'running') throw new CreationExecutionAuthorizationLostError();
    };
    let invocationIndex = 0;
    const recordingProvider = new InvocationRecordingProvider(
      provider,
      this.#options.evaluationRepository,
      context,
      () => ++invocationIndex,
      this.#now,
      assertAuthorized,
    );
    try {
      await this.#markRun(run.id, run.ownerId, 'running', this.#now());
      timer = setInterval(() => { void assertAuthorized().catch(() => abort.abort()); }, this.#options.pollCancellationMs ?? 500);
      stage = 'pi-load';
      const module = await loadPiCoreModule({ env: { ...process.env, PI_RUNTIME_ENABLED: 'true' } });
      stage = 'sandbox-start';
      sandboxHandle = await this.#options.sandbox.create({
        environmentId: CREATION_ENVIRONMENT_TEMPLATE.versionId,
        environmentDigest: CREATION_ENVIRONMENT_DIGEST,
        imageDigest: this.#options.sandboxImageDigest,
        runtime: 'pi',
        policyVersion: CREATION_ENVIRONMENT_TEMPLATE.runtime.policyVersion,
        networkPolicy: 'deny',
        limits: {
          maxEntries: CREATION_ENVIRONMENT_TEMPLATE.artifactPolicy.maxArtifacts,
          maxFileBytes: CREATION_ENVIRONMENT_TEMPLATE.artifactPolicy.maxArtifactBytes,
          maxOutputBytes: CREATION_ENVIRONMENT_TEMPLATE.artifactPolicy.maxTotalBytes,
          maxInvocations: 64,
          maxInvocationArgsBytes: 1024 * 1024,
        },
      }, {
        ownerId: run.ownerId,
        jobId: String(context.job.id),
        attemptId: String(context.attempt.id),
        fenceToken: fenceToken(context.executionToken),
      });
      stage = 'sandbox-mount';
      await this.#options.sandbox.mountApprovedInputs(sandboxHandle, []);
      stage = 'pi-run';
      const result = await runCreationWithPi({
        createAgent: (options) => new module.Agent(options),
        provider: recordingProvider,
        modelId,
        sandbox: this.#options.sandbox,
        sandboxHandle,
        instructions,
        brief,
        signal: abort.signal,
        assertAuthorized,
      });
      await assertAuthorized();
      stage = 'artifact-stop';
      await this.#options.sandbox.stopAll(sandboxHandle);
      stage = 'artifact-snapshot';
      const snapshot = await this.#options.sandbox.snapshot(sandboxHandle);
      stage = 'artifact-collect';
      const collection = await collectArtifacts({
        snapshot,
        readFile: (relativePath, limit) => this.#options.sandbox.readSnapshotFile(sandboxHandle!, snapshot, relativePath, limit),
      }, {
        businessRef: `creation-run:${run.id}`,
        attemptId: String(context.attempt.id),
        fenceToken: fenceToken(context.executionToken),
        environmentDigest: CREATION_ENVIRONMENT_DIGEST,
        outputContractVersion: 'svg-animation-v1',
        limits: {
          maxEntries: CREATION_ENVIRONMENT_TEMPLATE.artifactPolicy.maxArtifacts,
          maxFileBytes: CREATION_ENVIRONMENT_TEMPLATE.artifactPolicy.maxArtifactBytes,
          maxOutputBytes: CREATION_ENVIRONMENT_TEMPLATE.artifactPolicy.maxTotalBytes,
        },
      }, [
        { slotId: 'entry', relativePath: 'index.html', mediaTypes: ['text/html'], classification: 'public-feedback', required: true, maxBytes: 4 * 1024 * 1024 },
        { slotId: 'readme', relativePath: 'README.md', mediaTypes: ['text/markdown', 'text/plain'], classification: 'public-feedback', required: false, maxBytes: 256 * 1024 },
        { slotId: 'scene', relativePath: 'scene.svg', mediaTypes: ['image/svg+xml'], classification: 'public-feedback', required: false, maxBytes: 4 * 1024 * 1024 },
        { slotId: 'style', relativePath: 'style.css', mediaTypes: ['text/css'], classification: 'public-feedback', required: false, maxBytes: 512 * 1024 },
      ]);
      stage = 'artifact-seal';
      const sealed = await sealArtifactBundle({
        ownerId: run.ownerId,
        creationRunId: run.id,
        outputSlot: 'site',
        entrypoint: 'index.html',
        collection,
        repository: this.#options.repository,
        storage: this.#options.storage,
        now: this.#now,
      });
      sealedBundleId = sealed.bundle.id;
      outcome = {
        kind: 'completed',
        completion: {
          evidence: 'complete',
          summary: {
            artifactBundleId: sealed.bundle.id,
            artifactCount: sealed.artifacts.length,
            turns: result.turns,
            toolCalls: result.toolCalls,
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
            manifestDigest: sealed.bundle.manifestDigest,
          },
        },
      };
    } catch (error) {
      if (isCancelled(error, abort.signal)) {
        outcome = { kind: 'cancelled' };
      } else if (error instanceof UnknownProviderResultError) {
        outcome = { kind: 'unknown', code: error.code };
      } else {
        outcome = failure(creationFailureCode(error, stage), false);
      }
    } finally {
      if (timer) clearInterval(timer);
      abort.abort();
    }

    if (sandboxHandle) {
      try {
        const disposed = await this.#options.sandbox.dispose(sandboxHandle);
        ensure(disposed.state === 'disposed' && disposed.verified,
          'Sandbox disposal was not verified.', 503, ERROR_CODES.RUNTIME_UNAVAILABLE);
      } catch {
        await this.#markRun(run.id, run.ownerId, 'incomplete', undefined, this.#now(), sealedBundleId);
        return {
          kind: 'incomplete',
          completion: {
            evidence: 'partial',
            summary: {
              cleanupStatus: 'unverified',
              failureCode: 'SANDBOX_CLEANUP_UNVERIFIED',
              ...(sealedBundleId ? { artifactBundleId: sealedBundleId } : {}),
            },
          },
        };
      }
    }

    if (outcome.kind === 'completed') {
      await this.#markRun(run.id, run.ownerId, 'completed', undefined, this.#now(), sealedBundleId);
    } else if (outcome.kind === 'cancelled') {
      await this.#markRun(run.id, run.ownerId, 'cancelled', undefined, this.#now());
    } else if (outcome.kind === 'unknown' || outcome.kind === 'incomplete') {
      await this.#markRun(run.id, run.ownerId, 'incomplete', undefined, this.#now(), sealedBundleId);
    } else {
      await this.#markRun(run.id, run.ownerId, 'failed', undefined, this.#now());
    }
    return outcome;
  }

  async #markRun(
    id: string,
    ownerId: string,
    status: 'running' | 'completed' | 'failed' | 'cancelled' | 'incomplete',
    startedAt?: string,
    completedAt?: string | null,
    artifactBundleId?: string | null,
  ): Promise<void> {
    await this.#options.repository.update('creationRuns', { id, ownerId }, {
      status,
      updatedAt: this.#now(),
      ...(startedAt ? { startedAt } : {}),
      ...(completedAt !== undefined ? { completedAt } : {}),
      ...(artifactBundleId !== undefined ? { artifactBundleId } : {}),
    });
  }
}

function fenceToken(executionToken: string): string {
  return `fence-${createHash('sha256').update(executionToken).digest('hex').slice(0, 40)}`;
}

export function digestCreationPrompt(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
