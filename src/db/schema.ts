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
  revision: integer("revision").notNull(),
  title: text("title").notNull(),
  visibility: text("visibility").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (t) => [uniqueIndex("build_versions_unique_0").on(t.buildId, t.revision)]);

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

export const tableRegistry = {users: user, problems, testCases, builds, buildVersions, workflowNodes, workflowEdges, skills, tools, buildSkills, buildTools, runs, runCases, submissions, credentials, failureCases, reputations, badges, userBadges, forkRelations, components, componentVersions, attachments, componentAttachmentContents, componentTestSuites, componentTestSuiteVersions, componentTestRuns, publicationRequests, publicationReviews, componentReleases, usageReferences, extensionApplications, communityAuditEvents};

// Managed by the versioned runner, not by application repositories or seed data.
export const schemaMigrations = pgTable("schema_migrations", {
  version: text("version").primaryKey(),
  name: text("name").notNull(),
  checksum: text("checksum").notNull(),
  appliedAt: timestamp("applied_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (table) => [
  check("schema_migrations_checksum_check", sql`${table.checksum} ~ '^[0-9a-f]{64}$'`),
]);
