import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { AppError, ERROR_CODES } from '../src/shared/error-core.ts';
import type {
  PublishedWorkPublicationSource,
  PublicWorkPublication,
  SealedBundleSource,
  ShowcaseAuditEvent,
  ShowcaseRepository,
  WorkPublication,
} from '../src/server/showcase/contracts.ts';
import { CreationRunPublicationSeam } from '../src/server/showcase/creation-run.ts';
import { WorkPublicationService } from '../src/server/showcase/service.ts';
import type {
  ComparatorPolicy,
  ShowcaseBallot,
  ShowcaseEntry,
  ShowcaseEntryCandidate,
  ShowcaseVote,
  VoteAuditEvent,
  VotingRepository,
  VotingServiceOptions,
} from '../src/server/voting/contracts.ts';
import { ShowcaseVotingService } from '../src/server/voting/service.ts';

function clone<T>(value: T): T {
  return structuredClone(value);
}

class MemoryShowcaseRepository implements ShowcaseRepository {
  bundles = new Map<string, SealedBundleSource>();
  publications = new Map<string, WorkPublication>();
  audits: ShowcaseAuditEvent[] = [];

  async transaction<T>(fn: (tx: ShowcaseRepository) => Promise<T>): Promise<T> {
    return fn(this);
  }
  async getSealedBundle(bundleId: string, ownerId: string): Promise<SealedBundleSource | null> {
    const bundle = this.bundles.get(bundleId);
    return bundle && bundle.ownerId === ownerId ? clone(bundle) : null;
  }
  async getWorkPublication(publicationId: string): Promise<WorkPublication | null> {
    const publication = this.publications.get(publicationId);
    return publication ? clone(publication) : null;
  }
  async insertWorkPublication(publication: WorkPublication): Promise<void> {
    if (this.publications.has(publication.id)) throw new Error('duplicate publication');
    this.publications.set(publication.id, clone(publication));
  }
  async updateWorkPublication(publicationId: string, expectedRevision: number, values: Partial<Pick<WorkPublication, 'status' | 'revision' | 'updatedAt' | 'reviewedAt' | 'withdrawnAt'>>): Promise<WorkPublication | null> {
    const publication = this.publications.get(publicationId);
    if (!publication || publication.revision !== expectedRevision) return null;
    Object.assign(publication, clone(values));
    return clone(publication);
  }
  async appendAuditEvent(event: ShowcaseAuditEvent): Promise<void> {
    this.audits.push(clone(event));
  }
}

class MemoryVotingRepository implements VotingRepository {
  publications = new Map<string, PublishedWorkPublicationSource>();
  entries = new Map<string, ShowcaseEntry>();
  ballots = new Map<string, ShowcaseBallot>();
  votes = new Map<string, ShowcaseVote>();
  audits: VoteAuditEvent[] = [];
  limits = new Map<string, number>();
  concurrentVoteChoice: ShowcaseVote['choice'] | null = null;

