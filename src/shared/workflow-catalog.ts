import type { SkillId, ToolId } from './workflow-types.ts';

export const SKILL_IDS: readonly SkillId[] = [
  'structured',
  'reflection',
  'concise',
  'extract',
  'safety',
  'retry'
];

export const TOOL_IDS: readonly ToolId[] = [
  'calculator',
  'json-validator',
  'text-search',
  'date-parser',
  'string-matcher'
];

export function hasSkillId(value: unknown): value is SkillId {
  return typeof value === 'string' && (SKILL_IDS as readonly string[]).includes(value);
}

export function hasToolId(value: unknown): value is ToolId {
  return typeof value === 'string' && (TOOL_IDS as readonly string[]).includes(value);
}
