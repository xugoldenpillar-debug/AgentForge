import { createHash, randomUUID } from 'node:crypto';
import { Queue, Worker, type Job } from 'bullmq';
import Redis, { type RedisOptions } from 'ioredis';
import { EVALUATION_WORKER_MESSAGE_VERSION } from '../../../shared/evaluation-types.ts';
import { EvaluationQueueUnavailableError, EvaluationQueueProtocolError } from './errors.ts';
import type {
  EvaluationQueueDelivery,
  EvaluationQueueEnvelope,
  EvaluationQueuePort,
} from './ports.ts';

export const DEFAULT_EVALUATION_QUEUE_NAME = 'agentforge-evaluations';
export const DEFAULT_EVALUATION_QUEUE_PREFIX = 'agentforge';

export interface BullMqEvaluationQueueOptions {
  readonly redisUrl: string;
  readonly queueName?: string;
  readonly prefix?: string;
  readonly completedJobRetentionSeconds?: number;
  readonly failedJobRetentionSeconds?: number;
  readonly readinessTimeoutMs?: number;
}

/**
 * Reads only queue configuration. A missing REDIS_URL deliberately returns
 * null so callers can fail closed instead of silently selecting an in-memory
 * queue for real evaluation work.
 */
export function bullMqEvaluationQueueOptionsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): BullMqEvaluationQueueOptions | null {
  const redisUrl = env.REDIS_URL?.trim();
  if (!redisUrl) return null;

  return {
    redisUrl,
    queueName: nonEmptyEnv(env.EVALUATION_QUEUE_NAME),
    prefix: nonEmptyEnv(env.EVALUATION_QUEUE_PREFIX),
    readinessTimeoutMs: parsePositiveIntegerEnv(env.EVALUATION_QUEUE_READINESS_TIMEOUT_MS),
  };
}

interface BullMqJobData extends EvaluationQueueEnvelope {}

interface InFlightDelivery {
  readonly job: Job<BullMqJobData>;
  readonly token: string;
}

/**
 * BullMQ-backed queue port used only by the independent worker process.
 * PostgreSQL remains the source of truth; BullMQ provides delivery and leases.
 */
export class BullMqEvaluationQueue implements EvaluationQueuePort {
  private queue: Queue<BullMqJobData> | undefined;
  private worker: Worker<BullMqJobData, unknown> | undefined;
  private readonly probe: Redis;
  private readonly redisUrl: string;
  private readonly queueName: string;
  private readonly prefix: string;
  private readonly options: Required<Pick<
    BullMqEvaluationQueueOptions,
    'completedJobRetentionSeconds' | 'failedJobRetentionSeconds' | 'readinessTimeoutMs'
  >>;
  private readonly inFlight = new Map<string, InFlightDelivery>();
  private closed = false;
  private lastReadinessReason: string | undefined;

  constructor(options: BullMqEvaluationQueueOptions) {
    validateOptions(options);
    this.redisUrl = options.redisUrl;
    this.queueName = options.queueName ?? DEFAULT_EVALUATION_QUEUE_NAME;
    this.prefix = options.prefix ?? DEFAULT_EVALUATION_QUEUE_PREFIX;
    this.options = {
      completedJobRetentionSeconds: options.completedJobRetentionSeconds ?? 86_400,
      failedJobRetentionSeconds: options.failedJobRetentionSeconds ?? 604_800,
      readinessTimeoutMs: options.readinessTimeoutMs ?? 1_000,
    };

    this.probe = new Redis({
      ...redisConnection(options.redisUrl, this.options.readinessTimeoutMs),
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });
    this.probe.on('error', () => {
      // Readiness is fail-closed; the next health check reports unavailable.
    });
  }

