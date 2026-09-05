export type NodeKind = 'input' | 'prompt' | 'model' | 'skill' | 'tool' | 'validator' | 'output';
export type SkillId = 'structured' | 'reflection' | 'concise' | 'extract' | 'safety' | 'retry';
export type ToolId = 'calculator' | 'json-validator' | 'text-search' | 'date-parser' | 'string-matcher';
export type Category = 'normal' | 'edge' | 'adversarial' | 'security';
export type Tier = 'demo' | 'byok' | 'verified';
export type RunKind = 'public' | 'hidden' | 'failure';
export type Config = {
  systemPrompt?: string; userTemplate?: string; modelId?: string; credentialId?: string;
  maxTokens?: number; temperature?: number; skillId?: SkillId; toolId?: ToolId;
  schema?: Record<string, unknown>; maxLength?: number; expression?: string; query?: string;
  match?: string; mode?: 'contains' | 'exact'; format?: 'json' | 'enum' | 'text'; values?: string[];
};
export interface WorkflowNode { id: string; kind: NodeKind; label: string; x: number; y: number; config: Config }
export interface WorkflowEdge { id: string; source: string; target: string }
export interface Workflow { nodes: WorkflowNode[]; edges: WorkflowEdge[] }
export interface Constraints { tokenBudget: number; toolCallLimit: number; maxCost: number; maxLatencyMs: number }
export interface TestCase { id: string; problemId: string; visibility: 'public' | 'hidden'; category: Category; input: string; expected: unknown }
export type JudgeId = 'json' | 'enum' | 'secret' | 'exact' | 'contains';
export interface Problem {
  id: string; slug: string; title: string; description: string; mission: string; goal: string;
  why: string; category: string; difficulty: string; tags: string[]; judge: JudgeId;
  constraints: Constraints; reward: number; worldBoss: boolean; status: 'active' | 'pending';
  authorId: string | null; createdAt: string;
}
export interface User { id: string; name: string; email: string; emailVerified: boolean; image: string | null; createdAt: string; updatedAt: string; elo: number; reputation: number; isSeed: boolean }
export interface Build { id: string; problemId: string; userId: string; title: string; visibility: 'public' | 'private'; currentVersionId: string; parentBuildId: string | null; createdAt: string; updatedAt: string }
export interface BuildVersion { id: string; buildId: string; revision: number; title: string; visibility: 'public' | 'private'; createdAt: string }
export interface StoredNode extends WorkflowNode { versionId: string }
export interface StoredEdge extends WorkflowEdge { versionId: string }
export interface Metrics { inputTokens: number; outputTokens: number; reasoningTokens: number; toolCalls: number; latency: number; cost: number | null; estimated: boolean }
export interface Trace { nodeId: string; kind: NodeKind; label: string; state: 'running' | 'done' | 'failed'; tokens?: number; latency?: number }
export interface CaseResult extends Metrics { caseId: string; category: Category; passed: boolean; secure: boolean; failureType: string | null; input?: string; expected?: unknown; actual?: string; trace?: Trace[] }
export interface Score { total: number; accuracy: number; robustness: number; security: number; efficiency: number; elegance: number; grades: Record<string, string> }
export interface RunSummary { passed: number; total: number; failures: Record<string, number>; metrics: Metrics; score: Score; tier: Tier }
export interface Run { id: string; buildId: string; versionId: string; problemId: string; userId: string; kind: RunKind; tier: Tier; status: 'running' | 'completed' | 'failed'; summary: RunSummary | null; createdAt: string }
export interface RunCase extends CaseResult { id: string; runId: string }
export interface Submission { id: string; runId: string; buildId: string; versionId: string; userId: string; problemId: string; tier: Tier; score: number; accuracy: number; robustness: number; security: number; efficiency: number; elegance: number; tokens: number; cost: number | null; latency: number; nodes: number; model: string; createdAt: string }
export interface Credential { id: string; userId: string; name: string; baseUrl: string; modelId: string; ciphertext: string; lastFour: string; inputPrice: number | null; outputPrice: number | null; createdAt: string }
export interface FailureCase { id: string; problemId: string; buildId: string; versionId: string; userId: string; input: string; reason: string; fingerprint: string; status: 'verified' | 'pending' | 'not_reproduced'; tier: Tier; actual: string | null; createdAt: string }
export interface Reputation { id: string; userId: string; points: number; reason: string; referenceId: string; createdAt: string }
export interface Badge { id: string; name: string; description: string; icon: string }
export interface UserBadge { id: string; userId: string; badgeId: string; createdAt: string }
export interface ForkRelation { id: string; parentBuildId: string; childBuildId: string; userId: string; createdAt: string }
export interface CatalogSkill { id: SkillId; name: string; description: string; effect: string; icon: string; author: string }
export interface CatalogTool { id: ToolId; name: string; description: string; icon: string }
export interface Tables {
  users: User; problems: Problem; testCases: TestCase; builds: Build; buildVersions: BuildVersion;
  workflowNodes: StoredNode; workflowEdges: StoredEdge; skills: CatalogSkill; tools: CatalogTool;
  buildSkills: {id: string; versionId: string; skillId: SkillId}; buildTools: {id: string; versionId: string; toolId: ToolId};
  runs: Run; runCases: RunCase; submissions: Submission; credentials: Credential;
  failureCases: FailureCase; reputations: Reputation; badges: Badge; userBadges: UserBadge; forkRelations: ForkRelation;
}
export type TableName = keyof Tables;
export interface Repository {
  read<K extends TableName>(table: K, where?: Partial<Tables[K]>): Promise<Tables[K][]>;
  insert<K extends TableName>(table: K, rows: Tables[K][]): Promise<void>;
  update<K extends TableName>(table: K, where: Partial<Tables[K]>, values: Partial<Tables[K]>): Promise<Tables[K][]>;
  remove<K extends TableName>(table: K, where: Partial<Tables[K]>): Promise<void>;
  transaction<T>(fn: (tx: Repository) => Promise<T>): Promise<T>;
  rateLimit(key: string, limit: number, windowMs: number): Promise<boolean>;
  lease(key: string, ttlMs: number): Promise<string | null>;
  release(key: string, token: string): Promise<void>;
}
export type RunEvent = { type: 'start'; total: number; tier: Tier } | { type: 'trace'; caseNumber: number; trace: Trace } | { type: 'case'; result: CaseResult } | { type: 'progress'; completed: number; total: number } | { type: 'complete'; runId: string; summary: RunSummary; submissionId: string | null } | { type: 'error'; message: string };
