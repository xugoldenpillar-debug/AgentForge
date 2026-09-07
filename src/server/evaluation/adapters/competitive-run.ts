import { createHash, randomUUID } from 'node:crypto';
import type {
  CaseResult,
  Constraints,
  Repository,
  Run,
  RunKind,
  RunSummary,
  Submission,
  Tier,
  Workflow,
} from '../../../shared/types.ts';
import {
  asOpaqueId,
  EVALUATION_SNAPSHOT_VERSION,
  type BuildVersionId,
  type EvaluationAssociation,
  type EvaluationInputSnapshot,
  type TestSuiteVersionId,
} from '../../../shared/evaluation-types.ts';
import type {
  CreateEvaluationJobInput,
  CreateEvaluationJobResult,
  EvaluationJobView,
} from '../domain.ts';
import { summarize } from '../../../lib/scoring/index.ts';

/**
 * The adapter deliberately accepts the durable scheduler as a port. It does not
 * know whether the port is backed by PostgreSQL/Outbox/BullMQ or a deterministic
 * test double, and it never calls a model while accepting a job.
 */
export interface CompetitiveRunJobScheduler {
  createJob(input: CreateEvaluationJobInput): Promise<CreateEvaluationJobResult>;
}

export interface CompetitiveRunScheduleInput {
  readonly userId: string;
  readonly buildId: string;
  readonly versionId: string;
  readonly problemId: string;
  readonly kind: Extract<RunKind, 'public' | 'hidden'>;
  readonly tier: Tier;
  readonly model: string;
  readonly workflow: Workflow;
  readonly testCaseIds: readonly string[];
  readonly idempotencyKey: string;
  readonly consentVersion: string | null;
  readonly credentialAuthorizationId: string | null;
  readonly runId?: string;
  readonly capturedAt?: string;
}

export interface CompetitiveRunAccepted {
  readonly created: boolean;
  readonly run: Run;
  readonly job: EvaluationJobView;
}

export interface CompetitiveRunSubmissionContext {
  readonly run: Run;
  readonly summary: RunSummary;
  readonly submission: Submission;
  readonly model: string;
  readonly workflow: Workflow;
}

export interface CompetitiveRunAdapterOptions {
  readonly repository: Repository;
  readonly scheduler: CompetitiveRunJobScheduler;
  readonly now?: () => string;
  readonly createId?: () => string;
  readonly onCompetitiveSubmission?: (
    tx: Repository,
    context: CompetitiveRunSubmissionContext,
  ) => Promise<void>;
}

export interface CompetitiveRunCompletionInput {
  readonly runId: string;
  readonly userId: string;
  readonly buildId: string;
  readonly versionId: string;
  readonly problemId: string;
  readonly kind: Extract<RunKind, 'public' | 'hidden'>;
  readonly tier: Tier;
  readonly model: string;
  readonly workflow: Workflow;
  readonly constraints: Constraints;
  readonly results: readonly CaseResult[];
  readonly evidence: 'complete' | 'partial';
  readonly completedAt?: string;
}

export interface CompetitiveRunCompletionResult {
  readonly status: Run['status'];
  readonly summary: RunSummary | null;
  readonly submissionId: string | null;
}

export interface CompetitiveRunFailureInput {
  readonly runId: string;
  readonly userId: string;
  readonly results?: readonly CaseResult[];
  readonly workflow?: Workflow;
  readonly constraints?: Constraints;
  readonly tier?: Tier;
  readonly kind?: Extract<RunKind, 'public' | 'hidden'>;
}

/**
 * Bridges Arena's competitive business record to the shared evaluation job.
 *
 * Existing Run rows remain the competitive result record. Only newly scheduled
 * runs call this adapter; it intentionally never backfills historical runs.
 * Completion is idempotent and only a complete hidden run gets a Submission.
 */
export class CompetitiveRunAdapter {
  private readonly repository: Repository;
  private readonly scheduler: CompetitiveRunJobScheduler;
  private readonly now: () => string;
  private readonly createId: () => string;
  private readonly onCompetitiveSubmission?: CompetitiveRunAdapterOptions['onCompetitiveSubmission'];

  constructor(options: CompetitiveRunAdapterOptions) {
    this.repository = options.repository;
    this.scheduler = options.scheduler;
    this.now = options.now ?? (() => new Date().toISOString());
    this.createId = options.createId ?? randomUUID;
    this.onCompetitiveSubmission = options.onCompetitiveSubmission;
  }

