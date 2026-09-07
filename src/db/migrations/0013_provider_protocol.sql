-- Existing encrypted credentials retain their Chat Completions semantics.
ALTER TABLE provider_credentials
  ADD COLUMN IF NOT EXISTS protocol TEXT NOT NULL DEFAULT 'openai-chat'
  CHECK (protocol IN ('openai-chat', 'openai-responses', 'anthropic-messages', 'google-generative-ai'));
