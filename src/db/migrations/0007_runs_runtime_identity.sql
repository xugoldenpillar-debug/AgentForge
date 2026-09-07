-- Nullable identity for new runs. Existing rows stay unlabeled; do not backfill as dag or pi.
ALTER TABLE public.runs ADD COLUMN IF NOT EXISTS runtime_kind TEXT;
ALTER TABLE public.runs ADD COLUMN IF NOT EXISTS adapter_version TEXT;
ALTER TABLE public.runs ADD COLUMN IF NOT EXISTS policy_version TEXT;
