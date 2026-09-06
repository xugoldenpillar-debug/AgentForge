import type { CommunityRole } from './community-service.ts';

function exactIds(value: string | undefined): ReadonlySet<string> {
  return new Set((value ?? '').split(',').map((item) => item.trim()).filter(Boolean));
}

/**
 * Community roles are an operator-controlled server-side allowlist. The request
 * body cannot affect this resolver; an absent or malformed allowlist fails closed.
 */
export function resolveCommunityRoles(actorId: string): Promise<ReadonlySet<CommunityRole>> {
  const admins = exactIds(process.env.COMMUNITY_ADMIN_USER_IDS);
  const reviewers = exactIds(process.env.COMMUNITY_REVIEWER_USER_IDS);
  const roles = new Set<CommunityRole>();
  if (admins.has(actorId)) roles.add('admin');
  if (reviewers.has(actorId)) roles.add('reviewer');
  return Promise.resolve(roles);
}
