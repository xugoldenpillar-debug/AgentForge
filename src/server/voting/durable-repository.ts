import type { Repository, ShowcaseBallot as SharedBallot, ShowcaseEntry as SharedEntry, ShowcaseVote as SharedVote } from '../../shared/types.ts';
import type { PublishedWorkPublicationSource, PublicWorkPublication } from '../showcase/contracts.ts';
import type {
  ShowcaseBallot,
  ShowcaseEntry,
  ShowcaseEntryCandidate,
  ShowcaseVote,
  VotingRepository,
} from './contracts.ts';

function entryRow(entry: ShowcaseEntry): SharedEntry {
  return {
    id: entry.id,
    ownerId: entry.ownerId,
    publicationId: entry.publication.publicationId,
    comparatorKey: entry.comparatorKey,
    policyVersion: entry.policyVersion,
    roundId: entry.roundId,
    status: entry.status,
    publicationReleaseDigest: entry.publicationReleaseDigest,
    createdAt: entry.createdAt,
    withdrawnAt: entry.withdrawnAt,
  };
}

function entryDomain(row: SharedEntry, publication: PublicWorkPublication): ShowcaseEntry {
  return { ...row, publication };
}

function ballotRow(ballot: ShowcaseBallot): SharedBallot {
  return { ...ballot };
}

function ballotDomain(row: SharedBallot): ShowcaseBallot {
  return { ...row };
}

function voteRow(vote: ShowcaseVote): SharedVote {
  return { ...vote };
}

function voteDomain(row: SharedVote): ShowcaseVote {
  return { ...row };
}

/**
 * Durable voting adapter backed by the shared Repository. Publication metadata
 * is copied into each entry as a safe projection so leaderboard reads remain
 * stable even if a later publication is withdrawn. No raw bundle IDs are put
 * into the public publication payload.
 */
export class DrizzleVotingRepository implements VotingRepository {
  constructor(
    private readonly repository: Repository,
    private readonly getPublication: (publicationId: string) => Promise<PublishedWorkPublicationSource | null>,
  ) {}

  async transaction<T>(fn: (tx: VotingRepository) => Promise<T>): Promise<T> {
    return this.repository.transaction(async (tx) => fn(new DrizzleVotingRepository(tx, this.getPublication)));
  }

  async getPublishedPublication(publicationId: string): Promise<PublishedWorkPublicationSource | null> {
    return this.getPublication(publicationId);
  }

  async getEntry(entryId: string): Promise<ShowcaseEntry | null> {
    const row = (await this.repository.read('showcaseEntries', { id: entryId }))[0];
    if (!row) return null;
    const source = await this.getPublication(row.publicationId);
    return source ? entryDomain(row, source.publication) : null;
  }

  async findEntryByPublication(publicationId: string, roundId: string, comparatorKey: string, policyVersion: string): Promise<ShowcaseEntry | null> {
    const row = (await this.repository.read('showcaseEntries', { publicationId, roundId, comparatorKey, policyVersion }))[0];
    if (!row) return null;
    const source = await this.getPublication(row.publicationId);
    return source ? entryDomain(row, source.publication) : null;
  }

  async insertEntry(entry: ShowcaseEntry): Promise<void> {
    await this.repository.insert('showcaseEntries', [entryRow(entry)]);
  }

  async updateEntry(entryId: string, values: Partial<Pick<ShowcaseEntry, 'status' | 'withdrawnAt'>>): Promise<ShowcaseEntry | null> {
    const rows = await this.repository.update('showcaseEntries', { id: entryId }, values as Partial<SharedEntry>);
    const row = rows[0];
    if (!row) return null;
    const source = await this.getPublication(row.publicationId);
    return source ? entryDomain(row, source.publication) : null;
  }

  async listActiveEntries(roundId: string, comparatorKey: string, policyVersion: string): Promise<ShowcaseEntryCandidate[]> {
    const rows = await this.repository.read('showcaseEntries', { roundId, comparatorKey, policyVersion, status: 'active' });
    const entries = await Promise.all(rows.map(async (row) => {
      const source = await this.getPublication(row.publicationId);
      return source ? entryDomain(row, source.publication) : null;
    }));
    return entries.filter((entry): entry is ShowcaseEntryCandidate => entry !== null);
  }

  async getBallot(ballotId: string): Promise<ShowcaseBallot | null> {
    const row = (await this.repository.read('showcaseBallots', { id: ballotId }))[0];
    return row ? ballotDomain(row) : null;
  }

  async findBallotByIdempotencyKey(voterId: string, idempotencyKey: string): Promise<ShowcaseBallot | null> {
    const row = (await this.repository.read('showcaseBallots', { voterId, idempotencyKey }))[0];
    return row ? ballotDomain(row) : null;
  }

  async findOpenBallot(voterId: string, roundId: string, pairKey: string): Promise<ShowcaseBallot | null> {
    const rows = await this.repository.read('showcaseBallots', { voterId, roundId, pairKey, status: 'open' });
    return rows[0] ? ballotDomain(rows[0]) : null;
  }

  async insertBallot(ballot: ShowcaseBallot): Promise<void> {
    await this.repository.insert('showcaseBallots', [ballotRow(ballot)]);
  }

  async updateBallot(
    ballotId: string,
    values: Partial<Pick<ShowcaseBallot, 'status' | 'castVoteId'>>,
    expectedStatus?: ShowcaseBallot['status'],
  ): Promise<ShowcaseBallot | null> {
    const where: Partial<SharedBallot> = { id: ballotId };
    if (expectedStatus !== undefined) where.status = expectedStatus;
    const rows = await this.repository.update('showcaseBallots', where, values as Partial<SharedBallot>);
    return rows[0] ? ballotDomain(rows[0]) : null;
  }

  async findVoteByPair(voterId: string, roundId: string, pairKey: string): Promise<ShowcaseVote | null> {
    const row = (await this.repository.read('showcaseVotes', { voterId, roundId, pairKey }))[0];
    return row ? voteDomain(row) : null;
  }

  async findVoteByIdempotencyKey(voterId: string, idempotencyKey: string): Promise<ShowcaseVote | null> {
    const row = (await this.repository.read('showcaseVotes', { voterId, idempotencyKey }))[0];
    return row ? voteDomain(row) : null;
  }

  async insertVote(vote: ShowcaseVote): Promise<void> {
    await this.repository.insert('showcaseVotes', [voteRow(vote)]);
  }

  async listVotes(roundId: string, comparatorKey: string, policyVersion: string): Promise<ShowcaseVote[]> {
    const rows = await this.repository.read('showcaseVotes', { roundId, comparatorKey, policyVersion });
    return rows.map(voteDomain);
  }

  async appendAuditEvent(event: import('./contracts.ts').VoteAuditEvent): Promise<void> {
    await this.repository.insert('showcaseAuditEvents', [{
      id: event.id,
      action: event.action,
      actorId: event.actorId,
      publicationId: null,
      entityId: event.entityId,
      occurredAt: event.occurredAt,
      metadata: event.metadata,
    }]);
  }

  async rateLimit(key: string, limit: number, windowMs: number): Promise<boolean> {
    return this.repository.rateLimit(key, limit, windowMs);
  }
}