  async transaction<T>(fn: (tx: VotingRepository) => Promise<T>): Promise<T> {
    return fn(this);
  }
  async getPublishedPublication(publicationId: string): Promise<PublishedWorkPublicationSource | null> {
    const source = this.publications.get(publicationId);
    return source ? clone(source) : null;
  }
  async getEntry(entryId: string): Promise<ShowcaseEntry | null> {
    const entry = this.entries.get(entryId);
    return entry ? clone(entry) : null;
  }
  async findEntryByPublication(publicationId: string, roundId: string, comparatorKey: string, policyVersion: string): Promise<ShowcaseEntry | null> {
    const entry = [...this.entries.values()].find((candidate) => candidate.publicationId === publicationId && candidate.roundId === roundId && candidate.comparatorKey === comparatorKey && candidate.policyVersion === policyVersion);
    return entry ? clone(entry) : null;
  }
  async insertEntry(entry: ShowcaseEntry): Promise<void> {
    this.entries.set(entry.id, clone(entry));
  }
  async updateEntry(entryId: string, values: Partial<Pick<ShowcaseEntry, 'status' | 'withdrawnAt'>>): Promise<ShowcaseEntry | null> {
    const entry = this.entries.get(entryId);
    if (!entry) return null;
    Object.assign(entry, clone(values));
    return clone(entry);
  }
  async listActiveEntries(roundId: string, comparatorKey: string, policyVersion: string): Promise<ShowcaseEntryCandidate[]> {
    return [...this.entries.values()]
      .filter((entry) => entry.roundId === roundId && entry.comparatorKey === comparatorKey && entry.policyVersion === policyVersion && entry.status === 'active')
      .map(clone);
  }
  async getBallot(ballotId: string): Promise<ShowcaseBallot | null> {
    const ballot = this.ballots.get(ballotId);
    return ballot ? clone(ballot) : null;
  }
  async findBallotByIdempotencyKey(voterId: string, idempotencyKey: string): Promise<ShowcaseBallot | null> {
    const ballot = [...this.ballots.values()].find((candidate) => candidate.voterId === voterId && candidate.idempotencyKey === idempotencyKey);
    return ballot ? clone(ballot) : null;
  }
  async findOpenBallot(voterId: string, roundId: string, pairKey: string): Promise<ShowcaseBallot | null> {
    const ballot = [...this.ballots.values()].find((candidate) => candidate.voterId === voterId && candidate.roundId === roundId && candidate.pairKey === pairKey && candidate.status === 'open');
    return ballot ? clone(ballot) : null;
  }
  async insertBallot(ballot: ShowcaseBallot): Promise<void> {
    const duplicate = [...this.ballots.values()].find((candidate) =>
      candidate.voterId === ballot.voterId && candidate.idempotencyKey === ballot.idempotencyKey);
    if (duplicate) throw Object.assign(new Error('duplicate ballot idempotency key'), { code: '23505' });
    const openPair = [...this.ballots.values()].find((candidate) =>
      candidate.voterId === ballot.voterId
      && candidate.roundId === ballot.roundId
      && candidate.comparatorKey === ballot.comparatorKey
      && candidate.policyVersion === ballot.policyVersion
      && candidate.pairKey === ballot.pairKey
      && candidate.status === 'open');
    if (openPair) throw Object.assign(new Error('duplicate open ballot pair'), { code: '23505' });
    this.ballots.set(ballot.id, clone(ballot));
  }
  async updateBallot(
    ballotId: string,
    values: Partial<Pick<ShowcaseBallot, 'status' | 'castVoteId'>>,
    expectedStatus?: ShowcaseBallot['status'],
  ): Promise<ShowcaseBallot | null> {
    const ballot = this.ballots.get(ballotId);
    if (!ballot || (expectedStatus !== undefined && ballot.status !== expectedStatus)) return null;
    Object.assign(ballot, clone(values));
    return clone(ballot);
  }
  async findVoteByPair(voterId: string, roundId: string, pairKey: string): Promise<ShowcaseVote | null> {
    const vote = [...this.votes.values()].find((candidate) => candidate.voterId === voterId && candidate.roundId === roundId && candidate.pairKey === pairKey);
    return vote ? clone(vote) : null;
  }
  async findVoteByIdempotencyKey(voterId: string, idempotencyKey: string): Promise<ShowcaseVote | null> {
    const vote = [...this.votes.values()].find((candidate) => candidate.voterId === voterId && candidate.idempotencyKey === idempotencyKey);
    return vote ? clone(vote) : null;
  }
  async insertVote(vote: ShowcaseVote): Promise<void> {
    if (this.concurrentVoteChoice) {
      const winner: ShowcaseVote = {
        ...clone(vote),
        id: 'concurrent-vote',
        choice: this.concurrentVoteChoice,
        idempotencyKey: 'concurrent-idempotency-key',
      };
      this.concurrentVoteChoice = null;
      this.votes.set(winner.id, winner);
      const ballot = this.ballots.get(vote.ballotId);
      if (ballot) Object.assign(ballot, { status: 'cast' as const, castVoteId: winner.id });
      throw Object.assign(new Error('concurrent unique vote'), { code: '23505' });
    }
    this.votes.set(vote.id, clone(vote));
  }
  async listVotes(roundId: string, comparatorKey: string, policyVersion: string): Promise<ShowcaseVote[]> {
    return [...this.votes.values()].filter((vote) => vote.roundId === roundId && vote.comparatorKey === comparatorKey && vote.policyVersion === policyVersion).map(clone);
  }
  async appendAuditEvent(event: VoteAuditEvent): Promise<void> {
    this.audits.push(clone(event));
  }
  async rateLimit(key: string, limit: number): Promise<boolean> {
    const count = (this.limits.get(key) ?? 0) + 1;
    this.limits.set(key, count);
    return count <= limit;
  }
}