  async schedule(input: CompetitiveRunScheduleInput): Promise<CompetitiveRunAccepted> {
    const runId = input.runId ?? deterministicRunId(input.userId, input.idempotencyKey, this.createId);
    let run = (await this.repository.read('runs', { id: runId, userId: input.userId }))[0];
    const capturedAt = input.capturedAt ?? run?.createdAt ?? this.now();
    const association: EvaluationAssociation = {
      kind: 'competitive-run',
      runId: asOpaqueId<'run'>(runId),
      visibility: input.kind,
    };

    if (!run) {
      run = {
        id: runId,
        buildId: input.buildId,
        versionId: input.versionId,
        problemId: input.problemId,
        userId: input.userId,
        kind: input.kind,
        tier: input.tier,
        status: 'running',
        summary: null,
        createdAt: capturedAt,
        runtimeKind: 'dag',
        // EF executes its own durable path, not the PoC adapter/policy versions.
        adapterVersion: null,
        policyVersion: null,
      };
      try {
        await this.repository.insert('runs', [run]);
      } catch (error) {
        // Concurrent identical requests can both observe an absent Run. Recover
        // only the exact Run PK race; all other storage failures remain failures.
        if (!isRunPrimaryKeyConflict(error)) throw error;
        const winner = (await this.repository.read('runs', {id: runId, userId: input.userId}))[0];
        if (!winner) throw error;
        assertSameRun(winner, input);
        run = winner;
      }
    } else {
      assertSameRun(run, input);
    }

    // The committed winner owns capturedAt, which is part of the snapshot digest.
    const snapshot = createSnapshot(input, input.capturedAt ?? run.createdAt);
    let job: CreateEvaluationJobResult;
    try {
      job = await this.scheduler.createJob({
        userId: asOpaqueId<'user'>(input.userId),
        purpose: 'competitive',
        association,
        snapshot,
        idempotencyKey: input.idempotencyKey,
      });
    } catch (error) {
      // A transactional outbox may have committed before queue publication
      // failed. In that case the durable Job is still recoverable and the Run
      // must remain pending rather than being misclassified as an execution
      // failure. Only mark the Run failed when no Job association was persisted.
      const persistedJob = (await this.repository.read('evaluationJobs', {
        associationKind: 'competitive-run',
        businessRecordId: runId,
      }))[0];
      if (!persistedJob && run.status === 'running') {
        await this.repository.update('runs', { id: runId, userId: input.userId }, { status: 'failed' });
      }
      throw error;
    }

    return { created: job.created, run, job: job.job };
  }

  async complete(input: CompetitiveRunCompletionInput): Promise<CompetitiveRunCompletionResult> {
    const completedAt = input.completedAt ?? this.now();
    const summary = summarize([...input.results], input.workflow, input.constraints, input.tier);

    return this.repository.transaction(async (tx) => {
      const current = (await tx.read('runs', { id: input.runId, userId: input.userId }))[0];
      if (!current) throw new Error('Competitive run not found.');
      assertCompletionIdentity(current, input);

      const existingSubmission = (await tx.read('submissions', { runId: input.runId }))[0];
      if (current.status === 'completed') {
        return {
          status: current.status,
          summary: current.summary,
          submissionId: existingSubmission?.id ?? null,
        };
      }
      if (current.status === 'failed') {
        return { status: current.status, summary: current.summary, submissionId: null };
      }

      await persistRunCases(tx, input.runId, input.results, this.createId);
      if (input.evidence !== 'complete') {
        await tx.update('runs', { id: input.runId, userId: input.userId }, {
          status: 'failed',
          summary,
        });
        return { status: 'failed', summary, submissionId: null };
      }

      let submissionId = existingSubmission?.id ?? null;
      let submission: Submission | null = existingSubmission ?? null;
      await tx.update('runs', { id: input.runId, userId: input.userId }, {
        status: 'completed',
        summary,
      });

      // A public evaluation can complete safely but must never create a
      // competitive Submission. Hidden is the only competitive evidence lane.
      if (input.kind === 'hidden' && !submission) {
        const metrics = summary.metrics;
        const count = Math.max(1, input.results.length);
        const score = summary.score;
        submissionId = this.createId();
        submission = {
          id: submissionId,
          runId: input.runId,
          buildId: input.buildId,
          versionId: input.versionId,
          userId: input.userId,
          problemId: input.problemId,
          tier: input.tier,
          score: score.total,
          accuracy: score.accuracy,
          robustness: score.robustness,
          security: score.security,
          efficiency: score.efficiency,
          elegance: score.elegance,
          tokens: (metrics.inputTokens + metrics.outputTokens) / count,
          cost: metrics.cost === null ? null : metrics.cost / count,
          latency: metrics.latency / count,
          nodes: input.workflow.nodes.length,
          model: input.model,
          createdAt: completedAt,
        };
        await tx.insert('submissions', [submission]);
        if (this.onCompetitiveSubmission) {
          await this.onCompetitiveSubmission(tx, {
            run: {
              ...current,
              status: 'completed',
              summary,
            },
            summary,
            submission,
            model: input.model,
            workflow: input.workflow,
          },);
        }
      }

      return { status: 'completed', summary, submissionId };
    });
  }

