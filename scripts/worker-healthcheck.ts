import Redis from 'ioredis';
import postgres from 'postgres';

import { missingWorkerConfiguration } from './evaluation-worker-config.ts';
function timeoutMs(env: NodeJS.ProcessEnv): number {
  const raw = env.EVALUATION_QUEUE_READINESS_TIMEOUT_MS?.trim();
  if (!raw) return 1_000;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) return 1_000;
  return value;
}

async function withTimeout<T>(operation: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error('probe-timeout')), milliseconds);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function checkWorkerDependencies(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const missing = missingWorkerConfiguration(env);
  if (missing.length > 0) throw new Error(`missing:${missing.join(',')}`);
  if (env.EVALUATION_SCHEDULER_MODE !== 'outbox') throw new Error('scheduler-mode');

  const readinessTimeoutMs = timeoutMs(env);
  const sql = postgres(env.DATABASE_URL!, {
    max: 1,
    prepare: false,
    connect_timeout: Math.max(1, Math.ceil(readinessTimeoutMs / 1_000)),
  });
  const redis = new Redis(env.REDIS_URL!, {
    lazyConnect: true,
    connectTimeout: readinessTimeoutMs,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  });
  redis.on('error', () => {
    // The probe reports a generic dependency failure; do not leak connection details.
  });

  try {
    await withTimeout(Promise.all([
      sql`SELECT 1`,
      sql`SELECT 1 FROM evaluation_jobs LIMIT 1`,
      redis.connect().then(() => redis.ping()),
    ]), readinessTimeoutMs);
  } finally {
    await Promise.allSettled([
      sql.end({ timeout: Math.ceil(readinessTimeoutMs / 1_000) }),
      redis.quit(),
    ]);
  }
}

if (process.argv[1] && process.argv[1].endsWith('worker-healthcheck.ts')) {
  checkWorkerDependencies().catch((error: unknown) => {
    const reason = error instanceof Error && error.message.startsWith('missing:')
      ? error.message.slice('missing:'.length)
      : 'dependency-unavailable';
    console.error(`evaluation-worker healthcheck failed: ${reason}`);
    process.exitCode = 1;
  });
}
