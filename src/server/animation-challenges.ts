import { createHash } from 'node:crypto';
import type { AnimationChallenge, AnimationChallengeVersion } from '../shared/animation-challenge.ts';
import { SVG_ANIMATION_POLICY } from '../shared/animation-challenge.ts';
import { ensure, ERROR_CODES } from '../shared/errors.ts';
import type { Repository } from '../shared/types.ts';

type VersionContent = Omit<AnimationChallengeVersion, 'contentDigest'>;

export function animationChallengeDigest(content: VersionContent): string {
  // Explicit field order makes the digest independent of row/JSON property ordering.
  const canonical = [content.id, content.challengeId, content.versionNumber,
    content.title, content.titleEn, content.instructions, content.instructionsEn,
    content.outputPolicyVersion, SVG_ANIMATION_POLICY];
  return `sha256:${createHash('sha256').update('agentforge:animation-challenge:v1\n')
    .update(JSON.stringify(canonical)).digest('hex')}`;
}

export const ANIMATION_CHALLENGES: readonly AnimationChallenge[] = Object.freeze([
  Object.freeze({ id: 'animation-pelican-bike', slug: 'pelican-bike', position: 1, status: 'published' }),
  Object.freeze({ id: 'animation-qin-polar-bear', slug: 'qin-polar-bear', position: 2, status: 'published' }),
]);

const contents: VersionContent[] = [
  {
    id: 'animation-pelican-bike-v1', challengeId: 'animation-pelican-bike', versionNumber: 1,
    title: '鹈鹕骑自行车', titleEn: 'Pelican riding a bicycle',
    instructions: '创建一个HTML，内容是SVG绘制一个鹈鹕骑自行车的2D动画。',
    instructionsEn: 'Create an HTML file containing a 2D SVG animation of a pelican riding a bicycle.',
    outputPolicyVersion: 'svg-animation-v1',
  },
  {
    id: 'animation-qin-polar-bear-v1', challengeId: 'animation-qin-polar-bear', versionNumber: 1,
    title: '秦始皇骑北极熊', titleEn: 'Qin Shi Huang riding a polar bear',
    instructions: '生成HtmL，内容是svg绘制秦始皇骑北极熊的动画',
    instructionsEn: 'Generate HTML containing an SVG animation of Qin Shi Huang riding a polar bear.',
    outputPolicyVersion: 'svg-animation-v1',
  },
];

export const ANIMATION_CHALLENGE_VERSIONS: readonly AnimationChallengeVersion[] = Object.freeze(
  contents.map(content => Object.freeze({ ...content, contentDigest: animationChallengeDigest(content) })),
);

/** Called inside seedCore's transaction; never re-publishes retired catalog rows. */
export async function seedAnimationChallenges(repo: Repository): Promise<void> {
  for (const challenge of ANIMATION_CHALLENGES) {
    const [existing] = await repo.read('animationChallenges', { id: challenge.id });
    if (!existing) await repo.insert('animationChallenges', [{ ...challenge }]);
  }
  for (const version of ANIMATION_CHALLENGE_VERSIONS) {
    const [existing] = await repo.read('animationChallengeVersions', { id: version.id });
    ensure(!existing || (existing.contentDigest === version.contentDigest &&
      animationChallengeDigest(existing) === version.contentDigest),
    'Animation challenge version conflict; create a new version instead of overwriting history.',
    409, ERROR_CODES.REQUEST_VALIDATION_FAILED);
    if (!existing) await repo.insert('animationChallengeVersions', [{ ...version }]);
  }
}

export async function listAnimationChallenges(repo: Repository) {
  const challenges = await repo.read('animationChallenges', { status: 'published' });
  const versions = await repo.read('animationChallengeVersions');
  return challenges.sort((a, b) => a.position - b.position || a.id.localeCompare(b.id)).map(challenge => ({
    ...challenge,
    versions: versions.filter(version => version.challengeId === challenge.id)
      .sort((a, b) => b.versionNumber - a.versionNumber),
    outputPolicy: SVG_ANIMATION_POLICY,
    // Catalog publication must not imply that the execution dependency gates passed.
    runAvailability: { enabled: false as const, reason: 'dependency_unavailable' as const },
  }));
}
