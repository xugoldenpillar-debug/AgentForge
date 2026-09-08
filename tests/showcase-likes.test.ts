import assert from 'node:assert/strict';
import test from 'node:test';
import { WorkLikeService } from '../src/server/showcase/likes.ts';
import { AppError, ERROR_CODES } from '../src/shared/errors.ts';
import type { WorkPublication } from '../src/shared/types.ts';
import { MemoryRepository } from './helpers/memory-repository.ts';

const NOW = '2026-09-08T00:00:00.000Z';

function publication(id: string, ownerId: string, status: WorkPublication['status'] = 'published'): WorkPublication {
  return {
    id,
    ownerId,
    sourceBundleId: `bundle-${id}`,
    sourceSnapshotDigest: `sha256:${'1'.repeat(64)}`,
    sourceManifestDigest: `sha256:${'2'.repeat(64)}`,
    sourceAttemptFence: `fence-${id}`,
    releaseDigest: `sha256:${'3'.repeat(64)}`,
    title: `Work ${id}`,
    description: 'A safe public animation.',
    entryPath: 'index.html',
    files: [{
      artifactId: `artifact-${id}`,
      relativePath: 'index.html',
      mediaType: 'text/html',
      previewKind: 'html',
      sizeBytes: 100,
      sha256: `sha256:${'4'.repeat(64)}`,
    }],
    status,
    revision: 1,
    createdAt: NOW,
    updatedAt: NOW,
    reviewedAt: status === 'published' ? NOW : null,
    withdrawnAt: status === 'withdrawn' ? NOW : null,
  };
}

function service(repo: MemoryRepository): WorkLikeService {
  let sequence = 0;
  return new WorkLikeService(repo, { now: () => NOW, id: () => `like-${++sequence}` });
}

test('likes are one reversible idempotent vote per user and publication', async () => {
  const repo = new MemoryRepository();
  await repo.insert('workPublications', [publication('pub-1', 'author')]);
  const likes = service(repo);

  const first = await likes.like('viewer', 'pub-1');
  assert.deepEqual(first, { publicationId: 'pub-1', count: 1, likedByViewer: true, changed: true });
  const replay = await likes.like('viewer', 'pub-1');
  assert.deepEqual(replay, { publicationId: 'pub-1', count: 1, likedByViewer: true, changed: false });
  const other = await likes.like('viewer-2', 'pub-1');
  assert.equal(other.count, 2);
  assert.equal((await likes.summary('pub-1', 'viewer')).likedByViewer, true);
  assert.equal((await likes.summary('pub-1', 'outsider')).likedByViewer, false);

  const removed = await likes.unlike('viewer', 'pub-1');
  assert.deepEqual(removed, { publicationId: 'pub-1', count: 1, likedByViewer: false, changed: true });
  const repeatedRemoval = await likes.unlike('viewer', 'pub-1');
  assert.deepEqual(repeatedRemoval, { publicationId: 'pub-1', count: 1, likedByViewer: false, changed: false });
});

test('likes reject self-likes and any non-published work', async () => {
  const repo = new MemoryRepository();
  await repo.insert('workPublications', [
    publication('published', 'author'),
    publication('pending', 'other-author', 'pending'),
    publication('taken-down', 'other-author', 'taken-down'),
  ]);
  const likes = service(repo);

  await assert.rejects(() => likes.like('author', 'published'), (error: unknown) =>
    error instanceof AppError && error.status === 403 && error.code === ERROR_CODES.ACCESS_FORBIDDEN);
  await assert.rejects(() => likes.like('viewer', 'pending'), (error: unknown) =>
    error instanceof AppError && error.status === 404 && error.code === ERROR_CODES.RESOURCE_NOT_FOUND);
  await assert.rejects(() => likes.summary('taken-down', 'viewer'), (error: unknown) =>
    error instanceof AppError && error.status === 404 && error.code === ERROR_CODES.RESOURCE_NOT_FOUND);
});

test('likes remain isolated from ballots, community score, trust and ranking state', async () => {
  const repo = new MemoryRepository();
  await repo.insert('workPublications', [publication('pub-1', 'author')]);
  await repo.insert('showcaseEntries', [{
    id: 'entry-1',
    ownerId: 'author',
    publicationId: 'pub-1',
    comparatorKey: 'svg-animation-community-v1',
    policyVersion: 'showcase-pairwise-v1',
    roundId: 'animation-pelican-bike-v1:season-2026-launch:byok',
    status: 'active',
    publicationReleaseDigest: `sha256:${'3'.repeat(64)}`,
    createdAt: NOW,
    withdrawnAt: null,
  }]);
  const before = structuredClone({
    entries: repo.state.showcaseEntries,
    ballots: repo.state.showcaseBallots,
    votes: repo.state.showcaseVotes,
    runs: repo.state.runs,
    submissions: repo.state.submissions,
  });

  await service(repo).like('viewer', 'pub-1');

  assert.deepEqual({
    entries: repo.state.showcaseEntries,
    ballots: repo.state.showcaseBallots,
    votes: repo.state.showcaseVotes,
    runs: repo.state.runs,
    submissions: repo.state.submissions,
  }, before);
  assert.equal(repo.state.workLikes.length, 1);
});
