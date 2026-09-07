import { AppError, ERROR_CODES } from '../shared/errors.ts';
import {
  parseAgentBuildDefinition,
  type AgentBuildCapabilityRef,
  type AgentBuildDefinition,
  type AgentBuildPinnedRef,
  type AgentBuildSkillRef,
} from '../shared/agent-build-contract.ts';
import type {
  AgentBuildResolution,
  AgentBuildResolutionOperation,
  AgentBuildResolutionRequest,
  AgentBuildResolver,
} from './agent-build-resolver.ts';

/**
 * Catalog visibility is deliberately narrower than a build's visibility. It
 * describes who may consume a catalog release, not who may see an Agent Build.
 */
export type CatalogReleaseVisibility = 'platform' | 'public' | 'private';

interface CatalogReleaseState {
  readonly versionId: string;
  readonly contentDigest: string;
  readonly ownerId: string | null;
  readonly visibility: CatalogReleaseVisibility;
  readonly revoked: boolean;
}

export interface CatalogModelRelease extends CatalogReleaseState {
  readonly modelId: string;
}

export interface CatalogOutputContractRelease extends CatalogReleaseState {
  readonly outputContractId: string;
}

export interface CatalogProfileRelease extends CatalogReleaseState {
  readonly profileId: string;
}

export interface CatalogEnvironmentRelease extends CatalogReleaseState {
  readonly environmentId: string;
}

export interface CatalogSkillRelease extends CatalogReleaseState {
  readonly componentId: string;
}

export type CatalogCapabilityRelease = CatalogReleaseState & (
  | {
      readonly kind: 'tool';
      readonly toolId: string;
    }
  | {
      readonly kind: 'mcp-read';
      readonly serviceId: string;
      readonly toolId: string;
    }
);

export interface CatalogLookupContext {
  readonly actorId: string;
  readonly ownerId: string;
  readonly buildId: string;
  readonly buildVersionId: string;
  readonly operation: AgentBuildResolutionOperation;
}

/**
 * Each dependency class has its own port so a future catalog cannot
 * accidentally resolve a model through a skill/tool lookup. The ports return
 * metadata only; they do not return provider credentials, URLs, prompts, or
 * executable payloads.
 */
export interface ModelCatalogLookupPort {
  lookupModel(ref: AgentBuildPinnedRef, context: CatalogLookupContext): Promise<CatalogModelRelease | null>;
}

export interface OutputContractCatalogLookupPort {
  lookupOutputContract(ref: AgentBuildPinnedRef, context: CatalogLookupContext): Promise<CatalogOutputContractRelease | null>;
}

export interface ProfileCatalogLookupPort {
  lookupProfile(ref: AgentBuildPinnedRef, context: CatalogLookupContext): Promise<CatalogProfileRelease | null>;
}

export interface EnvironmentCatalogLookupPort {
  lookupEnvironment(ref: AgentBuildPinnedRef, context: CatalogLookupContext): Promise<CatalogEnvironmentRelease | null>;
}

export interface SkillCatalogLookupPort {
  lookupSkill(ref: AgentBuildSkillRef, context: CatalogLookupContext): Promise<CatalogSkillRelease | null>;
}

export interface CapabilityCatalogLookupPort {
  lookupCapability(ref: AgentBuildCapabilityRef, context: CatalogLookupContext): Promise<CatalogCapabilityRelease | null>;
}

export interface CatalogAgentBuildResolverPorts {
  readonly models: ModelCatalogLookupPort;
  readonly outputContracts: OutputContractCatalogLookupPort;
  readonly profiles: ProfileCatalogLookupPort;
  readonly environments: EnvironmentCatalogLookupPort;
  readonly skills: SkillCatalogLookupPort;
  readonly capabilities: CapabilityCatalogLookupPort;
}

function denied(message: string): never {
  throw new AppError(message, 409, ERROR_CODES.RUNTIME_POLICY_DENIED);
}

function ownershipDenied(): never {
  throw new AppError('The Agent dependency is not available to this actor.', 403, ERROR_CODES.OWNERSHIP_FORBIDDEN);
}

function unavailable(): never {
  throw new AppError('The Agent catalog is unavailable.', 503, ERROR_CODES.RUNTIME_UNAVAILABLE);
}

