import { AppError, ERROR_CODES, ensure } from '../shared/errors.ts';
import { CREATION_SKILL_LIMITS } from '../shared/creation-skill.ts';
import { parseCommunityDefinition, type InstructionSkillDefinition } from './community/contracts.ts';

export function assertCreationSkillDefinition(input: unknown): InstructionSkillDefinition {
  const definition = parseCommunityDefinition(input);
  ensure(definition.kind === 'instruction-skill' && definition.references.length === 0 && definition.dependencies.length === 0,
    'Only self-contained instruction Skills are supported. External references and executable dependencies are not loaded.',
    400, ERROR_CODES.COMPONENT_UNSUPPORTED_CAPABILITY);
  ensure(definition.instruction.trim().length > 0 && new TextEncoder().encode(definition.instruction).byteLength <= CREATION_SKILL_LIMITS.maxFileBytes &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\uD800-\uDFFF]/u.test(definition.instruction),
  'Skill content must be valid text within 64 KiB.', 400, ERROR_CODES.COMPONENT_DEFINITION_INVALID);
  return definition;
}

/** Read metadata, not YAML objects/tags or instructions to install/execute anything. */
function metadata(frontmatter: string, key: string): string | undefined {
  const match = frontmatter.match(new RegExp(`^${key}:\\s*(.*)$`, 'm'));
  if (!match) return undefined;
  const value = match[1].trim();
  if (/^[>|][-+]?$/u.test(value)) {
    const rest = frontmatter.slice((match.index ?? 0) + match[0].length);
    return rest.match(/^(?:\r?\n[ \t]+[^\n]*)+/u)?.[0].trim().replace(/\s+/gu, ' ');
  }
  return value.replace(/^(['"])(.*)\1$/u, '$2');
}

export function parseCreationSkillFile(fileName: string, content: string): InstructionSkillDefinition {
  ensure(fileName.length > 0 && fileName.length <= 180 && !/[\\/\u0000-\u001f]/u.test(fileName) && /\.(?:md|markdown|txt|json)$/iu.test(fileName),
    'Upload a Markdown, text or instruction-skill JSON file.', 400, ERROR_CODES.COMPONENT_ATTACHMENT_INVALID);
  ensure(new TextEncoder().encode(content).byteLength <= CREATION_SKILL_LIMITS.maxFileBytes,
    'Skill file exceeds 64 KiB.', 413, ERROR_CODES.REQUEST_BODY_TOO_LARGE);
  let text = content.replace(/^\uFEFF/u, '').replace(/\r\n/g, '\n').trim();
  if (/\.json$/iu.test(fileName)) {
    let parsed: unknown;
    try { parsed = JSON.parse(text); }
    catch { throw new AppError('Invalid Skill JSON.', 400, ERROR_CODES.COMPONENT_DEFINITION_INVALID); }
    return assertCreationSkillDefinition(parsed);
  }
  let name = fileName.replace(/\.[^.]+$/, '');
  let description = '';
  if (text.startsWith('---\n')) {
    const end = text.indexOf('\n---', 4);
    ensure(end >= 0 && /^(?:\n|$)/u.test(text.slice(end + 4)),
      'Skill front matter is not closed.', 400, ERROR_CODES.COMPONENT_DEFINITION_INVALID);
    const header = text.slice(4, end);
    name = metadata(header, 'name') || name;
    description = metadata(header, 'description') || '';
    text = text.slice(end + 4).trim();
  }
  return assertCreationSkillDefinition({
    formatVersion: 1, kind: 'instruction-skill', name,
    description: description || text.replace(/^#+\s*/gmu, '').slice(0, 240),
    instruction: text, references: [], dependencies: [], examples: [], license: null,
    provenance: { sourceType: 'third-party', declaration: 'Privately imported by the owner; no public license or execution grant is implied.' },
  });
}
