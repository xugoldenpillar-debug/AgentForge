-- Existing installations predate Better Auth's issuer mapping. Nullable additive
-- upgrade preserves accounts and passwords; the frozen baseline cannot add columns.
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS issuer TEXT;
