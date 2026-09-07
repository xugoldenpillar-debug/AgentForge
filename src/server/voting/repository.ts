import type { VotingRepository } from './contracts.ts';

export type { VotingRepository } from './contracts.ts';

export function isVotingRepository(value: unknown): value is VotingRepository {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<VotingRepository>;
  return typeof candidate.transaction === 'function'
    && typeof candidate.getPublishedPublication === 'function'
    && typeof candidate.listActiveEntries === 'function'
    && typeof candidate.insertBallot === 'function'
    && typeof candidate.insertVote === 'function'
    && typeof candidate.listVotes === 'function'
    && typeof candidate.appendAuditEvent === 'function';
}
