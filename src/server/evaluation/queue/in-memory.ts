import { randomUUID } from 'node:crypto';
import { EvaluationQueueUnavailableError } from './errors.ts';
import type {
  EvaluationQueueDelivery,
  EvaluationQueueEnvelope,
  EvaluationQueuePort,
} from './ports.ts';

/**
 * Deterministic queue substitute for tests and local wiring.
 * It deliberately models readiness and acknowledgement without claiming Redis semantics.
 */
export class InMemoryEvaluationQueue implements EvaluationQueuePort {
  private ready = true;
  private readonly pending: EvaluationQueueEnvelope[] = [];
  private readonly inflight = new Map<string, EvaluationQueueDelivery>();
  private readonly seen = new Set<string>();

  setReady(ready: boolean): void {
    this.ready = ready;
  }

  isReady(): boolean {
    return this.ready;
  }

  readinessReason(): string | undefined {
    return this.ready ? undefined : 'in-memory control plane marked unavailable';
  }

  async enqueue(message: EvaluationQueueEnvelope): Promise<{ readonly duplicate: boolean }> {
    if (!this.ready) throw new EvaluationQueueUnavailableError();
    if (this.seen.has(message.eventId)) return { duplicate: true };
    this.seen.add(message.eventId);
    this.pending.push(structuredClone(message));
    return { duplicate: false };
  }

  async receive(): Promise<EvaluationQueueDelivery | null> {
    if (!this.ready) throw new EvaluationQueueUnavailableError();
    const message = this.pending.shift();
    if (!message) return null;
    const delivery = { deliveryId: randomUUID(), message };
    this.inflight.set(delivery.deliveryId, delivery);
    return delivery;
  }

  async acknowledge(deliveryId: string): Promise<boolean> {
    return this.inflight.delete(deliveryId);
  }

  async reject(deliveryId: string): Promise<boolean> {
    const delivery = this.inflight.get(deliveryId);
    if (!delivery) return false;
    this.inflight.delete(deliveryId);
    this.pending.unshift(delivery.message);
    return true;
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  get inflightCount(): number {
    return this.inflight.size;
  }
}
