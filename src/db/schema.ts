import { sql } from "drizzle-orm";
import { pgTable, text, boolean, integer, doublePrecision, jsonb, timestamp, primaryKey, uniqueIndex, index, check } from "drizzle-orm/pg-core";

export const user = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  elo: integer("elo").notNull().default(1000),
  reputation: integer("reputation").notNull().default(0),
  isSeed: boolean("is_seed").notNull().default(false),
  piRuntimeAccess: text("pi_runtime_access"),
});

export const session = pgTable("sessions", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable("accounts", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true, mode: "date" }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true, mode: "date" }),
  scope: text("scope"),
  password: text("password"),
  issuer: text("issuer"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

export const verification = pgTable("verifications", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

export const problems = pgTable("problems", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  mission: text("mission").notNull(),
  goal: text("goal").notNull(),
  why: text("why").notNull(),
  category: text("category").notNull(),
  difficulty: text("difficulty").notNull(),
  tags: jsonb("tags").notNull(),
  judge: text("judge").notNull(),
  constraints: jsonb("constraints").notNull(),
  reward: integer("reward").notNull().default(0),
  worldBoss: boolean("world_boss").notNull().default(false),
  status: text("status").notNull(),
  authorId: text("author_id").references(() => user.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

export const testCases = pgTable("test_cases", {
  id: text("id").primaryKey(),
  problemId: text("problem_id").notNull().references(() => problems.id, { onDelete: "cascade" }),
  visibility: text("visibility").notNull(),
  category: text("category").notNull(),
  input: text("input").notNull(),
  expected: jsonb("expected").notNull(),
});

export const builds = pgTable("builds", {
  id: text("id").primaryKey(),
  problemId: text("problem_id").notNull().references(() => problems.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  visibility: text("visibility").notNull(),
  currentVersionId: text("current_version_id").notNull(),
  parentBuildId: text("parent_build_id"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

export const buildVersions = pgTable("build_versions", {
  id: text("id").primaryKey(),
  buildId: text("build_id").notNull().references(() => builds.id, { onDelete: "cascade" }),
  mode: text("mode").notNull().default("workflow"),
  agentDefinition: jsonb("agent_definition"),
  definitionDigest: text("definition_digest"),
  revision: integer("revision").notNull(),
  title: text("title").notNull(),
  visibility: text("visibility").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (t) => [uniqueIndex("build_versions_unique_0").on(t.buildId, t.revision),
  check("build_versions_mode_payload", sql`(${t.mode} = 'workflow' AND ${t.agentDefinition} IS NULL AND ${t.definitionDigest} IS NULL) OR (${t.mode} = 'agent' AND ${t.visibility} = 'private' AND ${t.agentDefinition} IS NOT NULL AND COALESCE(${t.agentDefinition}->>'mode' = 'agent', false) AND COALESCE(${t.agentDefinition}->>'definitionSchemaVersion' = '1', false) AND ${t.definitionDigest} IS NOT NULL AND ${t.definitionDigest} ~ '^sha256:[0-9a-f]{64}$')`)
]);

export const workflowNodes = pgTable("workflow_nodes", {
  id: text("id").notNull(),
  versionId: text("version_id").notNull().references(() => buildVersions.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  label: text("label").notNull(),
  x: doublePrecision("x").notNull(),
  y: doublePrecision("y").notNull(),
  config: jsonb("config").notNull(),
}, (t) => [primaryKey({ columns: [t.versionId, t.id] })]);

export const workflowEdges = pgTable("workflow_edges", {
  id: text("id").notNull(),
  versionId: text("version_id").notNull().references(() => buildVersions.id, { onDelete: "cascade" }),
  source: text("source").notNull(),
  target: text("target").notNull(),
}, (t) => [primaryKey({ columns: [t.versionId, t.id] })]);

export const skills = pgTable("skills", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  effect: text("effect").notNull(),
  icon: text("icon").notNull(),
  author: text("author").notNull(),
});

export const tools = pgTable("tools", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  icon: text("icon").notNull(),
});

export const buildSkills = pgTable("build_skills", {
  id: text("id").primaryKey(),
  versionId: text("version_id").notNull().references(() => buildVersions.id, { onDelete: "cascade" }),
  skillId: text("skill_id").notNull().references(() => skills.id, { onDelete: "cascade" }),
}, (t) => [uniqueIndex("build_skills_unique_0").on(t.versionId, t.skillId)]);

export const buildTools = pgTable("build_tools", {
  id: text("id").primaryKey(),
  versionId: text("version_id").notNull().references(() => buildVersions.id, { onDelete: "cascade" }),
  toolId: text("tool_id").notNull().references(() => tools.id, { onDelete: "cascade" }),
}, (t) => [uniqueIndex("build_tools_unique_0").on(t.versionId, t.toolId)]);

export const runs = pgTable("runs", {
  id: text("id").primaryKey(),
  buildId: text("build_id").notNull().references(() => builds.id, { onDelete: "cascade" }),
  versionId: text("version_id").notNull().references(() => buildVersions.id, { onDelete: "cascade" }),
  problemId: text("problem_id").notNull().references(() => problems.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  tier: text("tier").notNull(),
  status: text("status").notNull(),
  summary: jsonb("summary"),
  runtimeKind: text("runtime_kind"),
  adapterVersion: text("adapter_version"),
  policyVersion: text("policy_version"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

export const runCases = pgTable("run_cases", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),
  caseId: text("case_id").notNull(),
  category: text("category").notNull(),
  passed: boolean("passed").notNull(),
  secure: boolean("secure").notNull(),
  failureType: text("failure_type"),
  input: text("input"),
  expected: jsonb("expected"),
  actual: text("actual"),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  reasoningTokens: integer("reasoning_tokens").notNull().default(0),
  toolCalls: integer("tool_calls").notNull().default(0),
  latency: doublePrecision("latency").notNull().default(0),
  cost: doublePrecision("cost"),
  estimated: boolean("estimated").notNull().default(false),
  trace: jsonb("trace"),
});

export const submissions = pgTable("submissions", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull().unique().references(() => runs.id, { onDelete: "cascade" }),
  buildId: text("build_id").notNull().references(() => builds.id, { onDelete: "cascade" }),
  versionId: text("version_id").notNull().references(() => buildVersions.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  problemId: text("problem_id").notNull().references(() => problems.id, { onDelete: "cascade" }),
  tier: text("tier").notNull(),
  score: integer("score").notNull(),
  accuracy: doublePrecision("accuracy").notNull(),
  robustness: doublePrecision("robustness").notNull(),
  security: doublePrecision("security").notNull(),
  efficiency: doublePrecision("efficiency").notNull(),
  elegance: doublePrecision("elegance").notNull(),
  tokens: doublePrecision("tokens").notNull(),
  cost: doublePrecision("cost"),
  latency: doublePrecision("latency").notNull(),
  nodes: integer("nodes").notNull(),
  model: text("model").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

export const credentials = pgTable("provider_credentials", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  baseUrl: text("base_url").notNull(),
  modelId: text("model_id").notNull(),
  ciphertext: text("ciphertext").notNull(),
  lastFour: text("last_four").notNull(),
  inputPrice: doublePrecision("input_price"),
  outputPrice: doublePrecision("output_price"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

export const failureCases = pgTable("failure_cases", {
  id: text("id").primaryKey(),
  problemId: text("problem_id").notNull().references(() => problems.id, { onDelete: "cascade" }),
  buildId: text("build_id").notNull().references(() => builds.id, { onDelete: "cascade" }),
  versionId: text("version_id").notNull().references(() => buildVersions.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  input: text("input").notNull(),
  reason: text("reason").notNull(),
  fingerprint: text("fingerprint").notNull().unique(),
  status: text("status").notNull(),
  tier: text("tier").notNull(),
  actual: text("actual"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

export const reputations = pgTable("reputations", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  points: integer("points").notNull(),
  reason: text("reason").notNull(),
  referenceId: text("reference_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (t) => [uniqueIndex("reputations_unique_0").on(t.userId, t.reason, t.referenceId)]);

export const badges = pgTable("badges", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  icon: text("icon").notNull(),
});

export const userBadges = pgTable("user_badges", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  badgeId: text("badge_id").notNull().references(() => badges.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (t) => [uniqueIndex("user_badges_unique_0").on(t.userId, t.badgeId)]);

export const forkRelations = pgTable("fork_relations", {
  sourceVersionId: text("source_version_id").references(() => buildVersions.id),
  id: text("id").primaryKey(),
  parentBuildId: text("parent_build_id").notNull().references(() => builds.id, { onDelete: "cascade" }),
  childBuildId: text("child_build_id").notNull().unique().references(() => builds.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

export const components = pgTable("components", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description").notNull(),
  kind: text("kind").notNull(),
  visibility: text("visibility").notNull(),
  draftRevision: integer("draft_revision").notNull().default(0),
  draftDefinition: jsonb("draft_definition").notNull(),
  currentVersionId: text("current_version_id"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

export const componentVersions = pgTable("component_versions", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  componentId: text("component_id").notNull().references(() => components.id, { onDelete: "cascade" }),
  versionNumber: integer("version_number").notNull(),
  contractVersion: integer("contract_version").notNull(),
  definition: jsonb("definition").notNull(),
  definitionDigest: text("definition_digest").notNull(),
  dependencies: jsonb("dependencies").notNull(),
  publicMaterial: jsonb("public_material").notNull(),
  licenseSpdx: text("license_spdx"),
  provenance: jsonb("provenance").notNull(),
  frozenAt: timestamp("frozen_at", { withTimezone: true, mode: "date" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (t) => [uniqueIndex("component_versions_unique_0").on(t.componentId, t.versionNumber)]);

export const attachments = pgTable("component_attachments", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  componentVersionId: text("component_version_id").notNull().references(() => componentVersions.id, { onDelete: "cascade" }),
  path: text("path").notNull(),
  mediaType: text("media_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  sha256: text("sha256").notNull(),
  storageKey: text("storage_key").notNull(),
  visibility: text("visibility").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (t) => [uniqueIndex("component_attachments_unique_0").on(t.componentVersionId, t.path)]);

export const componentAttachmentContents = pgTable("component_attachment_contents", {
  attachmentId: text("attachment_id").primaryKey().references(() => attachments.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
}, (t) => [check("component_attachment_contents_content_size_check", sql`octet_length(${t.content}) <= 262144`)]);

export const componentTestSuites = pgTable("component_test_suites", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  componentId: text("component_id").notNull().references(() => components.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description").notNull(),
  visibility: text("visibility").notNull(),
  currentVersionId: text("current_version_id"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

export const componentTestSuiteVersions = pgTable("component_test_suite_versions", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  testSuiteId: text("test_suite_id").notNull().references(() => componentTestSuites.id, { onDelete: "cascade" }),
  versionNumber: integer("version_number").notNull(),
  cases: jsonb("cases").notNull(),
  casesDigest: text("cases_digest").notNull(),
  visibility: text("visibility").notNull(),
  frozenAt: timestamp("frozen_at", { withTimezone: true, mode: "date" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (t) => [uniqueIndex("component_test_suite_versions_unique_0").on(t.testSuiteId, t.versionNumber)]);

export const componentTestRuns = pgTable("component_test_runs", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  componentVersionId: text("component_version_id").notNull().references(() => componentVersions.id, { onDelete: "cascade" }),
  testSuiteVersionId: text("test_suite_version_id").notNull().references(() => componentTestSuiteVersions.id, { onDelete: "cascade" }),
  evaluationJobId: text("evaluation_job_id").unique(),
  credentialId: text("credential_id").notNull(),
  modelId: text("model_id"),
  runtimeKind: text("runtime_kind").notNull(),
  executionSource: text("execution_source"),
  idempotencyKey: text("idempotency_key").notNull(),
  constraints: jsonb("constraints").notNull(),
  usage: jsonb("usage"),
  resultSummary: jsonb("result_summary"),
  status: text("status").notNull(),
  consentVersion: text("consent_version"),
  requestDigest: text("request_digest").notNull(),
  failureReason: text("failure_reason"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }),
  completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
}, (t) => [uniqueIndex("component_test_runs_idempotency_unique_0").on(t.ownerId, t.idempotencyKey)]);

export const publicationRequests = pgTable("publication_requests", {
  id: text("id").primaryKey(),
  componentVersionId: text("component_version_id").notNull().references(() => componentVersions.id, { onDelete: "cascade" }),
  requesterId: text("requester_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  status: text("status").notNull(),
  requestRevision: integer("request_revision").notNull().default(1),
  publicMaterialSnapshot: jsonb("public_material_snapshot").notNull(),
  declaration: text("declaration").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  decidedAt: timestamp("decided_at", { withTimezone: true, mode: "date" }),
});

export const publicationReviews = pgTable("publication_reviews", {
  id: text("id").primaryKey(),
  publicationRequestId: text("publication_request_id").notNull().references(() => publicationRequests.id, { onDelete: "cascade" }),
  reviewerId: text("reviewer_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  decision: text("decision").notNull(),
  reason: text("reason").notNull(),
  evidence: jsonb("evidence").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

export const componentReleases = pgTable("component_releases", {
  id: text("id").primaryKey(),
  componentVersionId: text("component_version_id").notNull().unique().references(() => componentVersions.id, { onDelete: "cascade" }),
  publicationRequestId: text("publication_request_id").notNull().unique().references(() => publicationRequests.id, { onDelete: "cascade" }),
  status: text("status").notNull(),
  releasedAt: timestamp("released_at", { withTimezone: true, mode: "date" }).notNull(),
  disabledReason: text("disabled_reason"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

export const usageReferences = pgTable("component_usage_references", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  buildVersionId: text("build_version_id").notNull().references(() => buildVersions.id, { onDelete: "cascade" }),
  componentVersionId: text("component_version_id").notNull().references(() => componentVersions.id, { onDelete: "cascade" }),
  expansionDigest: text("expansion_digest").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (t) => [uniqueIndex("component_usage_references_unique_0").on(t.buildVersionId, t.componentVersionId)]);

export const extensionApplications = pgTable("extension_applications", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  extensionType: text("extension_type").notNull(),
  source: text("source").notNull(),
  permissionDeclaration: text("permission_declaration").notNull(),
  materials: jsonb("materials").notNull(),
  status: text("status").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  decidedAt: timestamp("decided_at", { withTimezone: true, mode: "date" }),
});

export const communityAuditEvents = pgTable("community_audit_events", {
  id: text("id").primaryKey(),
  action: text("action").notNull(),
  actorId: text("actor_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  componentId: text("component_id").notNull().references(() => components.id, { onDelete: "cascade" }),
  componentVersionId: text("component_version_id").references(() => componentVersions.id, { onDelete: "set null" }),
  publicationRequestId: text("publication_request_id").references(() => publicationRequests.id, { onDelete: "set null" }),
  occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" }).notNull(),
  metadata: jsonb("metadata").notNull(),
}, (t) => [index("community_audit_events_component_idx").on(t.componentId, t.occurredAt)]);

export const evaluationJobs = pgTable("evaluation_jobs", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "restrict" }),
  purpose: text("purpose").notNull(),
  associationKind: text("association_kind").notNull(),
  businessRecordId: text("business_record_id").notNull(),
  competitiveRunId: text("competitive_run_id").references(() => runs.id, { onDelete: "restrict" }),
  associationVisibility: text("association_visibility"),
  snapshot: jsonb("snapshot").notNull(),
  snapshotDigest: text("snapshot_digest").notNull(),
  idempotencyScope: text("idempotency_scope").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  requestDigest: text("request_digest").notNull(),
  budgetReservationId: text("budget_reservation_id"),
  state: text("state").notNull(),
  stateVersion: integer("state_version").notNull().default(0),
  executionToken: text("execution_token"),
  cancellationReason: text("cancellation_reason"),
  cancellationRequestedAt: timestamp("cancellation_requested_at", { withTimezone: true, mode: "date" }),
  completion: jsonb("completion"),
  failure: jsonb("failure"),
  acceptedAt: timestamp("accepted_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
}, (t) => [
  uniqueIndex("evaluation_jobs_association_unique").on(t.associationKind, t.businessRecordId),
  index("evaluation_jobs_user_created_idx").on(t.userId, t.createdAt),
  index("evaluation_jobs_state_created_idx").on(t.state, t.createdAt, t.id),
  uniqueIndex("evaluation_jobs_one_active_user_idx").on(t.userId).where(sql`${t.state} in ('accepted', 'queued', 'running', 'cancelling', 'unknown', 'reconciling')`),
  check("evaluation_jobs_purpose_check", sql`${t.purpose} in ('competitive', 'author-self-test', 'component-evaluation')`),
  check("evaluation_jobs_association_check", sql`(
    (${t.purpose} = 'competitive' and ${t.associationKind} = 'competitive-run' and ${t.competitiveRunId} is not null and ${t.businessRecordId} = ${t.competitiveRunId})
    or (${t.purpose} = 'author-self-test' and ${t.associationKind} = 'self-test-run' and ${t.competitiveRunId} is null)
    or (${t.purpose} = 'component-evaluation' and ${t.associationKind} = 'component-evaluation' and ${t.competitiveRunId} is null)
  )`),
  check("evaluation_jobs_state_version_check", sql`${t.stateVersion} >= 0`),
]);

export const evaluationAttempts = pgTable("evaluation_attempts", {
  id: text("id").primaryKey(),
  jobId: text("job_id").notNull().references(() => evaluationJobs.id, { onDelete: "restrict" }),
  attemptNumber: integer("attempt_number").notNull(),
  deliveryKey: text("delivery_key").notNull(),
  state: text("state").notNull(),
  stateVersion: integer("state_version").notNull().default(0),
  workerId: text("worker_id"),
  workerLeaseId: text("worker_lease_id"),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true, mode: "date" }),
  heartbeatAt: timestamp("heartbeat_at", { withTimezone: true, mode: "date" }),
  startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }),
  finishedAt: timestamp("finished_at", { withTimezone: true, mode: "date" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("evaluation_attempts_delivery_unique").on(t.jobId, t.deliveryKey),
  uniqueIndex("evaluation_attempts_one_active_idx").on(t.jobId).where(sql`${t.state} in ('claimed', 'running', 'cancelling', 'reconciling')`),
  index("evaluation_attempts_job_created_idx").on(t.jobId, t.createdAt, t.id),
  index("evaluation_attempts_lease_idx").on(t.state, t.leaseExpiresAt),
  check("evaluation_attempts_number_check", sql`${t.attemptNumber} > 0`),
  check("evaluation_attempts_state_version_check", sql`${t.stateVersion} >= 0`),
  check("evaluation_attempts_lease_check", sql`(
    ${t.state} not in ('claimed', 'running', 'cancelling', 'reconciling')
    or (${t.workerId} is not null and ${t.workerLeaseId} is not null and ${t.leaseExpiresAt} is not null)
  )`),
]);

export const evaluationInvocations = pgTable("evaluation_invocations", {
  id: text("id").primaryKey(),
  jobId: text("job_id").notNull().references(() => evaluationJobs.id, { onDelete: "restrict" }),
  attemptId: text("attempt_id").notNull().references(() => evaluationAttempts.id, { onDelete: "restrict" }),
  invocationIndex: integer("invocation_index").notNull(),
  requestId: text("request_id").notNull().unique(),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  providerScope: text("provider_scope").notNull(),
  providerId: text("provider_id").notNull(),
  modelId: text("model_id").notNull(),
  requestDigest: text("request_digest").notNull(),
  state: text("state").notNull(),
  providerRequestId: text("provider_request_id"),
  usageRecordId: text("usage_record_id"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }),
  completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
}, (t) => [
  uniqueIndex("evaluation_invocations_attempt_index_unique").on(t.attemptId, t.invocationIndex),
  index("evaluation_invocations_attempt_idx").on(t.attemptId, t.invocationIndex),
  index("evaluation_invocations_provider_scope_idx").on(t.providerScope, t.createdAt),
  check("evaluation_invocations_index_check", sql`${t.invocationIndex} > 0`),
  check("evaluation_invocations_state_check", sql`${t.state} in ('pending', 'started', 'succeeded', 'failed', 'cancelled', 'unknown', 'reconciling')`),
]);

export const evaluationUsageRecords = pgTable("evaluation_usage_records", {
  id: text("id").primaryKey(),
  jobId: text("job_id").notNull().references(() => evaluationJobs.id, { onDelete: "restrict" }),
  attemptId: text("attempt_id").notNull().references(() => evaluationAttempts.id, { onDelete: "restrict" }),
  invocationId: text("invocation_id").unique(),
  certainty: text("certainty").notNull(),
  chargeability: text("chargeability").notNull(),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  reasoningTokens: integer("reasoning_tokens"),
  toolCalls: integer("tool_calls"),
  latencyMs: doublePrecision("latency_ms"),
  costUsd: doublePrecision("cost_usd"),
  providerRequestId: text("provider_request_id"),
  evidenceRef: text("evidence_ref"),
  recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (t) => [
  index("evaluation_usage_records_job_idx").on(t.jobId, t.recordedAt),
  index("evaluation_usage_records_certainty_idx").on(t.certainty, t.recordedAt),
  check("evaluation_usage_records_certainty_check", sql`${t.certainty} in ('known', 'unknown')`),
  check("evaluation_usage_records_chargeability_check", sql`${t.chargeability} in ('not-chargeable', 'chargeable', 'uncertain')`),
  check("evaluation_usage_records_nonnegative_check", sql`(
    (${t.inputTokens} is null or ${t.inputTokens} >= 0)
    and (${t.outputTokens} is null or ${t.outputTokens} >= 0)
    and (${t.reasoningTokens} is null or ${t.reasoningTokens} >= 0)
    and (${t.toolCalls} is null or ${t.toolCalls} >= 0)
    and (${t.latencyMs} is null or ${t.latencyMs} >= 0)
    and (${t.costUsd} is null or ${t.costUsd} >= 0)
  )`),
]);

export const evaluationIdempotencyKeys = pgTable("evaluation_idempotency_keys", {
  id: text("id").primaryKey(),
  scope: text("scope").notNull(),
  key: text("key").notNull(),
  requestDigest: text("request_digest").notNull(),
  jobId: text("job_id").notNull().references(() => evaluationJobs.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
}, (t) => [
  uniqueIndex("evaluation_idempotency_scope_key_unique").on(t.scope, t.key),
  uniqueIndex("evaluation_idempotency_scope_job_unique").on(t.scope, t.jobId),
  index("evaluation_idempotency_job_idx").on(t.jobId),
]);

export const evaluationBudgetReservations = pgTable("evaluation_budget_reservations", {
  id: text("id").primaryKey(),
  jobId: text("job_id").notNull().unique().references(() => evaluationJobs.id, { onDelete: "restrict" }),
  purpose: text("purpose").notNull(),
  kind: text("kind").notNull(),
  state: text("state").notNull(),
  usageCertainty: text("usage_certainty").notNull(),
  chargeability: text("chargeability").notNull(),
  reservedInputTokens: integer("reserved_input_tokens"),
  reservedOutputTokens: integer("reserved_output_tokens"),
  reservedToolCalls: integer("reserved_tool_calls"),
  reservedExecutionMs: doublePrecision("reserved_execution_ms"),
  reservedCostUsd: doublePrecision("reserved_cost_usd"),
  settledInputTokens: integer("settled_input_tokens"),
  settledOutputTokens: integer("settled_output_tokens"),
  settledToolCalls: integer("settled_tool_calls"),
  settledExecutionMs: doublePrecision("settled_execution_ms"),
  settledCostUsd: doublePrecision("settled_cost_usd"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (t) => [
  index("evaluation_budget_reservations_state_idx").on(t.state, t.updatedAt),
  check("evaluation_budget_purpose_check", sql`${t.purpose} in ('competitive', 'author-self-test', 'component-evaluation')`),
  check("evaluation_budget_kind_check", sql`${t.kind} in ('execution-budget', 'benchmark-cost', 'platform-spend')`),
  check("evaluation_budget_state_check", sql`${t.state} in ('reserved', 'partially-settled', 'settled', 'released', 'held-for-reconciliation')`),
  check("evaluation_budget_certainty_check", sql`${t.usageCertainty} in ('known', 'unknown')`),
  check("evaluation_budget_chargeability_check", sql`${t.chargeability} in ('not-chargeable', 'chargeable', 'uncertain')`),
]);

export const evaluationOutbox = pgTable("evaluation_outbox", {
  id: text("id").primaryKey(),
  jobId: text("job_id").notNull().references(() => evaluationJobs.id, { onDelete: "restrict" }),
  aggregateId: text("aggregate_id").notNull(),
  version: integer("version").notNull(),
  kind: text("kind").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" }).notNull(),
  requestDigest: text("request_digest").notNull(),
  payload: jsonb("payload").notNull(),
  dedupeKey: text("dedupe_key").notNull().unique(),
  status: text("status").notNull().default("pending"),
  availableAt: timestamp("available_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  leaseToken: text("lease_token"),
  leaseOwner: text("lease_owner"),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true, mode: "date" }),
  deliveryAttempts: integer("delivery_attempts").notNull().default(0),
  lastErrorCode: text("last_error_code"),
  lastErrorAt: timestamp("last_error_at", { withTimezone: true, mode: "date" }),
  publishedAt: timestamp("published_at", { withTimezone: true, mode: "date" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (t) => [
  index("evaluation_outbox_pending_idx").on(t.status, t.availableAt, t.id),
  index("evaluation_outbox_job_idx").on(t.jobId, t.createdAt, t.id),
  check("evaluation_outbox_status_check", sql`${t.status} in ('pending', 'leased', 'published', 'dead-letter')`),
  check("evaluation_outbox_version_check", sql`${t.version} > 0`),
  check("evaluation_outbox_attempts_check", sql`${t.deliveryAttempts} >= 0`),
]);

export const tableRegistry = {
  users: user,
  problems,
  testCases,
  builds,
  buildVersions,
  workflowNodes,
  workflowEdges,
  skills,
  tools,
  buildSkills,
  buildTools,
  runs,
  runCases,
  submissions,
  credentials,
  failureCases,
  reputations,
  badges,
  userBadges,
  forkRelations,
  components,
  componentVersions,
  attachments,
  componentAttachmentContents,
  componentTestSuites,
  componentTestSuiteVersions,
  componentTestRuns,
  publicationRequests,
  publicationReviews,
  componentReleases,
  usageReferences,
  extensionApplications,
  communityAuditEvents,
  evaluationJobs,
  evaluationAttempts,
  evaluationInvocations,
  evaluationUsageRecords,
  evaluationIdempotencyKeys,
  evaluationBudgetReservations,
  evaluationOutbox,
};

// Managed by the versioned runner, not by application repositories or seed data.
export const schemaMigrations = pgTable("schema_migrations", {
  version: text("version").primaryKey(),
  name: text("name").notNull(),
  checksum: text("checksum").notNull(),
  appliedAt: timestamp("applied_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (table) => [
  check("schema_migrations_checksum_check", sql`${table.checksum} ~ '^[0-9a-f]{64}$'`),
]);
