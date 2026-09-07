import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryRepository } from './helpers/memory-repository.ts';
import { seedCore } from '../src/server/seed-core.ts';
import {
  ANIMATION_CHALLENGE_VERSIONS,
  animationChallengeDigest,
  listAnimationChallenges,
} from '../src/server/animation-challenges.ts';
import { SVG_ANIMATION_POLICY, ANIMATION_LAUNCH_LIMITS } from '../src/shared/animation-challenge.ts';

test('two original challenges: ordered, bilingual, no hidden judge, no invented runtime reference', async () => {
  const repo = new MemoryRepository();
  await seedCore(repo);
  const rows = await listAnimationChallenges(repo);
  assert.deepEqual(rows.map(row => row.slug), ['pelican-bike', 'qin-polar-bear']);
  assert.deepEqual(rows.map(row => row.versions[0].instructions), [
    '创建一个HTML，内容是SVG绘制一个鹈鹕骑自行车的2D动画。',
    '生成HtmL，内容是svg绘制秦始皇骑北极熊的动画',
  ]);
  for (const row of rows) {
    assert.equal(row.runAvailability.enabled, false);
    const version = row.versions[0];
    assert.ok(version.titleEn && version.instructionsEn);
    assert.equal(version.contentDigest, animationChallengeDigest(version));
    assert.notEqual(version.contentDigest, `sha256:${'0'.repeat(64)}`);
  }
  assert.deepEqual(SVG_ANIMATION_POLICY.requiredPaths, ['index.html']);
  assert.equal(SVG_ANIMATION_POLICY.hiddenSuite, false);
  assert.equal(SVG_ANIMATION_POLICY.automaticCorrectnessJudge, false);
  assert.equal(SVG_ANIMATION_POLICY.optionalReadme, true);
  assert.equal(repo.state.creationRuns.length, 0);
  assert.equal(repo.state.users.length, 0);
  assert.equal(repo.state.workPublications.length, 0);
  assert.equal(repo.state.testCases.some(row => rows.some(challenge => challenge.id === row.problemId)), false);
});

test('seed is idempotent, preserves legacy data and does not undo catalog retirement', async () => {
  const repo = new MemoryRepository();
  await seedCore(repo);
  const legacy = structuredClone(repo.state.problems);
  await repo.update('animationChallenges', { slug: 'pelican-bike' }, { status: 'retired' });
  const before = structuredClone(repo.state);
  await seedCore(repo);
  assert.deepEqual(repo.state, before);
  assert.deepEqual(repo.state.problems, legacy);
  assert.deepEqual((await listAnimationChallenges(repo)).map(row => row.slug), ['qin-polar-bear']);
});

test('seed rejects content drift rather than rewriting an immutable version', async () => {
  const repo = new MemoryRepository();
  await seedCore(repo);
  await repo.update('animationChallengeVersions', { id: ANIMATION_CHALLENGE_VERSIONS[0].id }, {
    instructions: 'altered original',
  });
  await assert.rejects(seedCore(repo), /version conflict/);
  assert.equal(repo.state.animationChallengeVersions[0].instructions, 'altered original');
});

test('digest binds translation, original, output policy and immutable identity', () => {
  const original = ANIMATION_CHALLENGE_VERSIONS[0];
  for (const change of [{ instructions: 'different' }, { instructionsEn: 'different' },
    { versionNumber: 2 }, { id: 'another-version' }, { challengeId: 'another-challenge' }]) {
    assert.notEqual(animationChallengeDigest({ ...original, ...change }), original.contentDigest);
  }
  assert.equal(animationChallengeDigest({ ...original }), original.contentDigest);
});

test('public HTTP catalog reads persisted records without granting execution', async () => {
  const { handleArena } = await import('../src/server/http.ts');
  const { ArenaService } = await import('../src/server/service.ts');
  const repo = new MemoryRepository();
  await seedCore(repo);
  const service = new ArenaService(repo, { demoMode: false });
  const response = await handleArena(new Request('http://localhost:3000/api/arena/animation-challenges'), {
    service, origin: 'http://localhost:3000',
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.length, 2);
  assert.equal(result[0].runAvailability.enabled, false);
});

// Explicit user scope change: defer dollars, never remove infrastructure controls.
test('BYOK launch defers dollar caps without disabling other resource limits', () => {
  assert.equal(ANIMATION_LAUNCH_LIMITS.costPerRunUsd, null);
  assert.equal(ANIMATION_LAUNCH_LIMITS.version, 'animation-launch-byok-v1');
  assert.equal(ANIMATION_LAUNCH_LIMITS.activeRunsPerUser, 1);
  assert.equal(ANIMATION_LAUNCH_LIMITS.tokensPerRun, 16000);
  assert.equal(ANIMATION_LAUNCH_LIMITS.wallTimeSeconds, 120);
});
