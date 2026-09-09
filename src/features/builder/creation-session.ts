import type { AgentBuildSkillRef } from '../../shared/agent-build-contract.ts';

export interface PersistedCreationSession {
  challengeVersionId?: string;
  credentialId?: string;
  buildId?: string;
  buildVersionId?: string;
  runId?: string;
  publicationId?: string;
  entryId?: string;
  draftTitle?: string;
  draftInstructions?: string;
  draftSkillRefs?: readonly AgentBuildSkillRef[];
}
const ID_FIELDS = ['challengeVersionId', 'credentialId', 'buildId', 'buildVersionId', 'runId', 'publicationId', 'entryId'] as const;
const validId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$/u.test(value);

/** Storage is untrusted. Explicit projection also prevents API keys from ever being persisted. */
export function parseCreationSession(raw: string | null): PersistedCreationSession {
  try {
    if (!raw || raw.length > 32_000) return {};
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
    const input = data as Record<string, unknown>;
    const result: PersistedCreationSession = {};
    for (const key of ID_FIELDS) if (validId(input[key])) result[key] = input[key];
    if (typeof input.draftTitle === 'string' && input.draftTitle.length <= 80) result.draftTitle = input.draftTitle;
    if (typeof input.draftInstructions === 'string' && input.draftInstructions.length <= 8000) result.draftInstructions = input.draftInstructions;
    if (Array.isArray(input.draftSkillRefs) && input.draftSkillRefs.length <= 16 && input.draftSkillRefs.every((ref) =>
      ref && ref.kind === 'declarative' && validId(ref.componentId) && validId(ref.versionId) &&
      typeof ref.contentDigest === 'string' && /^sha256:[a-f0-9]{64}$/u.test(ref.contentDigest))) {
      result.draftSkillRefs = input.draftSkillRefs.map(({ componentId, versionId, contentDigest }) => ({ kind: 'declarative', componentId, versionId, contentDigest }));
    }
    return result;
  } catch { return {}; }
}

export function draftMatchesBuild(draft: { title: string; instructions: string; skillRefs: readonly AgentBuildSkillRef[] },
  saved: { title: string; instructions: string; skillRefs: readonly AgentBuildSkillRef[] } | null): boolean {
  return saved !== null && draft.title.trim() === saved.title && draft.instructions.trim() === saved.instructions &&
    JSON.stringify(draft.skillRefs) === JSON.stringify(saved.skillRefs);
}
