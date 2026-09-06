import { AppError, ensure, ERROR_CODES, safeError } from '../shared/errors.ts';
import {
  EVALUATION_WORKER_MESSAGE_VERSION,
  asOpaqueId,
  type CancellationReason,
  type EvaluationJobId,
  type JsonObject,
} from '../shared/evaluation-types.ts';
import type { EvaluationJobRow, EvaluationAttemptRow, Run, RunCase } from '../shared/types.ts';
import { serializeRun } from './serializers.ts';
import { EvaluationRepositoryAdapter } from '../db/evaluation-repository.ts';
import {
  EvaluationService,
  EvaluationServiceError,
  type EvaluationDispatchSink,
} from './evaluation/domain.ts';
import { EvaluationPersistenceError } from '../db/evaluation-repository.ts';
import type { ArenaService } from './service.ts';
import type { CommunityService } from './community-service.ts';

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  ensure(request.headers.get('content-type')?.includes('application/json'), 'Use application/json.', 400, ERROR_CODES.REQUEST_CONTENT_TYPE_INVALID);
  const reader = request.body?.getReader();
  ensure(reader, 'Request body is required.', 400, ERROR_CODES.REQUEST_BODY_REQUIRED);
  let size = 0;
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 128 * 1024) {
      await reader.cancel();
      throw new AppError('Request body exceeds 128 KB.', 413, ERROR_CODES.REQUEST_BODY_TOO_LARGE);
    }
    chunks.push(value);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new AppError('Invalid JSON body.', 400, ERROR_CODES.INVALID_JSON_BODY);
  }
  ensure(parsed && typeof parsed === 'object' && !Array.isArray(parsed), 'Request body must be an object.', 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
  return parsed as Record<string, unknown>;
}

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(data, {
  status,
  headers: {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  },
});
const errorResponse = (error: ReturnType<typeof safeError>) => ({ error: { code: error.code, message: error.message } });

function requireCommunity(service: CommunityService | undefined): CommunityService {
  ensure(service, 'Community component library is not available.', 503, ERROR_CODES.INTERNAL_SERVER_ERROR);
  return service;
}

const noopDispatch: EvaluationDispatchSink = {
  async enqueue(): Promise<void> {
    // Cancellation is persisted to the outbox below. The request path must not
    // call a queue or a model directly.
  },
};

export interface EvaluationStatusResponse {
  readonly job: {
    readonly id: string;
    readonly purpose: EvaluationJobRow['purpose'];
    readonly state: EvaluationJobRow['state'];
    readonly association: {
      readonly kind: EvaluationJobRow['associationKind'];
      readonly runId?: string;
      readonly visibility?: 'public' | 'hidden';
      readonly businessRecordId?: string;
    };
    readonly snapshot: {
      readonly schemaVersion: number;
      readonly buildVersionId: string;
      readonly testSuiteVersionId: string;
      readonly runtimeAdapter: string;
      readonly modelOfferingId: string | null;
      readonly policyVersion: string;
      readonly capturedAt: string;
    };
    readonly snapshotDigest: string;
    readonly cancellationReason: EvaluationJobRow['cancellationReason'];
    readonly cancellationRequestedAt: string | null;
    readonly acceptedAt: string;
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly completedAt: string | null;
    readonly completion: { readonly evidence: 'complete' | 'partial' } | null;
    readonly failure: { readonly code: string; readonly retryable: boolean } | null;
  };
  readonly attempts: readonly {
    readonly id: string;
    readonly number: number;
    readonly state: EvaluationAttemptRow['state'];
    readonly startedAt: string | null;
    readonly finishedAt: string | null;
    readonly createdAt: string;
    readonly updatedAt: string;
  }[];
  readonly run: ReturnType<typeof serializeRun> | null;
}

