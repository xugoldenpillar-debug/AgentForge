import {
  APPROVED_CAPABILITY_PERMISSIONS,
  compileAgentCanvas,
  serializeAgentCanvas,
  validateAgentCanvas,
  type AgentCanvasDocument,
  type AgentCanvasNode,
  type ApprovedCapabilityId,
} from '../lib/agent-builder-canvas.ts';
import {
  digestEnvironmentTemplateVersion,
  environmentTemplateOwnership,
  parseEnvironmentTemplateVersion,
  type EnvironmentCapabilityRefV1,
  type EnvironmentTemplateVersionV1,
  type EnvironmentTemplateOwnershipV1,
  type EnvironmentSystemCapabilityId,
} from '../shared/environment-contract.ts';
import {
  createAgentRuntimePermissionSnapshot,
  type AgentRuntimeBuildIdentityV1,
  type AgentRuntimeEffectiveCapabilityV1,
  type AgentRuntimeCapabilityPermission,
  type AgentRuntimePermissionSnapshotV1,
  parseAgentRuntimePermissionSnapshot,
  AGENT_RUNTIME_CAPABILITY_PERMISSIONS,
} from '../shared/agent-runtime-contract.ts';
import type { CompiledAgentCanvas } from '../lib/agent-builder-canvas.ts';

export interface ApprovedEnvironmentResolutionContextV1 {
  readonly ownerId: string;
}

export interface ApprovedEnvironmentValidationOptionsV1 {
  readonly ownerId?: string;
}

export type ApprovedEnvironmentVersionResolver = (
  templateId: string,
  versionId: string,
  context?: ApprovedEnvironmentResolutionContextV1,
) => EnvironmentTemplateVersionV1 | null;

export interface ApprovedEnvironmentSubgraphPlanV1 {
  readonly canvasPlan: CompiledAgentCanvas;
  readonly environmentTemplate: EnvironmentTemplateVersionV1;
  readonly effectiveCapabilities: readonly AgentRuntimeEffectiveCapabilityV1[];
  readonly semanticJson: string;
}

export type ApprovedEnvironmentValidation =
  | { valid: true; plan: ApprovedEnvironmentSubgraphPlanV1 }
  | { valid: false; errors: string[] };

export type ApprovedEnvironmentCompileResult =
  | {
    valid: true;
    plan: ApprovedEnvironmentSubgraphPlanV1;
    runtimeSnapshot: AgentRuntimePermissionSnapshotV1;
    semanticJson: string;
  }
  | { valid: false; errors: string[] };

function invalid(...errors: string[]): ApprovedEnvironmentValidation {
  return { valid: false, errors: [...new Set(errors)] };
}

function environmentNode(canvas: AgentCanvasDocument, nodeId: string): AgentCanvasNode | undefined {
  return canvas.nodes.find((node) => node.id === nodeId);
}

function systemCapability(
  capabilities: readonly EnvironmentCapabilityRefV1[],
  capabilityId: EnvironmentSystemCapabilityId,
): Extract<EnvironmentCapabilityRefV1, { kind: 'system' }> | undefined {
  return capabilities.find(
    (capability): capability is Extract<EnvironmentCapabilityRefV1, { kind: 'system' }> =>
      capability.kind === 'system' && capability.capabilityId === capabilityId,
  );
}

function effectiveCapabilities(
  plan: CompiledAgentCanvas,
  template: EnvironmentTemplateVersionV1,
): { capabilities: AgentRuntimeEffectiveCapabilityV1[]; errors: string[] } {
  const capabilities: AgentRuntimeEffectiveCapabilityV1[] = [];
  const errors: string[] = [];
  const seen = new Set<ApprovedCapabilityId>();
  for (const requested of plan.requestedCapabilities) {
    if (seen.has(requested.capabilityId)) {
      errors.push('Agent environment subgraph must not request the same capability more than once.');
      continue;
    }
    seen.add(requested.capabilityId);
    const approved = systemCapability(template.capabilities, requested.capabilityId);
    if (!approved) {
      errors.push('Agent environment subgraph requests a capability outside the approved environment ceiling.');
      continue;
    }
    const permission = APPROVED_CAPABILITY_PERMISSIONS[requested.capabilityId];
    if (requested.permission !== permission) {
      errors.push('Agent environment subgraph capability permission is not an approved fixed permission.');
      continue;
    }
    capabilities.push({
      kind: 'system',
      capabilityId: requested.capabilityId,
      permission,
      versionId: approved.versionId,
      contentDigest: approved.contentDigest,
    });
  }
  return { capabilities, errors };
}

