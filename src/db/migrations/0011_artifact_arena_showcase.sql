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
  UNIQUE (voter_id, round_id, comparator_key, policy_version, pair_key),
  UNIQUE (voter_id, idempotency_key),
  CHECK (entry_a_id <> entry_b_id),
  CHECK (expires_at > issued_at),
  CHECK ((status = 'cast' AND cast_vote_id IS NOT NULL) OR (status IN ('open', 'expired') AND cast_vote_id IS NULL))
);
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