function projectJob(row: EvaluationJobRow): EvaluationStatusResponse['job'] {
  const association = row.associationKind === 'competitive-run'
    ? {
        kind: row.associationKind,
        runId: row.businessRecordId,
        visibility: row.associationVisibility ?? 'hidden',
      }
    : {
        kind: row.associationKind,
        businessRecordId: row.businessRecordId,
      };
  const snapshot = row.snapshot;
  return {
    id: row.id,
    purpose: row.purpose,
    state: row.state,
    association,
    // Do not return snapshot.metadata, credential authorization identities,
    // prompts, test inputs, or any worker-only field.
    snapshot: {
      schemaVersion: snapshot.schemaVersion,
      buildVersionId: snapshot.buildVersionId,
      testSuiteVersionId: snapshot.testSuiteVersionId,
      runtimeAdapter: snapshot.runtimeAdapter,
      modelOfferingId: snapshot.modelOfferingId,
      policyVersion: snapshot.policyVersion,
      capturedAt: snapshot.capturedAt,
    },
    snapshotDigest: row.snapshotDigest,
    cancellationReason: row.cancellationReason,
    cancellationRequestedAt: row.cancellationRequestedAt,
    acceptedAt: row.acceptedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    completedAt: row.completedAt,
    completion: row.completion ? { evidence: row.completion.evidence } : null,
    failure: row.failure ? { code: row.failure.code, retryable: row.failure.retryable } : null,
  };
}

async function ownedEvaluationJob(service: ArenaService, userId: string, jobId: string): Promise<EvaluationJobRow> {
  const row = (await service.repo.read('evaluationJobs', { id: jobId }))[0];
  // A missing job and another user's job intentionally have the same response.
  ensure(row && row.userId === userId, 'Evaluation not found.', 404, ERROR_CODES.RESOURCE_NOT_FOUND);
  return row;
}

async function evaluationStatus(service: ArenaService, userId: string, row: EvaluationJobRow): Promise<EvaluationStatusResponse> {
  const attempts = await service.repo.read('evaluationAttempts', { jobId: row.id });
  const runId = row.associationKind === 'competitive-run' ? row.businessRecordId : null;
  let run: Run | undefined;
  let cases: RunCase[] | undefined;
  if (runId) {
    run = (await service.repo.read('runs', { id: runId, userId }))[0];
    // Public competitive runs may expose their already-allowed traces/cases.
    // Hidden runs always use the aggregate-only serializer branch.
    if (run?.kind === 'public') cases = await service.repo.read('runCases', { runId });
  }
  return {
    job: projectJob(row),
    attempts: attempts
      .sort((a, b) => a.attemptNumber - b.attemptNumber)
      .map((attempt) => ({
        id: attempt.id,
        number: attempt.attemptNumber,
        state: attempt.state,
        startedAt: attempt.startedAt,
        finishedAt: attempt.finishedAt,
        createdAt: attempt.createdAt,
        updatedAt: attempt.updatedAt,
      })),
    run: run ? serializeRun(run, cases ?? []) : null,
  };
}