const policy: ComparatorPolicy = {
  comparatorKey: 'pelican-bike:v1',
  policyVersion: 'showcase-pairwise-v1',
  minValidVotes: 2,
  minIndependentVoters: 2,
  ballotTtlMs: 10 * 60 * 1000,
  maxBallotRequestsPerHour: 60,
  maxValidVotesPerHour: 30,
};

const digest = (value: string) => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const bundle = (ownerId = 'author', bundleId = 'bundle-1'): SealedBundleSource => ({
  id: bundleId,
  ownerId,
  status: 'sealed',
  executionStatus: 'completed',
  snapshotDigest: 'sha256:snapshot',
  manifestDigest: 'sha256:manifest',
  attemptFence: 'attempt-fence-1',
  artifacts: [
    { artifactId: `${bundleId}-html`, relativePath: 'index.html', mediaType: 'text/html', previewKind: 'html', sizeBytes: 100, sha256: digest('html'), classification: 'public' },
    { artifactId: `${bundleId}-private`, relativePath: 'prompt.txt', mediaType: 'text/plain', previewKind: 'text', sizeBytes: 20, sha256: digest('private'), classification: 'private' },
    { artifactId: `${bundleId}-hidden`, relativePath: 'hidden.json', mediaType: 'application/json', previewKind: 'json', sizeBytes: 20, sha256: digest('hidden'), classification: 'hidden' },
  ],
});

function publicationService(repo: MemoryShowcaseRepository, creationRuns?: CreationRunPublicationSeam): WorkPublicationService {
  let sequence = 0;
  return new WorkPublicationService(repo, {
    id: () => `publication-id-${++sequence}`,
    now: () => '2026-09-07T00:00:00.000Z',
    resolveRoles: async (id) => id === 'reviewer' ? new Set(['reviewer']) : id === 'admin' ? new Set(['admin']) : new Set(),
  }, creationRuns ? { getCreationRun: (runId, ownerId) => creationRuns['runs'].get(`${ownerId}:${runId}`) ?? Promise.resolve(null) } : undefined);
}

test('publication validates sealed fixed bundle references and safely projects only selected public files', async () => {
  const repo = new MemoryShowcaseRepository();
  repo.bundles.set('bundle-1', bundle());
  const service = publicationService(repo);
  await assert.rejects(() => service.requestPublication('author', {
    publishConfirmed: false,
    bundleId: 'bundle-1', expectedSnapshotDigest: 'sha256:snapshot', expectedManifestDigest: 'sha256:manifest',
    title: 'Unconfirmed', description: 'Must not publish.', entryPath: 'index.html', publicArtifactIds: ['bundle-1-html'],
  } as never), (error: unknown) => error instanceof AppError && error.code === ERROR_CODES.REQUEST_VALIDATION_FAILED);
  const publication = await service.requestPublication('author', {
    publishConfirmed: true,
    bundleId: 'bundle-1', expectedSnapshotDigest: 'sha256:snapshot', expectedManifestDigest: 'sha256:manifest',
    title: 'Pelican rides a bicycle', description: 'A static visual.', entryPath: 'index.html', publicArtifactIds: ['bundle-1-html'],
  });
  assert.equal(publication.status, 'published');
  assert.equal(publication.sourceBundleId, 'bundle-1');
  await assert.rejects(() => service.requestPublication('author', {
    publishConfirmed: true,
    bundleId: 'bundle-1', expectedSnapshotDigest: 'sha256:wrong', expectedManifestDigest: 'sha256:manifest',
    title: 'Wrong', description: 'Wrong', entryPath: 'index.html', publicArtifactIds: ['bundle-1-html'],
  }), (error: unknown) => error instanceof AppError && error.code === ERROR_CODES.CONCURRENT_SAVE);
  await assert.rejects(() => service.requestPublication('author', {
    publishConfirmed: true,
    bundleId: 'bundle-1', expectedSnapshotDigest: 'sha256:snapshot', expectedManifestDigest: 'sha256:manifest',
    title: 'Private', description: 'Private', entryPath: 'prompt.txt', publicArtifactIds: ['bundle-1-private'],
  }), (error: unknown) => error instanceof AppError && error.code === ERROR_CODES.ACCESS_FORBIDDEN);
  const publicView = await service.getPublicPublication(publication.id);
  assert.equal(publicView.files[0]?.relativePath, 'index.html');
  assert.equal('sourceBundleId' in publicView, false);
  assert.doesNotMatch(JSON.stringify(publicView), /prompt|hidden|attempt-fence|storage|credential|provider/i);
});

