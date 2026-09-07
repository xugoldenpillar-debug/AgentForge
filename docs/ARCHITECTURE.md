# Architecture and trust boundaries

## One application, separate environments

Next.js is the only application runtime: React/React Flow/Zustand, Better Auth,
PostgreSQL/Drizzle, and server-side AI adapters. Portable and its JSON authentication
and storage are retired. Historical local data is not automatically migrated or deleted.

`APP_ENV=test` plus `DEMO_MODE=true` explicitly enables offline models on the same
Next.js server for isolated testing. Development/production defaults do not enable
Demo, even with a legacy Demo flag. Test memory repositories and simulated activity
fixtures live under tests/helpers, not application persistence. Initial catalog seeding
is idempotent by stable ID and never creates simulated users, runs or scores.
Homepage and catalog statistics exclude seeded profiles and Demo scores in normal mode;
challenge scores and skill success rates use BYOK rather than mixing trust lanes.
New and forked workflows start unconfigured; drafts can be saved, but execution
requires an explicit provider. The compatibility runtime field is always `next`.


## Workflow semantics

Every node must be on an Input-to-Output path, with no path bypassing a Model. One Input and one Output are required, at least one Model is required, and sorting is deterministic. Edges define actual data dependencies. Fan-in combines parent text, prompt contexts, skills and equipped tools in deterministic source-ID order. This is a small DAG executor, not a general LangGraph replacement or parallel scheduler.

Prompt nodes assemble system context and interpolate `{{input}}` / `{{previous}}` in a single pass. Input values are literal strings, never recursively rendered. Tool nodes before a Model equip registered AI SDK tools; tool nodes after a Model execute that safe operation on its output. Model nodes resolve an owner-scoped provider/model pair. Validators assert output contracts. A failed explicit validator remains a failure even when later nodes generate valid text.

Structured/Extract/Concise/Safety skills configure the downstream model. Reflection performs one additional generation; Retry performs one repair when a structured/length contract fails. They are bounded by six model invocations per case, global token/tool/cost/latency limits, and model step limits. Reflection/Retry do not interpret arbitrary JavaScript. Concise is a character limit; token budgets are tracked independently. All configurable schemas are bounded in size/depth.

The execution trace includes node identifiers, status, tokens and timing, not provider headers or system secrets. Public tests expose traces and actual outputs. Hidden runs emit only start, aggregate progress, final totals and static error messages.

## Versioning and persistence

`builds.currentVersionId` is a draft pointer. `build_versions`, `workflow_nodes` and `workflow_edges` hold immutable version snapshots. `build_skills` and `build_tools` are queryable join tables, not an opaque workflow blob. Config fields may use JSONB. Submissions point to the executed version, not whatever draft is currently open. Optimistic saves require the expected version ID; stale saves roll back rather than overwrite. Forking the selected historical version preserves its content/title, records `parentBuildId` / `fork_relations` and removes every credential reference.

Better Auth owns users/accounts/sessions/verifications in the full stack. Game relations cover problems/test_cases, runs/run_cases/submissions, encrypted provider_credentials, failure_cases/reputations/badges/user_badges. Rate limits and execution locks live in PostgreSQL so multiple app processes share counters and leases. Drizzle transactions use serializable isolation with bounded serialization retries. The migration runner applies immutable SQL files from `src/db/migrations`, verifies the `schema_migrations` SHA-256 history, and uses a transaction-scoped advisory lock on a pinned postgres.js connection. The first migration freezes the legacy schema; the second adds the nullable accounts issuer column for existing databases. `src/db/schema.sql` remains the target snapshot, not the runtime migration input. Native runner tests do not establish actual PostgreSQL concurrency or authentication correctness; use the isolated migration matrix and full-stack smoke.

## Evaluation and leaderboard trust

The server chooses fixture cases, judge, secret and constraints. Request bodies cannot supply expected values or hidden cases. Results are deterministic for a given set of outputs/metrics. Only completed hidden runs create submissions. Different trust lanes are never mixed in a leaderboard: Demo is simulated, BYOK is unverified, Verified requires server-controlled Gateway model with configured pricing. Ratings/seeds should not be presented as evidence of model performance.

A BYOK gateway necessarily sees its requested test inputs and can return dishonest content/usage. Encryption cannot solve this. The separate lane is an explicit product security decision. Unknown pricing stays null; a real benchmark host should additionally vet its provider and meter costs independently. The seeded static suite is discoverable in this source package, so production tests must be hosted separately and versioned.