function nonEmpty(value: string, label: string): void {
  if (value.length === 0 || value.length > 160) {
    throw new AppError(`Invalid ${label}.`, 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
  }
}

function assertRequest(request: AgentBuildResolutionRequest): AgentBuildDefinition {
  nonEmpty(request.actorId, 'actor identity');
  nonEmpty(request.ownerId, 'owner identity');
  nonEmpty(request.buildId, 'build identity');
  nonEmpty(request.buildVersionId, 'build version identity');
  return parseAgentBuildDefinition(request.definition);
}

function contextOf(request: AgentBuildResolutionRequest): CatalogLookupContext {
  return Object.freeze({
    actorId: request.actorId,
    ownerId: request.ownerId,
    buildId: request.buildId,
    buildVersionId: request.buildVersionId,
    operation: request.operation,
  });
}

function assertReleaseAccess(release: CatalogReleaseState, context: CatalogLookupContext): void {
  if (release.revoked) denied('The Agent dependency has been revoked.');
  if (release.visibility === 'platform') {
    if (release.ownerId !== null) denied('The platform dependency has invalid ownership metadata.');
    return;
  }
  if (release.visibility === 'private') {
    if (release.ownerId === null || release.ownerId !== context.ownerId || context.actorId !== context.ownerId) {
      ownershipDenied();
    }
    return;
  }
  if (release.ownerId !== null && release.ownerId.length === 0) {
    denied('The public dependency has invalid ownership metadata.');
  }
}

function assertPinnedIdentity(
  ref: AgentBuildPinnedRef,
  release: CatalogReleaseState,
  id: string,
  label: string
): void {
  if (
    id !== ref.id ||
    release.versionId !== ref.versionId ||
    release.contentDigest !== ref.contentDigest
  ) {
    denied(`The ${label} identity or digest does not match the pinned reference.`);
  }
}

function assertSkillIdentity(ref: AgentBuildSkillRef, release: CatalogSkillRelease): void {
  if (
    release.componentId !== ref.componentId ||
    release.versionId !== ref.versionId ||
    release.contentDigest !== ref.contentDigest
  ) {
    denied('The skill identity or digest does not match the pinned reference.');
  }
}

function assertCapabilityIdentity(ref: AgentBuildCapabilityRef, release: CatalogCapabilityRelease): void {
  const sameKind = release.kind === ref.kind;
  const sameService = ref.kind === 'mcp-read' && release.kind === 'mcp-read'
    ? release.serviceId === ref.serviceId
    : ref.kind === 'tool' && release.kind === 'tool';
  const sameTool = release.toolId === ref.toolId;
  if (!sameKind || !sameService || !sameTool || release.versionId !== ref.versionId || release.contentDigest !== ref.contentDigest) {
    denied('The capability identity or digest does not match the pinned reference.');
  }
}

async function lookup<T>(operation: () => Promise<T | null>): Promise<T> {
  try {
    const result = await operation();
    if (result === null) unavailable();
    return result;
  } catch (error) {
    if (error instanceof AppError) throw error;
    unavailable();
  }
}

/**
 * Server-side resolver contract for configured Agent Builds.
 *
 * Save validates the caller as the build owner and authorizes the current
 * catalog releases. Read re-authorizes the stored pinned releases without
 * rewriting them. Fork uses the same immutable references and only permits
 * private releases when the forking actor is the source owner; public/platform
 * releases remain forkable without copying any credentials or bindings.
 *
 * This class is intentionally not exported through a factory and is not wired
 * as the default resolver. It is a contract seam for a later authoritative
 * catalog implementation.
 */
export class CatalogAgentBuildResolver implements AgentBuildResolver {
  readonly #ports: CatalogAgentBuildResolverPorts;

  constructor(ports: CatalogAgentBuildResolverPorts) {
    this.#ports = ports;
  }

  async resolve(request: AgentBuildResolutionRequest): Promise<AgentBuildResolution> {
    const definition = assertRequest(request);
    const context = contextOf(request);

    if (request.operation === 'save' && request.actorId !== request.ownerId) {
      ownershipDenied();
    }

    await this.#resolveDefinition(definition, context);

    // The resolver never canonicalizes or enriches the client definition. The
    // parser has already removed unsupported fields; every remaining reference
    // has just been matched exactly against a server-side release.
    return Object.freeze({ definition });
  }

  async #resolveDefinition(definition: AgentBuildDefinition, context: CatalogLookupContext): Promise<void> {
    if (definition.modelSelection) {
      const release = await lookup(() => this.#ports.models.lookupModel(definition.modelSelection!, context));
      assertReleaseAccess(release, context);
      assertPinnedIdentity(definition.modelSelection, release, release.modelId, 'model');
    }
    if (definition.outputContractRef) {
      const release = await lookup(() => this.#ports.outputContracts.lookupOutputContract(definition.outputContractRef!, context));
      assertReleaseAccess(release, context);
      assertPinnedIdentity(definition.outputContractRef, release, release.outputContractId, 'output contract');
    }
    if (definition.profileRef) {
      const release = await lookup(() => this.#ports.profiles.lookupProfile(definition.profileRef!, context));
      assertReleaseAccess(release, context);
      assertPinnedIdentity(definition.profileRef, release, release.profileId, 'profile');
    }
    if (definition.environmentRef) {
      const release = await lookup(() => this.#ports.environments.lookupEnvironment(definition.environmentRef!, context));
      assertReleaseAccess(release, context);
      assertPinnedIdentity(definition.environmentRef, release, release.environmentId, 'environment');
    }
    for (const skill of definition.skillRefs) {
      const release = await lookup(() => this.#ports.skills.lookupSkill(skill, context));
      assertReleaseAccess(release, context);
      assertSkillIdentity(skill, release);
    }
    for (const capability of definition.requestedCapabilities) {
      const release = await lookup(() => this.#ports.capabilities.lookupCapability(capability, context));
      assertReleaseAccess(release, context);
      assertCapabilityIdentity(capability, release);
    }
  }
}
