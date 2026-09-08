import { AppError, ERROR_CODES, ensure } from '../../shared/errors.ts';
import { parseAgentBuildDefinition } from '../../shared/agent-build-contract.ts';
import type { AgentBuildResolutionRequest, AgentBuildResolver } from '../agent-build-resolver.ts';
import {
  CREATION_BYOK_MODEL_REF,
  CREATION_ENVIRONMENT_DIGEST,
  CREATION_ENVIRONMENT_TEMPLATE,
  CREATION_OUTPUT_CONTRACT_REF,
} from './catalog.ts';

/**
 * Authoritative resolver for the deliberately small public animation launch.
 * Provider credentials remain a separate run-time authorization and are never
 * persisted in the immutable Build definition.
 */
export const creationAgentBuildResolver: AgentBuildResolver = Object.freeze({
  async resolve(request: AgentBuildResolutionRequest) {
    const definition = parseAgentBuildDefinition(request.definition);
    ensure(request.actorId === request.ownerId || request.operation !== 'save',
      'Only the owner can save an Agent Build.', 403, ERROR_CODES.OWNERSHIP_FORBIDDEN);
    ensure(definition.skillRefs.length === 0 && definition.requestedCapabilities.length === 0,
      'This launch accepts prompt-only Skill instructions and fixed sandbox capabilities.',
      409, ERROR_CODES.RUNTIME_POLICY_DENIED);
    ensure(definition.profileRef === null,
      'Custom execution profiles are not enabled for the animation launch.',
      409, ERROR_CODES.RUNTIME_POLICY_DENIED);
    ensure(definition.environmentRef?.id === CREATION_ENVIRONMENT_TEMPLATE.templateId
      && definition.environmentRef.versionId === CREATION_ENVIRONMENT_TEMPLATE.versionId
      && definition.environmentRef.contentDigest === CREATION_ENVIRONMENT_DIGEST,
    'The Agent Build must use the approved animation sandbox.', 409, ERROR_CODES.RUNTIME_POLICY_DENIED);
    ensure(definition.runtimeSelection?.kind === 'pi'
      && definition.runtimeSelection.adapterVersion === CREATION_ENVIRONMENT_TEMPLATE.runtime.adapterVersion
      && definition.runtimeSelection.policyVersion === CREATION_ENVIRONMENT_TEMPLATE.runtime.policyVersion,
    'The Agent Build must use the approved Pi animation runtime.', 409, ERROR_CODES.RUNTIME_POLICY_DENIED);
    ensure(definition.outputContractRef?.id === CREATION_OUTPUT_CONTRACT_REF.id
      && definition.outputContractRef.versionId === CREATION_OUTPUT_CONTRACT_REF.versionId
      && definition.outputContractRef.contentDigest === CREATION_OUTPUT_CONTRACT_REF.contentDigest,
    'The Agent Build must use the SVG animation output contract.', 409, ERROR_CODES.RUNTIME_POLICY_DENIED);
    ensure(definition.modelSelection !== null,
      'A BYOK model selection is required.', 409, ERROR_CODES.RUNTIME_POLICY_DENIED);

    return {
      definition: parseAgentBuildDefinition({
        ...definition,
        // The immutable Build records a generic BYOK model contract. The exact
        // credential and model are authorized and snapshotted per CreationRun.
        modelSelection: CREATION_BYOK_MODEL_REF,
        outputContractRef: CREATION_OUTPUT_CONTRACT_REF,
        environmentRef: {
          id: CREATION_ENVIRONMENT_TEMPLATE.templateId,
          versionId: CREATION_ENVIRONMENT_TEMPLATE.versionId,
          contentDigest: CREATION_ENVIRONMENT_DIGEST,
        },
        runtimeSelection: CREATION_ENVIRONMENT_TEMPLATE.runtime,
      }),
    };
  },
});

export function assertCreationAgentBuildResolverConfigured(resolver: AgentBuildResolver | undefined): asserts resolver is AgentBuildResolver {
  if (!resolver) {
    throw new AppError('Creation Agent Build resolver is unavailable.', 503, ERROR_CODES.RUNTIME_UNAVAILABLE);
  }
}