Failure Hunter picks the best submitted version in the selected trust lane. A hunter uses their own credential (never the author's) and cannot execute another user's private prompt through a chosen gateway. JSON-shape/enum-membership/secret-leak failure can be deterministic; arbitrary semantic correctness needs reviewed expected output. Duplicate normalized input/version reports cannot farm reputation; self-breaks do not earn points and daily awards are capped.

## Credential and egress boundary

AES-256-GCM records contain version, random nonce, authentication tag and ciphertext. Additional authenticated data binds user ID + credential ID, preventing swapped ciphertext between users/records. Plain API keys appear only transiently in server memory for encryption/decryption/provider construction. Public serializers explicitly select metadata plus a last-four mask. The model adapter sanitizes upstream errors and disables SDK telemetry. Never add debug logging of provider requests.

BYOK HTTP clients use exact-host HTTPS allowlists, no redirects, validated public DNS addresses, a connection-time DNS check, response-size cap and timeout. No literal IPs, user-info, URL query, fragments or private networks are accepted. Only the five registered tool implementations exist; no shell, arbitrary file reads, dynamic code evaluation or custom executable uploads. React escapes values, and unsafe HTML output is never interpreted.

## Deployment boundaries

Production TLS/origin configuration, email verification/recovery, account abuse monitoring, content moderation, database backup, key rotation and service observability need deployment-specific work. The Next CSP is a development-compatible baseline with inline/eval allowances; harden it with tested per-request nonces before public deployment. The Docker image keeps dev tooling to run migrations/seed; optimize it only after the full build path passes in your environment. The evaluation-foundation tables, Outbox/BullMQ delivery path and independent Node Worker exist in the current code behind explicit scheduler configuration; the request-bound path remains a compatibility fallback when that scheduler is not configured. Production deployment and reconnect/resume behavior still require separate validation.

## Official Flash adaptation within existing BYOK

The existing BYOK SDK adapter now resolves official DeepSeek endpoints through the Registry, forces non-thinking Flash and requires real input/output usage. Other compatible BYOK endpoints retain their existing behavior. This does not introduce a new trust lane or implement Official/Custom credential authorization. Credentials still use the existing owner-bound AES-GCM store. Unknown pricing remains null, so token/call bounds do not imply a monetary hard cap. See `docs/verification/deepseek-app-live-2026-09-06.md`.

## Evaluation foundation and worker architecture (foundation implemented; product integrations pending, 2026-09-07)

See [project design map](../specs/README.md), [evaluation foundation](../specs/evaluation-foundation/README.md) and ADR-0012. The current implementation includes the shared Job/Attempt/Invocation foundation, Outbox/BullMQ delivery, an independent Worker, idempotency and lease/recovery boundaries. The request-bound executor remains available only as a compatibility path when the durable scheduler is not configured. Complete component SelfTestRun, community/Verified integration, production operations, shared quota policy and email flows remain pending and are not claimed as production-verified.

The target keeps one Next.js application with independent Node workers. PostgreSQL owns business state and evidence; Redis/BullMQ coordinates delivery. Competitive Run and component SelfTestRun remain distinct records under common evaluation jobs/attempts. Verified execution reuses this foundation while retaining its separate private model gateway, Ticket/Profile/Season/Receipt gates. Pi is an optional execution adapter, not an alternative web application or a security sandbox.

Public caching may be eventually consistent; permissions, credential revocation, execution eligibility and budget are authoritative checks. Queue waiting time is distinct from execution latency used for scoring. Component self-test detail retention does not override Gateway audit retention. See the design map for scope and cross-branch dependencies; no historical Portable data is deleted by this design.

## Optional Pi adapter — current vs target

Target: a second task runtime behind the same platform adapter boundary, default off, never a sandbox and never mixed into competitive leaderboards.

Current: optional Pi adapter behind `PI_RUNTIME_ENABLED` (exact string `true`; default `false`). Competitive `ArenaService.run` goes through the DAG adapter onto the same `executeWorkflow`; new `runs` rows store nullable DAG identity and are not backfilled. Pi is not a sandbox, has no public UI selector, and does not write competitive submissions. Bridge A reuses official Flash safe fetch; Bridge B stays unavailable. Invited/public enablement is still off.

## Pi/main integration safety boundary

Private Agent B1/B2 drafts coexist with community components and durable evaluation,
without enabling B3 or sandbox execution. Both competitive enqueue and the worker inspect
the selected **immutable BuildVersion mode** before provider or invocation work. A current
Build pointer changing later does not invalidate a queued Workflow version. Existing
community/private projections and exact-version Fork ACLs remain authoritative.

Pi demo self-test is allowed only with explicit `APP_ENV=test`, `DEMO_MODE=true`,
invitation/flag/engine gates, and **no EF scheduler configured**. With an EF scheduler
(or outbox environment setting), both status and execution fail closed, even for Demo:
the legacy lease is not shared durable admission, and checking for active jobs first
would not make it atomic. Real credential self-test now fails
closed with `RUNTIME_UNAVAILABLE` before credential lookup/decryption, execution lease,
adapter construction or network calls: the request-bound Pi bridge has not been wired
to shared EF reservations, quotas and usage receipts. Offline real-SDK tests are not
production self-test admission. The main EF worker retains its existing executor/outbox
and evidence path; it is not silently relabeled as the PoC DAG adapter.

The durable Run adapter recovers only an exact PostgreSQL `runs_pkey` insertion race.
It rereads the same user's Run, validates immutable identity and uses the committed
winner's timestamp in the snapshot digest. Other database errors and mismatched
idempotency requests are not swallowed. A real DB/BullMQ regression covers this race.

New EF competitive Runs identify runtime kind `dag`, but adapter/policy identity stays
null: their existing frozen EF policy snapshot is authoritative, not `poc-dag-v1` or
`poc-t4-v1`. Existing rows are not backfilled.

The independent production worker uses the same durable competitive completion
adapter as the web scheduler. `createProductionWorkerService` is exercised by the real
PostgreSQL/BullMQ gate: a worker with only model execution options cannot finalize a
Run/Submission and would conservatively leave an unknown Job after usage was recorded.
The integration fixes that composition without replaying or deleting unknown work.
