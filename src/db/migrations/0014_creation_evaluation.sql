-- Creation Evaluation Foundation v2.
-- This migration is additive: old evaluation jobs keep their original shape and
-- remain readable/processable while creation jobs gain an explicit association.
ALTER TABLE public.evaluation_jobs
  DROP CONSTRAINT IF EXISTS evaluation_jobs_purpose_check,
  DROP CONSTRAINT IF EXISTS evaluation_jobs_association_kind_check,
  DROP CONSTRAINT IF EXISTS evaluation_jobs_association_check;

ALTER TABLE public.evaluation_jobs
  ADD CONSTRAINT evaluation_jobs_purpose_check
    CHECK (purpose IN ('competitive', 'author-self-test', 'component-evaluation', 'creation')),
  ADD CONSTRAINT evaluation_jobs_association_kind_check
    CHECK (association_kind IN ('competitive-run', 'self-test-run', 'component-evaluation', 'creation-run')),
  ADD CONSTRAINT evaluation_jobs_association_check
    CHECK (
      (purpose = 'competitive' AND association_kind = 'competitive-run' AND competitive_run_id IS NOT NULL AND business_record_id = competitive_run_id AND association_visibility IS NOT NULL)
      OR (purpose = 'author-self-test' AND association_kind = 'self-test-run' AND competitive_run_id IS NULL AND association_visibility IS NULL)
      OR (purpose = 'component-evaluation' AND association_kind = 'component-evaluation' AND competitive_run_id IS NULL AND association_visibility IS NULL)
      OR (purpose = 'creation' AND association_kind = 'creation-run' AND competitive_run_id IS NULL AND association_visibility IS NULL)
    );

ALTER TABLE public.evaluation_budget_reservations
  DROP CONSTRAINT IF EXISTS evaluation_budget_reservations_purpose_check;
ALTER TABLE public.evaluation_budget_reservations
  ADD CONSTRAINT evaluation_budget_reservations_purpose_check
    CHECK (purpose IN ('competitive', 'author-self-test', 'component-evaluation', 'creation'));

ALTER TABLE public.creation_runs
  ADD COLUMN IF NOT EXISTS challenge_version_id TEXT REFERENCES public.animation_challenge_versions(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS creation_runs_challenge_version_idx
  ON public.creation_runs(challenge_version_id, created_at DESC);
