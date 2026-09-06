-- Synthetic, non-secret records. Never use real credentials in migration fixtures.
INSERT INTO users (id, name, email) VALUES ('migration-user', 'Migration User', 'migration@example.invalid');
INSERT INTO accounts (id, account_id, provider_id, user_id, password)
VALUES ('migration-account', 'migration-user', 'credential', 'migration-user', 'fixture-not-a-valid-password-hash');
INSERT INTO sessions (id, expires_at, token, user_id)
VALUES ('migration-session', '2030-01-01', 'fixture-not-a-session-token', 'migration-user');
INSERT INTO problems (id, slug, title, description, mission, goal, why, category, difficulty, tags, judge, constraints, status)
VALUES ('migration-problem', 'migration-problem', 'Fixture', 'Fixture', 'Fixture', 'Fixture', 'Fixture', 'test', 'easy', '[]', 'exact', '{}', 'published');
INSERT INTO builds (id, user_id, problem_id, title, visibility, current_version_id)
VALUES ('migration-build', 'migration-user', 'migration-problem', 'Fixture Build', 'private', 'migration-version');
INSERT INTO build_versions (id, build_id, revision, title, visibility)
VALUES ('migration-version', 'migration-build', 1, 'Fixture Build', 'private');
INSERT INTO provider_credentials (id, user_id, name, base_url, model_id, ciphertext, last_four, input_price, output_price)
VALUES ('migration-credential', 'migration-user', 'Legacy custom', 'https://example.invalid/v1', 'legacy-model', 'fixture-not-encrypted-material', 'fake', 1, 2);
INSERT INTO runs (id, build_id, version_id, problem_id, user_id, kind, tier, status, summary)
VALUES ('migration-run', 'migration-build', 'migration-version', 'migration-problem', 'migration-user', 'hidden', 'byok', 'completed', '{"fixture":true}');
INSERT INTO submissions (id, run_id, build_id, version_id, user_id, problem_id, tier, score, accuracy, robustness, security, efficiency, elegance, tokens, cost, latency, nodes, model)
VALUES ('migration-submission', 'migration-run', 'migration-build', 'migration-version', 'migration-user', 'migration-problem', 'byok', 42, 0.5, 0.5, 1, 0.5, 1, 100, 0.001, 10, 3, 'legacy-model');
