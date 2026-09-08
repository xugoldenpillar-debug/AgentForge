import type { AgentBuildSkillRef } from './agent-build-contract.ts';

export const CREATION_SKILL_LIMITS = Object.freeze({ maxFileBytes: 64 * 1024, maxTotalBytes: 64 * 1024, maxSkills: 16 });

export interface CreationSkillView {
  ref: AgentBuildSkillRef;
  name: string;
  description: string;
  preview: string;
  instructionBytes: number;
  versionNumber: number;
}
