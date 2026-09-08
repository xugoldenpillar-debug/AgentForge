import type { PublishedWorkPublicationSource, PublicWorkPublication } from '../showcase/contracts.ts';

export type BallotChoice = 'a' | 'b' | 'tie' | 'skip';
export type BallotStatus = 'open' | 'cast' | 'expired';
export type EntryStatus = 'active' | 'withdrawn';

export interface ComparatorPolicy {
  comparatorKey: string;
  policyVersion: string;
  minValidVotes: number;
  minIndependentVoters: number;
  ballotTtlMs: number;
  maxBallotRequestsPerHour: number;
  maxValidVotesPerHour: number;
}

export interface ShowcaseEntry {
  id: string;
  ownerId: string;
  publicationId: string;
  comparatorKey: string;
  policyVersion: string;
  roundId: string;
  status: EntryStatus;
  /** Frozen release digest persisted with the entry so later publication revisions cannot retarget votes. */
  publicationReleaseDigest: string;
  publication: PublicWorkPublication;
  createdAt: string;
  withdrawnAt: string | null;
}

export interface ShowcaseBallot {
  id: string;
  voterId: string;
  roundId: string;
  comparatorKey: string;
  policyVersion: string;
  entryAId: string;
  entryBId: string;
  pairKey: string;
  requestDigest: string;
  idempotencyKey: string;
  issuedAt: string;
  expiresAt: string;
  status: BallotStatus;
  castVoteId: string | null;
}


export interface BlindBallotCandidate {
  readonly entryId: string;
  readonly publication: PublicWorkPublication;
}

export interface ShowcaseBallotProjection extends ShowcaseBallot {
  readonly candidates: null | {
    readonly a: BlindBallotCandidate;
    readonly b: BlindBallotCandidate;
  };
}

export interface ShowcaseVote {
  id: string;
  ballotId: string;
  voterId: string;
  roundId: string;
  comparatorKey: string;
  policyVersion: string;
  entryAId: string;
  entryBId: string;
  pairKey: string;
  choice: BallotChoice;
  idempotencyKey: string;
  createdAt: string;
  validity: 'accepted' | 'excluded';
  exclusionReason: string | null;
}

export interface ShowcaseEntryCandidate extends ShowcaseEntry {
  /** Safe public metadata only; no source bundle or private build details. */
  publication: PublicWorkPublication;
}

export interface VoteAuditEvent {
  id: string;
  action: 'showcase-entry.created' | 'showcase-entry.withdrawn' | 'showcase-ballot.issued' | 'showcase-vote.recorded';
  actorId: string;
  entityId: string;
  occurredAt: string;
  metadata: Readonly<Record<string, string | number | boolean | null>>;
}

export interface VotingRepository {
  transaction<T>(fn: (tx: VotingRepository) => Promise<T>): Promise<T>;
  getPublishedPublication(publicationId: string): Promise<PublishedWorkPublicationSource | null>;
  getEntry(entryId: string): Promise<ShowcaseEntry | null>;
  findEntryByPublication(publicationId: string, roundId: string, comparatorKey: string, policyVersion: string): Promise<ShowcaseEntry | null>;
  insertEntry(entry: ShowcaseEntry): Promise<void>;
  updateEntry(entryId: string, values: Partial<Pick<ShowcaseEntry, 'status' | 'withdrawnAt'>>): Promise<ShowcaseEntry | null>;
  listActiveEntries(roundId: string, comparatorKey: string, policyVersion: string): Promise<ShowcaseEntryCandidate[]>;
  getBallot(ballotId: string): Promise<ShowcaseBallot | null>;
  findBallotByIdempotencyKey(voterId: string, idempotencyKey: string): Promise<ShowcaseBallot | null>;
  findOpenBallot(voterId: string, roundId: string, pairKey: string): Promise<ShowcaseBallot | null>;
  insertBallot(ballot: ShowcaseBallot): Promise<void>;
  updateBallot(
    ballotId: string,
    values: Partial<Pick<ShowcaseBallot, 'status' | 'castVoteId'>>,
    expectedStatus?: ShowcaseBallot['status'],
  ): Promise<ShowcaseBallot | null>;
  findVoteByPair(voterId: string, roundId: string, pairKey: string): Promise<ShowcaseVote | null>;
  findVoteByIdempotencyKey(voterId: string, idempotencyKey: string): Promise<ShowcaseVote | null>;
  insertVote(vote: ShowcaseVote): Promise<void>;
  listVotes(roundId: string, comparatorKey: string, policyVersion: string): Promise<ShowcaseVote[]>;
  appendAuditEvent(event: VoteAuditEvent): Promise<void>;
  rateLimit(key: string, limit: number, windowMs: number): Promise<boolean>;
}

export interface CreateShowcaseEntryInput {
  publicationId: string;
  roundId: string;
  comparatorKey: string;
  policyVersion: string;
}

export interface IssueBallotInput {
  roundId: string;
  comparatorKey: string;
  policyVersion: string;
  idempotencyKey: string;
}

export interface CastBallotInput {
  ballotId: string;
  choice: BallotChoice;
  idempotencyKey: string;
}

export interface LeaderboardRow {
  entryId: string;
  publication: PublicWorkPublication;
  comparisons: number;
  halfPoints: number;
  points: number;
  score: number;
  validVoters: number;
  qualified: boolean;
}

export interface LeaderboardProjection {
  roundId: string;
  comparatorKey: string;
  policyVersion: string;
  sample: { validVotes: number; independentVoters: number; minValidVotes: number; minIndependentVoters: number; qualified: boolean };
  rows: readonly LeaderboardRow[];
}

export interface VotingServiceOptions {
  now?: () => string;
  id?: () => string;
  policy: ComparatorPolicy;
  choosePair?: (candidates: readonly ShowcaseEntryCandidate[], voterId: string) => [ShowcaseEntryCandidate, ShowcaseEntryCandidate] | null;
}

export interface VoteResult {
  vote: ShowcaseVote;
  ballot: ShowcaseBallot;
}
