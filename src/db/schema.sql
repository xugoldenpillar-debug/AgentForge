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
  "is_seed" BOOLEAN NOT NULL DEFAULT false,
  "pi_runtime_access" TEXT
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
  "issuer" TEXT,
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
-- Additive catalog only. Does not enable execution or create simulated activity.
CREATE TABLE IF NOT EXISTS animation_challenges (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  position INTEGER NOT NULL CHECK (position > 0),
  status TEXT NOT NULL CHECK (status IN ('draft', 'published', 'retired'))
);
CREATE TABLE IF NOT EXISTS animation_challenge_versions (
  id TEXT PRIMARY KEY,
  challenge_id TEXT NOT NULL REFERENCES animation_challenges(id) ON DELETE RESTRICT,
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  title_en TEXT NOT NULL CHECK (length(title_en) BETWEEN 1 AND 120),
  instructions TEXT NOT NULL CHECK (length(instructions) BETWEEN 1 AND 16384),
  instructions_en TEXT NOT NULL CHECK (length(instructions_en) BETWEEN 1 AND 16384),
  output_policy_version TEXT NOT NULL CHECK (output_policy_version = 'svg-animation-v1'),
  content_digest TEXT NOT NULL CHECK (content_digest ~ '^sha256:[a-f0-9]{64}$'),
  UNIQUE (challenge_id, version_number)
);

CREATE TABLE IF NOT EXISTS "builds" (
  "id" TEXT PRIMARY KEY,
  "problem_id" TEXT REFERENCES "problems"("id") ON DELETE CASCADE,
  "animation_challenge_id" TEXT REFERENCES "animation_challenges"("id") ON DELETE RESTRICT,
  "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "title" TEXT NOT NULL,
  "visibility" TEXT NOT NULL,
  "current_version_id" TEXT NOT NULL,
  "parent_build_id" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT builds_target_check CHECK (
    (problem_id IS NOT NULL AND animation_challenge_id IS NULL)
    OR (problem_id IS NULL AND animation_challenge_id IS NOT NULL)
  )
);
CREATE TABLE IF NOT EXISTS "build_versions" (
  "id" TEXT PRIMARY KEY,
  "build_id" TEXT NOT NULL REFERENCES "builds"("id") ON DELETE CASCADE,
  "mode" TEXT NOT NULL DEFAULT 'workflow',
  "agent_definition" JSONB,
  "definition_digest" TEXT,
  "animation_challenge_version_id" TEXT REFERENCES "animation_challenge_versions"("id") ON DELETE RESTRICT,
  "revision" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "visibility" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE ("build_id", "revision"),
  CONSTRAINT build_versions_mode_payload CHECK (
    (mode = 'workflow' AND agent_definition IS NULL AND definition_digest IS NULL)
    OR (mode = 'agent' AND visibility = 'private' AND agent_definition IS NOT NULL
      AND COALESCE(agent_definition->>'mode' = 'agent', false) AND COALESCE(agent_definition->>'definitionSchemaVersion' = '1', false)
      AND definition_digest IS NOT NULL AND definition_digest ~ '^sha256:[0-9a-f]{64}$')
  )
);
CREATE INDEX IF NOT EXISTS builds_animation_challenge_idx
  ON public.builds(animation_challenge_id, updated_at DESC)
  WHERE animation_challenge_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS build_versions_animation_challenge_version_idx
  ON public.build_versions(animation_challenge_version_id, created_at DESC)
  WHERE animation_challenge_version_id IS NOT NULL;
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
  "runtime_kind" TEXT,
  "adapter_version" TEXT,
  "policy_version" TEXT,
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
  "protocol" TEXT NOT NULL DEFAULT 'openai-chat' CHECK (protocol IN ('openai-chat', 'openai-responses', 'anthropic-messages', 'google-generative-ai')),
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
  "source_version_id" TEXT REFERENCES "build_versions"("id"),
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

