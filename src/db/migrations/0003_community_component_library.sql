-- Community component library data foundation. These tables are deliberately
-- separate from competitive runs, submissions and leaderboard evidence.
CREATE TABLE IF NOT EXISTS "components" (
  "id" TEXT PRIMARY KEY,
  "owner_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "visibility" TEXT NOT NULL,
  "draft_revision" INTEGER NOT NULL DEFAULT 0,
  "draft_definition" JSONB NOT NULL,
  "current_version_id" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS "component_versions" (
  "id" TEXT PRIMARY KEY,
  "owner_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "component_id" TEXT NOT NULL REFERENCES "components"("id") ON DELETE CASCADE,
  "version_number" INTEGER NOT NULL,
  "contract_version" INTEGER NOT NULL,
  "definition" JSONB NOT NULL,
  "definition_digest" TEXT NOT NULL,
  "dependencies" JSONB NOT NULL,
  "public_material" JSONB NOT NULL,
  "license_spdx" TEXT,
  "provenance" JSONB NOT NULL,
  "frozen_at" TIMESTAMPTZ NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE ("component_id", "version_number")
);
CREATE TABLE IF NOT EXISTS "component_attachments" (
  "id" TEXT PRIMARY KEY,
  "owner_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "component_version_id" TEXT NOT NULL REFERENCES "component_versions"("id") ON DELETE CASCADE,
  "path" TEXT NOT NULL,
  "media_type" TEXT NOT NULL,
  "size_bytes" INTEGER NOT NULL,
  "sha256" TEXT NOT NULL,
  "storage_key" TEXT NOT NULL,
  "visibility" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE ("component_version_id", "path")
);
CREATE TABLE IF NOT EXISTS "component_test_suites" (
  "id" TEXT PRIMARY KEY,
  "owner_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "component_id" TEXT NOT NULL REFERENCES "components"("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "visibility" TEXT NOT NULL,
  "current_version_id" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS "component_test_suite_versions" (
  "id" TEXT PRIMARY KEY,
  "owner_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "test_suite_id" TEXT NOT NULL REFERENCES "component_test_suites"("id") ON DELETE CASCADE,
  "version_number" INTEGER NOT NULL,
  "cases" JSONB NOT NULL,
  "cases_digest" TEXT NOT NULL,
  "visibility" TEXT NOT NULL,
  "frozen_at" TIMESTAMPTZ NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE ("test_suite_id", "version_number")
);
CREATE TABLE IF NOT EXISTS "component_test_runs" (
  "id" TEXT PRIMARY KEY,
  "owner_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "component_version_id" TEXT NOT NULL REFERENCES "component_versions"("id") ON DELETE CASCADE,
  "test_suite_version_id" TEXT NOT NULL REFERENCES "component_test_suite_versions"("id") ON DELETE CASCADE,
  "evaluation_job_id" TEXT UNIQUE,
  "credential_id" TEXT NOT NULL,
  "model_id" TEXT,
  "runtime_kind" TEXT NOT NULL,
  "execution_source" TEXT,
  "idempotency_key" TEXT NOT NULL,
  "constraints" JSONB NOT NULL,
  "usage" JSONB,
  "result_summary" JSONB,
  "status" TEXT NOT NULL,
  "consent_version" TEXT,
  "request_digest" TEXT NOT NULL,
  "failure_reason" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "started_at" TIMESTAMPTZ,
  "completed_at" TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS "publication_requests" (
  "id" TEXT PRIMARY KEY,
  "component_version_id" TEXT NOT NULL REFERENCES "component_versions"("id") ON DELETE CASCADE,
  "requester_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "status" TEXT NOT NULL,
  "request_revision" INTEGER NOT NULL DEFAULT 1,
  "public_material_snapshot" JSONB NOT NULL,
  "declaration" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "decided_at" TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS "publication_reviews" (
  "id" TEXT PRIMARY KEY,
  "publication_request_id" TEXT NOT NULL REFERENCES "publication_requests"("id") ON DELETE CASCADE,
  "reviewer_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "decision" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "evidence" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS "component_releases" (
  "id" TEXT PRIMARY KEY,
  "component_version_id" TEXT NOT NULL UNIQUE REFERENCES "component_versions"("id") ON DELETE CASCADE,
  "publication_request_id" TEXT NOT NULL UNIQUE REFERENCES "publication_requests"("id") ON DELETE CASCADE,
  "status" TEXT NOT NULL,
  "released_at" TIMESTAMPTZ NOT NULL,
  "disabled_reason" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS "component_usage_references" (
  "id" TEXT PRIMARY KEY,
  "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "build_version_id" TEXT NOT NULL REFERENCES "build_versions"("id") ON DELETE CASCADE,
  "component_version_id" TEXT NOT NULL REFERENCES "component_versions"("id") ON DELETE CASCADE,
  "expansion_digest" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE ("build_version_id", "component_version_id")
);
CREATE TABLE IF NOT EXISTS "extension_applications" (
  "id" TEXT PRIMARY KEY,
  "owner_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "extension_type" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "permission_declaration" TEXT NOT NULL,
  "materials" JSONB NOT NULL,
  "status" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "decided_at" TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS components_owner_idx ON components(owner_id);
CREATE INDEX IF NOT EXISTS component_versions_component_idx ON component_versions(component_id, version_number DESC);
CREATE INDEX IF NOT EXISTS component_attachments_owner_idx ON component_attachments(owner_id);
CREATE INDEX IF NOT EXISTS component_test_suites_owner_idx ON component_test_suites(owner_id);
CREATE INDEX IF NOT EXISTS component_test_runs_owner_idx ON component_test_runs(owner_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS component_test_runs_idempotency_unique_0 ON component_test_runs(owner_id, idempotency_key);
CREATE INDEX IF NOT EXISTS publication_requests_version_idx ON publication_requests(component_version_id, created_at DESC);
CREATE INDEX IF NOT EXISTS publication_reviews_request_idx ON publication_reviews(publication_request_id, created_at DESC);
CREATE INDEX IF NOT EXISTS component_releases_status_idx ON component_releases(status, released_at DESC);
CREATE INDEX IF NOT EXISTS component_usage_references_build_idx ON component_usage_references(build_version_id);