  async enqueue(message: EvaluationQueueEnvelope): Promise<{ readonly duplicate: boolean }> {
    this.ensureOpen();
    const safeMessage = validateAndCloneEnvelope(message);
    await this.ensureReadyForOperation();
    const jobId = stableBullMqJobId(safeMessage.eventId);

    try {
      const queue = this.requireClients().queue;
      const existing = await queue.getJob(jobId);
      if (existing) return { duplicate: true };

      // BullMQ's deterministic jobId is the durable delivery de-duplication
      // boundary. A concurrent add for the same event is harmless: both
      // publishers address the same Redis job and the worker's database claim
      // fences duplicate deliveries before any model invocation.
      await queue.add(safeMessage.kind, safeMessage, {
        jobId,
        attempts: 1,
        removeOnComplete: {
          age: this.options.completedJobRetentionSeconds,
          count: 10_000,
        },
        removeOnFail: {
          age: this.options.failedJobRetentionSeconds,
          count: 10_000,
        },
      });
      return { duplicate: false };
    } catch (error) {
      throw this.asQueueUnavailable(error);
    }
  }

  async receive(): Promise<EvaluationQueueDelivery | null> {
    this.ensureOpen();
    await this.ensureReadyForOperation();
    const token = randomUUID();

    let job: Job<BullMqJobData> | undefined;
    try {
      job = await this.requireClients().worker.getNextJob(token, { block: false });
    } catch (error) {
      throw this.asQueueUnavailable(error);
    }
    if (!job) return null;

    const deliveryId = job.id ?? randomUUID();
    try {
      const message = validateAndCloneEnvelope(job.data);
      this.inFlight.set(deliveryId, { job, token });
      return { deliveryId, message };
    } catch (error) {
      // A malformed or unsupported durable message must not be retried forever.
      // Do not include the payload in the failure reason or thrown error.
      try {
        await job.moveToFailed(new Error('invalid evaluation queue message'), token, false);
      } catch {
        // If Redis failed while fencing the malformed job, the active lock will
        // expire and reconciliation remains the source of truth.
      }
      if (error instanceof EvaluationQueueProtocolError) throw error;
      throw new EvaluationQueueProtocolError('Invalid evaluation queue message.');
    }
  }

  async acknowledge(deliveryId: string): Promise<boolean> {
    const delivery = this.inFlight.get(deliveryId);
    if (!delivery) return false;
    try {
      await delivery.job.moveToCompleted({ acknowledged: true }, delivery.token, false);
      this.inFlight.delete(deliveryId);
      return true;
    } catch (error) {
      // Keep the delivery in memory so a caller can retry acknowledgement after
      // a transient Redis outage. The database attempt fencing remains primary.
      throw this.asQueueUnavailable(error);
    }
  }

  async reject(deliveryId: string): Promise<boolean> {
    const delivery = this.inFlight.get(deliveryId);
    if (!delivery) return false;
    try {
      await delivery.job.moveToFailed(new Error('evaluation delivery rejected'), delivery.token, false);
      this.inFlight.delete(deliveryId);
      return true;
    } catch (error) {
      throw this.asQueueUnavailable(error);
    }
  }

  async isReady(): Promise<boolean> {
    if (this.closed) return false;
    try {
      await withTimeout(this.pingProbe(), this.options.readinessTimeoutMs);
      this.ensureBullMqClients();
      const clients = this.requireClients();
      await withTimeout(
        Promise.all([clients.queue.waitUntilReady(), clients.worker.waitUntilReady()]),
        this.options.readinessTimeoutMs,
      );
      this.lastReadinessReason = undefined;
      return true;
    } catch {
      this.lastReadinessReason = 'redis-control-plane-unavailable';
      return false;
    }
  }

