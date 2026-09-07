import type { AgentBuildDefinition } from './agent-build-contract.ts';
import type { ErrorCode } from './error-core.ts';
import type { Config, NodeKind, SkillId, ToolId, Workflow, WorkflowEdge, WorkflowNode } from './workflow-types.ts';
export type { Config, NodeKind, SkillId, ToolId, Workflow, WorkflowEdge, WorkflowNode } from './workflow-types.ts';
import type {
  CancellationReason,
  EvaluationAttemptState,
  EvaluationBudgetKind,
  EvaluationBudgetReservationState,
  EvaluationInputSnapshot,
  JsonObject,
  EvaluationInvocationState,
  EvaluationJobState,
  EvaluationOutboxEventKind,
  EvaluationPurpose,
  UsageChargeability,
  UsageCertainty,
} from './evaluation-types.ts';
export type Category = 'normal' | 'edge' | 'adversarial' | 'security';
export type Tier = 'demo' | 'byok' | 'verified';
export type RunKind = 'public' | 'hidden' | 'failure';
export interface Constraints { tokenBudget: number; toolCallLimit: number; maxCost: number; maxLatencyMs: number }
export interface TestCase { id: string; problemId: string; visibility: 'public' | 'hidden'; category: Category; input: string; expected: unknown }
export type JudgeId = 'json' | 'enum' | 'secret' | 'exact' | 'contains';
export interface Problem {
  id: string; slug: string; title: string; description: string; mission: string; goal: string;
  why: string; category: string; difficulty: string; tags: string[]; judge: JudgeId;
  constraints: Constraints; reward: number; worldBoss: boolean; status: 'active' | 'pending';
  authorId: string | null; createdAt: string;
}
export interface User {
  id: string; name: string; email: string; emailVerified: boolean; image: string | null;
  createdAt: string; updatedAt: string; elo: number; reputation: number; isSeed: boolean;
  piRuntimeAccess?: 'applied' | 'invited' | null;
}
export interface Build { id: string; problemId: string; userId: string; title: string; visibility: 'public' | 'private'; currentVersionId: string; parentBuildId: string | null; createdAt: string; updatedAt: string }
export interface BuildVersion {
  id: string;
  buildId: string;
  revision: number;
  title: string;
  visibility: 'public' | 'private';
  createdAt: string;
  /** Missing only in legacy in-memory fixtures; PostgreSQL defaults to workflow. */
  mode?: 'workflow' | 'agent';
  agentDefinition?: AgentBuildDefinition | null;
  definitionDigest?: string | null;
}
export interface StoredNode extends WorkflowNode { versionId: string }
export interface StoredEdge extends WorkflowEdge { versionId: string }
export interface Metrics { inputTokens: number; outputTokens: number; reasoningTokens: number; toolCalls: number; latency: number; cost: number | null; estimated: boolean }
export interface Trace { nodeId: string; kind: NodeKind; label: string; state: 'running' | 'done' | 'failed'; tokens?: number; latency?: number }
export interface CaseResult extends Metrics { caseId: string; category: Category; passed: boolean; secure: boolean; failureType: string | null; input?: string; expected?: unknown; actual?: string; trace?: Trace[] }
export interface Score { total: number; accuracy: number; robustness: number; security: number; efficiency: number; elegance: number; grades: Record<string, string> }
export interface RunSummary { passed: number; total: number; failures: Record<string, number>; metrics: Metrics; score: Score; tier: Tier }
export interface Run {
  id: string; buildId: string; versionId: string; problemId: string; userId: string;
  kind: RunKind; tier: Tier; status: 'running' | 'completed' | 'failed';
  summary: RunSummary | null; createdAt: string;
  runtimeKind?: 'dag' | 'pi' | null;
  adapterVersion?: string | null;
  policyVersion?: string | null;
}
export interface RunCase extends CaseResult { id: string; runId: string }
export interface Submission { id: string; runId: string; buildId: string; versionId: string; userId: string; problemId: string; tier: Tier; score: number; accuracy: number; robustness: number; security: number; efficiency: number; elegance: number; tokens: number; cost: number | null; latency: number; nodes: number; model: string; createdAt: string }
export interface Credential { id: string; userId: string; name: string; baseUrl: string; modelId: string; ciphertext: string; lastFour: string; inputPrice: number | null; outputPrice: number | null; createdAt: string }
export interface FailureCase { id: string; problemId: string; buildId: string; versionId: string; userId: string; input: string; reason: string; fingerprint: string; status: 'verified' | 'pending' | 'not_reproduced'; tier: Tier; actual: string | null; createdAt: string }
export interface Reputation { id: string; userId: string; points: number; reason: string; referenceId: string; createdAt: string }
export interface Badge { id: string; name: string; description: string; icon: string }
export interface UserBadge { id: string; userId: string; badgeId: string; createdAt: string }
export interface ForkRelation { id: string; parentBuildId: string; childBuildId: string; userId: string; createdAt: string; sourceVersionId?: string | null }
export type EvaluationAssociationKind = 'competitive-run' | 'self-test-run' | 'component-evaluation';
export type EvaluationOutboxStatus = 'pending' | 'leased' | 'published' | 'dead-letter';
export interface EvaluationJobRow {
  id: string;
  userId: string;
  purpose: EvaluationPurpose;
  associationKind: EvaluationAssociationKind;
  businessRecordId: string;
  competitiveRunId: string | null;
  associationVisibility: 'public' | 'hidden' | null;
  snapshot: EvaluationInputSnapshot;
  snapshotDigest: string;
  idempotencyScope: string;
  idempotencyKey: string;
  requestDigest: string;
  budgetReservationId: string | null;
  state: EvaluationJobState;
  stateVersion: number;
  executionToken: string | null;
  cancellationReason: CancellationReason | null;
  cancellationRequestedAt: string | null;
  completion: { readonly evidence: 'complete' | 'partial'; readonly summary?: JsonObject } | null;
  failure: { readonly code: string; readonly retryable: boolean } | null;
  acceptedAt: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}