  async fail(input: CompetitiveRunFailureInput): Promise<CompetitiveRunCompletionResult> {
    return this.repository.transaction(async (tx) => {
      const current = (await tx.read('runs', { id: input.runId, userId: input.userId }))[0];
      if (!current) throw new Error('Competitive run not found.');
      if (current.status === 'completed' || current.status === 'failed') {
        const submission = (await tx.read('submissions', { runId: input.runId }))[0];
        return { status: current.status, summary: current.summary, submissionId: submission?.id ?? null };
      }
      if (input.results) await persistRunCases(tx, input.runId, input.results, this.createId);
      const summary = input.results && input.workflow && input.constraints && input.tier
        ? summarize([...input.results], input.workflow, input.constraints, input.tier)
        : null;
      await tx.update('runs', { id: input.runId, userId: input.userId }, { status: 'failed', summary });
      return { status: 'failed', summary, submissionId: null };
    });
  }
}

function createSnapshot(input: CompetitiveRunScheduleInput, capturedAt: string): EvaluationInputSnapshot {
  const metadata = {
    visibility: input.kind,
    testCaseIds: [...input.testCaseIds],
    workflowNodeIds: input.workflow.nodes.map((node) => node.id),
    workflowEdgeIds: input.workflow.edges.map((edge) => edge.id),
  };
  const snapshotBody = {
    schemaVersion: EVALUATION_SNAPSHOT_VERSION,
    buildVersionId: asOpaqueId<'build-version'>(input.versionId) as BuildVersionId,
    testSuiteVersionId: testSuiteVersionId(input.problemId, input.testCaseIds),
    skillVersionId: null,
    runtimeAdapter: 'arena-workflow',
    modelOfferingId: input.model,
    policyVersion: 'competitive-evaluation-v1',
    consentVersion: input.consentVersion,
    credentialAuthorizationId: input.credentialAuthorizationId,
    capturedAt,
    metadata,
  } as const;
  const snapshotDigest = createHash('sha256').update(stableJson(snapshotBody)).digest('hex');
  return Object.freeze({ ...snapshotBody, snapshotDigest });
}

function testSuiteVersionId(problemId: string, caseIds: readonly string[]): TestSuiteVersionId {
  const digest = createHash('sha256').update(stableJson({ problemId, caseIds: [...caseIds] })).digest('hex').slice(0, 32);
  return asOpaqueId<'test-suite-version'>(`test-suite:${problemId}:${digest}`);
}

function deterministicRunId(userId: string, idempotencyKey: string, createId: () => string): string {
  if (!idempotencyKey.trim()) return createId();
  const digest = createHash('sha256').update(`${userId}\u0000${idempotencyKey}`).digest('hex').slice(0, 32);
  return `competitive-run:${digest}`;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (typeof value !== 'object') throw new Error('Snapshot data must be JSON-safe.');
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`).join(',')}}`;
}

function assertSameRun(run: Run, input: CompetitiveRunScheduleInput): void {
  if (run.buildId !== input.buildId || run.versionId !== input.versionId || run.problemId !== input.problemId || run.kind !== input.kind || run.tier !== input.tier) {
    throw new Error('The idempotency key is already associated with a different competitive run.');
  }
}

function assertCompletionIdentity(run: Run, input: CompetitiveRunCompletionInput): void {
  if (run.buildId !== input.buildId || run.versionId !== input.versionId || run.problemId !== input.problemId || run.kind !== input.kind || run.tier !== input.tier) {
    throw new Error('Competitive run completion does not match the frozen run identity.');
  }
}

async function persistRunCases(
  tx: Repository,
  runId: string,
  results: readonly CaseResult[],
  createId: () => string,
): Promise<void> {
  const existing = new Set((await tx.read('runCases', { runId })).map((row) => row.caseId));
  const fresh = results.filter((result) => !existing.has(result.caseId));
  if (fresh.length > 0) await tx.insert('runCases', fresh.map((result) => ({ ...result, id: createId(), runId })));
}

function isRunPrimaryKeyConflict(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 3 && current && typeof current === 'object'; depth++) {
    const record = current as Record<string, unknown>;
    if (record.code === '23505' && record.constraint_name === 'runs_pkey' && record.table_name === 'runs') return true;
    current = record.cause;
  }
  return false;
}
