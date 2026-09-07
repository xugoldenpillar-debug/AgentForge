/** Catalog contracts are not renderer approval or permission to execute a run. */
export interface AnimationChallenge {
  id: string;
  slug: string;
  position: number;
  status: 'draft' | 'published' | 'retired';
}

export interface AnimationChallengeVersion {
  id: string;
  challengeId: string;
  versionNumber: number;
  title: string;
  titleEn: string;
  instructions: string;
  instructionsEn: string;
  outputPolicyVersion: 'svg-animation-v1';
  contentDigest: string;
}

export const SVG_ANIMATION_POLICY = Object.freeze({
  version: 'svg-animation-v1',
  requiredPaths: Object.freeze(['index.html']),
  optionalReadme: true,
  inlineSvgRequired: true,
  hiddenSuite: false,
  automaticCorrectnessJudge: false,
  scriptsAllowed: false,
  animationModes: Object.freeze(['css-keyframes', 'svg-declarative']),
  maxFiles: 16,
  maxFileBytes: 2 * 1024 * 1024,
  maxBundleBytes: 8 * 1024 * 1024,
  maxParseDepth: 64,
  maxNodes: 20_000,
  maxAnimations: 200,
} as const);

/** Candidate limits, not a spending authorization or implemented quota counter. */
export const ANIMATION_LAUNCH_LIMITS = Object.freeze({
  version: 'animation-launch-v1',
  activeRunsPerUser: 1,
  queuedRunsPerUser: 3,
  newRunsPerRollingDay: 10,
  wallTimeSeconds: 120,
  tokensPerRun: 16_000,
  toolCallsPerRun: 40,
  costPerRunUsd: 0.10,
  minimumValidVotes: 20,
  minimumIndependentVoters: 10,
} as const);
