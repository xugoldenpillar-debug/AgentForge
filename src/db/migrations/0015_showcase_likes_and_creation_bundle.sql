-- Link a completed CreationRun to its sealed bundle and add independent likes.
ALTER TABLE public.creation_runs
  ADD COLUMN IF NOT EXISTS artifact_bundle_id TEXT;

ALTER TABLE public.creation_runs
  DROP CONSTRAINT IF EXISTS creation_runs_artifact_bundle_id_fkey;
ALTER TABLE public.creation_runs
  ADD CONSTRAINT creation_runs_artifact_bundle_id_fkey
  FOREIGN KEY (artifact_bundle_id) REFERENCES public.artifact_bundles(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS creation_runs_artifact_bundle_unique
  ON public.creation_runs(artifact_bundle_id)
  WHERE artifact_bundle_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.work_likes (
  id TEXT PRIMARY KEY,
  publication_id TEXT NOT NULL REFERENCES public.work_publications(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, publication_id)
);
CREATE INDEX IF NOT EXISTS work_likes_publication_idx
  ON public.work_likes(publication_id, created_at DESC);
