import { AppError, ERROR_CODES } from '../shared/errors.ts';
import type { AgentBuildDefinition } from '../shared/agent-build-contract.ts';

/**
 * The only server-side boundary allowed to turn pinned Agent references into
 * an accepted configuration. The request deliberately contains no client URL,
 * provider credential, model endpoint, host path, or raw request body.
 */
export type AgentBuildResolutionOperation = 'save' | 'read' | 'fork';

export interface AgentBuildResolutionRequest {
  readonly actorId: string;
  readonly ownerId: string;
  readonly buildId: string;
  readonly buildVersionId: string;
  readonly operation: AgentBuildResolutionOperation;
  readonly definition: AgentBuildDefinition;
}

export interface AgentBuildResolution {
  /** A server-canonical definition; the caller recomputes its digest. */
  readonly definition: AgentBuildDefinition;
}

export interface AgentBuildResolver {
  resolve(request: AgentBuildResolutionRequest): Promise<AgentBuildResolution>;
}

/**
 * Production default until the catalog/release/permission directories are
 * wired. It is intentionally not a pass-through and never treats a client
 * reference as an approved dependency.
 */
export const unavailableAgentBuildResolver: AgentBuildResolver = Object.freeze({
  async resolve(): Promise<AgentBuildResolution> {
    throw new AppError(
      'Configured Agent dependencies are unavailable until the authoritative resolver is configured.',
      503,
      ERROR_CODES.RUNTIME_UNAVAILABLE
    );
  },
});