-- Community component library data foundation. These tables are deliberately
-- separate from competitive runs, submissions and leaderboard evidence.
CREATE TABLE IF NOT EXISTS "components" (
  "id" TEXT PRIMARY KEY,
  "owner_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "visibility" TEXT NOT NULL,
  "draft_revision" INTEGER NOT NULL DEFAULT 0,
  "draft_definition" JSONB NOT NULL,
  "current_version_id" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS "component_versions" (
  "id" TEXT PRIMARY KEY,
  "owner_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "component_id" TEXT NOT NULL REFERENCES "components"("id") ON DELETE CASCADE,
  "version_number" INTEGER NOT NULL,
  "contract_version" INTEGER NOT NULL,
  "definition" JSONB NOT NULL,
  "definition_digest" TEXT NOT NULL,
  "dependencies" JSONB NOT NULL,
  "public_material" JSONB NOT NULL,
  "license_spdx" TEXT,
  "provenance" JSONB NOT NULL,
  "frozen_at" TIMESTAMPTZ NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE ("component_id", "version_number")
);
CREATE TABLE IF NOT EXISTS "component_attachments" (
  "id" TEXT PRIMARY KEY,
  "owner_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "component_version_id" TEXT NOT NULL REFERENCES "component_versions"("id") ON DELETE CASCADE,
  "path" TEXT NOT NULL,
  "media_type" TEXT NOT NULL,
  "size_bytes" INTEGER NOT NULL,
  "sha256" TEXT NOT NULL,
  "storage_key" TEXT NOT NULL,
  "visibility" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE ("component_version_id", "path")
);
CREATE TABLE IF NOT EXISTS "component_attachment_contents" (
  "attachment_id" TEXT PRIMARY KEY REFERENCES "component_attachments"("id") ON DELETE CASCADE,
  "content" TEXT NOT NULL,
  CONSTRAINT "component_attachment_contents_content_size_check" CHECK (octet_length("content") <= 262144)
);
CREATE TABLE IF NOT EXISTS "component_test_suites" (
  "id" TEXT PRIMARY KEY,
  "owner_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "component_id" TEXT NOT NULL REFERENCES "components"("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "visibility" TEXT NOT NULL,
  "current_version_id" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS "component_test_suite_versions" (
  "id" TEXT PRIMARY KEY,
  "owner_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "test_suite_id" TEXT NOT NULL REFERENCES "component_test_suites"("id") ON DELETE CASCADE,
  "version_number" INTEGER NOT NULL,
  "cases" JSONB NOT NULL,
  "cases_digest" TEXT NOT NULL,
  "visibility" TEXT NOT NULL,
  "frozen_at" TIMESTAMPTZ NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE ("test_suite_id", "version_number")
);
CREATE TABLE IF NOT EXISTS "component_test_runs" (
  "id" TEXT PRIMARY KEY,
  "owner_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "component_version_id" TEXT NOT NULL REFERENCES "component_versions"("id") ON DELETE CASCADE,
  "test_suite_version_id" TEXT NOT NULL REFERENCES "component_test_suite_versions"("id") ON DELETE CASCADE,
  "evaluation_job_id" TEXT UNIQUE,
  "credential_id" TEXT NOT NULL,
  "model_id" TEXT,
  "runtime_kind" TEXT NOT NULL,
  "execution_source" TEXT,
  "idempotency_key" TEXT NOT NULL,
  "constraints" JSONB NOT NULL,
  "usage" JSONB,
  "result_summary" JSONB,
  "status" TEXT NOT NULL,
  "consent_version" TEXT,
  "request_digest" TEXT NOT NULL,
  "failure_reason" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "started_at" TIMESTAMPTZ,
  "completed_at" TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS "publication_requests" (
  "id" TEXT PRIMARY KEY,
  "component_version_id" TEXT NOT NULL REFERENCES "component_versions"("id") ON DELETE CASCADE,
  "requester_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "status" TEXT NOT NULL,
  "request_revision" INTEGER NOT NULL DEFAULT 1,
  "public_material_snapshot" JSONB NOT NULL,
  "declaration" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "decided_at" TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS "publication_reviews" (
  "id" TEXT PRIMARY KEY,
  "publication_request_id" TEXT NOT NULL REFERENCES "publication_requests"("id") ON DELETE CASCADE,
  "reviewer_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "decision" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "evidence" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS "component_releases" (
  "id" TEXT PRIMARY KEY,
  "component_version_id" TEXT NOT NULL UNIQUE REFERENCES "component_versions"("id") ON DELETE CASCADE,
  "publication_request_id" TEXT NOT NULL UNIQUE REFERENCES "publication_requests"("id") ON DELETE CASCADE,
  "status" TEXT NOT NULL,
  "released_at" TIMESTAMPTZ NOT NULL,
  "disabled_reason" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS "component_usage_references" (
  "id" TEXT PRIMARY KEY,
  "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "build_version_id" TEXT NOT NULL REFERENCES "build_versions"("id") ON DELETE CASCADE,
  "component_version_id" TEXT NOT NULL REFERENCES "component_versions"("id") ON DELETE CASCADE,
  "expansion_digest" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE ("build_version_id", "component_version_id")
);
CREATE TABLE IF NOT EXISTS "extension_applications" (
  "id" TEXT PRIMARY KEY,
  "owner_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "extension_type" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "permission_declaration" TEXT NOT NULL,
  "materials" JSONB NOT NULL,
  "status" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "decided_at" TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS "community_audit_events" (
  "id" TEXT PRIMARY KEY,
  "action" TEXT NOT NULL,
  "actor_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "component_id" TEXT NOT NULL REFERENCES "components"("id") ON DELETE CASCADE,
  "component_version_id" TEXT REFERENCES "component_versions"("id") ON DELETE SET NULL,
  "publication_request_id" TEXT REFERENCES "publication_requests"("id") ON DELETE SET NULL,
  "occurred_at" TIMESTAMPTZ NOT NULL,
  "metadata" JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS components_owner_idx ON components(owner_id);
CREATE INDEX IF NOT EXISTS component_versions_component_idx ON component_versions(component_id, version_number DESC);
CREATE INDEX IF NOT EXISTS component_attachments_owner_idx ON component_attachments(owner_id);
CREATE INDEX IF NOT EXISTS component_test_suites_owner_idx ON component_test_suites(owner_id);
CREATE INDEX IF NOT EXISTS component_test_runs_owner_idx ON component_test_runs(owner_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS component_test_runs_idempotency_unique_0 ON component_test_runs(owner_id, idempotency_key);
CREATE INDEX IF NOT EXISTS publication_requests_version_idx ON publication_requests(component_version_id, created_at DESC);
CREATE INDEX IF NOT EXISTS publication_reviews_request_idx ON publication_reviews(publication_request_id, created_at DESC);
CREATE INDEX IF NOT EXISTS component_releases_status_idx ON component_releases(status, released_at DESC);
CREATE INDEX IF NOT EXISTS component_usage_references_build_idx ON component_usage_references(build_version_id);
CREATE INDEX IF NOT EXISTS community_audit_events_component_idx ON community_audit_events(component_id, occurred_at);


-- Durable evaluation foundation. Upgrades are applied by the versioned runner.
CREATE TABLE IF NOT EXISTS public.evaluation_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  purpose TEXT NOT NULL CHECK (purpose IN ('competitive', 'author-self-test', 'component-evaluation', 'creation')),
  association_kind TEXT NOT NULL CHECK (association_kind IN ('competitive-run', 'self-test-run', 'component-evaluation', 'creation-run')),
  business_record_id TEXT NOT NULL,
  competitive_run_id TEXT REFERENCES public.runs(id) ON DELETE RESTRICT,
  association_visibility TEXT CHECK (association_visibility IS NULL OR association_visibility IN ('public', 'hidden')),
  snapshot JSONB NOT NULL,
  snapshot_digest TEXT NOT NULL CHECK (length(snapshot_digest) > 0),
  idempotency_scope TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_digest TEXT NOT NULL CHECK (length(request_digest) > 0),
  budget_reservation_id TEXT,
  state TEXT NOT NULL CHECK (state IN ('accepted', 'queued', 'running', 'cancelling', 'completed', 'failed', 'cancelled', 'incomplete', 'unknown', 'reconciling', 'expired')),
  state_version INTEGER NOT NULL DEFAULT 0 CHECK (state_version >= 0),
  execution_token TEXT,
  cancellation_reason TEXT CHECK (cancellation_reason IS NULL OR cancellation_reason IN ('user-requested', 'authorization-revoked', 'budget-revoked', 'system-shutdown', 'worker-timeout')),
  cancellation_requested_at TIMESTAMPTZ,
  completion JSONB,
  failure JSONB,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  CONSTRAINT evaluation_jobs_association_check CHECK (
    (purpose = 'competitive' AND association_kind = 'competitive-run' AND competitive_run_id IS NOT NULL AND business_record_id = competitive_run_id AND association_visibility IS NOT NULL)
    OR (purpose = 'author-self-test' AND association_kind = 'self-test-run' AND competitive_run_id IS NULL AND association_visibility IS NULL)
    OR (purpose = 'component-evaluation' AND association_kind = 'component-evaluation' AND competitive_run_id IS NULL AND association_visibility IS NULL)
    OR (purpose = 'creation' AND association_kind = 'creation-run' AND competitive_run_id IS NULL AND association_visibility IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS evaluation_jobs_association_unique ON public.evaluation_jobs(association_kind, business_record_id);
CREATE INDEX IF NOT EXISTS evaluation_jobs_user_created_idx ON public.evaluation_jobs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS evaluation_jobs_state_created_idx ON public.evaluation_jobs(state, created_at, id);
CREATE UNIQUE INDEX IF NOT EXISTS evaluation_jobs_one_active_user_idx
  ON public.evaluation_jobs(user_id)
  WHERE state IN ('accepted', 'queued', 'running', 'cancelling', 'unknown', 'reconciling');

CREATE TABLE IF NOT EXISTS public.evaluation_attempts (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES public.evaluation_jobs(id) ON DELETE RESTRICT,
  attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
  delivery_key TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('created', 'claimed', 'running', 'cancelling', 'completed', 'failed', 'cancelled', 'incomplete', 'unknown', 'reconciling', 'expired')),
  state_version INTEGER NOT NULL DEFAULT 0 CHECK (state_version >= 0),
  worker_id TEXT,
  worker_lease_id TEXT,
  lease_expires_at TIMESTAMPTZ,
  heartbeat_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (job_id, attempt_number),
  UNIQUE (job_id, delivery_key),
  CHECK (
    state NOT IN ('claimed', 'running', 'cancelling', 'reconciling')
    OR (worker_id IS NOT NULL AND worker_lease_id IS NOT NULL AND lease_expires_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS evaluation_attempts_one_active_idx
  ON public.evaluation_attempts(job_id)
  WHERE state IN ('claimed', 'running', 'cancelling', 'reconciling');
CREATE INDEX IF NOT EXISTS evaluation_attempts_job_created_idx ON public.evaluation_attempts(job_id, created_at, id);
CREATE INDEX IF NOT EXISTS evaluation_attempts_lease_idx ON public.evaluation_attempts(state, lease_expires_at);

CREATE TABLE IF NOT EXISTS public.evaluation_invocations (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES public.evaluation_jobs(id) ON DELETE RESTRICT,
  attempt_id TEXT NOT NULL REFERENCES public.evaluation_attempts(id) ON DELETE RESTRICT,
  invocation_index INTEGER NOT NULL CHECK (invocation_index > 0),
  request_id TEXT NOT NULL UNIQUE,
  idempotency_key TEXT NOT NULL UNIQUE,
  provider_scope TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  request_digest TEXT NOT NULL CHECK (length(request_digest) > 0),
  state TEXT NOT NULL CHECK (state IN ('pending', 'started', 'succeeded', 'failed', 'cancelled', 'unknown', 'reconciling')),
  provider_request_id TEXT,
  usage_record_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  UNIQUE (attempt_id, invocation_index)
);
CREATE INDEX IF NOT EXISTS evaluation_invocations_attempt_idx ON public.evaluation_invocations(attempt_id, invocation_index);
CREATE INDEX IF NOT EXISTS evaluation_invocations_provider_scope_idx ON public.evaluation_invocations(provider_scope, created_at DESC);

CREATE TABLE IF NOT EXISTS public.evaluation_usage_records (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES public.evaluation_jobs(id) ON DELETE RESTRICT,
  attempt_id TEXT NOT NULL REFERENCES public.evaluation_attempts(id) ON DELETE RESTRICT,
  invocation_id TEXT UNIQUE REFERENCES public.evaluation_invocations(id) ON DELETE RESTRICT,
  certainty TEXT NOT NULL CHECK (certainty IN ('known', 'unknown')),
  chargeability TEXT NOT NULL CHECK (chargeability IN ('not-chargeable', 'chargeable', 'uncertain')),
  input_tokens INTEGER CHECK (input_tokens IS NULL OR input_tokens >= 0),
  output_tokens INTEGER CHECK (output_tokens IS NULL OR output_tokens >= 0),
  reasoning_tokens INTEGER CHECK (reasoning_tokens IS NULL OR reasoning_tokens >= 0),
  tool_calls INTEGER CHECK (tool_calls IS NULL OR tool_calls >= 0),
  latency_ms DOUBLE PRECISION CHECK (latency_ms IS NULL OR latency_ms >= 0),
  cost_usd DOUBLE PRECISION CHECK (cost_usd IS NULL OR cost_usd >= 0),
  provider_request_id TEXT,
  evidence_ref TEXT,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS evaluation_usage_records_job_idx ON public.evaluation_usage_records(job_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS evaluation_usage_records_certainty_idx ON public.evaluation_usage_records(certainty, recorded_at DESC);

CREATE TABLE IF NOT EXISTS public.evaluation_idempotency_keys (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  request_digest TEXT NOT NULL CHECK (length(request_digest) > 0),
  job_id TEXT NOT NULL REFERENCES public.evaluation_jobs(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  UNIQUE (scope, key),
  UNIQUE (scope, job_id)
);
CREATE INDEX IF NOT EXISTS evaluation_idempotency_job_idx ON public.evaluation_idempotency_keys(job_id);
CREATE INDEX IF NOT EXISTS evaluation_idempotency_expiry_idx ON public.evaluation_idempotency_keys(expires_at) WHERE expires_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.evaluation_budget_reservations (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL UNIQUE REFERENCES public.evaluation_jobs(id) ON DELETE RESTRICT,
  purpose TEXT NOT NULL CHECK (purpose IN ('competitive', 'author-self-test', 'component-evaluation', 'creation')),
  kind TEXT NOT NULL CHECK (kind IN ('execution-budget', 'benchmark-cost', 'platform-spend')),
  state TEXT NOT NULL CHECK (state IN ('reserved', 'partially-settled', 'settled', 'released', 'held-for-reconciliation')),
  usage_certainty TEXT NOT NULL CHECK (usage_certainty IN ('known', 'unknown')),
  chargeability TEXT NOT NULL CHECK (chargeability IN ('not-chargeable', 'chargeable', 'uncertain')),
  reserved_input_tokens INTEGER CHECK (reserved_input_tokens IS NULL OR reserved_input_tokens >= 0),
  reserved_output_tokens INTEGER CHECK (reserved_output_tokens IS NULL OR reserved_output_tokens >= 0),
  reserved_tool_calls INTEGER CHECK (reserved_tool_calls IS NULL OR reserved_tool_calls >= 0),
  reserved_execution_ms DOUBLE PRECISION CHECK (reserved_execution_ms IS NULL OR reserved_execution_ms >= 0),
  reserved_cost_usd DOUBLE PRECISION CHECK (reserved_cost_usd IS NULL OR reserved_cost_usd >= 0),
  settled_input_tokens INTEGER CHECK (settled_input_tokens IS NULL OR settled_input_tokens >= 0),
  settled_output_tokens INTEGER CHECK (settled_output_tokens IS NULL OR settled_output_tokens >= 0),
  settled_tool_calls INTEGER CHECK (settled_tool_calls IS NULL OR settled_tool_calls >= 0),
  settled_execution_ms DOUBLE PRECISION CHECK (settled_execution_ms IS NULL OR settled_execution_ms >= 0),
  settled_cost_usd DOUBLE PRECISION CHECK (settled_cost_usd IS NULL OR settled_cost_usd >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS evaluation_budget_reservations_state_idx ON public.evaluation_budget_reservations(state, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.evaluation_outbox (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES public.evaluation_jobs(id) ON DELETE RESTRICT,
  aggregate_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  kind TEXT NOT NULL CHECK (kind IN ('evaluation-job-accepted', 'evaluation-job-cancel-requested', 'evaluation-attempt-dispatch-requested', 'evaluation-attempt-reconcile-requested')),
  occurred_at TIMESTAMPTZ NOT NULL,
  request_digest TEXT NOT NULL CHECK (length(request_digest) > 0),
  payload JSONB NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'leased', 'published', 'dead-letter')),
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_token TEXT,
  lease_owner TEXT,
  lease_expires_at TIMESTAMPTZ,
  delivery_attempts INTEGER NOT NULL DEFAULT 0 CHECK (delivery_attempts >= 0),
  last_error_code TEXT,
  last_error_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status <> 'leased' OR (lease_token IS NOT NULL AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)),
  CHECK (status <> 'published' OR published_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS evaluation_outbox_pending_idx ON public.evaluation_outbox(status, available_at, id);
CREATE INDEX IF NOT EXISTS evaluation_outbox_job_idx ON public.evaluation_outbox(job_id, created_at, id);

-- Artifact Arena foundation. Immutable version rows keep execution and object references auditable.
CREATE TABLE IF NOT EXISTS public.environment_templates (
  id TEXT PRIMARY KEY,
  owner_id TEXT REFERENCES public.users(id) ON DELETE RESTRICT,
  scope TEXT NOT NULL DEFAULT 'platform',
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  description TEXT NOT NULL CHECK (length(description) BETWEEN 1 AND 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((scope = 'platform' AND owner_id IS NULL) OR (scope = 'private' AND owner_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS environment_templates_owner_idx ON public.environment_templates(owner_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.environment_template_versions (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES public.environment_templates(id) ON DELETE RESTRICT,
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  runtime_kind TEXT NOT NULL CHECK (runtime_kind = 'pi'),
  runtime_adapter_version TEXT NOT NULL,
  runtime_policy_version TEXT NOT NULL,
  capabilities JSONB NOT NULL CHECK (jsonb_typeof(capabilities) = 'array'),
  limits JSONB NOT NULL CHECK (jsonb_typeof(limits) = 'object'),
  artifact_policy JSONB NOT NULL CHECK (jsonb_typeof(artifact_policy) = 'object'),
  content_digest TEXT NOT NULL CHECK (content_digest ~ '^sha256:[0-9a-f]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (template_id, version_number)
);
CREATE INDEX IF NOT EXISTS environment_template_versions_template_idx ON public.environment_template_versions(template_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.creation_briefs (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS creation_briefs_owner_idx ON public.creation_briefs(owner_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.creation_brief_versions (
  id TEXT PRIMARY KEY,
  brief_id TEXT NOT NULL REFERENCES public.creation_briefs(id) ON DELETE RESTRICT,
  owner_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  instructions TEXT NOT NULL CHECK (length(instructions) BETWEEN 1 AND 16384),
  input_attachments JSONB NOT NULL CHECK (jsonb_typeof(input_attachments) = 'array'),
  output_policy JSONB NOT NULL CHECK (jsonb_typeof(output_policy) = 'object'),
  content_digest TEXT NOT NULL CHECK (content_digest ~ '^sha256:[0-9a-f]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (brief_id, version_number)
);
CREATE INDEX IF NOT EXISTS creation_brief_versions_owner_idx ON public.creation_brief_versions(owner_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.creation_runs (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  build_id TEXT NOT NULL REFERENCES public.builds(id) ON DELETE RESTRICT,
  build_version_id TEXT NOT NULL REFERENCES public.build_versions(id) ON DELETE RESTRICT,
  brief_id TEXT NOT NULL REFERENCES public.creation_briefs(id) ON DELETE RESTRICT,
  brief_version_id TEXT NOT NULL REFERENCES public.creation_brief_versions(id) ON DELETE RESTRICT,
  challenge_version_id TEXT REFERENCES public.animation_challenge_versions(id) ON DELETE RESTRICT,
  environment_template_id TEXT NOT NULL REFERENCES public.environment_templates(id) ON DELETE RESTRICT,
  environment_template_version_id TEXT NOT NULL REFERENCES public.environment_template_versions(id) ON DELETE RESTRICT,
  evaluation_job_id TEXT UNIQUE REFERENCES public.evaluation_jobs(id) ON DELETE RESTRICT,
  artifact_bundle_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled', 'incomplete')),
  context JSONB NOT NULL CHECK (jsonb_typeof(context) = 'object' AND context->>'kind' = 'creation' AND (context->>'schemaVersion')::INTEGER = 1),
  context_digest TEXT NOT NULL CHECK (context_digest ~ '^sha256:[0-9a-f]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS creation_runs_owner_created_idx ON public.creation_runs(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS creation_runs_brief_version_idx ON public.creation_runs(brief_version_id, created_at DESC);
CREATE INDEX IF NOT EXISTS creation_runs_challenge_version_idx ON public.creation_runs(challenge_version_id, created_at DESC);
CREATE INDEX IF NOT EXISTS creation_runs_status_idx ON public.creation_runs(status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.artifact_bundles (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  creation_run_id TEXT REFERENCES public.creation_runs(id) ON DELETE RESTRICT,
  run_id TEXT REFERENCES public.runs(id) ON DELETE RESTRICT,
  attempt_id TEXT NOT NULL REFERENCES public.evaluation_attempts(id) ON DELETE RESTRICT,
  output_slot TEXT NOT NULL CHECK (length(output_slot) BETWEEN 1 AND 80),
  status TEXT NOT NULL DEFAULT 'collecting' CHECK (status IN ('collecting', 'sealed', 'rejected')),
  snapshot_digest TEXT NOT NULL CHECK (snapshot_digest ~ '^sha256:[0-9a-f]{64}$'),
  manifest_digest TEXT NOT NULL CHECK (manifest_digest ~ '^sha256:[0-9a-f]{64}$'),
  manifest JSONB NOT NULL CHECK (jsonb_typeof(manifest) = 'object'),
  sealed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (attempt_id, output_slot),
  CHECK ((creation_run_id IS NOT NULL AND run_id IS NULL) OR (creation_run_id IS NULL AND run_id IS NOT NULL)),
  CHECK (status <> 'sealed' OR sealed_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS artifact_bundles_owner_created_idx ON public.artifact_bundles(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS artifact_bundles_creation_run_idx ON public.artifact_bundles(creation_run_id, created_at DESC);
CREATE INDEX IF NOT EXISTS artifact_bundles_run_idx ON public.artifact_bundles(run_id, created_at DESC);

ALTER TABLE public.creation_runs
  DROP CONSTRAINT IF EXISTS creation_runs_artifact_bundle_id_fkey;
ALTER TABLE public.creation_runs
  ADD CONSTRAINT creation_runs_artifact_bundle_id_fkey
  FOREIGN KEY (artifact_bundle_id) REFERENCES public.artifact_bundles(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX IF NOT EXISTS creation_runs_artifact_bundle_unique
  ON public.creation_runs(artifact_bundle_id) WHERE artifact_bundle_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.artifacts (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  bundle_id TEXT NOT NULL REFERENCES public.artifact_bundles(id) ON DELETE RESTRICT,
  path TEXT NOT NULL CHECK (length(path) BETWEEN 1 AND 240 AND path !~ E'(^/|/$|\\\\|:|(^|/)\\.\\.?(/|$))'),
  media_type TEXT NOT NULL CHECK (media_type IN ('text/html', 'text/markdown', 'text/plain', 'text/csv', 'text/css', 'text/javascript', 'application/json', 'application/pdf', 'image/svg+xml', 'image/png', 'image/jpeg', 'image/webp', 'audio/mpeg', 'video/mp4')),
  detected_media_type TEXT CHECK (detected_media_type IS NULL OR detected_media_type IN ('text/html', 'text/markdown', 'text/plain', 'text/csv', 'text/css', 'text/javascript', 'application/json', 'application/pdf', 'image/svg+xml', 'image/png', 'image/jpeg', 'image/webp', 'audio/mpeg', 'video/mp4')),
  size_bytes INTEGER NOT NULL CHECK (size_bytes BETWEEN 1 AND 8388608),
  sha256 TEXT NOT NULL CHECK (sha256 ~ '^sha256:[0-9a-f]{64}$'),
  storage_key TEXT NOT NULL CHECK (length(storage_key) BETWEEN 1 AND 512 AND storage_key !~ E'(^/|/$|\\\\|:|(^|/)\\.\\.?(/|$))'),
  object_version TEXT NOT NULL CHECK (length(object_version) BETWEEN 1 AND 160 AND object_version !~ E'(^latest$|^current$|^head$|^main$|^master$|\\.\\.)'),
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'public')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (bundle_id, path)
);
CREATE INDEX IF NOT EXISTS artifacts_owner_created_idx ON public.artifacts(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS artifacts_bundle_idx ON public.artifacts(bundle_id, path);


-- Durable Artifact Arena showcase and pairwise voting records.
-- Public rows point at immutable artifact digests; object URLs and file bytes stay out of PostgreSQL.
CREATE TABLE IF NOT EXISTS public.work_publications (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  source_bundle_id TEXT NOT NULL REFERENCES public.artifact_bundles(id) ON DELETE RESTRICT,
  source_snapshot_digest TEXT NOT NULL CHECK (source_snapshot_digest ~ '^sha256:[0-9a-f]{64}$'),
  source_manifest_digest TEXT NOT NULL CHECK (source_manifest_digest ~ '^sha256:[0-9a-f]{64}$'),
  source_attempt_fence TEXT NOT NULL CHECK (length(source_attempt_fence) BETWEEN 1 AND 160),
  release_digest TEXT NOT NULL CHECK (release_digest ~ '^sha256:[0-9a-f]{64}$'),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  description TEXT NOT NULL CHECK (length(description) BETWEEN 1 AND 2000),
  entry_path TEXT NOT NULL CHECK (length(entry_path) BETWEEN 1 AND 240 AND entry_path !~ E'(^/|/$|\\|:|(^|/)\\.\\.?(/|$))'),
  files JSONB NOT NULL CHECK (jsonb_typeof(files) = 'array' AND jsonb_array_length(files) BETWEEN 1 AND 200),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'published', 'rejected', 'withdrawn', 'taken-down')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  withdrawn_at TIMESTAMPTZ,
  CHECK (status <> 'withdrawn' OR withdrawn_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS work_publications_owner_created_idx ON public.work_publications(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS work_publications_status_created_idx ON public.work_publications(status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.work_likes (
  id TEXT PRIMARY KEY,
  publication_id TEXT NOT NULL REFERENCES public.work_publications(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, publication_id)
);
CREATE INDEX IF NOT EXISTS work_likes_publication_idx ON public.work_likes(publication_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.showcase_entries (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  publication_id TEXT NOT NULL REFERENCES public.work_publications(id) ON DELETE RESTRICT,
  round_id TEXT NOT NULL CHECK (length(round_id) BETWEEN 1 AND 160),
  comparator_key TEXT NOT NULL CHECK (length(comparator_key) BETWEEN 1 AND 160),
  policy_version TEXT NOT NULL CHECK (length(policy_version) BETWEEN 1 AND 100),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'withdrawn')),
  publication_release_digest TEXT NOT NULL CHECK (publication_release_digest ~ '^sha256:[0-9a-f]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  withdrawn_at TIMESTAMPTZ,
  UNIQUE (publication_id, round_id, comparator_key, policy_version),
  CHECK (status <> 'withdrawn' OR withdrawn_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS showcase_entries_partition_idx ON public.showcase_entries(round_id, comparator_key, policy_version, status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS showcase_entries_active_owner_partition_unique
  ON public.showcase_entries(owner_id, round_id, comparator_key, policy_version)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS public.showcase_ballots (
  id TEXT PRIMARY KEY,
  voter_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  round_id TEXT NOT NULL CHECK (length(round_id) BETWEEN 1 AND 160),
  comparator_key TEXT NOT NULL CHECK (length(comparator_key) BETWEEN 1 AND 160),
  policy_version TEXT NOT NULL CHECK (length(policy_version) BETWEEN 1 AND 100),
  entry_a_id TEXT NOT NULL REFERENCES public.showcase_entries(id) ON DELETE RESTRICT,
  entry_b_id TEXT NOT NULL REFERENCES public.showcase_entries(id) ON DELETE RESTRICT,
  pair_key TEXT NOT NULL CHECK (length(pair_key) BETWEEN 1 AND 600),
  request_digest TEXT NOT NULL CHECK (request_digest ~ '^sha256:[0-9a-f]{64}$'),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 200),
  issued_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'cast', 'expired')),
  cast_vote_id TEXT,
  UNIQUE (voter_id, idempotency_key),
  CHECK (entry_a_id <> entry_b_id),
  CHECK (expires_at > issued_at),
  CHECK ((status = 'cast' AND cast_vote_id IS NOT NULL) OR (status IN ('open', 'expired') AND cast_vote_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS showcase_ballots_voter_pair_open_unique
  ON public.showcase_ballots(voter_id, round_id, comparator_key, policy_version, pair_key)
  WHERE status = 'open';
CREATE INDEX IF NOT EXISTS showcase_ballots_partition_idx ON public.showcase_ballots(voter_id, round_id, comparator_key, policy_version, issued_at DESC);

CREATE TABLE IF NOT EXISTS public.showcase_votes (
  id TEXT PRIMARY KEY,
  ballot_id TEXT NOT NULL UNIQUE REFERENCES public.showcase_ballots(id) ON DELETE RESTRICT,
  voter_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  round_id TEXT NOT NULL CHECK (length(round_id) BETWEEN 1 AND 160),
  comparator_key TEXT NOT NULL CHECK (length(comparator_key) BETWEEN 1 AND 160),
  policy_version TEXT NOT NULL CHECK (length(policy_version) BETWEEN 1 AND 100),
  entry_a_id TEXT NOT NULL REFERENCES public.showcase_entries(id) ON DELETE RESTRICT,
  entry_b_id TEXT NOT NULL REFERENCES public.showcase_entries(id) ON DELETE RESTRICT,
  pair_key TEXT NOT NULL CHECK (length(pair_key) BETWEEN 1 AND 600),
  choice TEXT NOT NULL CHECK (choice IN ('a', 'b', 'tie', 'skip')),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 200),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  validity TEXT NOT NULL DEFAULT 'accepted' CHECK (validity IN ('accepted', 'excluded')),
  exclusion_reason TEXT,
  UNIQUE (voter_id, round_id, comparator_key, policy_version, pair_key),
  UNIQUE (voter_id, idempotency_key),
  CHECK (entry_a_id <> entry_b_id),
  CHECK ((validity = 'accepted' AND exclusion_reason IS NULL) OR (validity = 'excluded' AND exclusion_reason IS NOT NULL AND length(exclusion_reason) BETWEEN 1 AND 500))
);
CREATE INDEX IF NOT EXISTS showcase_votes_partition_idx ON public.showcase_votes(round_id, comparator_key, policy_version, created_at DESC);
CREATE INDEX IF NOT EXISTS showcase_votes_entry_idx ON public.showcase_votes(entry_a_id, entry_b_id, validity, created_at DESC);

-- Shared durable audit stream for publication and voting actions.
CREATE TABLE IF NOT EXISTS public.showcase_audit_events (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL CHECK (action IN ('work-publication.requested', 'work-publication.reviewed', 'work-publication.withdrawn', 'showcase-entry.created', 'showcase-entry.withdrawn', 'showcase-ballot.issued', 'showcase-vote.recorded')),
  actor_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  publication_id TEXT REFERENCES public.work_publications(id) ON DELETE RESTRICT,
  entity_id TEXT,
  occurred_at TIMESTAMPTZ NOT NULL,
  metadata JSONB NOT NULL CHECK (jsonb_typeof(metadata) = 'object')
);
CREATE INDEX IF NOT EXISTS showcase_audit_publication_idx ON public.showcase_audit_events(publication_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS showcase_audit_entity_idx ON public.showcase_audit_events(entity_id, occurred_at DESC);

-- Runner-owned history. Version SQL remains the immutable source of upgrades.
CREATE TABLE IF NOT EXISTS public.schema_migrations (
  version TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  checksum TEXT NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
