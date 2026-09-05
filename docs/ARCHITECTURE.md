# Architecture and trust boundaries

## One domain, two frontends

The primary application is a Next.js modular monolith. A small Node-only runtime permits an install-free demo. Both instantiate `ArenaService` and execute the same workflow, judges, scores, catalog, fixtures, serializers and credential crypto. They do not share persistence or authentication state. There is no automatic portable-to-Postgres migration.

| Layer | Full runtime | Portable runtime |
| --- | --- | --- |
| Web frontend | React / @xyflow/react / Zustand | Vanilla JS / SVG / pointer events |
| Authentication | Better Auth + Drizzle | Local scrypt hashes + opaque cookie sessions |
| Storage | PostgreSQL, normalized tables, JSONB configs | Normalized in-memory tables persisted atomically to JSON |
| AI | Vercel AI SDK compatible / Gateway adapters; optional demo | Demo only; real provider request rejected |
| Validation | Zod API + domain config validation | Same domain validation, bounded JSON reader |
| Distributed controls | PostgreSQL rate-limit/upsert and execution leases | Single-process rate limits and execution leases |

The native HTTP adapter serves only an explicit asset allowlist. It cannot serve the source tree, environment or data files. Portable data has restrictive file permissions; bind is loopback-only. Do not run multiple portable processes against the same data directory.

## Workflow semantics

Every node must be on an Input-to-Output path, with no path bypassing a Model. One Input and one Output are required, at least one Model is required, and sorting is deterministic. Edges define actual data dependencies. Fan-in combines parent text, prompt contexts, skills and equipped tools in deterministic source-ID order. This is a small DAG executor, not a general LangGraph replacement or parallel scheduler.

Prompt nodes assemble system context and interpolate `{{input}}` / `{{previous}}` in a single pass. Input values are literal strings, never recursively rendered. Tool nodes before a Model equip registered AI SDK tools; tool nodes after a Model execute that safe operation on its output. Model nodes resolve an owner-scoped provider/model pair. Validators assert output contracts. A failed explicit validator remains a failure even when later nodes generate valid text.

Structured/Extract/Concise/Safety skills configure the downstream model. Reflection performs one additional generation; Retry performs one repair when a structured/length contract fails. They are bounded by six model invocations per case, global token/tool/cost/latency limits, and model step limits. Reflection/Retry do not interpret arbitrary JavaScript. Concise is a character limit; token budgets are tracked independently. All configurable schemas are bounded in size/depth.

The execution trace includes node identifiers, status, tokens and timing, not provider headers or system secrets. Public tests expose traces and actual outputs. Hidden runs emit only start, aggregate progress, final totals and static error messages.

## Versioning and persistence

`builds.currentVersionId` is a draft pointer. `build_versions`, `workflow_nodes` and `workflow_edges` hold immutable version snapshots. `build_skills` and `build_tools` are queryable join tables, not an opaque workflow blob. Config fields may use JSONB. Submissions point to the executed version, not whatever draft is currently open. Optimistic saves require the expected version ID; stale saves roll back rather than overwrite. Forking the selected historical version preserves its content/title, records `parentBuildId` / `fork_relations` and removes every credential reference.

Better Auth owns users/accounts/sessions/verifications in the full stack. Game relations cover problems/test_cases, runs/run_cases/submissions, encrypted provider_credentials, failure_cases/reputations/badges/user_badges. Rate limits and execution locks live in PostgreSQL so multiple app processes share counters and leases. Drizzle transactions use serializable isolation with bounded serialization retries. Initial migration is an idempotent checked-in DDL bootstrap; future schema changes need real versioned ALTER migrations, not simply editing CREATE TABLE IF NOT EXISTS.

## Evaluation and leaderboard trust

The server chooses fixture cases, judge, secret and constraints. Request bodies cannot supply expected values or hidden cases. Results are deterministic for a given set of outputs/metrics. Only completed hidden runs create submissions. Different trust lanes are never mixed in a leaderboard: Demo is simulated, BYOK is unverified, Verified requires server-controlled Gateway model with configured pricing. Ratings/seeds should not be presented as evidence of model performance.

A BYOK gateway necessarily sees its requested test inputs and can return dishonest content/usage. Encryption cannot solve this. The separate lane is an explicit product security decision. Unknown pricing stays null; a real benchmark host should additionally vet its provider and meter costs independently. The seeded static suite is discoverable in this source package, so production tests must be hosted separately and versioned.

Failure Hunter picks the best submitted version in the selected trust lane. A hunter uses their own credential (never the author's) and cannot execute another user's private prompt through a chosen gateway. JSON-shape/enum-membership/secret-leak failure can be deterministic; arbitrary semantic correctness needs reviewed expected output. Duplicate normalized input/version reports cannot farm reputation; self-breaks do not earn points and daily awards are capped.

## Credential and egress boundary

AES-256-GCM records contain version, random nonce, authentication tag and ciphertext. Additional authenticated data binds user ID + credential ID, preventing swapped ciphertext between users/records. Plain API keys appear only transiently in server memory for encryption/decryption/provider construction. Public serializers explicitly select metadata plus a last-four mask. The model adapter sanitizes upstream errors and disables SDK telemetry. Never add debug logging of provider requests.

BYOK HTTP clients use exact-host HTTPS allowlists, no redirects, validated public DNS addresses, a connection-time DNS check, response-size cap and timeout. No literal IPs, user-info, URL query, fragments or private networks are accepted. Only the five registered tool implementations exist; no shell, arbitrary file reads, dynamic code evaluation or custom executable uploads. React escapes values, the portable renderer escapes interpolated text, and unsafe HTML output is never interpreted.

## Deployment boundaries

Portable auth is local-only and is not Better Auth. Production TLS/origin configuration, email verification/recovery, account abuse monitoring, content moderation, database backup, key rotation and service observability need deployment-specific work. The Next CSP is a development-compatible baseline with inline/eval allowances; harden it with tested per-request nonces before public deployment. The Docker image keeps dev tooling to run migrations/seed; optimize it only after the full build path passes in your environment. Long executions are request-bound; no durable job queue or reconnect-resume protocol is claimed.
