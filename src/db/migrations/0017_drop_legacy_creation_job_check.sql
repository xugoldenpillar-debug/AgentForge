-- Migration 0014 added the creation association constraint but the unnamed
-- constraint from 0006 retained the old three-purpose expression. Remove that
-- legacy check so CreationRun jobs can be inserted under the versioned v2 rule.
ALTER TABLE public.evaluation_jobs
  DROP CONSTRAINT IF EXISTS evaluation_jobs_check;