test('publication state changes are role-gated, revision-checked and auditable', async () => {
  const repo = new MemoryShowcaseRepository();
  repo.bundles.set('bundle-1', bundle());
  const service = publicationService(repo);
  const publication = await service.requestPublication('author', {
    publishConfirmed: true,
    bundleId: 'bundle-1', expectedSnapshotDigest: 'sha256:snapshot', expectedManifestDigest: 'sha256:manifest',
    title: 'A', description: 'B', entryPath: 'index.html', publicArtifactIds: ['bundle-1-html'],
  });
  await assert.rejects(() => service.reviewPublication('outsider', { publicationId: publication.id, expectedStatus: 'published', expectedRevision: 1, decision: 'take-down', reason: 'no' }), (error: unknown) => error instanceof AppError && error.code === ERROR_CODES.ACCESS_FORBIDDEN);
  await assert.rejects(() => service.reviewPublication('admin', { publicationId: publication.id, expectedStatus: 'pending', expectedRevision: 1, decision: 'take-down', reason: 'stale' }), (error: unknown) => error instanceof AppError && error.code === ERROR_CODES.CONCURRENT_SAVE);
  const withdrawn = await service.withdrawPublication('author', publication.id, publication.revision);
  assert.equal(withdrawn.publication.status, 'withdrawn');
  assert.deepEqual(repo.audits.map((event) => event.action), ['work-publication.requested', 'work-publication.withdrawn']);
  await assert.rejects(() => service.getPublicPublication(publication.id), (error: unknown) => error instanceof AppError && error.code === ERROR_CODES.RESOURCE_NOT_FOUND);
});

test('CreationRun seam requires a completed creation run with its own bundle', async () => {
  const runs = new Map<string, import('../src/server/showcase/contracts.ts').CreationRunRef>();
  const port = { getCreationRun: async (runId: string, ownerId: string) => runs.get(`${ownerId}:${runId}`) ?? null };
  const seam = new CreationRunPublicationSeam(port);
  runs.set('author:run-1', { id: 'run-1', ownerId: 'author', purpose: 'creation', status: 'completed', artifactBundleId: 'bundle-1', buildVersionId: 'build-v1', briefVersionId: 'brief-v1' });
  assert.equal((await seam.requireCompletedRun('author', 'run-1')).artifactBundleId, 'bundle-1');
  await assert.rejects(() => seam.requireCompletedRun('author', 'missing'), (error: unknown) => error instanceof AppError && error.code === ERROR_CODES.RESOURCE_NOT_FOUND);
  runs.set('author:run-2', { id: 'run-2', ownerId: 'author', purpose: 'creation', status: 'running', artifactBundleId: 'bundle-2', buildVersionId: 'build-v1', briefVersionId: 'brief-v1' });
  await assert.rejects(() => seam.requireCompletedRun('author', 'run-2'), (error: unknown) => error instanceof AppError && error.code === ERROR_CODES.EVALUATION_NOT_READY);
});

function votingService(
  repo: MemoryVotingRepository,
  now: () => string = () => '2026-09-07T00:00:00.000Z',
  choosePair?: VotingServiceOptions['choosePair'],
): ShowcaseVotingService {
  let sequence = 0;
  return new ShowcaseVotingService(repo, { policy, id: () => `voting-id-${++sequence}`, now, choosePair });
}

function seedEntries(repo: MemoryVotingRepository): void {
  for (const [id, ownerId] of [['entry-a', 'alice'], ['entry-b', 'bob'], ['entry-c', 'carol']] as const) {
    const publication: PublicWorkPublication = { publicationId: `pub-${id}`, title: id, description: `work ${id}`, entryPath: 'index.html', releaseDigest: `release-${id}`, files: [{ relativePath: 'index.html', mediaType: 'text/html', previewKind: 'html', sizeBytes: 1, sha256: digest(id) }], createdAt: '2026-09-07T00:00:00.000Z' };
    repo.publications.set(publication.publicationId, { ownerId, publication });
    repo.entries.set(id, { id, ownerId, publicationId: publication.publicationId, comparatorKey: policy.comparatorKey, policyVersion: policy.policyVersion, roundId: 'round-1', status: 'active', publicationReleaseDigest: publication.releaseDigest, publication, createdAt: publication.createdAt, withdrawnAt: null });
  }
}