function inspectApprovedTemplate(
  plan: CompiledAgentCanvas,
  canvas: AgentCanvasDocument,
  resolve: ApprovedEnvironmentVersionResolver,
  options: ApprovedEnvironmentValidationOptionsV1 = {},
): ApprovedEnvironmentValidation {
  const node = environmentNode(canvas, plan.environment.id);
  if (!node) return invalid('Agent environment node is missing from the canvas.');
  const requestedRuntime = node.config.runtime;
  if (requestedRuntime !== undefined && requestedRuntime !== 'pi') {
    return invalid('Agent environment runtime must remain the approved pi runtime.');
  }

  let resolved: EnvironmentTemplateVersionV1 | null;
  try {
    resolved = resolve(
      plan.environment.templateId,
      plan.environment.versionId,
      options.ownerId === undefined ? undefined : { ownerId: options.ownerId },
    );
  } catch {
    return invalid('The approved environment catalog could not resolve the selected version.');
  }
  if (!resolved) return invalid('The selected environment template version is not approved or is unavailable.');

  let template: EnvironmentTemplateVersionV1;
  try {
    template = parseEnvironmentTemplateVersion(resolved);
  } catch {
    return invalid('The selected environment template version failed server validation.');
  }

  const errors: string[] = [];
  const ownership: EnvironmentTemplateOwnershipV1 = environmentTemplateOwnership(template);
  if (ownership.scope === 'private' && ownership.ownerId !== options.ownerId) {
    errors.push('The selected private environment template is not owned by the current Agent owner.');
  }
  if (template.templateId !== plan.environment.templateId || template.versionId !== plan.environment.versionId) {
    errors.push('The selected environment template/version does not match the server-approved reference.');
  }
  if (digestEnvironmentTemplateVersion(template) !== plan.environment.contentDigest) {
    errors.push('The selected environment content digest does not match the server-approved version.');
  }
  if (template.runtime.kind !== 'pi') {
    errors.push('Only the approved pi environment runtime is supported by this compiler.');
  }
  if (template.runtime.policyVersion !== plan.agent.policyVersion) {
    errors.push('The Agent policy version does not match the approved environment runtime policy.');
  }
  if (!systemCapability(template.capabilities, 'network.none')) {
    errors.push('Approved environments must declare the network.none capability.');
  }

  const capabilityResult = effectiveCapabilities(plan, template);
  errors.push(...capabilityResult.errors);
  if (errors.length > 0) return invalid(...errors);
  return {
    valid: true,
    plan: {
      canvasPlan: plan,
      environmentTemplate: template,
      effectiveCapabilities: Object.freeze(capabilityResult.capabilities),
      semanticJson: serializeAgentCanvas(canvas),
    },
  };
}

/**
 * Server-side environment subgraph validation. The resolver is the trust
 * boundary: browser-provided template payloads are never accepted as approval.
 */
export function validateApprovedEnvironmentSubgraph(
  canvas: AgentCanvasDocument,
  resolve: ApprovedEnvironmentVersionResolver,
  options: ApprovedEnvironmentValidationOptionsV1 = {},
): ApprovedEnvironmentValidation {
  const canvasValidation = validateAgentCanvas(canvas);
  if (!canvasValidation.valid) return invalid(...canvasValidation.errors);
  const compiled = compileAgentCanvas(canvas);
  if (!compiled.valid) return invalid(...compiled.errors);
  return inspectApprovedTemplate(compiled.plan, canvas, resolve, options);
}

/**
 * Compile a validated canvas into a fixed approved-environment plan and a
 * runtime permission snapshot. This is declaration-only; it does not start a
 * model, shell, Docker image, or sandbox.
 */
export function compileApprovedEnvironmentSubgraph(
  canvas: AgentCanvasDocument,
  resolve: ApprovedEnvironmentVersionResolver,
  buildIdentity: AgentRuntimeBuildIdentityV1,
): ApprovedEnvironmentCompileResult {
  const validation = validateApprovedEnvironmentSubgraph(canvas, resolve, { ownerId: buildIdentity.ownerId });
  if (!validation.valid) return validation;
  const { plan } = validation;
  const snapshot = createAgentRuntimePermissionSnapshot({
    schemaVersion: 1,
    kind: 'agent-permission-snapshot',
    agent: {
      nodeId: plan.canvasPlan.agent.id,
      runtime: plan.canvasPlan.agent.runtime,
      policyVersion: plan.canvasPlan.agent.policyVersion,
    },
    build: buildIdentity,
    environment: {
      templateId: plan.environmentTemplate.templateId,
      versionId: plan.environmentTemplate.versionId,
      contentDigest: digestEnvironmentTemplateVersion(plan.environmentTemplate),
      runtime: plan.environmentTemplate.runtime,
      networkMode: plan.canvasPlan.environment.networkMode,
    },
    effectiveCapabilities: plan.effectiveCapabilities,
    limits: plan.environmentTemplate.limits,
    artifactPolicy: plan.environmentTemplate.artifactPolicy,
  });
  return {
    valid: true,
    plan,
    runtimeSnapshot: snapshot,
    semanticJson: plan.semanticJson,
  };
}


/**
 * Runtime admission is deliberately narrower than canvas compilation: it
 * accepts only the immutable, server-issued snapshot and exposes no canvas or
 * permission-mutation input. This is a contract boundary, not an executor.
 */
export interface AgentRuntimePermissionBoundary {
  readonly snapshot: AgentRuntimePermissionSnapshotV1;
  hasCapability(capabilityId: EnvironmentSystemCapabilityId, permission: AgentRuntimeCapabilityPermission): boolean;
}

export function createAgentRuntimePermissionBoundary(snapshot: unknown): AgentRuntimePermissionBoundary {
  const immutableSnapshot = parseAgentRuntimePermissionSnapshot(snapshot);
  const permissions = new Map(
    immutableSnapshot.effectiveCapabilities.map((capability) => [capability.capabilityId, capability.permission]),
  );
  return Object.freeze({
    snapshot: immutableSnapshot,
    hasCapability(capabilityId: EnvironmentSystemCapabilityId, permission: AgentRuntimeCapabilityPermission): boolean {
      return permissions.get(capabilityId) === permission && permission === AGENT_RUNTIME_CAPABILITY_PERMISSIONS[capabilityId];
    },
  });
}
