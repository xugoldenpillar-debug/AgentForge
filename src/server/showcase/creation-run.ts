import { AppError, ERROR_CODES, ensure } from '../../shared/error-core.ts';
import type { CreationRunPort, CreationRunRef } from './contracts.ts';

function notFound(message: string): never {
  throw new AppError(message, 404, ERROR_CODES.RESOURCE_NOT_FOUND);
}

/**
 * Small AA-T6 adapter seam. It intentionally does not create or mutate EF
 * rows; the eventual EF-backed implementation can satisfy this port without
 * making showcase code depend on EvaluationService internals.
 */
export class CreationRunPublicationSeam {
  private readonly runs: CreationRunPort;

  constructor(runs: CreationRunPort) {
    this.runs = runs;
  }

  async requireCompletedRun(ownerId: string, runId: string): Promise<CreationRunRef> {
    const run = await this.runs.getCreationRun(runId, ownerId);
    if (!run) notFound('Creation run not found.');
    ensure(run.ownerId === ownerId, 'You do not own this creation run.', 403, ERROR_CODES.OWNERSHIP_FORBIDDEN);
    ensure(run.purpose === 'creation', 'The run is not a CreationRun.', 409, ERROR_CODES.RUNTIME_POLICY_DENIED);
    ensure(run.status === 'completed', 'The creation run is not complete.', 409, ERROR_CODES.EVALUATION_NOT_READY);
    ensure(typeof run.artifactBundleId === 'string' && run.artifactBundleId.length > 0, 'The creation run has no sealed artifact bundle.', 409, ERROR_CODES.EVALUATION_NOT_READY);
    return structuredClone(run);
  }
}
