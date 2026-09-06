export type NodeKind = 'input' | 'prompt' | 'model' | 'skill' | 'tool' | 'validator' | 'output';
export type SkillId = 'structured' | 'reflection' | 'concise' | 'extract' | 'safety' | 'retry';
export type ToolId = 'calculator' | 'json-validator' | 'text-search' | 'date-parser' | 'string-matcher';

export type Config = {
  systemPrompt?: string;
  userTemplate?: string;
  modelId?: string;
  credentialId?: string;
  maxTokens?: number;
  temperature?: number;
  skillId?: SkillId;
  toolId?: ToolId;
  schema?: Record<string, unknown>;
  maxLength?: number;
  expression?: string;
  query?: string;
  match?: string;
  mode?: 'contains' | 'exact';
  format?: 'json' | 'enum' | 'text';
  values?: string[];
};

export interface WorkflowNode {
  id: string;
  kind: NodeKind;
  label: string;
  x: number;
  y: number;
  config: Config;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
}

export interface Workflow {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}
