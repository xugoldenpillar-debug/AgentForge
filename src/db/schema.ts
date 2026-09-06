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
  id: text("id").primaryKey(),
  parentBuildId: text("parent_build_id").notNull().references(() => builds.id, { onDelete: "cascade" }),
  childBuildId: text("child_build_id").notNull().unique().references(() => builds.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

export const tableRegistry = {users: user, problems, testCases, builds, buildVersions, workflowNodes, workflowEdges, skills, tools, buildSkills, buildTools, runs, runCases, submissions, credentials, failureCases, reputations, badges, userBadges, forkRelations};

// Managed by the versioned runner, not by application repositories or seed data.
export const schemaMigrations = pgTable("schema_migrations", {
  version: text("version").primaryKey(),
  name: text("name").notNull(),
  checksum: text("checksum").notNull(),
  appliedAt: timestamp("applied_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (table) => [
  check("schema_migrations_checksum_check", sql`${table.checksum} ~ '^[0-9a-f]{64}$'`),
]);