  readinessReason(): string | undefined {
    if (this.closed) return 'queue-closed';
    return this.lastReadinessReason;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const delivery of this.inFlight.values()) {
      try {
        await delivery.job.moveToFailed(new Error('worker shutting down'), delivery.token, false);
      } catch {
        // The lease will expire and reconciliation will fence the attempt.
      }
    }
    this.inFlight.clear();
    this.probe.disconnect();
    const clients = this.takeClients();
    if (clients) {
      await Promise.allSettled([
        clients.worker.close(true),
        clients.queue.close(),
      ]);
    }
  }

  private async pingProbe(): Promise<string> {
    if (this.probe.status === 'wait') await this.probe.connect();
    return this.probe.ping();
  }

  private ensureBullMqClients(): void {
    if (this.queue && this.worker) return;
    const queue = new Queue<BullMqJobData>(this.queueName, {
      connection: redisConnection(this.redisUrl, this.options.readinessTimeoutMs),
      prefix: this.prefix,
    });
    const worker = new Worker<BullMqJobData, unknown>(
      this.queueName,
      null,
      {
        connection: redisConnection(this.redisUrl, this.options.readinessTimeoutMs),
        prefix: this.prefix,
        autorun: false,
        concurrency: 1,
        maxStalledCount: 1,
        // Provider streams may legitimately run for up to ten minutes before artifact finalization.
        lockDuration: 15 * 60_000,
        skipStalledCheck: true,
      },
    );
    queue.on('error', () => {
      // Queue operations surface failures to the caller; this listener prevents
      // an asynchronous BullMQ connection error from becoming an unhandled event.
    });
    worker.on('error', () => {
      // Worker operations surface failures to the caller; see the queue port.
    });
    this.queue = queue;
    this.worker = worker;
  }

  private requireClients(): {
    readonly queue: Queue<BullMqJobData>;
    readonly worker: Worker<BullMqJobData, unknown>;
  } {
    if (!this.queue || !this.worker) {
      throw new EvaluationQueueUnavailableError('BullMQ clients are not ready.');
    }
    return { queue: this.queue, worker: this.worker };
  }

  private takeClients(): {
    readonly queue: Queue<BullMqJobData>;
    readonly worker: Worker<BullMqJobData, unknown>;
  } | undefined {
    const clients = this.queue && this.worker
      ? { queue: this.queue, worker: this.worker }
      : undefined;
    this.queue = undefined;
    this.worker = undefined;
    return clients;
  }

  private async ensureReadyForOperation(): Promise<void> {
    if (!(await this.isReady())) {
      throw new EvaluationQueueUnavailableError(this.readinessReason());
    }
  }

  private asQueueUnavailable(error: unknown): EvaluationQueueUnavailableError {
    this.lastReadinessReason = 'redis-control-plane-unavailable';
    if (error instanceof EvaluationQueueUnavailableError) return error;
    return new EvaluationQueueUnavailableError();
  }

  private ensureOpen(): void {
    if (this.closed) throw new EvaluationQueueUnavailableError('The evaluation queue is closed.');
  }
}

/**
 * Validate and clone before handing data to BullMQ. Queue payloads are an
 * operational control message, never a transport for credentials, prompts,
 * hidden inputs, or model responses.
 */
export function validateAndCloneBullMqEnvelope(
  message: EvaluationQueueEnvelope,
): EvaluationQueueEnvelope {
  return validateAndCloneEnvelope(message);
}

function validateAndCloneEnvelope(message: EvaluationQueueEnvelope): EvaluationQueueEnvelope {
  if (!message || typeof message !== 'object') {
    throw new EvaluationQueueProtocolError('Evaluation queue message must be an object.');
  }
  if (message.version !== EVALUATION_WORKER_MESSAGE_VERSION) {
    throw new EvaluationQueueProtocolError(
      `Unsupported evaluation queue message version '${String(message.version)}'.`,
    );
  }
  if (typeof message.eventId !== 'string' || message.eventId.trim().length === 0) {
    throw new EvaluationQueueProtocolError('Evaluation queue message eventId is required.');
  }
  if (typeof message.jobId !== 'string' || message.jobId.trim().length === 0) {
    throw new EvaluationQueueProtocolError('Evaluation queue message jobId is required.');
  }
  if (typeof message.requestDigest !== 'string' || message.requestDigest.trim().length === 0) {
    throw new EvaluationQueueProtocolError('Evaluation queue message requestDigest is required.');
  }
  if (!KNOWN_QUEUE_KINDS.has(message.kind) || typeof message.enqueuedAt !== 'string') {
    throw new EvaluationQueueProtocolError('Evaluation queue message metadata is invalid.');
  }
  if (!message.payload || typeof message.payload !== 'object' || Array.isArray(message.payload)) {
    throw new EvaluationQueueProtocolError('Evaluation queue message payload must be an object.');
  }

  assertSafeQueueJson(message.payload, '$payload');
  return structuredClone(message);
}

