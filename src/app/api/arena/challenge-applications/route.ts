import { getAuth } from '@/lib/auth';
import { getChallengeApplicationService } from '@/server/factory';
import { AppError, ERROR_CODES, ensure, safeError } from '@/shared/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}

async function userId(request: Request): Promise<string> {
  const session = await getAuth().api.getSession({ headers: request.headers });
  ensure(session?.user.id, 'Sign in to continue.', 401, ERROR_CODES.AUTH_REQUIRED);
  return session.user.id;
}

function sameOrigin(request: Request): void {
  const expected = new URL(process.env.BETTER_AUTH_URL || 'http://localhost:3000').origin;
  const origin = request.headers.get('origin');
  ensure(!origin || origin === expected, 'Cross-origin mutations are not allowed.', 403, ERROR_CODES.ACCESS_FORBIDDEN);
  ensure(request.headers.get('sec-fetch-site') !== 'cross-site', 'Cross-site mutations are not allowed.', 403, ERROR_CODES.ACCESS_FORBIDDEN);
}

export async function GET(request: Request) {
  try {
    return json(await getChallengeApplicationService().listOwned(await userId(request)));
  } catch (error) {
    const safe = safeError(error);
    return json({ error: { code: safe.code, message: safe.message } }, safe.status);
  }
}

export async function POST(request: Request) {
  try {
    sameOrigin(request);
    ensure(request.headers.get('content-type')?.includes('application/json'), 'Use application/json.', 400, ERROR_CODES.REQUEST_CONTENT_TYPE_INVALID);
    const body = await request.json() as Record<string, unknown>;
    ensure(body && typeof body === 'object' && !Array.isArray(body), 'Request body must be an object.', 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
    return json(await getChallengeApplicationService().submit(await userId(request), {
      material: body.material,
      declaration: body.declaration,
    }), 201);
  } catch (error) {
    const safe = safeError(error instanceof SyntaxError ? new AppError('Invalid JSON body.', 400, ERROR_CODES.INVALID_JSON_BODY) : error);
    return json({ error: { code: safe.code, message: safe.message } }, safe.status);
  }
}
