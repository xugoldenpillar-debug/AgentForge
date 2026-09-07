import type { Repository, ShowcaseAuditEvent as SharedShowcaseAuditEvent, WorkPublication } from '../../shared/types.ts';
import type {
  SealedBundleSource,
  ShowcaseAuditEvent as ContractShowcaseAuditEvent,
  ShowcaseRepository,
  WorkPublication as ContractWorkPublication,
} from './contracts.ts';
import { DrizzleArtifactReadPort } from '../artifacts/durable.ts';

function publicationRow(row: WorkPublication): ContractWorkPublication {
  return row as unknown as ContractWorkPublication;
}

export class DrizzleShowcaseRepository implements ShowcaseRepository {
  constructor(
    private readonly repository: Repository,
    private readonly artifacts = new DrizzleArtifactReadPort(repository),
  ) {}

  async transaction<T>(fn: (tx: ShowcaseRepository) => Promise<T>): Promise<T> {
    return this.repository.transaction(async (tx) => fn(new DrizzleShowcaseRepository(tx, new DrizzleArtifactReadPort(tx, this.artifacts.storage))));
  }

  async getSealedBundle(bundleId: string, ownerId: string): Promise<SealedBundleSource | null> {
    return this.artifacts.getSealedBundle(bundleId, ownerId);
  }

  async getWorkPublication(publicationId: string): Promise<ContractWorkPublication | null> {
    const row = (await this.repository.read('workPublications', { id: publicationId }))[0];
    return row ? publicationRow(row) : null;
  }

  async insertWorkPublication(publication: ContractWorkPublication): Promise<void> {
    await this.repository.insert('workPublications', [publication as unknown as WorkPublication]);
  }

  async updateWorkPublication(
    publicationId: string,
    expectedRevision: number,
    values: Partial<Pick<ContractWorkPublication, 'status' | 'revision' | 'updatedAt' | 'reviewedAt' | 'withdrawnAt'>>,
  ): Promise<ContractWorkPublication | null> {
    const updated = await this.repository.update('workPublications', { id: publicationId, revision: expectedRevision }, values as Partial<WorkPublication>);
    return updated[0] ? publicationRow(updated[0]) : null;
  }

  async appendAuditEvent(event: ContractShowcaseAuditEvent): Promise<void> {
    const row: SharedShowcaseAuditEvent = {
      id: event.id,
      action: event.action,
      actorId: event.actorId,
      publicationId: event.publicationId,
      entityId: null,
      occurredAt: event.occurredAt,
      metadata: event.metadata,
    };
    await this.repository.insert('showcaseAuditEvents', [row]);
  }
}
