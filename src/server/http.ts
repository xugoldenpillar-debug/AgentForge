import { AppError, ensure, ERROR_CODES, safeError } from '../shared/errors.ts';
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

const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
const errorResponse = (error: ReturnType<typeof safeError>) => ({ error: { code: error.code, message: error.message } });

function requireCommunity(service: CommunityService | undefined): CommunityService {
  ensure(service, 'Community component library is not available.', 503, ERROR_CODES.INTERNAL_SERVER_ERROR);
  return service;
}

export async function handleArena(request: Request, options: { service: ArenaService; communityService?: CommunityService; userId?: string; origin: string; validateBody?: (path: string, body: Record<string, unknown>) => void }): Promise<Response> {
  const { service, communityService, userId } = options;
  try {
    const url = new URL(request.url), path = url.pathname.replace(/^\/api\/arena\/?/, '').split('/').filter(Boolean).map(decodeURIComponent), method = request.method;
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
      if (path[0] === 'boot') return json(await service.boot());
      if (path[0] === 'overview') return json(await service.overview());
      if (path[0] === 'problems') return json(path[1] ? await service.problem(path[1]) : await service.problems());
      if (path[0] === 'skills') return json(path[1] ? await service.skillDetail(path[1]) : await service.skills());
      if (path[0] === 'tools') return json(path[1] ? await service.toolDetail(path[1]) : await service.tools());
      if (path[0] === 'leaderboard') return json(await service.leaderboard({ problemId: url.searchParams.get('problemId') || undefined, tier: url.searchParams.get('tier') || undefined, sort: url.searchParams.get('sort') || undefined }));
      if (path[0] === 'builds' && path[1]) return json(await service.build(path[1], userId, url.searchParams.get('version') || undefined));
      if (path[0] === 'profile' && path[1]) return json(await service.profile(path[1] === 'me' ? auth() : path[1], userId));
      if (path[0] === 'providers') return json(await service.providers(auth()));
      if (path[0] === 'runs' && path[1]) return json(await service.runDetail(auth(), path[1]));
      if (path[0] === 'failures') return json(await service.failures(url.searchParams.get('problemId') || undefined));
    }
    if (method === 'DELETE' && path[0] === 'providers' && path[1]) return json(await service.deleteProvider(auth(), path[1]));
    if (method === 'POST' || method === 'PATCH') {
      const body = await readJson(request);
      options.validateBody?.(path.join('/'), body);
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
      if (path[0] === 'builds' && path[2] === 'fork') return json(await service.fork(auth(), path[1], typeof body.versionId === 'string' ? body.versionId : undefined), 201);
      if (path[0] === 'builds') return json(await service.saveBuild(auth(), body), 201);
      if (path[0] === 'providers') return json(await service.addProvider(auth(), body), 201);
      if (path[0] === 'problems') return json(await service.createProblem(auth(), body), 201);
      if (path[0] === 'failure-cases') return json(await service.hunt(auth(), body), 201);
      if (path[0] === 'runs') {
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
              const safe = safeError(error);
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
          }
        });
        return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no', 'X-Content-Type-Options': 'nosniff' } });
      }
    }
    return json(errorResponse({ code: ERROR_CODES.ENDPOINT_NOT_FOUND, message: 'Endpoint not found.', status: 404 }), 404);
  } catch (error) {
    const safe = safeError(error);
    return json(errorResponse(safe), safe.status);
  }
}
