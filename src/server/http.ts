import { AppError, ensure, ERROR_CODES, safeError } from '../shared/errors.ts';
import type { ArenaService } from './service.ts';

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

export async function handleArena(request: Request, options: { service: ArenaService; userId?: string; origin: string; validateBody?: (path: string, body: Record<string, unknown>) => void }): Promise<Response> {
  const { service, userId } = options;
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
      if (path[0] === 'boot') return json(await service.boot());
      if (path[0] === 'overview') return json(await service.overview());
      if (path[0] === 'problems') return json(path[1] ? await service.problem(path[1]) : await service.problems());
      if (path[0] === 'skills') return json(await service.skills());
      if (path[0] === 'tools') return json(await service.tools());
      if (path[0] === 'leaderboard') return json(await service.leaderboard({ problemId: url.searchParams.get('problemId') || undefined, tier: url.searchParams.get('tier') || undefined, sort: url.searchParams.get('sort') || undefined }));
      if (path[0] === 'builds' && path[1]) return json(await service.build(path[1], userId, url.searchParams.get('version') || undefined));
      if (path[0] === 'profile' && path[1]) return json(await service.profile(path[1] === 'me' ? auth() : path[1], userId));
      if (path[0] === 'providers') return json(await service.providers(auth()));
      if (path[0] === 'runs' && path[1]) return json(await service.runDetail(auth(), path[1]));
      if (path[0] === 'failures') return json(await service.failures(url.searchParams.get('problemId') || undefined));
    }
    if (method === 'DELETE' && path[0] === 'providers' && path[1]) return json(await service.deleteProvider(auth(), path[1]));
    if (method === 'POST') {
      const body = await readJson(request);
      options.validateBody?.(path.join('/'), body);
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
