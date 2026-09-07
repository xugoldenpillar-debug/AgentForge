-- Nullable invite state for the optional Pi self-test entry. Existing users stay unlabeled.
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS pi_runtime_access TEXT;
