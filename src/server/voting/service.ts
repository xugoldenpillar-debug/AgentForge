import { createHash, randomUUID } from 'node:crypto';
import { AppError, ERROR_CODES, ensure } from '../../shared/error-core.ts';
import type {
  BallotChoice,
  CastBallotInput,
  ComparatorPolicy,
  CreateShowcaseEntryInput,
  IssueBallotInput,
  LeaderboardProjection,
  LeaderboardRow,
  ShowcaseBallot,
  ShowcaseBallotProjection,
  ShowcaseEntry,
  ShowcaseEntryCandidate,
  ShowcaseVote,
  VoteAuditEvent,
  VoteResult,
  VotingRepository,
  VotingServiceOptions,
} from './contracts.ts';

function clone<T>(value: T): T { return structuredClone(value); }
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function actorId(actor: { id?: string; userId?: string } | string | null | undefined): string {
  const id = typeof actor === 'string' ? actor : actor?.id ?? actor?.userId;
  ensure(typeof id === 'string' && id.trim().length > 0, 'Authentication is required.', 401, ERROR_CODES.AUTH_REQUIRED);
  return id;
}
function text(value: unknown, field: string, maxLength: number): string {
  ensure(typeof value === 'string' && value.trim().length > 0, `${field} is required.`, 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
  ensure(value.length <= maxLength, `${field} is too long.`, 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
  return value;
}
function digest(value: unknown): string {
  const normalize = (current: unknown): unknown => {
    if (Array.isArray(current)) return current.map(normalize);
    if (!record(current)) return current;
    return Object.fromEntries(Object.keys(current).sort().map((key) => [key, normalize(current[key])]));
  };
  return `sha256:${createHash('sha256').update(JSON.stringify(normalize(value))).digest('hex')}`;
}
function notFound(message: string): never { throw new AppError(message, 404, ERROR_CODES.RESOURCE_NOT_FOUND); }
function conflict(message: string): never { throw new AppError(message, 409, ERROR_CODES.CONCURRENT_SAVE); }
function pairKey(roundId: string, comparatorKey: string, policyVersion: string, entryAId: string, entryBId: string): string {
  const [left, right] = [entryAId, entryBId].sort();
  return `${roundId}:${comparatorKey}:${policyVersion}:${left}:${right}`;
}
function canonicalPair(roundId: string, comparatorKey: string, policyVersion: string, a: ShowcaseEntryCandidate, b: ShowcaseEntryCandidate): [ShowcaseEntryCandidate, ShowcaseEntryCandidate] {
  ensure(a.id !== b.id, 'A ballot requires two distinct entries.', 409, ERROR_CODES.RUNTIME_POLICY_DENIED);
  ensure(a.ownerId !== b.ownerId, 'Entries owned by the same user cannot be paired.', 409, ERROR_CODES.RUNTIME_POLICY_DENIED);
  ensure(a.roundId === roundId && b.roundId === roundId && a.comparatorKey === comparatorKey && b.comparatorKey === comparatorKey && a.policyVersion === policyVersion && b.policyVersion === policyVersion, 'Entries do not share the requested comparator partition.', 409, ERROR_CODES.RUNTIME_POLICY_DENIED);
  return a.id < b.id ? [a, b] : [b, a];
}

function isBallotExpired(ballot: ShowcaseBallot, now: string): boolean {
  return Date.parse(ballot.expiresAt) <= Date.parse(now);
}

function isUniqueConflict(error: unknown): boolean {
  if (error instanceof AppError) return error.code === ERROR_CODES.CONCURRENT_SAVE;
  const candidate = error as { code?: unknown; cause?: { code?: unknown } } | null;
  return candidate?.code === '23505' || candidate?.cause?.code === '23505';
}
function validatePolicy(policy: ComparatorPolicy): ComparatorPolicy {
  ensure(Number.isInteger(policy.minValidVotes) && policy.minValidVotes > 0, 'Comparator policy requires a positive vote threshold.', 500, ERROR_CODES.RUNTIME_POLICY_DENIED);
  ensure(Number.isInteger(policy.minIndependentVoters) && policy.minIndependentVoters > 0, 'Comparator policy requires a positive voter threshold.', 500, ERROR_CODES.RUNTIME_POLICY_DENIED);
  ensure(Number.isInteger(policy.ballotTtlMs) && policy.ballotTtlMs > 0, 'Comparator policy requires a positive ballot TTL.', 500, ERROR_CODES.RUNTIME_POLICY_DENIED);
  ensure(Number.isInteger(policy.maxBallotRequestsPerHour) && policy.maxBallotRequestsPerHour > 0, 'Comparator policy requires a ballot rate limit.', 500, ERROR_CODES.RUNTIME_POLICY_DENIED);
  ensure(Number.isInteger(policy.maxValidVotesPerHour) && policy.maxValidVotesPerHour > 0, 'Comparator policy requires a vote rate limit.', 500, ERROR_CODES.RUNTIME_POLICY_DENIED);
  return policy;
}

export class ShowcaseVotingService {
  private readonly repo: VotingRepository;
  private readonly now: () => string;
  private readonly id: () => string;
  private readonly policy: ComparatorPolicy;
  private readonly choosePair: VotingServiceOptions['choosePair'];

  constructor(repo: VotingRepository, options: VotingServiceOptions) {
    this.repo = repo;
    this.now = options.now ?? (() => new Date().toISOString());
    this.id = options.id ?? randomUUID;
    this.policy = validatePolicy(options.policy);
    this.choosePair = options.choosePair;
  }

  private orderedPairs(
    candidates: readonly ShowcaseEntryCandidate[],
    voterId: string,
    roundId: string,
    comparatorKey: string,
    policyVersion: string,
  ): Array<[ShowcaseEntryCandidate, ShowcaseEntryCandidate]> {
    const ordered = [...candidates].sort((left, right) => left.id.localeCompare(right.id));
    const pairs: Array<[ShowcaseEntryCandidate, ShowcaseEntryCandidate]> = [];
    for (let leftIndex = 0; leftIndex < ordered.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < ordered.length; rightIndex += 1) {
        const left = ordered[leftIndex];
        const right = ordered[rightIndex];
        if (left.ownerId === voterId || right.ownerId === voterId || left.ownerId === right.ownerId) continue;
        pairs.push(canonicalPair(roundId, comparatorKey, policyVersion, left, right));
      }
    }
    if (pairs.length > 1) {
      const rotationSeed = createHash('sha256')
        .update(`${voterId}\0${roundId}\0${comparatorKey}\0${policyVersion}`)
        .digest('hex');
      const offset = Number.parseInt(rotationSeed.slice(0, 8), 16) % pairs.length;
      pairs.push(...pairs.splice(0, offset));
    }
    if (!this.choosePair) return pairs;
    const preferred = this.choosePair(candidates, voterId);
    if (!preferred) return [];
    const canonicalPreferred = canonicalPair(roundId, comparatorKey, policyVersion, preferred[0], preferred[1]);
    const preferredKey = pairKey(roundId, comparatorKey, policyVersion, canonicalPreferred[0].id, canonicalPreferred[1].id);
    return [canonicalPreferred, ...pairs.filter(([left, right]) => pairKey(roundId, comparatorKey, policyVersion, left.id, right.id) !== preferredKey)];
  }

  async createEntry(actor: { id?: string; userId?: string } | string | null | undefined, input: CreateShowcaseEntryInput): Promise<ShowcaseEntry> {
    const ownerId = actorId(actor);
    const source = await this.repo.getPublishedPublication(input.publicationId);
    if (!source) notFound('Published work not found.');
    ensure(source.ownerId === ownerId, 'You do not own this publication.', 403, ERROR_CODES.OWNERSHIP_FORBIDDEN);
    const publication = source.publication;
    const roundId = text(input.roundId, 'roundId', 200);
    const comparatorKey = text(input.comparatorKey, 'comparatorKey', 200);
    const policyVersion = text(input.policyVersion, 'policyVersion', 100);
    ensure(comparatorKey === this.policy.comparatorKey && policyVersion === this.policy.policyVersion, 'The requested comparator policy is not configured for this service.', 409, ERROR_CODES.RUNTIME_POLICY_DENIED);
    const existing = await this.repo.findEntryByPublication(publication.publicationId, roundId, comparatorKey, policyVersion);
    if (existing) {
      ensure(existing.ownerId === ownerId, 'This publication is already entered by another owner.', 403, ERROR_CODES.OWNERSHIP_FORBIDDEN);
      return clone(existing);
    }
    const entry: ShowcaseEntry = {
      id: this.id(), ownerId, publicationId: publication.publicationId, comparatorKey, policyVersion,
      roundId, status: 'active', publicationReleaseDigest: publication.releaseDigest, publication: clone(publication), createdAt: this.now(), withdrawnAt: null,
    };
    const audit: VoteAuditEvent = { id: this.id(), action: 'showcase-entry.created', actorId: ownerId, entityId: entry.id, occurredAt: entry.createdAt, metadata: { roundId, comparatorKey, policyVersion } };
    await this.repo.transaction(async (tx) => { await tx.insertEntry(entry); await tx.appendAuditEvent(audit); });
    return clone(entry);
  }

  async withdrawEntry(actor: { id?: string; userId?: string } | string | null | undefined, entryId: string): Promise<ShowcaseEntry> {
    const ownerId = actorId(actor);
    const entry = await this.repo.getEntry(entryId);
    if (!entry) notFound('Showcase entry not found.');
    ensure(entry.ownerId === ownerId, 'You do not own this showcase entry.', 403, ERROR_CODES.OWNERSHIP_FORBIDDEN);
    ensure(entry.status === 'active', 'The showcase entry is already withdrawn.', 409, ERROR_CODES.RUNTIME_POLICY_DENIED);
    const withdrawnAt = this.now();
    const updated = await this.repo.transaction(async (tx) => {
      const next = await tx.updateEntry(entry.id, { status: 'withdrawn', withdrawnAt });
      if (!next) conflict('The showcase entry changed before withdrawal could be saved.');
      const audit: VoteAuditEvent = { id: this.id(), action: 'showcase-entry.withdrawn', actorId: ownerId, entityId: entry.id, occurredAt: withdrawnAt, metadata: { roundId: entry.roundId } };
      await tx.appendAuditEvent(audit);
      return next;
    });
    return clone(updated);
  }

  async getBallot(actor: { id?: string; userId?: string } | string | null | undefined, ballotId: string): Promise<ShowcaseBallot> {
    const voterId = actorId(actor);
    const id = text(ballotId, 'ballotId', 200);
    const ballot = await this.repo.getBallot(id);
    if (!ballot || ballot.voterId !== voterId) notFound('Showcase ballot not found.');
    if (ballot.status === 'open' && Date.parse(ballot.expiresAt) <= Date.parse(this.now())) {
      const expired = await this.repo.updateBallot(ballot.id, { status: 'expired' }, 'open');
      return clone(expired ?? { ...ballot, status: 'expired' });
    }
    return clone(ballot);
  }

  async projectBallot(actor: { id?: string; userId?: string } | string | null | undefined, ballotId: string): Promise<ShowcaseBallotProjection> {
    const ballot = await this.getBallot(actor, ballotId);
    const [entryA, entryB] = await Promise.all([
      this.repo.getEntry(ballot.entryAId),
      this.repo.getEntry(ballot.entryBId),
    ]);
    const candidates = entryA && entryB
      ? {
          a: { entryId: entryA.id, publication: clone(entryA.publication) },
          b: { entryId: entryB.id, publication: clone(entryB.publication) },
        }
      : null;
    return { ...ballot, candidates };
  }

  async issueBallot(actor: { id?: string; userId?: string } | string | null | undefined, input: IssueBallotInput): Promise<ShowcaseBallot | null> {
    const voterId = actorId(actor);
    const roundId = text(input.roundId, 'roundId', 200);
    const comparatorKey = text(input.comparatorKey, 'comparatorKey', 200);
    const policyVersion = text(input.policyVersion, 'policyVersion', 100);
    const idempotencyKey = text(input.idempotencyKey, 'idempotencyKey', 200);
    ensure(comparatorKey === this.policy.comparatorKey && policyVersion === this.policy.policyVersion, 'The requested comparator policy is not configured for this service.', 409, ERROR_CODES.RUNTIME_POLICY_DENIED);
    const requestDigest = digest({ roundId, comparatorKey, policyVersion });
    const prior = await this.repo.findBallotByIdempotencyKey(voterId, idempotencyKey);
    if (prior) {
      ensure(prior.requestDigest === requestDigest, 'The idempotency key was reused for a different ballot request.', 409, ERROR_CODES.CONCURRENT_SAVE);
      return clone(prior);
    }
    ensure(await this.repo.rateLimit(`showcase-ballot:${voterId}`, this.policy.maxBallotRequestsPerHour, 60 * 60 * 1000), 'Ballot request rate limit exceeded.', 429, ERROR_CODES.RATE_LIMITED);

    // The partial unique index on open ballots is the final concurrency fence. A
    // serializable transaction normally prevents duplicate issuance; retry once
    // when another request wins that fence so callers receive the live ballot.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const ballot = await this.repo.transaction(async (tx) => {
          const prior = await tx.findBallotByIdempotencyKey(voterId, idempotencyKey);
          if (prior) {
            ensure(prior.requestDigest === requestDigest, 'The idempotency key was reused for a different ballot request.', 409, ERROR_CODES.CONCURRENT_SAVE);
            return prior;
          }

          const candidates = (await tx.listActiveEntries(roundId, comparatorKey, policyVersion))
            .filter((entry) => entry.status === 'active' && entry.ownerId !== voterId);
          const pairs = this.orderedPairs(candidates, voterId, roundId, comparatorKey, policyVersion);
          for (const [a, b] of pairs) {
            const key = pairKey(roundId, comparatorKey, policyVersion, a.id, b.id);
            const priorOpen = await tx.findOpenBallot(voterId, roundId, key);
            if (priorOpen) {
              if (!isBallotExpired(priorOpen, this.now())) return priorOpen;
              // Expired rows remain as audit history. They must be transitioned
              // before a new generation can use the same pair.
              const expired = await tx.updateBallot(priorOpen.id, { status: 'expired' }, 'open');
              if (!expired) continue;
            }
            if (await tx.findVoteByPair(voterId, roundId, key)) continue;

            const issuedAt = this.now();
            const ballot: ShowcaseBallot = {
              id: this.id(), voterId, roundId, comparatorKey, policyVersion, entryAId: a.id, entryBId: b.id, pairKey: key,
              requestDigest, idempotencyKey, issuedAt,
              expiresAt: new Date(Date.parse(issuedAt) + this.policy.ballotTtlMs).toISOString(), status: 'open', castVoteId: null,
            };
            const audit: VoteAuditEvent = { id: this.id(), action: 'showcase-ballot.issued', actorId: voterId, entityId: ballot.id, occurredAt: issuedAt, metadata: { roundId, comparatorKey, policyVersion, pairKey: key } };
            await tx.insertBallot(ballot);
            await tx.appendAuditEvent(audit);
            return ballot;
          }
          return null;
        });
        return ballot ? clone(ballot) : null;
      } catch (error) {
        if (!isUniqueConflict(error) || attempt === 1) throw error;
      }
    }
    return null;
  }

  async castBallot(actor: { id?: string; userId?: string } | string | null | undefined, input: CastBallotInput): Promise<VoteResult> {
    const voterId = actorId(actor);
    const ballotId = text(input.ballotId, 'ballotId', 200);
    const idempotencyKey = text(input.idempotencyKey, 'idempotencyKey', 200);
    ensure(['a', 'b', 'tie', 'skip'].includes(input.choice), 'Invalid ballot choice.', 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
    const existingByKey = await this.repo.findVoteByIdempotencyKey(voterId, idempotencyKey);
    if (existingByKey) {
      ensure(existingByKey.ballotId === ballotId && existingByKey.choice === input.choice, 'The idempotency key was reused for a different vote.', 409, ERROR_CODES.CONCURRENT_SAVE);
      const ballot = await this.repo.getBallot(ballotId);
      if (!ballot) notFound('Ballot not found.');
      return { vote: clone(existingByKey), ballot: clone(ballot) };
    }
    const ballot = await this.repo.getBallot(ballotId);
    if (!ballot) notFound('Ballot not found.');
    ensure(ballot.voterId === voterId, 'You do not own this ballot.', 403, ERROR_CODES.OWNERSHIP_FORBIDDEN);
    const now = Date.parse(this.now());
    ensure(ballot.status === 'open', 'This ballot has already been cast.', 409, ERROR_CODES.CONCURRENT_SAVE);
    if (Date.parse(ballot.expiresAt) <= now) {
      await this.repo.updateBallot(ballot.id, { status: 'expired' }, 'open');
      throw new AppError('This ballot has expired.', 409, ERROR_CODES.RUNTIME_POLICY_DENIED);
    }
    ensure(await this.repo.rateLimit(`showcase-vote:${voterId}`, this.policy.maxValidVotesPerHour, 60 * 60 * 1000), 'Vote rate limit exceeded.', 429, ERROR_CODES.RATE_LIMITED);
    const [entryA, entryB] = await Promise.all([this.repo.getEntry(ballot.entryAId), this.repo.getEntry(ballot.entryBId)]);
    ensure(entryA && entryB && entryA.status === 'active' && entryB.status === 'active', 'The entries are no longer available for voting.', 409, ERROR_CODES.RUNTIME_POLICY_DENIED);
    ensure(entryA.ownerId !== voterId && entryB.ownerId !== voterId, 'You cannot vote on your own work.', 403, ERROR_CODES.ACCESS_FORBIDDEN);
    const duplicate = await this.repo.findVoteByPair(voterId, ballot.roundId, ballot.pairKey);
    if (duplicate) {
      ensure(duplicate.choice === input.choice, 'This pair has already been voted on.', 409, ERROR_CODES.CONCURRENT_SAVE);
      return { vote: clone(duplicate), ballot: clone(ballot) };
    }
    const createdAt = this.now();
    const vote: ShowcaseVote = {
      id: this.id(), ballotId: ballot.id, voterId, roundId: ballot.roundId, comparatorKey: ballot.comparatorKey,
      policyVersion: ballot.policyVersion, entryAId: ballot.entryAId, entryBId: ballot.entryBId, pairKey: ballot.pairKey,
      choice: input.choice as BallotChoice, idempotencyKey, createdAt, validity: input.choice === 'skip' ? 'accepted' : 'accepted', exclusionReason: null,
    };
    const audit: VoteAuditEvent = { id: this.id(), action: 'showcase-vote.recorded', actorId: voterId, entityId: vote.id, occurredAt: createdAt, metadata: { ballotId: ballot.id, choice: vote.choice, pairKey: vote.pairKey } };
    const updated = await this.repo.transaction(async (tx) => {
      await tx.insertVote(vote);
      const nextBallot = await tx.updateBallot(ballot.id, { status: 'cast', castVoteId: vote.id }, 'open');
      if (!nextBallot) conflict('The ballot changed before the vote could be saved.');
      await tx.appendAuditEvent(audit);
      return nextBallot;
    });
    return { vote: clone(vote), ballot: clone(updated) };
  }

  async projectLeaderboard(roundId: string, comparatorKey: string, policyVersion: string): Promise<LeaderboardProjection> {
    ensure(comparatorKey === this.policy.comparatorKey && policyVersion === this.policy.policyVersion, 'The requested comparator policy is not configured for this service.', 409, ERROR_CODES.RUNTIME_POLICY_DENIED);
    const entries = (await this.repo.listActiveEntries(roundId, comparatorKey, policyVersion)).filter((entry) => entry.status === 'active');
    const entryMap = new Map(entries.map((entry) => [entry.id, entry]));
    const votes = (await this.repo.listVotes(roundId, comparatorKey, policyVersion)).filter((vote) => vote.validity === 'accepted' && vote.choice !== 'skip');
    const stats = new Map<string, { comparisons: number; halfPoints: number; voters: Set<string> }>();
    for (const entry of entries) stats.set(entry.id, { comparisons: 0, halfPoints: 0, voters: new Set() });
    let validVotes = 0;
    const voters = new Set<string>();
    for (const vote of votes) {
      const a = entryMap.get(vote.entryAId);
      const b = entryMap.get(vote.entryBId);
      if (!a || !b || a.ownerId === vote.voterId || b.ownerId === vote.voterId || a.ownerId === b.ownerId) continue;
      const aStats = stats.get(a.id);
      const bStats = stats.get(b.id);
      if (!aStats || !bStats) continue;
      validVotes += 1;
      voters.add(vote.voterId);
      aStats.comparisons += 1; bStats.comparisons += 1; aStats.voters.add(vote.voterId); bStats.voters.add(vote.voterId);
      if (vote.choice === 'a') aStats.halfPoints += 2;
      else if (vote.choice === 'b') bStats.halfPoints += 2;
      else if (vote.choice === 'tie') { aStats.halfPoints += 1; bStats.halfPoints += 1; }
    }
    const sampleQualified = validVotes >= this.policy.minValidVotes && voters.size >= this.policy.minIndependentVoters;
    const rows: LeaderboardRow[] = entries.map((entry) => {
      const current = stats.get(entry.id)!;
      const points = current.halfPoints / 2;
      const score = current.comparisons === 0 ? 0 : Math.round((current.halfPoints / (2 * current.comparisons)) * 1_000_000) / 1_000_000;
      const qualified = current.comparisons >= this.policy.minValidVotes
        && current.voters.size >= this.policy.minIndependentVoters;
      return { entryId: entry.id, publication: clone(entry.publication), comparisons: current.comparisons, halfPoints: current.halfPoints, points, score, validVoters: current.voters.size, qualified };
    }).sort((left, right) => Number(right.qualified) - Number(left.qualified)
      || right.score - left.score
      || right.comparisons - left.comparisons
      || left.entryId.localeCompare(right.entryId));
    return { roundId, comparatorKey, policyVersion, sample: { validVotes, independentVoters: voters.size, minValidVotes: this.policy.minValidVotes, minIndependentVoters: this.policy.minIndependentVoters, qualified: sampleQualified }, rows };
  }
}
