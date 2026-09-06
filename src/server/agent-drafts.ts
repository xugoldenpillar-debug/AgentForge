import { parseAgentBuildDefinition } from '../shared/agent-build-contract.ts';
import { digestAgentBuildDefinition } from '../lib/agent-build/digest.ts';
import { ensure, ERROR_CODES } from '../shared/errors.ts';
import type { BuildVersion } from '../shared/types.ts';

/** No catalog/Profile authorization exists yet. Hashes are identities, not grants. */
export function privateAgentDraft(input: unknown, visibility: unknown) {
  const definition = parseAgentBuildDefinition(input);
  ensure(visibility === 'private' && !definition.modelSelection &&
    !definition.profileRef && !definition.environmentRef && !definition.outputContractRef &&
    !definition.runtimeSelection && definition.skillRefs.length === 0 &&
    definition.requestedCapabilities.length === 0,
  'Only unconfigured private Agent drafts are supported; dependency authorization is unavailable.',
  400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
  return { agentDefinition: definition, definitionDigest: digestAgentBuildDefinition(definition) };
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
  const allowed = new Set(['mode', 'buildId', 'currentVersionId', 'problemId', 'title', 'visibility',
    mode === 'agent' ? 'agentDefinition' : 'workflow']);
  ensure(Object.keys(body).every(key => allowed.has(key)) &&
    typeof body.problemId === 'string' && body.problemId.length > 0 && body.problemId.length <= 100 &&
    typeof body.title === 'string' && body.title.trim().length > 0 && body.title.length <= 80 &&
    (body.visibility === 'public' || body.visibility === 'private') &&
    ['buildId', 'currentVersionId'].every(key => !Object.hasOwn(body, key) ||
      (typeof body[key] === 'string' && body[key].length > 0 && body[key].length <= 100)) &&
    (body.buildId !== undefined || body.currentVersionId === undefined),
  'Invalid Build fields.', 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
  return mode;
}
