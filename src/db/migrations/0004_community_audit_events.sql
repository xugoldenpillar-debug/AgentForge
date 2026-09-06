-- Durable audit history for community component-library state changes.
CREATE TABLE IF NOT EXISTS "community_audit_events" (
  "id" TEXT PRIMARY KEY,
  "action" TEXT NOT NULL,
  "actor_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "component_id" TEXT NOT NULL REFERENCES "components"("id") ON DELETE CASCADE,
  "component_version_id" TEXT REFERENCES "component_versions"("id") ON DELETE SET NULL,
  "publication_request_id" TEXT REFERENCES "publication_requests"("id") ON DELETE SET NULL,
  "occurred_at" TIMESTAMPTZ NOT NULL,
  "metadata" JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS community_audit_events_component_idx ON community_audit_events(component_id, occurred_at);
