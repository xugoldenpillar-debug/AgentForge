import 'server-only';
import { testModelsEnabled } from './environment.ts';
import { ArenaService } from './service.ts';
import { CommunityService } from './community-service.ts';
import { resolveCommunityRoles } from './community-roles.ts';
import { DrizzleRepository } from '../db/repository.ts';
import { byokProvider, gatewayProvider } from '../lib/ai/sdk-provider.ts';
import { createDurableOutboxCompetitiveRunScheduler } from './evaluation/runtime.ts';

let service: ArenaService | undefined;
let communityService: CommunityService | undefined;

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
  });
}

export function getCommunityService(): CommunityService {
  return communityService ??= new CommunityService(new DrizzleRepository(), {
    resolveRoles: resolveCommunityRoles,
  });
}
