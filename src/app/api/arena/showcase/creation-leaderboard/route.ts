import { getCreationLeaderboardService } from '@/server/factory';
import { ERROR_CODES, ensure, safeError } from '@/shared/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const roundId = url.searchParams.get('roundId');
    const comparatorKey = url.searchParams.get('comparatorKey');
    const policyVersion = url.searchParams.get('policyVersion');
    ensure(roundId && comparatorKey && policyVersion,
      'roundId, comparatorKey and policyVersion are required.', 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
    const service = getCreationLeaderboardService();
    ensure(service, 'Creation leaderboard is not available.', 503, ERROR_CODES.RUNTIME_UNAVAILABLE);
    return json(await service.project(roundId, comparatorKey, policyVersion));
  } catch (error) {
    const safe = safeError(error);
    return json({ error: { code: safe.code, message: safe.message } }, safe.status);
  }
}
