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

let service: ArenaService | undefined;
let communityService: CommunityService | undefined;
let artifactArenaServices: ArtifactArenaHttpServices | undefined;
let artifactArenaStorageAdapter: ArtifactStorageAdapter | undefined;

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
  // Durable scheduling is opt-in so a web process cannot silently accept jobs
  // without an outbox publisher and independent worker being configured.
  const competitiveRunScheduler = process.env.EVALUATION_SCHEDULER_MODE === 'outbox'
    ? createDurableOutboxCompetitiveRunScheduler(repository)
    : undefined;
  return service = new ArenaService(repository, {
    demoMode: testModelsEnabled(process.env),
    encryptionKey: process.env.CREDENTIAL_ENCRYPTION_KEY || '',
    allowedHosts: (process.env.PROVIDER_ALLOWED_HOSTS || 'api.openai.com,openrouter.ai').split(',').map((s) => s.trim()).filter(Boolean),
    githubEnabled: !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET),
    platform,
    createRealProvider: byokProvider,
    createPlatformProvider: platform ? () => gatewayProvider(process.env.AI_GATEWAY_API_KEY!, platform) : undefined,
    maxRunCost: Number(process.env.RUN_MAX_TOTAL_COST || 2.5),
    maxCases: Number(process.env.RUN_MAX_CASES || 50),
    competitiveRunScheduler,
    env: process.env,
  });
}

export function getCommunityService(): CommunityService {
  return communityService ??= new CommunityService(new DrizzleRepository(), {
    resolveRoles: resolveCommunityRoles,
  });
}

export interface ArtifactArenaServiceDependencies {
  /** A real immutable object-storage adapter. No host path or URL adapter is accepted here. */
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

/**
 * Build the durable Artifact Arena HTTP services only when an operator has
 * enabled the feature and supplied the real immutable object-store seam.
 *
 * The route currently calls this without dependencies, so the default remains
 * fail-closed. A future production composition root must explicitly pass a
 * provider-backed adapter; environment variables alone never select storage.
 */
export function getArtifactArenaServices(
  dependencies: ArtifactArenaServiceDependencies = {},
): ArtifactArenaHttpServices | undefined {
  if (process.env.ARTIFACT_ARENA_ENABLED !== 'true' || process.env.ARTIFACT_ARENA_KILL_SWITCH === 'true') return undefined;
  const storageAdapter = dependencies.storageAdapter;
  if (!storageAdapter) return undefined;
  if (artifactArenaServices && artifactArenaStorageAdapter === storageAdapter) return artifactArenaServices;

  const repository = new DrizzleRepository();
  const artifacts = new DrizzleArtifactReadPort(repository, storageAdapter);
  const showcaseRepository = new DrizzleShowcaseRepository(repository, artifacts);
  const publications = new WorkPublicationService(showcaseRepository, {
    resolveRoles: resolveCommunityRoles,
  });
  const votingRepository = new DrizzleVotingRepository(
    repository,
    (publicationId) => publications.getPublicPublication(publicationId),
  );
  const voting = new ShowcaseVotingService(votingRepository, {
    policy: showcaseComparatorPolicy,
  });

  artifactArenaStorageAdapter = storageAdapter;
  artifactArenaServices = { artifacts, publications, voting };
  return artifactArenaServices;
}
