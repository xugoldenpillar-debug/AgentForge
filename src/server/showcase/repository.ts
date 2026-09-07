import type { ShowcaseRepository } from './contracts.ts';

/**
 * A narrow re-export keeps the persistence seam discoverable. Production code
 * must inject a durable adapter; there is intentionally no memory fallback.
 */
export type { ShowcaseRepository } from './contracts.ts';

export function isShowcaseRepository(value: unknown): value is ShowcaseRepository {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ShowcaseRepository>;
  return typeof candidate.transaction === 'function'
    && typeof candidate.getSealedBundle === 'function'
    && typeof candidate.getWorkPublication === 'function'
    && typeof candidate.insertWorkPublication === 'function'
    && typeof candidate.updateWorkPublication === 'function'
    && typeof candidate.appendAuditEvent === 'function';
}
