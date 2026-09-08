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
    this.ballots.set(ballot.id, clone(ballot));
  }
  async updateBallot(ballotId: string, values: Partial<Pick<ShowcaseBallot, 'status' | 'castVoteId'>>): Promise<ShowcaseBallot | null> {
    const ballot = this.ballots.get(ballotId);
    if (!ballot) return null;
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
  const publication = await service.requestPublication('author', {
    bundleId: 'bundle-1', expectedSnapshotDigest: 'sha256:snapshot', expectedManifestDigest: 'sha256:manifest',
    title: 'Pelican rides a bicycle', description: 'A static visual.', entryPath: 'index.html', publicArtifactIds: ['bundle-1-html'],
  });
  assert.equal(publication.status, 'pending');
  assert.equal(publication.sourceBundleId, 'bundle-1');
  await assert.rejects(() => service.requestPublication('author', {
    bundleId: 'bundle-1', expectedSnapshotDigest: 'sha256:wrong', expectedManifestDigest: 'sha256:manifest',
    title: 'Wrong', description: 'Wrong', entryPath: 'index.html', publicArtifactIds: ['bundle-1-html'],
  }), (error: unknown) => error instanceof AppError && error.code === ERROR_CODES.CONCURRENT_SAVE);
  await assert.rejects(() => service.requestPublication('author', {
    bundleId: 'bundle-1', expectedSnapshotDigest: 'sha256:snapshot', expectedManifestDigest: 'sha256:manifest',
    title: 'Private', description: 'Private', entryPath: 'prompt.txt', publicArtifactIds: ['bundle-1-private'],
  }), (error: unknown) => error instanceof AppError && error.code === ERROR_CODES.ACCESS_FORBIDDEN);
  const reviewer = await service.reviewPublication('reviewer', { publicationId: publication.id, expectedStatus: 'pending', expectedRevision: 1, decision: 'approve', reason: 'safe static artifact' });
  const publicView = await service.getPublicPublication(publication.id);
  assert.equal(reviewer.publication.status, 'published');
  assert.equal(publicView.files[0]?.relativePath, 'index.html');
  assert.equal('sourceBundleId' in publicView, false);
  assert.doesNotMatch(JSON.stringify(publicView), /prompt|hidden|attempt-fence|storage|credential|provider/i);
});

test('publication state changes are role-gated, revision-checked and auditable', async () => {
  const repo = new MemoryShowcaseRepository();
  repo.bundles.set('bundle-1', bundle());
  const service = publicationService(repo);
  const publication = await service.requestPublication('author', {
    bundleId: 'bundle-1', expectedSnapshotDigest: 'sha256:snapshot', expectedManifestDigest: 'sha256:manifest',
    title: 'A', description: 'B', entryPath: 'index.html', publicArtifactIds: ['bundle-1-html'],
  });
  await assert.rejects(() => service.reviewPublication('outsider', { publicationId: publication.id, expectedStatus: 'pending', expectedRevision: 1, decision: 'approve', reason: 'no' }), (error: unknown) => error instanceof AppError && error.code === ERROR_CODES.ACCESS_FORBIDDEN);
  const approved = await service.reviewPublication('admin', { publicationId: publication.id, expectedStatus: 'pending', expectedRevision: 1, decision: 'approve', reason: 'approved' });
  await assert.rejects(() => service.reviewPublication('admin', { publicationId: publication.id, expectedStatus: 'pending', expectedRevision: 1, decision: 'take-down', reason: 'stale' }), (error: unknown) => error instanceof AppError && error.code === ERROR_CODES.CONCURRENT_SAVE);
  const withdrawn = await service.withdrawPublication('author', approved.publication.id, approved.publication.revision);
  assert.equal(withdrawn.publication.status, 'withdrawn');
  assert.deepEqual(repo.audits.map((event) => event.action), ['work-publication.requested', 'work-publication.reviewed', 'work-publication.withdrawn']);
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

function votingService(repo: MemoryVotingRepository): ShowcaseVotingService {
  let sequence = 0;
  return new ShowcaseVotingService(repo, { policy, id: () => `voting-id-${++sequence}`, now: () => '2026-09-07T00:00:00.000Z' });
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
  assert.equal(secondBallot, null);
  const selfCandidate = await service.issueBallot('alice', { roundId: 'round-1', comparatorKey: policy.comparatorKey, policyVersion: policy.policyVersion, idempotencyKey: 'self' });
  assert.ok(selfCandidate);
  assert.notEqual(selfCandidate?.entryAId, 'entry-a');
  const skipBallot = await service.issueBallot('voter-2', { roundId: 'round-1', comparatorKey: policy.comparatorKey, policyVersion: policy.policyVersion, idempotencyKey: 'ballot-3' });
  assert.ok(skipBallot);
  await service.castBallot('voter-2', { ballotId: skipBallot!.id, choice: 'skip', idempotencyKey: 'vote-2' });
});

test('leaderboard uses deterministic normalized pairwise score and sample threshold', async () => {
  const repo = new MemoryVotingRepository();
  seedEntries(repo);
  const service = votingService(repo);
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