function assertSafeQueueJson(value: unknown, path: string): asserts value is EvaluationQueueEnvelope['payload'] {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new EvaluationQueueProtocolError(`Invalid queue payload at ${path}.`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertSafeQueueJson(entry, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') {
    throw new EvaluationQueueProtocolError(`Invalid queue payload at ${path}.`);
  }
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_QUEUE_KEY.test(key)) {
      throw new EvaluationQueueProtocolError(`Sensitive queue payload field '${key}' is not allowed.`);
    }
    assertSafeQueueJson(child, `${path}.${key}`);
  }
}

function validateOptions(options: BullMqEvaluationQueueOptions): void {
  if (typeof options.redisUrl !== 'string' || options.redisUrl.trim().length === 0) {
    throw new Error('REDIS_URL is required for BullMQ evaluation work.');
  }
  if (options.queueName !== undefined && !isSafeName(options.queueName)) {
    throw new Error('BullMQ queueName must be a non-empty name without whitespace.');
  }
  if (options.prefix !== undefined && !isSafeName(options.prefix)) {
    throw new Error('BullMQ prefix must be a non-empty name without whitespace.');
  }
  for (const [name, value] of [
    ['completedJobRetentionSeconds', options.completedJobRetentionSeconds],
    ['failedJobRetentionSeconds', options.failedJobRetentionSeconds],
    ['readinessTimeoutMs', options.readinessTimeoutMs],
  ] as const) {
    if (value !== undefined && (!Number.isInteger(value) || value <= 0)) {
      throw new Error(`${name} must be a positive integer.`);
    }
  }
  parseRedisUrl(options.redisUrl);
}

function redisConnection(redisUrl: string, connectTimeout: number): RedisOptions {
  const url = parseRedisUrl(redisUrl);
  const database = url.pathname.length > 1 ? Number.parseInt(url.pathname.slice(1), 10) : undefined;
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: database,
    connectTimeout,
    enableOfflineQueue: false,
    maxRetriesPerRequest: null,
    // The worker is deliberately fail-closed. A process supervisor can
    // restart it; it must not queue real work in a disconnected client.
    retryStrategy: () => null,
    ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
  };
}

function parseRedisUrl(redisUrl: string): URL {
  let url: URL;
  try {
    url = new URL(redisUrl);
  } catch {
    throw new Error('REDIS_URL must be a valid redis:// or rediss:// URL.');
  }
  if (url.protocol !== 'redis:' && url.protocol !== 'rediss:') {
    throw new Error('REDIS_URL must use redis:// or rediss://.');
  }
  if (!url.hostname) throw new Error('REDIS_URL must include a Redis host.');
  if (url.pathname.length > 1) {
    const database = Number.parseInt(url.pathname.slice(1), 10);
    if (!Number.isInteger(database) || database < 0 || String(database) !== url.pathname.slice(1)) {
      throw new Error('REDIS_URL database must be a non-negative integer.');
    }
  }
  return url;
}

function stableBullMqJobId(eventId: string): string {
  return `evaluation-${createHash('sha256').update(eventId).digest('hex')}`;
}

function isSafeName(value: string): boolean {
  return value.trim().length > 0 && !/\s/u.test(value);
}

function nonEmptyEnv(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parsePositiveIntegerEnv(value: string | undefined): number | undefined {
  if (!value?.trim()) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error('EVALUATION_QUEUE_READINESS_TIMEOUT_MS must be a positive integer.');
  }
  return parsed;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Redis readiness probe timed out.')), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const KNOWN_QUEUE_KINDS = new Set([
  'evaluation-job-accepted',
  'evaluation-job-cancel-requested',
  'evaluation-attempt-dispatch-requested',
  'evaluation-attempt-reconcile-requested',
]);

const FORBIDDEN_QUEUE_KEY = /^(?:api[_-]?key|password|secret|token|cookie|ciphertext|private[_-]?key|access[_-]?token|refresh[_-]?token|authorization|authorization[_-]?header|credentials?|prompt|hidden[_-]?input|model[_-]?(?:response|output)|response(?:[_-]?body)?|completion)$/i;
