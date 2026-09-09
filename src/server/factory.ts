import 'server-only';
import { testModelsEnabled } from './environment.ts';
import { ArenaService } from './service.ts';
import { CommunityService } from './community-service.ts';
import { resolveCommunityRoles } from './community-roles.ts';
import { DrizzleRepository } from '../db/repository.ts';
import { byokProvider, gatewayProvider } from '../lib/ai/sdk-provider.ts';
import { createDurableOutboxCompetitiveRunScheduler } from './evaluation/runtime.ts';
import type { ArtifactArenaHttpServices } from './http.ts';
import { DrizzleArtifactReadPort } from './artifacts/durable.ts';
import type { ArtifactStorageAdapter } from './artifacts/access.ts';
import { DrizzleShowcaseRepository } from './showcase/durable-repository.ts';
import { WorkPublicationService } from './showcase/service.ts';
import { DrizzleVotingRepository } from './voting/durable-repository.ts';
import { ShowcaseVotingService } from './voting/service.ts';
import { WorkLikeService } from './showcase/likes.ts';
import { FileSystemArtifactStorageAdapter } from './artifacts/filesystem.ts';
import { CreationRunService } from './creation/service.ts';
import { createCreationAgentBuildResolver } from './creation/build-resolver.ts';
import { ChallengeApplicationService } from './creation/challenge-applications.ts';
import { CreationLeaderboardService } from './creation/leaderboard.ts';
import { safeProviderFetch } from '../lib/ai/safe-fetch.ts';
let service: ArenaService | undefined;
let communityService: CommunityService | undefined;
let artifactArenaServices: ArtifactArenaHttpServices | undefined;
let artifactArenaStorageAdapter: ArtifactStorageAdapter | undefined;
let defaultArtifactStorageAdapter: FileSystemArtifactStorageAdapter | undefined;
let defaultArtifactStorageRoot: string | undefined;
let challengeApplications: ChallengeApplicationService | undefined;
let creationLeaderboard: CreationLeaderboardService | undefined;

function price(value: string | undefined): number | null {
  if (!value?.trim()) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function getService(): ArenaService {
  if (service) return service;
  const platform = process.env.AI_GATEWAY_API_KEY && process.env.PLATFORM_MODEL
    ? {
        model: process.env.PLATFORM_MODEL,
        inputPrice: price(process.env.PLATFORM_INPUT_PRICE_PER_MILLION),
        outputPrice: price(process.env.PLATFORM_OUTPUT_PRICE_PER_MILLION),
      }
    : undefined;
  const repository = new DrizzleRepository();
  const competitiveRunScheduler = process.env.EVALUATION_SCHEDULER_MODE === 'outbox'
    ? createDurableOutboxCompetitiveRunScheduler(repository)
    : undefined;
  return service = new ArenaService(repository, {
    demoMode: testModelsEnabled(process.env),
    encryptionKey: process.env.CREDENTIAL_ENCRYPTION_KEY || '',
    allowedHosts: (process.env.PROVIDER_ALLOWED_HOSTS || 'api.openai.com,openrouter.ai').split(',').map((s) => s.trim()).filter(Boolean),
    allowCustomProviderHosts: process.env.PROVIDER_ALLOW_CUSTOM_HOSTS === 'true',
    githubEnabled: !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET),
    platform,
    createRealProvider: byokProvider,
    createProviderFetch: safeProviderFetch,
    createPlatformProvider: platform ? () => gatewayProvider(process.env.AI_GATEWAY_API_KEY!, platform) : undefined,
    maxRunCost: Number(process.env.RUN_MAX_TOTAL_COST || 2.5),
    maxCases: Number(process.env.RUN_MAX_CASES || 50),
    competitiveRunScheduler,
    env: process.env,
    agentBuildResolver: createCreationAgentBuildResolver(repository),
  });
}

export function getCommunityService(): CommunityService {
  return communityService ??= new CommunityService(new DrizzleRepository(), {
    resolveRoles: resolveCommunityRoles,
  });
}

export function getChallengeApplicationService(): ChallengeApplicationService {
  return challengeApplications ??= new ChallengeApplicationService(new DrizzleRepository(), {
    resolveRoles: resolveCommunityRoles,
  });
}

export function getCreationLeaderboardService(): CreationLeaderboardService | undefined {
  if (creationLeaderboard) return creationLeaderboard;
  const arena = getArtifactArenaServices();
  if (!arena?.voting) return undefined;
  return creationLeaderboard = new CreationLeaderboardService(new DrizzleRepository(), arena.voting);
}

export interface ArtifactArenaServiceDependencies {
  readonly storageAdapter?: ArtifactStorageAdapter;
}

const showcaseComparatorPolicy = Object.freeze({
  comparatorKey: 'artifact-arena:showcase:v1',
  policyVersion: 'showcase-pairwise-v1',
  minValidVotes: 20,
  minIndependentVoters: 10,
  ballotTtlMs: 10 * 60 * 1000,
  maxBallotRequestsPerHour: 60,
  maxValidVotesPerHour: 30,
});

export function getArtifactArenaServices(
  dependencies: ArtifactArenaServiceDependencies = {},
): ArtifactArenaHttpServices | undefined {
  if (process.env.ARTIFACT_ARENA_ENABLED !== 'true') return undefined;
  let storageAdapter = dependencies.storageAdapter;
  if (!storageAdapter) {
    const storageRoot = process.env.ARTIFACT_STORAGE_ROOT?.trim();
    if (!storageRoot) return undefined;
    if (!defaultArtifactStorageAdapter || defaultArtifactStorageRoot !== storageRoot) {
      defaultArtifactStorageAdapter = new FileSystemArtifactStorageAdapter(storageRoot);
      defaultArtifactStorageRoot = storageRoot;
    }
    storageAdapter = defaultArtifactStorageAdapter;
  }
  if (artifactArenaServices && artifactArenaStorageAdapter === storageAdapter) return artifactArenaServices;

  const repository = new DrizzleRepository();
  const artifacts = new DrizzleArtifactReadPort(repository, storageAdapter);
  const showcaseRepository = new DrizzleShowcaseRepository(repository, artifacts);
  const scheduler = process.env.EVALUATION_SCHEDULER_MODE === 'outbox'
    ? createDurableOutboxCompetitiveRunScheduler(repository)
    : undefined;
  const creationRuns = scheduler ? new CreationRunService(repository, { scheduler }) : undefined;
  const publications = new WorkPublicationService(showcaseRepository, {
    resolveRoles: resolveCommunityRoles,
  }, creationRuns);
  const votingRepository = new DrizzleVotingRepository(
    repository,
    (publicationId) => publications.resolvePublishedPublication(publicationId),
  );
  const voting = new ShowcaseVotingService(votingRepository, {
    policy: showcaseComparatorPolicy,
  });
  const likes = new WorkLikeService(repository);

  artifactArenaStorageAdapter = storageAdapter;
  artifactArenaServices = { artifacts, publications, voting, likes, creationRuns };
  return artifactArenaServices;
}