test('only the publication owner can enter a published work into the showcase', async () => {
  const repo = new MemoryVotingRepository();
  seedEntries(repo);
  const service = votingService(repo);

  await assert.rejects(() => service.createEntry('mallory', {
    publicationId: 'pub-entry-a',
    roundId: 'round-2',
    comparatorKey: policy.comparatorKey,
    policyVersion: policy.policyVersion,
  }), (error: unknown) => error instanceof AppError && error.code === ERROR_CODES.OWNERSHIP_FORBIDDEN);

  assert.equal([...repo.entries.values()].some((entry) => entry.roundId === 'round-2'), false);
  assert.equal(repo.audits.some((event) => event.action === 'showcase-entry.created'), false);
});

test('pairwise voting canonicalizes pairs, enforces anti-self-vote and idempotency, including tie and skip', async () => {
  const repo = new MemoryVotingRepository();
  seedEntries(repo);
  const service = votingService(repo);
  const ballot = await service.issueBallot('voter', { roundId: 'round-1', comparatorKey: policy.comparatorKey, policyVersion: policy.policyVersion, idempotencyKey: 'ballot-1' });
  assert.ok(ballot);
  assert.equal(ballot?.entryAId, 'entry-a');
  assert.equal(ballot?.entryBId, 'entry-b');
  const projected = await service.projectBallot('voter', ballot!.id);
  assert.equal(projected.candidates?.a.publication.publicationId, 'pub-entry-a');
  assert.equal(projected.candidates?.b.publication.publicationId, 'pub-entry-b');
  assert.equal('ownerId' in (projected.candidates?.a ?? {}), false);
  assert.doesNotMatch(JSON.stringify(projected.candidates), /alice|bob|carol/);
  await assert.rejects(() => service.projectBallot('other-voter', ballot!.id), (error: unknown) =>
    error instanceof AppError && error.code === ERROR_CODES.RESOURCE_NOT_FOUND);
  const sameBallot = await service.issueBallot('voter', { roundId: 'round-1', comparatorKey: policy.comparatorKey, policyVersion: policy.policyVersion, idempotencyKey: 'ballot-1' });
  assert.equal(sameBallot?.id, ballot?.id);
  const first = await service.castBallot('voter', { ballotId: ballot!.id, choice: 'tie', idempotencyKey: 'vote-1' });
  assert.equal(first.vote.choice, 'tie');
  const replay = await service.castBallot('voter', { ballotId: ballot!.id, choice: 'tie', idempotencyKey: 'vote-1' });
  assert.equal(replay.vote.id, first.vote.id);
  const secondBallot = await service.issueBallot('voter', { roundId: 'round-1', comparatorKey: policy.comparatorKey, policyVersion: policy.policyVersion, idempotencyKey: 'ballot-2' });
  assert.ok(secondBallot);
  assert.notEqual(secondBallot.pairKey, ballot!.pairKey);
  await service.castBallot('voter', { ballotId: secondBallot.id, choice: 'skip', idempotencyKey: 'vote-1b' });
  const selfCandidate = await service.issueBallot('alice', { roundId: 'round-1', comparatorKey: policy.comparatorKey, policyVersion: policy.policyVersion, idempotencyKey: 'self' });
  assert.ok(selfCandidate);
  assert.notEqual(selfCandidate?.entryAId, 'entry-a');
  const skipBallot = await service.issueBallot('voter-2', { roundId: 'round-1', comparatorKey: policy.comparatorKey, policyVersion: policy.policyVersion, idempotencyKey: 'ballot-3' });
  assert.ok(skipBallot);
  await service.castBallot('voter-2', { ballotId: skipBallot!.id, choice: 'skip', idempotencyKey: 'vote-2' });
});

