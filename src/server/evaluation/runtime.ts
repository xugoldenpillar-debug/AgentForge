import type { Repository } from '../../shared/types.ts';
import { EvaluationRepositoryAdapter } from '../../db/evaluation-repository.ts';
import {
  EvaluationService,
  type EvaluationDispatchSink,
} from './domain.ts';
import type { EvaluationOutboxEvent } from '../../shared/evaluation-types.ts';

/**
 * The web process only accepts work after the transactional outbox row exists.
 * Publishing that row to Redis/BullMQ remains the dedicated worker process's job;
 * this adapter never executes a model or uses an in-memory queue as a fallback.
 */
class DurableOutboxDispatch implements EvaluationDispatchSink {
  private readonly repository: Repository;

  constructor(repository: Repository) {
    this.repository = repository;
  }

  async enqueue(event: EvaluationOutboxEvent): Promise<void> {
    const row = (await this.repository.read('evaluationOutbox', { id: event.id }))[0];
    if (!row || row.jobId !== event.aggregateId || !['pending', 'leased', 'published'].includes(row.status)) {
      throw new Error('Evaluation accepted event was not durably persisted in the outbox.');
    }
  }
}

/**
 * Creates the production-safe web-side scheduler boundary.
 *
 * It persists Job + idempotency + accepted Outbox event through PostgreSQL, then
 * returns. A worker must publish/execute the pending outbox row separately.
 */
export function createDurableOutboxCompetitiveRunScheduler(
  repository: Repository,
): EvaluationService {
  return new EvaluationService(
    new EvaluationRepositoryAdapter(repository),
    new DurableOutboxDispatch(repository),
  );
}
