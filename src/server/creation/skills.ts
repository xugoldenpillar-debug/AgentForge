import { ensure, ERROR_CODES } from '../../shared/errors.ts';
import type { AgentBuildSkillRef } from '../../shared/agent-build-contract.ts';
import type { Repository } from '../../shared/types.ts';
import { parseCommunityDefinition } from '../../lib/community/contracts.ts';

export interface ResolvedCreationSkill {
  readonly componentId: string;
  readonly versionId: string;
  readonly contentDigest: string;
  readonly name: string;
  readonly description: string;
  readonly instruction: string;
}

const MAX_CREATION_SKILL_PROMPT_CHARS = 48_000;

/**
 * Creation runs only load reviewed, immutable instruction Skills. Workflow
 * recipes, private drafts, withdrawn releases and digest-mismatched references
 * are rejected. This keeps the public challenge lane declarative and makes the
 * exact loaded Skill set reproducible from the Build version.
 */
export async function resolveCreationSkills(
  repository: Repository,
  refs: readonly AgentBuildSkillRef[],
): Promise<readonly ResolvedCreationSkill[]> {
  const resolved: ResolvedCreationSkill[] = [];
  let promptChars = 0;

  for (const ref of refs) {
    const version = (await repository.read('componentVersions', {
      id: ref.versionId,
      componentId: ref.componentId,
    }))[0];
    ensure(version, 'A selected Skill version does not exist.', 409, ERROR_CODES.RUNTIME_POLICY_DENIED);
    ensure(version.definitionDigest === ref.contentDigest,
      'A selected Skill digest does not match the pinned Build reference.', 409, ERROR_CODES.RUNTIME_POLICY_DENIED);
    const release = (await repository.read('componentReleases', {
      componentVersionId: version.id,
      status: 'active',
    }))[0];
    ensure(release, 'Creation runs only accept reviewed public Skill releases.', 409, ERROR_CODES.RUNTIME_POLICY_DENIED);

    const definition = parseCommunityDefinition(version.definition);
    ensure(definition.kind === 'instruction-skill',
      'Creation runs only accept declarative instruction Skills.', 409, ERROR_CODES.RUNTIME_POLICY_DENIED);
    promptChars += definition.instruction.length;
    ensure(promptChars <= MAX_CREATION_SKILL_PROMPT_CHARS,
      'The selected Skill instructions exceed the creation prompt budget.', 409, ERROR_CODES.RUNTIME_POLICY_DENIED);

    resolved.push(Object.freeze({
      componentId: ref.componentId,
      versionId: ref.versionId,
      contentDigest: ref.contentDigest,
      name: definition.name,
      description: definition.description,
      instruction: definition.instruction,
    }));
  }

  return Object.freeze(resolved);
}
