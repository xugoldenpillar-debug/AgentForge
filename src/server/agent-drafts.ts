import { parseAgentBuildDefinition, isConfiguredAgentBuild } from '../shared/agent-build-contract.ts';
import { digestAgentBuildDefinition } from '../lib/agent-build/digest.ts';
import { AppError, ensure, ERROR_CODES } from '../shared/errors.ts';
import type { AgentBuildDefinition } from '../shared/agent-build-contract.ts';
import type { AgentBuildResolutionRequest, AgentBuildResolver } from './agent-build-resolver.ts';
import type { BuildVersion } from '../shared/types.ts';

export interface PersistedAgentDraft {
  readonly agentDefinition: AgentBuildDefinition;
  readonly definitionDigest: string;
}

function privateAgentDefinition(input: unknown, visibility: unknown): AgentBuildDefinition {
  const definition = parseAgentBuildDefinition(input);
  ensure(visibility === 'private', 'Only private Agent Builds are supported.', 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
  return definition;
}

/** No catalog/Profile authorization exists yet. Hashes are identities, not grants. */
export function privateAgentDraft(input: unknown, visibility: unknown): PersistedAgentDraft {
  const definition = parseAgentBuildDefinition(input);
  ensure(visibility === 'private' && !isConfiguredAgentBuild(definition),
    'Only unconfigured private Agent drafts are supported; dependency authorization is unavailable.',
    400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
  return { agentDefinition: definition, definitionDigest: digestAgentBuildDefinition(definition) };
}

/** Structural/private validation used before the injected resolver runs. */
export function parsePrivateAgentDefinition(input: unknown, visibility: unknown): AgentBuildDefinition {
  return privateAgentDefinition(input, visibility);
}

function resolverFailure(): AppError {
  return new AppError(
    'Configured Agent dependencies could not be resolved.',
    503,
    ERROR_CODES.RUNTIME_UNAVAILABLE
  );
}

async function resolveConfiguredDefinition(
  definition: AgentBuildDefinition,
  request: Omit<AgentBuildResolutionRequest, 'definition'>,
  resolver: AgentBuildResolver | undefined
): Promise<PersistedAgentDraft> {
  if (!isConfiguredAgentBuild(definition)) {
    return { agentDefinition: definition, definitionDigest: digestAgentBuildDefinition(definition) };
  }
  if (!resolver) throw resolverFailure();

  let resolution;
  try {
    resolution = await resolver.resolve({ ...request, definition });
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw resolverFailure();
  }

  let resolved: AgentBuildDefinition;
  try {
    resolved = parseAgentBuildDefinition(resolution?.definition);
  } catch {
    throw resolverFailure();
  }
  // Save may translate a client-facing reference into a server-canonical
  // identity. Read/Fork must not rewrite an immutable historical version when
  // the catalog or resolver changes; they may only re-authorize the stored
  // canonical definition.
  if (request.operation !== 'save' && digestAgentBuildDefinition(resolved) !== digestAgentBuildDefinition(definition)) {
    throw resolverFailure();
  }
  // A resolver may canonicalize approved identities, but it may not rewrite
  // user instructions, add capabilities, or silently turn the request into an
  // unconfigured draft.
  const samePresence = (left: AgentBuildDefinition, right: AgentBuildDefinition): boolean =>
    Boolean(left.modelSelection) === Boolean(right.modelSelection) &&
    Boolean(left.outputContractRef) === Boolean(right.outputContractRef) &&
    Boolean(left.profileRef) === Boolean(right.profileRef) &&
    Boolean(left.environmentRef) === Boolean(right.environmentRef) &&
    Boolean(left.runtimeSelection) === Boolean(right.runtimeSelection) &&
    left.skillRefs.length === right.skillRefs.length &&
    left.requestedCapabilities.length === right.requestedCapabilities.length;
  if (!isConfiguredAgentBuild(resolved) || resolved.instructions !== definition.instructions || !samePresence(definition, resolved)) {
    throw resolverFailure();
  }
  return { agentDefinition: resolved, definitionDigest: digestAgentBuildDefinition(resolved) };
}

export async function resolveAgentDraft(
  input: unknown,
  visibility: unknown,
  request: Omit<AgentBuildResolutionRequest, 'definition'>,
  resolver?: AgentBuildResolver
): Promise<PersistedAgentDraft> {
  return resolveConfiguredDefinition(parsePrivateAgentDefinition(input, visibility), request, resolver);
}

export async function resolvePersistedAgentDraft(
  input: unknown,
  storedDigest: unknown,
  request: Omit<AgentBuildResolutionRequest, 'definition'>,
  resolver?: AgentBuildResolver
): Promise<PersistedAgentDraft> {
  const definition = parsePrivateAgentDefinition(input, 'private');
  const digest = digestAgentBuildDefinition(definition);
  ensure(storedDigest === digest,
    'Stored Agent definition integrity could not be verified.',
    409, ERROR_CODES.RUNTIME_POLICY_DENIED);
  return resolveConfiguredDefinition(definition, request, resolver);
}

export function versionMetadata(version: BuildVersion) {
  return {
    id: version.id, buildId: version.buildId, revision: version.revision,
    title: version.title, visibility: version.visibility, createdAt: version.createdAt,
    mode: version.mode ?? 'workflow'
  };
}

export function validateBuildEnvelope(body: Record<string, unknown>) {
  const mode = body.mode ?? 'workflow';
  ensure(!Object.hasOwn(body, 'mode') || body.mode === 'workflow' || body.mode === 'agent',
    'Invalid Build mode.', 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
  const allowed = new Set(['mode', 'buildId', 'currentVersionId', 'problemId', 'animationChallengeVersionId', 'title', 'visibility',
    mode === 'agent' ? 'agentDefinition' : 'workflow']);
  ensure(Object.keys(body).every(key => allowed.has(key)) &&
    ((typeof body.problemId === 'string' && body.problemId.length > 0 && body.problemId.length <= 100) !==
      (typeof body.animationChallengeVersionId === 'string' && body.animationChallengeVersionId.length > 0 && body.animationChallengeVersionId.length <= 100)) &&
    (mode === 'agent' || body.animationChallengeVersionId === undefined) &&
    typeof body.title === 'string' && body.title.trim().length > 0 && body.title.length <= 80 &&
    (body.visibility === 'public' || body.visibility === 'private') &&
    ['buildId', 'currentVersionId'].every(key => !Object.hasOwn(body, key) ||
      (typeof body[key] === 'string' && body[key].length > 0 && body[key].length <= 100)) &&
    (body.buildId !== undefined || body.currentVersionId === undefined),
  'Invalid Build fields.', 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
  return mode;
}
