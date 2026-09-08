import { getAuth } from '@/lib/auth';
import { getChallengeApplicationService, getService } from '@/server/factory';
import { readJson } from '@/server/http';
import { ERROR_CODES, ensure, safeError } from '@/shared/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const expected = new URL(process.env.BETTER_AUTH_URL || 'http://localhost:3000').origin;
    const origin = request.headers.get('origin');
    ensure(!origin || origin === expected, 'Cross-origin mutations are not allowed.', 403, ERROR_CODES.ACCESS_FORBIDDEN);
    ensure(request.headers.get('sec-fetch-site') !== 'cross-site', 'Cross-site mutations are not allowed.', 403, ERROR_CODES.ACCESS_FORBIDDEN);
    ensure(process.env.ARTIFACT_ARENA_ENABLED === 'true', 'Artifact Arena is not available.', 503, ERROR_CODES.RUNTIME_UNAVAILABLE);
    const session = await getAuth().api.getSession({ headers: request.headers });
    ensure(session?.user.id, 'Sign in to continue.', 401, ERROR_CODES.AUTH_REQUIRED);
    await getService().limit(session.user.id, 'api', 120);
    const body = await readJson(request);
    const { id } = await context.params;
    return json(await getChallengeApplicationService().review(session.user.id, id, {
      decision: body.decision,
      reason: body.reason,
    }));
  } catch (error) {
    const safe = safeError(error);
    return json({ error: { code: safe.code, message: safe.message } }, safe.status);
  }
}
