export interface ProductionWorkerConfig {
  readonly databaseUrl: string;
  readonly redisUrl: string;
  readonly schedulerMode: 'outbox';
  readonly queueName: string;
  readonly queuePrefix: string;
  readonly workerId: string;
  readonly concurrency: number;
  readonly workerLeaseTtlMs: number;
  readonly workerPollIntervalMs: number;
  readonly reconciliationIntervalMs: number;
  readonly reconciliationBatchSize: number;
  readonly publisherLeaseTtlMs: number;
  readonly publisherBatchSize: number;
  readonly queueReadinessTimeoutMs: number;
  readonly completedJobRetentionSeconds: number;
  readonly failedJobRetentionSeconds: number;
  readonly encryptionKey: string;
  readonly allowedHosts: string[];
  readonly maxRunCost: number;
  readonly maxCases: number;
  readonly platformModel?: string;
  readonly platformApiKey?: string;
  readonly platformInputPrice: number | null;
  readonly platformOutputPrice: number | null;
}

export const REQUIRED_WORKER_CONFIGURATION = [
  'DATABASE_URL',
  'REDIS_URL',
  'EVALUATION_SCHEDULER_MODE',
  'EVALUATION_QUEUE_NAME',
  'EVALUATION_QUEUE_PREFIX',
  'EVALUATION_WORKER_ID',
  'CREDENTIAL_ENCRYPTION_KEY',
] as const;

export function missingWorkerConfiguration(env: NodeJS.ProcessEnv = process.env): readonly string[] {
  return REQUIRED_WORKER_CONFIGURATION.filter((name) => !env[name]?.trim());
}

function requiredEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Missing required worker configuration: ${name}`);
  return value;
}

function validateName(value: string, name: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(value)) {
    throw new Error(`Invalid worker configuration: ${name}`);
  }
  return value;
}

function positiveInteger(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Invalid worker configuration: ${name}`);
  return value;
}

function nonNegativeInteger(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid worker configuration: ${name}`);
  return value;
}

function nonNegativeNumber(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid worker configuration: ${name}`);
  return value;
}

function optionalPrice(env: NodeJS.ProcessEnv, name: string): number | null {
  const raw = env[name]?.trim();
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid worker configuration: ${name}`);
  return value;
}

export function readWorkerConfig(env: NodeJS.ProcessEnv = process.env): ProductionWorkerConfig {
  const schedulerMode = requiredEnv(env, 'EVALUATION_SCHEDULER_MODE');
  if (schedulerMode !== 'outbox') {
    throw new Error('EVALUATION_SCHEDULER_MODE must be outbox for the production worker.');
  }

  const databaseUrl = requiredEnv(env, 'DATABASE_URL');
  const redisUrl = requiredEnv(env, 'REDIS_URL');
  const queueName = validateName(requiredEnv(env, 'EVALUATION_QUEUE_NAME'), 'EVALUATION_QUEUE_NAME');
  const queuePrefix = validateName(requiredEnv(env, 'EVALUATION_QUEUE_PREFIX'), 'EVALUATION_QUEUE_PREFIX');
  const workerId = validateName(requiredEnv(env, 'EVALUATION_WORKER_ID'), 'EVALUATION_WORKER_ID');
  const encryptionKey = requiredEnv(env, 'CREDENTIAL_ENCRYPTION_KEY');

  const concurrency = positiveInteger(env, 'EVALUATION_WORKER_CONCURRENCY', 1);
  const workerLeaseTtlMs = positiveInteger(env, 'EVALUATION_WORKER_LEASE_TTL_MS', 60_000);
  const reconciliationIntervalMs = positiveInteger(env, 'EVALUATION_WORKER_RECONCILIATION_INTERVAL_MS', 5_000);
  const publisherLeaseTtlMs = positiveInteger(env, 'EVALUATION_PUBLISHER_LEASE_TTL_MS', 30_000);
  if (publisherLeaseTtlMs >= workerLeaseTtlMs) {
    throw new Error('EVALUATION_PUBLISHER_LEASE_TTL_MS must be shorter than the worker lease TTL.');
  }

  return {
    databaseUrl,
    redisUrl,
    schedulerMode: 'outbox',
    queueName,
    queuePrefix,
    workerId,
    concurrency,
    workerLeaseTtlMs,
    workerPollIntervalMs: nonNegativeInteger(env, 'EVALUATION_WORKER_POLL_INTERVAL_MS', 250),
    reconciliationIntervalMs,
    reconciliationBatchSize: positiveInteger(env, 'EVALUATION_WORKER_RECONCILIATION_BATCH_SIZE', 50),
    publisherLeaseTtlMs,
    publisherBatchSize: positiveInteger(env, 'EVALUATION_PUBLISHER_BATCH_SIZE', 50),
    queueReadinessTimeoutMs: positiveInteger(env, 'EVALUATION_QUEUE_READINESS_TIMEOUT_MS', 1_000),
    completedJobRetentionSeconds: positiveInteger(env, 'EVALUATION_QUEUE_COMPLETED_RETENTION_SECONDS', 86_400),
    failedJobRetentionSeconds: positiveInteger(env, 'EVALUATION_QUEUE_FAILED_RETENTION_SECONDS', 604_800),
    encryptionKey,
    allowedHosts: (env.PROVIDER_ALLOWED_HOSTS ?? 'api.openai.com,openrouter.ai')
      .split(',')
      .map((host) => host.trim())
      .filter(Boolean),
    maxRunCost: nonNegativeNumber(env, 'RUN_MAX_TOTAL_COST', 2.5),
    maxCases: positiveInteger(env, 'RUN_MAX_CASES', 50),
    platformModel: env.PLATFORM_MODEL?.trim() || undefined,
    platformApiKey: env.AI_GATEWAY_API_KEY?.trim() || undefined,
    platformInputPrice: optionalPrice(env, 'PLATFORM_INPUT_PRICE_PER_MILLION'),
    platformOutputPrice: optionalPrice(env, 'PLATFORM_OUTPUT_PRICE_PER_MILLION'),
  };
}
