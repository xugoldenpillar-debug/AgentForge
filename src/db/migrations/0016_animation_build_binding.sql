-- Bind Creation v2 Agent Builds to an immutable animation challenge version
-- without rewriting or mixing legacy DAG problem history.
ALTER TABLE public.builds
  ADD COLUMN IF NOT EXISTS animation_challenge_id TEXT;

ALTER TABLE public.builds
  DROP CONSTRAINT IF EXISTS builds_animation_challenge_id_fkey;
ALTER TABLE public.builds
  ADD CONSTRAINT builds_animation_challenge_id_fkey
  FOREIGN KEY (animation_challenge_id)
  REFERENCES public.animation_challenges(id)
  ON DELETE RESTRICT;

ALTER TABLE public.builds ALTER COLUMN problem_id DROP NOT NULL;

ALTER TABLE public.builds
  DROP CONSTRAINT IF EXISTS builds_target_check;
ALTER TABLE public.builds
  ADD CONSTRAINT builds_target_check CHECK (
    (problem_id IS NOT NULL AND animation_challenge_id IS NULL)
    OR (problem_id IS NULL AND animation_challenge_id IS NOT NULL)
  ) NOT VALID;
ALTER TABLE public.builds VALIDATE CONSTRAINT builds_target_check;

ALTER TABLE public.build_versions
  ADD COLUMN IF NOT EXISTS animation_challenge_version_id TEXT;

ALTER TABLE public.build_versions
  DROP CONSTRAINT IF EXISTS build_versions_animation_challenge_version_id_fkey;
ALTER TABLE public.build_versions
  ADD CONSTRAINT build_versions_animation_challenge_version_id_fkey
  FOREIGN KEY (animation_challenge_version_id)
  REFERENCES public.animation_challenge_versions(id)
  ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS builds_animation_challenge_idx
  ON public.builds(animation_challenge_id, updated_at DESC)
  WHERE animation_challenge_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS build_versions_animation_challenge_version_idx
  ON public.build_versions(animation_challenge_version_id, created_at DESC)
  WHERE animation_challenge_version_id IS NOT NULL;
