-- AgentForge initial schema. Idempotent, checked into source control.
CREATE TABLE IF NOT EXISTS "users" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL UNIQUE,
  "email_verified" BOOLEAN NOT NULL DEFAULT false,
  "image" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "elo" INTEGER NOT NULL DEFAULT 1000,
  "reputation" INTEGER NOT NULL DEFAULT 0,
  "is_seed" BOOLEAN NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS "sessions" (
  "id" TEXT PRIMARY KEY,
  "expires_at" TIMESTAMPTZ NOT NULL,
  "token" TEXT NOT NULL UNIQUE,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "ip_address" TEXT,
  "user_agent" TEXT,
  "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS "accounts" (
  "id" TEXT PRIMARY KEY,
  "account_id" TEXT NOT NULL,
  "provider_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "access_token" TEXT,
  "refresh_token" TEXT,
  "id_token" TEXT,
  "access_token_expires_at" TIMESTAMPTZ,
  "refresh_token_expires_at" TIMESTAMPTZ,
  "scope" TEXT,
  "password" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS "verifications" (
  "id" TEXT PRIMARY KEY,
  "identifier" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "expires_at" TIMESTAMPTZ NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS "problems" (
  "id" TEXT PRIMARY KEY,
  "slug" TEXT NOT NULL UNIQUE,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "mission" TEXT NOT NULL,
  "goal" TEXT NOT NULL,
  "why" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "difficulty" TEXT NOT NULL,
  "tags" JSONB NOT NULL,
  "judge" TEXT NOT NULL,
  "constraints" JSONB NOT NULL,
  "reward" INTEGER NOT NULL DEFAULT 0,
  "world_boss" BOOLEAN NOT NULL DEFAULT false,
  "status" TEXT NOT NULL,
  "author_id" TEXT REFERENCES "users"("id") ON DELETE CASCADE,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS "test_cases" (
  "id" TEXT PRIMARY KEY,
  "problem_id" TEXT NOT NULL REFERENCES "problems"("id") ON DELETE CASCADE,
  "visibility" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "input" TEXT NOT NULL,
  "expected" JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS "builds" (
  "id" TEXT PRIMARY KEY,
  "problem_id" TEXT NOT NULL REFERENCES "problems"("id") ON DELETE CASCADE,
  "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "title" TEXT NOT NULL,
  "visibility" TEXT NOT NULL,
  "current_version_id" TEXT NOT NULL,
  "parent_build_id" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS "build_versions" (
  "id" TEXT PRIMARY KEY,
  "build_id" TEXT NOT NULL REFERENCES "builds"("id") ON DELETE CASCADE,
  "revision" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "visibility" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE ("build_id", "revision")
);
CREATE TABLE IF NOT EXISTS "workflow_nodes" (
  "id" TEXT NOT NULL,
  "version_id" TEXT NOT NULL REFERENCES "build_versions"("id") ON DELETE CASCADE,
  "kind" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "x" DOUBLE PRECISION NOT NULL,
  "y" DOUBLE PRECISION NOT NULL,
  "config" JSONB NOT NULL,
  PRIMARY KEY ("version_id", "id")
);
CREATE TABLE IF NOT EXISTS "workflow_edges" (
  "id" TEXT NOT NULL,
  "version_id" TEXT NOT NULL REFERENCES "build_versions"("id") ON DELETE CASCADE,
  "source" TEXT NOT NULL,
  "target" TEXT NOT NULL,
  PRIMARY KEY ("version_id", "id")
);
CREATE TABLE IF NOT EXISTS "skills" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "effect" TEXT NOT NULL,
  "icon" TEXT NOT NULL,
  "author" TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS "tools" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "icon" TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS "build_skills" (
  "id" TEXT PRIMARY KEY,
  "version_id" TEXT NOT NULL REFERENCES "build_versions"("id") ON DELETE CASCADE,
  "skill_id" TEXT NOT NULL REFERENCES "skills"("id") ON DELETE CASCADE,
  UNIQUE ("version_id", "skill_id")
);
CREATE TABLE IF NOT EXISTS "build_tools" (
  "id" TEXT PRIMARY KEY,
  "version_id" TEXT NOT NULL REFERENCES "build_versions"("id") ON DELETE CASCADE,
  "tool_id" TEXT NOT NULL REFERENCES "tools"("id") ON DELETE CASCADE,
  UNIQUE ("version_id", "tool_id")
);
CREATE TABLE IF NOT EXISTS "runs" (
  "id" TEXT PRIMARY KEY,
  "build_id" TEXT NOT NULL REFERENCES "builds"("id") ON DELETE CASCADE,
  "version_id" TEXT NOT NULL REFERENCES "build_versions"("id") ON DELETE CASCADE,
  "problem_id" TEXT NOT NULL REFERENCES "problems"("id") ON DELETE CASCADE,
  "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "kind" TEXT NOT NULL,
  "tier" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "summary" JSONB,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS "run_cases" (
  "id" TEXT PRIMARY KEY,
  "run_id" TEXT NOT NULL REFERENCES "runs"("id") ON DELETE CASCADE,
  "case_id" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "passed" BOOLEAN NOT NULL,
  "secure" BOOLEAN NOT NULL,
  "failure_type" TEXT,
  "input" TEXT,
  "expected" JSONB,
  "actual" TEXT,
  "input_tokens" INTEGER NOT NULL DEFAULT 0,
  "output_tokens" INTEGER NOT NULL DEFAULT 0,
  "reasoning_tokens" INTEGER NOT NULL DEFAULT 0,
  "tool_calls" INTEGER NOT NULL DEFAULT 0,
  "latency" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "cost" DOUBLE PRECISION,
  "estimated" BOOLEAN NOT NULL DEFAULT false,
  "trace" JSONB
);
CREATE TABLE IF NOT EXISTS "submissions" (
  "id" TEXT PRIMARY KEY,
  "run_id" TEXT NOT NULL UNIQUE REFERENCES "runs"("id") ON DELETE CASCADE,
  "build_id" TEXT NOT NULL REFERENCES "builds"("id") ON DELETE CASCADE,
  "version_id" TEXT NOT NULL REFERENCES "build_versions"("id") ON DELETE CASCADE,
  "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "problem_id" TEXT NOT NULL REFERENCES "problems"("id") ON DELETE CASCADE,
  "tier" TEXT NOT NULL,
  "score" INTEGER NOT NULL,
  "accuracy" DOUBLE PRECISION NOT NULL,
  "robustness" DOUBLE PRECISION NOT NULL,
  "security" DOUBLE PRECISION NOT NULL,
  "efficiency" DOUBLE PRECISION NOT NULL,
  "elegance" DOUBLE PRECISION NOT NULL,
  "tokens" DOUBLE PRECISION NOT NULL,
  "cost" DOUBLE PRECISION,
  "latency" DOUBLE PRECISION NOT NULL,
  "nodes" INTEGER NOT NULL,
  "model" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS "provider_credentials" (
  "id" TEXT PRIMARY KEY,
  "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL,
  "base_url" TEXT NOT NULL,
  "model_id" TEXT NOT NULL,
  "ciphertext" TEXT NOT NULL,
  "last_four" TEXT NOT NULL,
  "input_price" DOUBLE PRECISION,
  "output_price" DOUBLE PRECISION,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS "failure_cases" (
  "id" TEXT PRIMARY KEY,
  "problem_id" TEXT NOT NULL REFERENCES "problems"("id") ON DELETE CASCADE,
  "build_id" TEXT NOT NULL REFERENCES "builds"("id") ON DELETE CASCADE,
  "version_id" TEXT NOT NULL REFERENCES "build_versions"("id") ON DELETE CASCADE,
  "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "input" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL UNIQUE,
  "status" TEXT NOT NULL,
  "tier" TEXT NOT NULL,
  "actual" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS "reputations" (
  "id" TEXT PRIMARY KEY,
  "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "points" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "reference_id" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE ("user_id", "reason", "reference_id")
);
CREATE TABLE IF NOT EXISTS "badges" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "icon" TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS "user_badges" (
  "id" TEXT PRIMARY KEY,
  "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "badge_id" TEXT NOT NULL REFERENCES "badges"("id") ON DELETE CASCADE,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE ("user_id", "badge_id")
);
CREATE TABLE IF NOT EXISTS "fork_relations" (
  "id" TEXT PRIMARY KEY,
  "parent_build_id" TEXT NOT NULL REFERENCES "builds"("id") ON DELETE CASCADE,
  "child_build_id" TEXT NOT NULL UNIQUE REFERENCES "builds"("id") ON DELETE CASCADE,
  "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS builds_user_idx ON builds(user_id);
CREATE INDEX IF NOT EXISTS submissions_board_idx ON submissions(problem_id,tier,score DESC);
CREATE INDEX IF NOT EXISTS test_cases_visibility_idx ON test_cases(problem_id,visibility);
CREATE INDEX IF NOT EXISTS nodes_kind_idx ON workflow_nodes(kind);
CREATE INDEX IF NOT EXISTS runs_user_idx ON runs(user_id,created_at DESC);
CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, hits INTEGER NOT NULL, expires_at TIMESTAMPTZ NOT NULL);
CREATE TABLE IF NOT EXISTS execution_locks (key TEXT PRIMARY KEY, token TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL);
