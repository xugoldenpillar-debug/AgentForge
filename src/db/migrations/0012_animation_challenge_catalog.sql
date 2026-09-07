-- Additive catalog only. Does not enable execution or create simulated activity.
CREATE TABLE IF NOT EXISTS animation_challenges (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  position INTEGER NOT NULL CHECK (position > 0),
  status TEXT NOT NULL CHECK (status IN ('draft', 'published', 'retired'))
);
CREATE TABLE IF NOT EXISTS animation_challenge_versions (
  id TEXT PRIMARY KEY,
  challenge_id TEXT NOT NULL REFERENCES animation_challenges(id) ON DELETE RESTRICT,
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  title_en TEXT NOT NULL CHECK (length(title_en) BETWEEN 1 AND 120),
  instructions TEXT NOT NULL CHECK (length(instructions) BETWEEN 1 AND 16384),
  instructions_en TEXT NOT NULL CHECK (length(instructions_en) BETWEEN 1 AND 16384),
  output_policy_version TEXT NOT NULL CHECK (output_policy_version = 'svg-animation-v1'),
  content_digest TEXT NOT NULL CHECK (content_digest ~ '^sha256:[a-f0-9]{64}$'),
  UNIQUE (challenge_id, version_number)
);
