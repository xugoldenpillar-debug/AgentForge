/**
 * Converts the browser Agent canvas handoff plan into the shared B1/B2
 * definition shape. The canvas only carries catalog coordinates; the caller
 * must provide authoritative pinned references for model, output contract,
 * profile, capabilities, and the runtime adapter version.
 *
 * This adapter is intentionally not an execution adapter. A successful result
 * is still a private, unconfigured-safe definition until the server performs
 * ownership, release, capability, credential, budget, and runtime checks.
 */
import {
  parseAgentBuildDefinition,
  type AgentBuildCapabilityRef,
  type AgentBuildDefinition,
  type AgentBuildPinnedRef,
} from '../shared/agent-build-contract.ts';
import {
  compileAgentCanvas,
  type AgentCanvasDocument,
  type CompiledAgentCanvas,
} from './agent-builder-canvas.ts';

export interface ResolvedCanvasPinnedRef {
  readonly nodeId: string;
  readonly ref: AgentBuildPinnedRef;
}

export interface AgentCanvasBuildResolution {
  /** Authoritative catalog resolution for the Model node. */
  readonly modelSelection: ResolvedCanvasPinnedRef;
  /** Authoritative catalog resolution for the Output Contract node. */
  readonly outputContractRef: ResolvedCanvasPinnedRef;
  /** Required only when the Task node contains a profileRef. */
  readonly profileRef?: ResolvedCanvasPinnedRef;
  /** Capability resolutions are keyed by the canvas Capability node id. */
  readonly capabilityRefs: Readonly<Record<string, AgentBuildCapabilityRef>>;
  /** This is supplied by the server/runtime registry, not the canvas. */
  readonly runtimeAdapterVersion: string;
}

export type AgentCanvasDefinitionAdapterResult =
  | {
    readonly valid: true;
    readonly definition: AgentBuildDefinition;
    readonly semanticJson: string;
  }
  | {
    readonly valid: false;
    readonly errors: readonly string[];
  };

function fail(...errors: string[]): AgentCanvasDefinitionAdapterResult {
  return { valid: false, errors };
}

function pinnedForNode(
  resolved: ResolvedCanvasPinnedRef | undefined,
  expectedNodeId: string,
  label: string
): AgentBuildPinnedRef | null {
  if (!resolved) return null;
  if (resolved.nodeId !== expectedNodeId) return null;
  return resolved.ref;
}

function mapCapabilityRefs(
  plan: CompiledAgentCanvas,
  resolution: AgentCanvasBuildResolution
): AgentBuildCapabilityRef[] | null {
  const refs: AgentBuildCapabilityRef[] = [];
  for (const capability of plan.requestedCapabilities) {
    const ref = resolution.capabilityRefs[capability.id];
    if (!ref) return null;
    refs.push(ref);
  }
  return refs;
}

export function agentCanvasToBuildDefinition(
  canvas: AgentCanvasDocument,
  resolution: AgentCanvasBuildResolution
): AgentCanvasDefinitionAdapterResult {
  const compiled = compileAgentCanvas(canvas);
  if (!compiled.valid) return fail(...compiled.errors);

  const plan = compiled.plan;
  const modelSelection = pinnedForNode(resolution.modelSelection, plan.model.id, 'Model');
  if (!modelSelection) return fail('The Model node has no authoritative pinned catalog reference.');

  const outputContractRef = pinnedForNode(
    resolution.outputContractRef,
    plan.outputContract.id,
    'Output Contract'
  );
  if (!outputContractRef) return fail('The Output Contract node has no authoritative pinned catalog reference.');

  const profileRef = plan.task.profileRef === null
    ? null
    : pinnedForNode(resolution.profileRef, plan.task.id, 'Profile');
  if (plan.task.profileRef !== null && !profileRef) {
    return fail('The Task profile has no authoritative pinned catalog reference.');
  }

  const capabilityRefs = mapCapabilityRefs(plan, resolution);
  if (!capabilityRefs) return fail('Every requested capability must be resolved by the server.');

  try {
    const definition = parseAgentBuildDefinition({
      mode: 'agent',
      definitionSchemaVersion: 1,
      instructions: `${plan.task.brief}\n\n${plan.agent.instructions}`,
      modelSelection,
      skillRefs: plan.skillRefs.map(({ id: _id, kind, componentId, versionId, contentDigest }) => ({
        kind,
        componentId,
        versionId,
        contentDigest,
      })),
      requestedCapabilities: capabilityRefs,
      outputContractRef,
      profileRef,
      environmentRef: {
        id: plan.environment.templateId,
        versionId: plan.environment.versionId,
        contentDigest: plan.environment.contentDigest,
      },
      runtimeSelection: {
        kind: 'pi',
        adapterVersion: resolution.runtimeAdapterVersion,
        policyVersion: plan.agent.policyVersion,
      },
    });
    return {
      valid: true,
      definition,
      semanticJson: compiled.semanticJson,
    };
  } catch {
    // Shared parser errors intentionally do not expose private canvas content
    // or resolver identities at this boundary.
    return fail('The Agent canvas could not be converted to a valid Agent Build definition.');
  }
}