test('concurrent vote uniqueness is returned idempotently for the same choice and normalized for a conflict', async () => {
  const sameRepo = new MemoryVotingRepository();
  seedEntries(sameRepo);
  const sameService = votingService(sameRepo);
  const sameBallot = await sameService.issueBallot('voter', {
    roundId: 'round-1', comparatorKey: policy.comparatorKey, policyVersion: policy.policyVersion, idempotencyKey: 'concurrent-ballot-same',
  });
  assert.ok(sameBallot);
  sameRepo.concurrentVoteChoice = 'a';
  const same = await sameService.castBallot('voter', { ballotId: sameBallot.id, choice: 'a', idempotencyKey: 'concurrent-cast-same' });
  assert.equal(same.vote.id, 'concurrent-vote');
  assert.equal(same.ballot.status, 'cast');

  const conflictRepo = new MemoryVotingRepository();
  seedEntries(conflictRepo);
  const conflictService = votingService(conflictRepo);
  const conflictBallot = await conflictService.issueBallot('voter', {
    roundId: 'round-1', comparatorKey: policy.comparatorKey, policyVersion: policy.policyVersion, idempotencyKey: 'concurrent-ballot-conflict',
  });
  assert.ok(conflictBallot);
  conflictRepo.concurrentVoteChoice = 'b';
  await assert.rejects(
    () => conflictService.castBallot('voter', { ballotId: conflictBallot.id, choice: 'a', idempotencyKey: 'concurrent-cast-conflict' }),
    (error: unknown) => error instanceof AppError && error.status === 409 && error.code === ERROR_CODES.CONCURRENT_SAVE,
  );
});

test('three-author voters receive every legal pair instead of getting stuck on the first pair', async () => {
  const repo = new MemoryVotingRepository();
  seedEntries(repo);
  const service = votingService(repo);
  const issue = (idempotencyKey: string) => service.issueBallot('voter', {
    roundId: 'round-1', comparatorKey: policy.comparatorKey, policyVersion: policy.policyVersion, idempotencyKey,
  });
  const cast = (ballot: ShowcaseBallot, idempotencyKey: string) => service.castBallot('voter', {
    ballotId: ballot.id, choice: 'skip', idempotencyKey,
  });

  const issuedPairs = new Set<string>();
  for (const [ballotKey, voteKey] of [
    ['ballot-first', 'vote-first'],
    ['ballot-second', 'vote-second'],
    ['ballot-third', 'vote-third'],
  ] as const) {
    const ballot = await issue(ballotKey);
    assert.ok(ballot);
    issuedPairs.add(ballot.pairKey);
    await cast(ballot, voteKey);
  }

  assert.deepEqual([...issuedPairs].sort(), [
    'round-1:pelican-bike:v1:showcase-pairwise-v1:entry-a:entry-b',
    'round-1:pelican-bike:v1:showcase-pairwise-v1:entry-a:entry-c',
    'round-1:pelican-bike:v1:showcase-pairwise-v1:entry-b:entry-c',
  ]);
  assert.equal(await issue('ballot-exhausted'), null);
  assert.equal([...repo.votes.values()].length, 3);
});

test('default pair ordering is stable per voter and rotates exposure across voters', async () => {
  const firstPairs = new Set<string>();
  for (const voterId of ['voter', 'voter-a', 'voter-b']) {
    const repo = new MemoryVotingRepository();
    seedEntries(repo);
    const service = votingService(repo);
    const first = await service.issueBallot(voterId, {
      roundId: 'round-1', comparatorKey: policy.comparatorKey, policyVersion: policy.policyVersion,
      idempotencyKey: `first-${voterId}`,
    });
    const replay = await service.issueBallot(voterId, {
      roundId: 'round-1', comparatorKey: policy.comparatorKey, policyVersion: policy.policyVersion,
      idempotencyKey: `replay-${voterId}`,
    });
    assert.ok(first);
    assert.equal(replay?.id, first.id);
    firstPairs.add(first.pairKey);
  }
  assert.equal(firstPairs.size, 3);
});