export interface EvaluationAttemptRow {
  id: string;
  jobId: string;
  attemptNumber: number;
  deliveryKey: string;
  state: EvaluationAttemptState;
  stateVersion: number;
  workerId: string | null;
  workerLeaseId: string | null;
  leaseExpiresAt: string | null;
  heartbeatAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface EvaluationInvocationRow {
  id: string;
  jobId: string;
  attemptId: string;
  invocationIndex: number;
  requestId: string;
  idempotencyKey: string;
  providerScope: string;
  providerId: string;
  modelId: string;
  requestDigest: string;
  state: EvaluationInvocationState;
  providerRequestId: string | null;
  usageRecordId: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}
export interface EvaluationUsageRecordRow {
  id: string;
  jobId: string;
  attemptId: string;
  invocationId: string | null;
  certainty: UsageCertainty;
  chargeability: UsageChargeability;
  inputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  toolCalls: number | null;
  latencyMs: number | null;
  costUsd: number | null;
  providerRequestId: string | null;
  evidenceRef: string | null;
  recordedAt: string;
}
export interface EvaluationIdempotencyKeyRow {
  id: string;
  scope: string;
  key: string;
  requestDigest: string;
  jobId: string;
  createdAt: string;
  expiresAt: string | null;
}
export interface EvaluationBudgetReservationRow {
  id: string;
  jobId: string;
  purpose: EvaluationPurpose;
  kind: EvaluationBudgetKind;
  state: EvaluationBudgetReservationState;
  usageCertainty: UsageCertainty;
  chargeability: UsageChargeability;
  reservedInputTokens: number | null;
  reservedOutputTokens: number | null;
  reservedToolCalls: number | null;
  reservedExecutionMs: number | null;
  reservedCostUsd: number | null;
  settledInputTokens: number | null;
  settledOutputTokens: number | null;
  settledToolCalls: number | null;
  settledExecutionMs: number | null;
  settledCostUsd: number | null;
  createdAt: string;
  updatedAt: string;
}
export interface EvaluationOutboxRow {
  id: string;
  jobId: string;
  aggregateId: string;
  version: number;
  kind: EvaluationOutboxEventKind;
  occurredAt: string;
  requestDigest: string;
  payload: JsonObject;
  dedupeKey: string;
  status: EvaluationOutboxStatus;
  availableAt: string;
  leaseToken: string | null;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  deliveryAttempts: number;
  lastErrorCode: string | null;
  lastErrorAt: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface CatalogSkill { id: SkillId; name: string; description: string; effect: string; icon: string; author: string }
export interface CatalogTool { id: ToolId; name: string; description: string; icon: string }

export type ComponentKind = 'workflow-recipe' | 'instruction-skill';
export type ComponentVisibility = 'private' | 'unlisted' | 'public';
export type ComponentTestRunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type PublicationRequestStatus = 'submitted' | 'in_review' | 'approved' | 'rejected' | 'withdrawn';
export type PublicationReviewDecision = 'approved' | 'rejected';
export type ComponentReleaseStatus = 'active' | 'withdrawn' | 'deprecated' | 'revoked';
export type TestSuiteVisibility = 'private' | 'public';
export type ExtensionApplicationStatus = 'submitted' | 'in_review' | 'approved' | 'rejected' | 'withdrawn';

export interface Component {
  id: string; ownerId: string; name: string; description: string; kind: ComponentKind;
  visibility: ComponentVisibility; draftRevision: number; draftDefinition: unknown;
  currentVersionId: string | null; createdAt: string; updatedAt: string
}
export interface ComponentVersion {
  id: string; ownerId: string; componentId: string; versionNumber: number; contractVersion: number;
  definition: unknown; definitionDigest: string; dependencies: unknown; publicMaterial: unknown;
  licenseSpdx: string | null; provenance: unknown; frozenAt: string; createdAt: string
}
export interface Attachment {
  id: string; ownerId: string; componentVersionId: string; path: string; mediaType: string;
  sizeBytes: number; sha256: string; storageKey: string; visibility: 'private' | 'public'; createdAt: string
}
export interface ComponentAttachmentContent {
  attachmentId: string;
  content: string;
}
export interface ComponentTestSuite {
  id: string; ownerId: string; componentId: string; name: string; description: string;
  visibility: TestSuiteVisibility; currentVersionId: string | null; createdAt: string; updatedAt: string
}
export interface ComponentTestSuiteVersion {
  id: string; ownerId: string; testSuiteId: string; versionNumber: number; cases: unknown; casesDigest: string;
  visibility: TestSuiteVisibility; frozenAt: string; createdAt: string
}
export interface ComponentTestRun {
  id: string; ownerId: string; componentVersionId: string; testSuiteVersionId: string;
  evaluationJobId: string | null; credentialId: string; modelId: string | null;
  runtimeKind: string; executionSource: string | null; idempotencyKey: string;
  constraints: unknown; usage: unknown | null; resultSummary: unknown | null;
  status: ComponentTestRunStatus; consentVersion: string | null; requestDigest: string;
  failureReason: string | null; createdAt: string; startedAt: string | null; completedAt: string | null
}
export interface PublicationRequest {
  id: string; componentVersionId: string; requesterId: string; status: PublicationRequestStatus;
  requestRevision: number; publicMaterialSnapshot: unknown; declaration: string;
  createdAt: string; updatedAt: string; decidedAt: string | null
}
export interface PublicationReview {
  id: string; publicationRequestId: string; reviewerId: string; decision: PublicationReviewDecision;
  reason: string; evidence: unknown; createdAt: string
}
export interface ComponentRelease {
  id: string; componentVersionId: string; publicationRequestId: string; status: ComponentReleaseStatus;
  releasedAt: string; disabledReason: string | null; createdAt: string
}
export interface UsageReference {
  id: string; userId: string; buildVersionId: string; componentVersionId: string;
  expansionDigest: string; createdAt: string
}

export interface ExtensionApplication {
  id: string; ownerId: string; extensionType: string; source: string;
  permissionDeclaration: string; materials: unknown; status: ExtensionApplicationStatus;
  createdAt: string; updatedAt: string; decidedAt: string | null
}

export type CommunityAuditAction =
  | 'component.created'
  | 'component.draft.updated'
  | 'component.version.frozen'
  | 'publication.requested'
  | 'publication.reviewed';

export interface CommunityAuditEventRow {
  id: string;
  action: CommunityAuditAction;
  actorId: string;
  componentId: string;
  componentVersionId: string | null;
  publicationRequestId: string | null;
  occurredAt: string;
  metadata: Readonly<Record<string, string | number | boolean | null>>;
}

export type TestSuite = ComponentTestSuite;
export type TestSuiteVersion = ComponentTestSuiteVersion;
export type TestRun = ComponentTestRun;
export type Review = PublicationReview;
export type Release = ComponentRelease;
export interface Tables {
  users: User; problems: Problem; testCases: TestCase; builds: Build; buildVersions: BuildVersion;
  workflowNodes: StoredNode; workflowEdges: StoredEdge; skills: CatalogSkill; tools: CatalogTool;
  buildSkills: {id: string; versionId: string; skillId: SkillId}; buildTools: {id: string; versionId: string; toolId: ToolId};
  runs: Run; runCases: RunCase; submissions: Submission; credentials: Credential;
  failureCases: FailureCase; reputations: Reputation; badges: Badge; userBadges: UserBadge; forkRelations: ForkRelation;
  components: Component; componentVersions: ComponentVersion; attachments: Attachment;
  componentAttachmentContents: ComponentAttachmentContent;
  componentTestSuites: ComponentTestSuite; componentTestSuiteVersions: ComponentTestSuiteVersion;
  componentTestRuns: ComponentTestRun; publicationRequests: PublicationRequest;
  publicationReviews: PublicationReview; componentReleases: ComponentRelease; usageReferences: UsageReference;
  extensionApplications: ExtensionApplication; communityAuditEvents: CommunityAuditEventRow;
  evaluationJobs: EvaluationJobRow; evaluationAttempts: EvaluationAttemptRow; evaluationInvocations: EvaluationInvocationRow; evaluationUsageRecords: EvaluationUsageRecordRow; evaluationIdempotencyKeys: EvaluationIdempotencyKeyRow; evaluationBudgetReservations: EvaluationBudgetReservationRow; evaluationOutbox: EvaluationOutboxRow;
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
export type RunEvent = { type: 'start'; total: number; tier: Tier } | { type: 'trace'; caseNumber: number; trace: Trace } | { type: 'case'; result: CaseResult } | { type: 'progress'; completed: number; total: number } | { type: 'complete'; runId: string; summary: RunSummary; submissionId: string | null } | { type: 'error'; code?: ErrorCode; message: string };
