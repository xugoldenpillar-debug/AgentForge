CREATE TABLE IF NOT EXISTS public.evaluation_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  purpose TEXT NOT NULL CHECK (purpose IN ('competitive', 'author-self-test', 'component-evaluation')),
  association_kind TEXT NOT NULL CHECK (association_kind IN ('competitive-run', 'self-test-run', 'component-evaluation')),
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
  CHECK (
    (purpose = 'competitive' AND association_kind = 'competitive-run' AND competitive_run_id IS NOT NULL AND business_record_id = competitive_run_id AND association_visibility IS NOT NULL)
    OR (purpose = 'author-self-test' AND association_kind = 'self-test-run' AND competitive_run_id IS NULL AND association_visibility IS NULL)
    OR (purpose = 'component-evaluation' AND association_kind = 'component-evaluation' AND competitive_run_id IS NULL AND association_visibility IS NULL)
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
  purpose TEXT NOT NULL CHECK (purpose IN ('competitive', 'author-self-test', 'component-evaluation')),
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
