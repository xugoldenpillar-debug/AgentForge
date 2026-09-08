import type { Repository } from '../../shared/types.ts';
import type { AgentBuildSkillRef } from '../../shared/agent-build-contract.ts';
import { CREATION_SKILL_LIMITS, type CreationSkillView } from '../../shared/creation-skill.ts';
import { AppError, ensure, ERROR_CODES } from '../../shared/errors.ts';
import { assertCreationSkillDefinition, parseCreationSkillFile } from '../../lib/creation-skill-file.ts';
import { CommunityService, digestCommunityDefinition } from '../community-service.ts';

export interface ResolvedCreationSkill extends CreationSkillView { instruction: string }

/** Private immutable component versions are the sole source of Skill text. */
export async function resolveCreationSkills(repo: Repository, ownerId: string, refs: readonly AgentBuildSkillRef[]): Promise<ResolvedCreationSkill[]> {
  ensure(refs.length <= CREATION_SKILL_LIMITS.maxSkills && new Set(refs.map((ref) => ref.componentId)).size === refs.length,
    'Invalid Skill selection.', 400, ERROR_CODES.COMPONENT_DEFINITION_INVALID);
  const skills: ResolvedCreationSkill[] = [];
  let bytes = 0;
  for (const ref of refs) {
    const [version] = await repo.read('componentVersions', { id: ref.versionId, componentId: ref.componentId, ownerId });
    const [component] = await repo.read('components', { id: ref.componentId, ownerId });
    ensure(version && component, 'A selected Skill is unavailable to this owner.', 404, ERROR_CODES.RESOURCE_NOT_FOUND);
    const definition = assertCreationSkillDefinition(version.definition);
    ensure(ref.kind === 'declarative' && version.definitionDigest === ref.contentDigest && digestCommunityDefinition(definition) === ref.contentDigest,
      'The selected Skill version failed integrity validation.', 409, ERROR_CODES.RUNTIME_POLICY_DENIED);
    const releases = await repo.read('componentReleases', { componentVersionId: version.id });
    ensure(!releases.some((release) => release.status === 'revoked'),
      'A selected Skill version has been revoked.', 409, ERROR_CODES.RUNTIME_POLICY_DENIED);
    const instructionBytes = new TextEncoder().encode(definition.instruction).byteLength;
    bytes += instructionBytes;
    ensure(bytes <= CREATION_SKILL_LIMITS.maxTotalBytes,
      'Selected Skill instructions exceed 64 KiB in total.', 400, ERROR_CODES.COMPONENT_DEFINITION_INVALID);
    skills.push({ ref: { ...ref }, name: definition.name, description: definition.description, preview: definition.instruction.slice(0, 1200),
      instructionBytes, instruction: definition.instruction, versionNumber: version.versionNumber });
  }
  return skills;
}

function view(skill: ResolvedCreationSkill): CreationSkillView {
  const { instruction: _instruction, ...metadata } = skill;
  return metadata;
}

export async function listCreationSkills(repo: Repository, ownerId: string): Promise<CreationSkillView[]> {
  const versions = await repo.read('componentVersions', { ownerId });
  const output: CreationSkillView[] = [];
  for (const version of versions.sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
    try {
      const [skill] = await resolveCreationSkills(repo, ownerId, [{ kind: 'declarative', componentId: version.componentId,
        versionId: version.id, contentDigest: version.definitionDigest }]);
      output.push(view(skill));
    } catch (error) {
      // Other component kinds, missing/revoked releases and unsupported dependencies are not selectable Skills.
      if (!(error instanceof AppError)) throw error;
    }
  }
  return output;
}

export async function importCreationSkill(repo: Repository, ownerId: string, body: Record<string, unknown>): Promise<CreationSkillView> {
  ensure(Object.keys(body).every((key) => ['fileName', 'content'].includes(key)) && typeof body.fileName === 'string' && typeof body.content === 'string',
    'Invalid Skill upload fields.', 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
  const definition = parseCreationSkillFile(body.fileName, body.content);
  return repo.transaction(async (tx) => {
    const digest = digestCommunityDefinition(definition);
    const [existing] = await tx.read('componentVersions', { ownerId, definitionDigest: digest });
    let version = existing;
    if (!version) {
      const library = new CommunityService(tx);
      const component = await library.createDraft(ownerId, { definition });
      version = await library.freezeVersion(ownerId, { componentId: component.id, expectedRevision: component.draftRevision });
    }
    const [skill] = await resolveCreationSkills(tx, ownerId, [{ kind: 'declarative', componentId: version.componentId,
      versionId: version.id, contentDigest: version.definitionDigest }]);
    return view(skill);
  });
}
