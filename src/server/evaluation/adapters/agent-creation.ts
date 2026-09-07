import { validateConfiguredAgentBuild, type AgentBuildDefinition } from '../../../shared/agent-build-contract.ts';
import { AppError, ERROR_CODES } from '../../../shared/errors.ts';
import type { EvaluationCapacityProvider, EvaluationBudgetProvider } from '../domain.ts';
import type { EvaluationInvocationBoundary } from '../invocation/ports.ts';
import type { SandboxProvider } from '../../sandbox/types.ts';

/**
 * Ports needed before a free-form Agent can enter a CreationRun.
 *
 * These are intentionally optional at the web boundary: an omitted port is a
 * deployment misconfiguration, not permission to fall back to an in-memory
 * queue, a legacy lease, or a model call. The concrete ports must be backed by
 * the durable evaluation foundation and an approved sandbox before this seam
 * can be enabled.
 */
export interface AgentCreationEvaluationPorts {
  readonly capacity?: EvaluationCapacityProvider;
  readonly budget?: EvaluationBudgetProvider;
  readonly usage?: EvaluationInvocationBoundary;
  readonly sandbox?: SandboxProvider;
}

export interface AgentCreationEvaluationInput {
  readonly definition: unknown;
  readonly ownerId: string;
  readonly buildId: string;
  readonly buildVersionId: string;
  readonly creationRunId: string;
}

export type AgentCreationDependency = 'budget-reservation' | 'usage-accounting' | 'sandbox';

const CREATION_PURPOSE_UNAVAILABLE =
  'CreationRun evaluation is unavailable until its versioned evaluation purpose and durable worker are enabled.';
const DEPENDENCIES_UNAVAILABLE =
  'CreationRun evaluation is unavailable until durable budget reservations, usage accounting, and an approved sandbox are configured.';

function unavailable(message: string): never {
  throw new AppError(message, 503, ERROR_CODES.RUNTIME_UNAVAILABLE);
}

function validateIdentifier(value: unknown, label: string): void {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 160) {
    throw new AppError(`A valid ${label} is required.`, 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
  }
}

/**
 * Admission-only adapter for the future Pi-backed Agent CreationRun path.
 *
 * This class does not create jobs, reserve capacity, invoke a model, start Pi,
 * or execute a sandbox. It exists so the eventual EF integration has one
 * typed boundary and cannot accidentally treat a browser canvas definition as
 * an executable request while the creation purpose is still unsupported.
 */
export class AgentCreationEvaluationAdapter {
  private readonly ports: AgentCreationEvaluationPorts;

  constructor(ports: AgentCreationEvaluationPorts = {}) {
    this.ports = ports;
  }

  /**
   * Parse and apply the existing private B2 configuration gate without
   * changing its ownership or release semantics.
   */
  validateDefinition(input: unknown): AgentBuildDefinition {
    return validateConfiguredAgentBuild(input, 'private', {
      requireModel: true,
      requireEnvironment: true,
      requireOutputContract: true,
      requireRuntime: true,
    });
  }

  missingDependencies(): readonly AgentCreationDependency[] {
    const missing: AgentCreationDependency[] = [];
    if (!this.ports.capacity || !this.ports.budget) missing.push('budget-reservation');
    if (!this.ports.usage) missing.push('usage-accounting');
    if (!this.ports.sandbox) missing.push('sandbox');
    return missing;
  }

  /**
   * Fail-closed admission. The return type is `never` by design: no caller can
   * mistake this foundation checkpoint for an accepted or executable run.
   */
  async admit(input: AgentCreationEvaluationInput): Promise<never> {
    validateIdentifier(input.ownerId, 'owner');
    validateIdentifier(input.buildId, 'build');
    validateIdentifier(input.buildVersionId, 'build version');
    validateIdentifier(input.creationRunId, 'CreationRun');
    this.validateDefinition(input.definition);

    if (this.missingDependencies().length > 0) {
      unavailable(DEPENDENCIES_UNAVAILABLE);
    }

    // Even with test doubles or future ports supplied, the current EF contract
    // has no `creation` purpose / `creation-run` association. Do not reinterpret
    // this request as competitive or author-self-test work.
    unavailable(CREATION_PURPOSE_UNAVAILABLE);
  }
}