function withIdempotencyKey(request: Request, body: Record<string, unknown>): Record<string, unknown> {
  const headerKey = request.headers.get('idempotency-key')?.trim() || undefined;
  const bodyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : undefined;
  if (headerKey && bodyKey && headerKey !== bodyKey) {
    throw new AppError('The idempotency key header does not match the request body.', 409, ERROR_CODES.REQUEST_VALIDATION_FAILED);
  }
  const key = headerKey ?? bodyKey;
  ensure(key, 'An idempotency key is required for asynchronous evaluations.', 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
  return { ...body, idempotencyKey: key };
}

function toCancellationReason(value: unknown): CancellationReason {
  if (value === undefined) return 'user-requested';
  ensure(value === 'user-requested', 'Only user-requested cancellation is available from this endpoint.', 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
  return value;
}

async function appendCancellationOutbox(service: ArenaService, row: EvaluationJobRow): Promise<void> {
  if (row.state !== 'cancelling' || !row.cancellationRequestedAt) return;
  const id = `evaluation-job-cancel-requested:${row.id}:${row.cancellationRequestedAt}`;
  const attempts = await service.repo.read('evaluationAttempts', { jobId: row.id });
  const activeAttempt = attempts.find((attempt) => ['claimed', 'running', 'cancelling', 'reconciling'].includes(attempt.state));
  const payload: JsonObject = {
    jobId: row.id,
    reason: row.cancellationReason ?? 'user-requested',
    ...(activeAttempt ? { attemptId: activeAttempt.id } : {}),
  };
  const existing = await service.repo.read('evaluationOutbox', { id });
  if (existing.length > 0) return;
  const event = {
    id,
    jobId: row.id,
    aggregateId: row.id,
    version: EVALUATION_WORKER_MESSAGE_VERSION,
    kind: 'evaluation-job-cancel-requested' as const,
    occurredAt: row.cancellationRequestedAt,
    requestDigest: row.requestDigest,
    payload,
    dedupeKey: id,
    status: 'pending' as const,
    availableAt: row.cancellationRequestedAt,
    leaseToken: null,
    leaseOwner: null,
    leaseExpiresAt: null,
    deliveryAttempts: 0,
    lastErrorCode: null,
    lastErrorAt: null,
    publishedAt: null,
    createdAt: row.cancellationRequestedAt,
    updatedAt: row.cancellationRequestedAt,
  };
  try {
    await service.repo.transaction(async (tx) => {
      if (!(await tx.read('evaluationOutbox', { id })).length) {
        await tx.insert('evaluationOutbox', [event]);
      }
    });
  } catch (error) {
    // A concurrent cancellation request may have won the unique outbox key.
    if (!(await service.repo.read('evaluationOutbox', { id })).length) throw error;
  }
}

function mapEvaluationError(error: unknown): unknown {
  if (error instanceof AppError) return error;
  if (error instanceof EvaluationServiceError) {
    const status = error.code === 'JOB_NOT_FOUND' ? 404
      : error.code === 'IDEMPOTENCY_CONFLICT' ? 409
        : error.code === 'INVALID_STATE_TRANSITION' || error.code === 'STALE_EXECUTION' ? 409
          : 400;
    const code = error.code === 'JOB_NOT_FOUND' ? ERROR_CODES.RESOURCE_NOT_FOUND
      : error.code === 'IDEMPOTENCY_CONFLICT' ? ERROR_CODES.REQUEST_VALIDATION_FAILED
        : ERROR_CODES.REQUEST_VALIDATION_FAILED;
    return new AppError(error.message, status, code);
  }
  if (error instanceof EvaluationPersistenceError) {
    const status = error.code === 'not-found' ? 404
      : error.code === 'idempotency-conflict' || error.code === 'active-job-exists' || error.code === 'association-exists' ? 409
        : 400;
    return new AppError(error.message, status, status === 404 ? ERROR_CODES.RESOURCE_NOT_FOUND : ERROR_CODES.REQUEST_VALIDATION_FAILED);
  }
  if (error instanceof Error && error.message.includes('idempotency key is already associated')) {
    return new AppError('The idempotency key was already used for a different request.', 409, ERROR_CODES.REQUEST_VALIDATION_FAILED);
  }
  return error;
}

export async function handleArena(request: Request, options: { service: ArenaService; communityService?: CommunityService; userId?: string; origin: string; validateBody?: (path: string, body: Record<string, unknown>) => void }): Promise<Response> {
  const { service, communityService, userId } = options;
  try {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api\/arena\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
    const method = request.method;
    const mutating = method !== 'GET';
    if (mutating) {
      const origin = request.headers.get('origin');
      ensure(!origin || origin === options.origin, 'Cross-origin mutations are not allowed.', 403, ERROR_CODES.ACCESS_FORBIDDEN);
      ensure(request.headers.get('sec-fetch-site') !== 'cross-site', 'Cross-site mutations are not allowed.', 403, ERROR_CODES.ACCESS_FORBIDDEN);
      ensure(userId, 'Sign in to continue.', 401, ERROR_CODES.AUTH_REQUIRED);
      await service.limit(userId, 'api', 120);
    }
    const auth = () => {
      ensure(userId, 'Sign in to continue.', 401, ERROR_CODES.AUTH_REQUIRED);
      return userId;
    };

    if (method === 'GET') {
      if (path[0] === 'components') {
        const actor = auth();
        if (path.length === 1) return json(await requireCommunity(communityService).listOwnedComponents(actor));
        if (path[1] === 'versions' && path[2] && path[3] === 'attachments') {
          return json(await requireCommunity(communityService).listAttachments(actor, path[2]));
        }
        if (path[1] && path[2] === 'versions' && path[3] && path[4] === 'attachments') {
          const community = requireCommunity(communityService);
          const version = await community.getComponentVersion(actor, path[3]);
          ensure(version.componentId === path[1], 'Component version does not belong to this component.', 404, ERROR_CODES.RESOURCE_NOT_FOUND);
          return json(await community.listAttachments(actor, path[3]));
        }
        if (path[1] === 'attachments' && path[2]) {
          return json(await requireCommunity(communityService).getAttachment(actor, path[2]));
        }
        if (path[1] && path[2] === 'versions' && path[3]) {
          return json(await requireCommunity(communityService).getComponentVersion(actor, path[3]));
        }
        if (path[1]) return json(await requireCommunity(communityService).getComponent(actor, path[1]));
      }
      if (path[0] === 'attachments' && path[1]) {
        return json(await requireCommunity(communityService).getAttachment(auth(), path[1]));
      }
      if (path[0] === 'evaluation-jobs' && path[1]) {
        const status = await evaluationStatus(service, auth(), await ownedEvaluationJob(service, auth(), path[1]));
        return json(status);
      }
      if (path[0] === 'runs' && path[1] && path[2] === 'evaluation') {
        const uid = auth();
        const row = (await service.repo.read('evaluationJobs', { businessRecordId: path[1], associationKind: 'competitive-run' }))[0];
        ensure(row && row.userId === uid, 'Evaluation not found.', 404, ERROR_CODES.RESOURCE_NOT_FOUND);
        return json(await evaluationStatus(service, uid, row));
      }
      if (path[0] === 'boot') return json(await service.boot());
      if (path[0] === 'overview') return json(await service.overview());
      if (path[0] === 'problems') return json(path[1] ? await service.problem(path[1]) : await service.problems());
      if (path[0] === 'skills') {
        return json(path[1] ? await service.skillDetail(path[1]) : await service.skills());
      }
      if (path[0] === 'tools') {
        return json(path[1] ? await service.toolDetail(path[1]) : await service.tools());
      }
      if (path[0] === 'leaderboard') return json(await service.leaderboard({ problemId: url.searchParams.get('problemId') || undefined, tier: url.searchParams.get('tier') || undefined, sort: url.searchParams.get('sort') || undefined }));
      if (path[0] === 'builds' && path[1]) return json(await service.build(path[1], userId, url.searchParams.get('version') || undefined));
      if (path[0] === 'profile' && path[1]) return json(await service.profile(path[1] === 'me' ? auth() : path[1], userId));
      if (path[0] === 'providers') return json(await service.providers(auth()));
      if (path[0] === 'runs' && path[1]) return json(await service.runDetail(auth(), path[1]));
      if (path[0] === 'failures') return json(await service.failures(url.searchParams.get('problemId') || undefined));
    }

    if (method === 'DELETE' && path[0] === 'providers' && path[1]) return json(await service.deleteProvider(auth(), path[1]));

    if (method === 'POST' || method === 'PATCH') {
      const isCancellation = path[0] === 'evaluation-jobs' && path[1] && path[2] === 'cancel';
      const rawBody = request.body ? await readJson(request) : {};
      const body = isCancellation ? rawBody : (path[0] === 'evaluation-jobs' || (path[0] === 'runs' && url.searchParams.get('mode') === 'async') ? withIdempotencyKey(request, rawBody) : rawBody);
      const validationPath = path[0] === 'runs' && url.searchParams.get('mode') === 'async'
        ? 'runs/async'
        : path.join('/');
      options.validateBody?.(validationPath, body);

      if (method === 'POST' && path[0] === 'components' && path.length === 1) {
        return json(await requireCommunity(communityService).createDraft(auth(), { definition: body.definition }), 201);
      }
      if (method === 'PATCH' && path[0] === 'components' && path.length === 2) {
        return json(await requireCommunity(communityService).updateDraft(auth(), {
          componentId: path[1],
          expectedRevision: body.expectedRevision as number,
          definition: body.definition,
        }));
      }
      if (method === 'POST' && path[0] === 'components' && path[1] && path[2] === 'versions' && path.length === 3) {
        return json(await requireCommunity(communityService).freezeVersion(auth(), {
          componentId: path[1],
          expectedRevision: body.expectedRevision as number,
        }), 201);
      }
      if (method === 'POST' && path[0] === 'publication-requests' && path.length === 1) {
        return json(await requireCommunity(communityService).createPublicationRequest(auth(), {
          componentVersionId: body.componentVersionId as string,
          publicExampleIds: body.publicExampleIds as string[] | undefined,
          publicReferencePaths: body.publicReferencePaths as string[] | undefined,
          declaration: body.declaration as string,
        }), 201);
      }
      if (method === 'POST' && path[0] === 'admin' && path[1] === 'publication-requests' && path[2] && path[3] === 'reviews' && path.length === 4) {
        return json(await requireCommunity(communityService).reviewPublication(auth(), {
          publicationRequestId: path[2],
          expectedStatus: body.expectedStatus as import('../shared/types.ts').PublicationRequestStatus,
          expectedRevision: body.expectedRevision as number,
          decision: body.decision as import('../shared/types.ts').PublicationReviewDecision,
          reason: body.reason as string,
          checks: body.checks as string[] | undefined,
        }));
      }
      if (isCancellation) {
        const uid = auth();
        const row = await ownedEvaluationJob(service, uid, path[1]);
        const cancellation = new EvaluationService(new EvaluationRepositoryAdapter(service.repo), noopDispatch);
        const result = await cancellation.requestCancellation(asOpaqueId<'evaluation-job'>(row.id), toCancellationReason(body.reason));
        const latest = (await service.repo.read('evaluationJobs', { id: row.id }))[0] ?? row;
        await appendCancellationOutbox(service, latest);
        const status = await evaluationStatus(service, uid, latest);
        return json({ ...status, cancellationRequested: result.applied }, result.applied ? 202 : 200, result.applied ? { 'Retry-After': '1' } : {});
      }

      if (path[0] === 'evaluation-jobs' || (path[0] === 'runs' && url.searchParams.get('mode') === 'async')) {
        const accepted = await service.scheduleCompetitiveRun(auth(), body);
        const status = await evaluationStatus(service, auth(), await ownedEvaluationJob(service, auth(), accepted.job.id));
        return json({ created: accepted.created, ...status }, 202, {
          Location: `/api/arena/evaluation-jobs/${accepted.job.id}`,
          'Retry-After': '1',
        });
      }
      if (path[0] === 'builds' && path[2] === 'fork') return json(await service.fork(auth(), path[1], typeof body.versionId === 'string' ? body.versionId : undefined), 201);
      if (path[0] === 'builds') return json(await service.saveBuild(auth(), body), 201);
      if (path[0] === 'providers') return json(await service.addProvider(auth(), body), 201);
      if (path[0] === 'problems') return json(await service.createProblem(auth(), body), 201);
      if (path[0] === 'failure-cases') return json(await service.hunt(auth(), body), 201);
      if (path[0] === 'runs') {
        // Explicit compatibility path: durable evaluations use /evaluation-jobs
        // (or /runs?mode=async); this legacy route remains NDJSON for tests and
        // the existing arena UI.
        const uid = auth(), encoder = new TextEncoder(), abort = new AbortController();
        let closed = false;
        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            const push = (event: unknown) => {
              if (!closed) {
                try {
                  controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
                } catch {
                  closed = true;
                  abort.abort();
                }
              }
            };
            try {
              await service.run(uid, body, push, AbortSignal.any([abort.signal, request.signal, AbortSignal.timeout(180000)]));
            } catch (error) {
              const safe = safeError(mapEvaluationError(error));
              push({ type: 'error', code: safe.code, message: safe.message });
            } finally {
              if (!closed) {
                closed = true;
                controller.close();
              }
            }
          },
          cancel() {
            closed = true;
            abort.abort();
          },
        });
        return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no', 'X-Content-Type-Options': 'nosniff' } });
      }
    }
    return json(errorResponse({ code: ERROR_CODES.ENDPOINT_NOT_FOUND, message: 'Endpoint not found.', status: 404 }), 404);
  } catch (error) {
    const safe = safeError(mapEvaluationError(error));
    return json(errorResponse(safe), safe.status);
  }
}
