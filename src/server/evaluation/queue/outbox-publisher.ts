import { asOpaqueId, EVALUATION_WORKER_MESSAGE_VERSION } from '../../../shared/evaluation-types.ts';
import type { EvaluationOutboxRow } from '../../../shared/types.ts';
import { EvaluationQueueProtocolError } from './errors.ts';
import type {
  EvaluationOutboxStore,
  EvaluationQueueEnvelope,
  EvaluationQueuePort,
} from './ports.ts';

export interface EvaluationOutboxPublisherOptions {
  readonly publisherId: string;
  readonly leaseTtlMs: number;
  readonly batchSize: number;
  readonly now?: () => string;
  readonly retryDelayMs?: (deliveryAttempts: number) => number;
}

export interface EvaluationOutboxPublishResult {
  readonly claimed: number;
  readonly published: number;
  readonly duplicate: number;
  readonly rescheduled: number;
  readonly leaseLost: number;
  readonly skipped: boolean;
}

/** Publishes durable outbox rows; Redis/BullMQ remains behind the injected queue port. */
export class EvaluationOutboxPublisher {
  private readonly now: () => string;
  private readonly retryDelayMs: (deliveryAttempts: number) => number;
  private readonly store: EvaluationOutboxStore;
  private readonly queue: EvaluationQueuePort;
  private readonly options: EvaluationOutboxPublisherOptions;

  constructor(
    store: EvaluationOutboxStore,
    queue: EvaluationQueuePort,
    options: EvaluationOutboxPublisherOptions,
  ) {
    this.store = store;
    this.queue = queue;
    this.options = options;
    this.now = options.now ?? (() => new Date().toISOString());
    this.retryDelayMs = options.retryDelayMs ?? ((attempts) => Math.min(60_000, 250 * 2 ** Math.min(attempts, 8)));
  }

  async publishBatch(): Promise<EvaluationOutboxPublishResult> {
    if (!(await this.isQueueReady())) {
      return { claimed: 0, published: 0, duplicate: 0, rescheduled: 0, leaseLost: 0, skipped: true };
    }

    const now = this.now();
    const rows = await this.store.claimOutbox({
      owner: this.options.publisherId,
      limit: this.options.batchSize,
      leaseTtlMs: this.options.leaseTtlMs,
      now,
    });
    let published = 0;
    let duplicate = 0;
    let rescheduled = 0;
    let leaseLost = 0;

    for (const row of rows) {
      try {
        const result = await this.queue.enqueue(toQueueEnvelope(row, now));
        const marked = await this.store.markOutboxPublished(row.id, this.options.publisherId, requireLeaseToken(row), this.now());
        if (!marked) {
          leaseLost += 1;
        } else if (result.duplicate) {
          duplicate += 1;
        } else {
          published += 1;
        }
      } catch (error) {
        const code = error instanceof Error && 'code' in error && typeof error.code === 'string'
          ? error.code
          : 'QUEUE_PUBLISH_FAILED';
        const availableAt = new Date(Date.parse(this.now()) + this.retryDelayMs(row.deliveryAttempts)).toISOString();
        const rescheduledRow = await this.store.rescheduleOutbox(
          row.id,
          this.options.publisherId,
          requireLeaseToken(row),
          code,
          availableAt,
          this.now(),
        );
        if (rescheduledRow) rescheduled += 1;
        else leaseLost += 1;
      }
    }

    return { claimed: rows.length, published, duplicate, rescheduled, leaseLost, skipped: false };
  }

  private async isQueueReady(): Promise<boolean> {
    try {
      return await this.queue.isReady();
    } catch {
      // Claim nothing when the control-plane health signal is unavailable.
      return false;
    }
  }
}

function toQueueEnvelope(row: EvaluationOutboxRow, now: string): EvaluationQueueEnvelope {
  if (row.version !== EVALUATION_WORKER_MESSAGE_VERSION) {
    throw new EvaluationQueueProtocolError(`Unsupported evaluation outbox version '${String(row.version)}'.`);
  }
  return {
    eventId: asOpaqueId<'evaluation-outbox-event'>(row.id),
    version: row.version,
    kind: row.kind,
    jobId: asOpaqueId<'evaluation-job'>(row.jobId),
    requestDigest: row.requestDigest,
    payload: structuredClone(row.payload),
    enqueuedAt: now,
  };
}

function requireLeaseToken(row: EvaluationOutboxRow): string {
  if (!row.leaseToken) throw new EvaluationQueueProtocolError(`Outbox row '${row.id}' has no lease token.`);
  return row.leaseToken;
}