test('expired open ballots are closed and can be reissued as a new generation', async () => {
  const repo = new MemoryVotingRepository();
  seedEntries(repo);
  let now = '2026-09-07T00:00:00.000Z';
  const service = votingService(repo, () => now);
  const first = await service.issueBallot('voter', {
    roundId: 'round-1', comparatorKey: policy.comparatorKey, policyVersion: policy.policyVersion, idempotencyKey: 'expired-1',
  });
  assert.ok(first);

  now = '2026-09-07T00:11:00.000Z';
  const second = await service.issueBallot('voter', {
    roundId: 'round-1', comparatorKey: policy.comparatorKey, policyVersion: policy.policyVersion, idempotencyKey: 'expired-2',
  });
  assert.ok(second);
  assert.notEqual(second.id, first.id);
  assert.equal(repo.ballots.get(first.id)?.status, 'expired');
  assert.equal(repo.ballots.get(second.id)?.status, 'open');
  assert.equal([...repo.ballots.values()].filter((ballot) => ballot.pairKey === first.pairKey).length, 2);

  const replay = await service.issueBallot('voter', {
    roundId: 'round-1', comparatorKey: policy.comparatorKey, policyVersion: policy.policyVersion, idempotencyKey: 'expired-1',
  });
  assert.equal(replay?.id, first.id);
  assert.equal(replay?.status, 'expired');
});

test('concurrent ballot requests converge on one open ballot for a pair', async () => {
  const repo = new MemoryVotingRepository();
  seedEntries(repo);
  const service = votingService(repo);
  const request = (idempotencyKey: string) => service.issueBallot('voter', {
    roundId: 'round-1', comparatorKey: policy.comparatorKey, policyVersion: policy.policyVersion, idempotencyKey,
  });

  const [left, right] = await Promise.all([request('concurrent-left'), request('concurrent-right')]);
  assert.ok(left);
  assert.ok(right);
  assert.equal(left.id, right.id);
  assert.equal([...repo.ballots.values()].filter((ballot) => ballot.status === 'open').length, 1);
  assert.equal(repo.audits.filter((event) => event.action === 'showcase-ballot.issued').length, 1);
});

test('leaderboard uses deterministic normalized pairwise score and sample threshold', async () => {
  const repo = new MemoryVotingRepository();
  seedEntries(repo);
  const service = votingService(repo, undefined, (candidates) => [candidates[0], candidates[1]]);
  const cast = async (voterId: string, ballotId: string, choice: 'a' | 'b' | 'tie') => service.castBallot(voterId, { ballotId, choice, idempotencyKey: `vote-${voterId}` });
  const b1 = await service.issueBallot('voter-1', { roundId: 'round-1', comparatorKey: policy.comparatorKey, policyVersion: policy.policyVersion, idempotencyKey: 'b1' });
  await cast('voter-1', b1!.id, 'a');
  const b2 = await service.issueBallot('voter-2', { roundId: 'round-1', comparatorKey: policy.comparatorKey, policyVersion: policy.policyVersion, idempotencyKey: 'b2' });
  await cast('voter-2', b2!.id, 'tie');
  const board = await service.projectLeaderboard('round-1', policy.comparatorKey, policy.policyVersion);
  assert.equal(board.sample.validVotes, 2);
  assert.equal(board.sample.independentVoters, 2);
  assert.equal(board.sample.qualified, true);
  assert.equal(board.rows[0]?.entryId, 'entry-a');
  assert.equal(board.rows[0]?.score, 0.75);
  assert.equal(board.rows[1]?.score, 0.25);
  assert.equal(board.rows[0]?.publication.publicationId, 'pub-entry-a');
  assert.deepEqual(board.rows.map((row) => row.entryId), ['entry-a', 'entry-b', 'entry-c']);
  assert.deepEqual(board.rows.map((row) => row.qualified), [true, true, false]);
  for (const row of board.rows.filter((candidate) => candidate.qualified)) {
    assert.ok(row.comparisons >= policy.minValidVotes);
    assert.ok(row.validVoters >= policy.minIndependentVoters);
  }
  assert.equal(board.rows[2]?.comparisons, 0);
  assert.equal(board.rows[2]?.validVoters, 0);
});

test('withdrawn entries cannot receive new ballots or remain in the leaderboard', async () => {
  const repo = new MemoryVotingRepository();
  seedEntries(repo);
  const service = votingService(repo);
  await service.withdrawEntry('alice', 'entry-a');
  const ballot = await service.issueBallot('voter', { roundId: 'round-1', comparatorKey: policy.comparatorKey, policyVersion: policy.policyVersion, idempotencyKey: 'withdrawn' });
  assert.ok(ballot);
  assert.notEqual(ballot?.entryAId, 'entry-a');
  assert.notEqual(ballot?.entryBId, 'entry-a');
  const board = await service.projectLeaderboard('round-1', policy.comparatorKey, policy.policyVersion);
  assert.equal(board.rows.some((row) => row.entryId === 'entry-a'), false);
});
