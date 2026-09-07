ALTER TABLE build_versions ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'workflow';
ALTER TABLE build_versions ADD COLUMN IF NOT EXISTS agent_definition JSONB;
ALTER TABLE build_versions ADD COLUMN IF NOT EXISTS definition_digest TEXT;
ALTER TABLE build_versions ADD CONSTRAINT build_versions_mode_payload CHECK (
  (mode = 'workflow' AND agent_definition IS NULL AND definition_digest IS NULL)
  OR (mode = 'agent' AND visibility = 'private' AND agent_definition IS NOT NULL
      AND COALESCE(agent_definition->>'mode' = 'agent', false)
      AND COALESCE(agent_definition->>'definitionSchemaVersion' = '1', false)
      AND definition_digest IS NOT NULL AND definition_digest ~ '^sha256:[0-9a-f]{64}$')
);
ALTER TABLE fork_relations ADD COLUMN IF NOT EXISTS source_version_id TEXT REFERENCES build_versions(id);
