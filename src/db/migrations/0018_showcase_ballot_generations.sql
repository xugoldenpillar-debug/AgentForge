-- Allow a voter to receive a new ballot generation after an old ballot expires.
-- The vote table remains the durable once-per-pair fence; only one open ballot
-- generation may exist for a voter and pair at a time.
ALTER TABLE public.showcase_ballots
  DROP CONSTRAINT IF EXISTS showcase_ballots_voter_pair_unique,
  -- PostgreSQL truncates generated constraint names at 63 bytes. This is the
  -- name used by the Hubei production schema for the legacy full-pair unique
  -- constraint; keep the historical variants below for older deployments.
  DROP CONSTRAINT IF EXISTS showcase_ballots_voter_id_round_id_comparator_key_policy_ve_key,
  DROP CONSTRAINT IF EXISTS showcase_ballots_voter_id_round_id_comparator_key_policy_versio;

-- Some early deployments used the Drizzle-generated index name instead of the
-- table constraint above. Keep the migration safe for either starting shape.
DROP INDEX IF EXISTS public.showcase_ballots_voter_pair_unique;

CREATE UNIQUE INDEX IF NOT EXISTS showcase_ballots_voter_pair_open_unique
  ON public.showcase_ballots(voter_id, round_id, comparator_key, policy_version, pair_key)
  WHERE status = 'open';
