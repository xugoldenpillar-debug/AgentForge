
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
  environment_template_id TEXT NOT NULL REFERENCES public.environment_templates(id) ON DELETE RESTRICT,
  environment_template_version_id TEXT NOT NULL REFERENCES public.environment_template_versions(id) ON DELETE RESTRICT,
  evaluation_job_id TEXT UNIQUE REFERENCES public.evaluation_jobs(id) ON DELETE RESTRICT,
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
