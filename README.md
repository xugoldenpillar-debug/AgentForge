# AgentForge

**Build AI. Beat Problems.** A locally playable AI-building arena: build an agent, run public tests, submit against a server-side benchmark, compete across five leaderboards, then fork a better version.

AgentForge has one application runtime: **Next.js + PostgreSQL + Better Auth**.
Development and isolated testing use the same application. The early Portable preview
has been retired; existing local data is not deleted or migrated.

## Run the application

Prerequisites: Node.js >=22.16, Corepack/pnpm, Docker with Compose, internet access for dependency installation.

```sh
corepack enable
pnpm install
pnpm run setup
docker compose up -d postgres
pnpm db
pnpm dev
```

Open `http://localhost:3000`. `pnpm run setup` creates `.env` with unique encryption/authentication keys and never overwrites an existing file. `pnpm db` applies the checked-in versioned SQL migrations and idempotent seed. Migration history is checksummed and protected by a transaction-scoped lock; see `docs/MIGRATIONS.md`. The example uses a local development PostgreSQL password; change it before deployment. If changing `POSTGRES_PASSWORD`, also update the local `DATABASE_URL` for a host-run application.

Full stack: Next.js 16 App Router, TypeScript, Tailwind 4, shadcn-style Radix components, **@xyflow/react** with Zustand, Vercel AI SDK adapters, PostgreSQL with Drizzle, Zod request validation, Better Auth email/password and optional GitHub OAuth. All model and credential code executes on the server.

For the complete Docker stack:

```sh
node scripts/setup.mjs
docker compose up --build
```

The app waits for PostgreSQL's health check, initializes the schema/seed, and starts Next.js. Both exposed ports bind to localhost by default.

### Environment and verification

Normal environments default to `APP_ENV=development`, `DEMO_MODE=false`. Even an old
`DEMO_MODE=true` has no effect unless `APP_ENV=test` is explicitly set. Test mode is
for isolated test databases only, including when testing a production build locally.
`NODE_ENV` does not opt in. Never deploy with the test environment configuration.

Optional Pi runtime stays off unless `PI_RUNTIME_ENABLED` is the exact string `true`
(`.env.example` defaults to `false`). Contributors do not install Pi; Node `<22.19.0`
refuses Pi while the app `engines.node` remains `>=22.16.0`. This is an offline PoC,
not a user-selectable runtime, sandbox, or competitive Run path.

Database initialization inserts only reference challenges, cases, skills, tools and
badges. It neither generates fake activity nor overwrites existing catalog records.
No standard account is created. Register your account and configure Providers.
Existing Demo history remains labeled and separate; forks and new workflows have no
selected provider. Saving a draft is allowed; running requires a provider and consent.

See `docs/verification/retire-portable-2026-09-06.md` for the retirement evidence,
`docs/VERIFICATION.md` for the historical verification matrix, and
`docs/PI-MAIN-INTEGRATION-REVIEW.md` for the current merged delivery status.
Historical Portable screenshots and checks are not current Next.js acceptance. The
application remains an MVP, not a production security certification or a completed
Verified Gateway implementation.

## Real model calls / BYOK

Use the **full Next.js runtime**, sign in, and open **Providers**. Save a name, OpenAI-compatible base URL, API key and model ID. Select that credential on the Builder's Model node. Real runs require an explicit token-spending consent checkbox. An unavailable or failed real provider produces an error; it never falls back to simulation.

Only administrator-allowlisted HTTPS hosts on port 443 are accepted. Add a trusted gateway's exact hostname to `PROVIDER_ALLOWED_HOSTS` in `.env`, then restart the app. URL credentials, query/fragment, literal IPs, private/reserved DNS answers and redirects are rejected. DNS addresses are rechecked and pinned by the actual HTTP connection. This means local model endpoints and LAN gateways are **deliberately not supported by this V1 security policy**.

User-supplied pricing is optional and is interpreted as dollars per 1 million input/output tokens. Missing prices remain `unknown`, not zero. Changing a Model node to a different ID than its credential's priced model clears effective pricing for that run. Unknown pricing cannot support a reliable monetary cap; token, tool and duration limits still apply. Provider-reported usage and BYOK prices are untrusted measurements, so BYOK results never enter the verified lane.

Keys are AES-256-GCM encrypted at rest with per-record random nonces and user/record-bound additional authenticated data. APIs return only `sk-****1234`. Delete removes the credential; old builds that referenced it must select a new provider. Keep `CREDENTIAL_ENCRYPTION_KEY` stable and back it up securely; replacing it without a migration makes existing credentials unreadable. Do not log request bodies or place keys in prompts.

### Platform AI Gateway

Set `AI_GATEWAY_API_KEY` and `PLATFORM_MODEL`. Supply verified input/output pricing in `PLATFORM_INPUT_PRICE_PER_MILLION` and `PLATFORM_OUTPUT_PRICE_PER_MILLION`. No model names or live prices are guessed. A server-controlled platform provider with known pricing uses the **Verified** lane; otherwise it uses **BYOK / unverified**.

### GitHub login

Set `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` for a GitHub OAuth application, with callback `http://localhost:3000/api/auth/callback/github` for local development. Keep `BETTER_AUTH_URL` equal to the actual origin. The login button appears only when configured. Email/password does not require GitHub.

## Gameplay and initial content

| Feature | Implementation |
| --- | --- |
| Challenges | Messy JSON Extractor, Support Ticket Router (World Boss), Secret Keeper |
| Tests | 4 public + 12 hidden per challenge: 5 normal, 3 edge, 2 adversarial, 2 security |
| Workflow | Input, Prompt, Model, Skill, Tool, Validator, Output; actual edge-driven topological execution |
| Validation | Required nodes, legal configs, connectivity, no cycles or model bypass, 24-node / 64-edge caps |
| Skills | Structured Output, Reflection, Concise, Extract, Safety Guard, Retry |
| Tools | Calculator, JSON Validator, Text Search, Date Parser, String Matcher; no shell or user code |
| Score | Deterministic 1000 points: accuracy 45%, robustness 20%, security 15%, efficiency 10%, elegance 10% |
| Leaderboards | Overall, Cheapest, Fastest, Robust, Minimalist, each separated into Demo / BYOK / Verified |
| Builds | Immutable versions, optimistic saves, private prompts, selected-version forks, parent relationships |
| Community | Pending problem submissions; top-submitted-version failure hunting; reputation and five badges |
| Initialization | Reference catalog only; simulated activity exists only in test fixtures |

The demo provider is a deliberately imperfect bounded simulator, not an LLM. It does not read expected answers or hidden fixtures. Prompts, skills and graph changes affect the simulated outputs; real runs use the separate AI SDK adapter. Seed leaderboard values and demo costs are clearly labeled as simulated.

## Commands

```sh
pnpm test
pnpm test:provider-sdk        # offline; no paid requests
pnpm typecheck
pnpm build
pnpm db:migrate
pnpm db:seed                 # reference catalog only
pnpm test:migrations         # explicit isolated PostgreSQL target required
pnpm test:evaluation-db      # isolated PostgreSQL + Redis; real worker completion gate
pnpm test:smoke              # running isolated Next.js test server required
node scripts/pi0-probe.mjs   # registry identity; does not mutate the app
pnpm test:pi-runtime         # real SDK, fake stream; no paid calls
# PI_RUNTIME_LIVE=true pnpm test:pi-runtime:live   # authorized Flash sample only
```

`pnpm test` includes runtime contract, DAG adapter, fake Pi, and Bridge A offline tests.
`pnpm test:pi-runtime` is in CI and still makes no paid calls.
Pi self-test fails closed when EF/outbox is configured; its status reports unavailable.
Only standalone explicit test-mode Demo is supported until shared durable admission and
accounting exist. Private Agent B1/B2 drafts cannot execute; B3 is not enabled.
See `docs/MIGRATIONS.md` for immutable main/Pi ledger compatibility.

For full-stack smoke, set `APP_ENV=test` and `DEMO_MODE=true` on the target Next.js
process and point it at a disposable database. Smoke checks this mode before creating
accounts or builds. For normal-mode boundary checks only, set
`SMOKE_EXPECT_TEST_MODE=false`; no model calls are made. `SMOKE_BASE_URL` selects the origin. Never target production or
your working credential database. Browser verification targets the real React UI.

## Source map

```text
src/app/                 Next.js routes, auth and arena HTTP endpoints
src/components/          Shared React UI, complete arena pages, shadcn button
src/features/builder/    React Flow canvas, Zustand state, editor/runner
src/lib/ai/              Provider contract, real SDK adapter, demo, registered tools
src/lib/workflow/        DAG validation and real executor
src/lib/judge/           Deterministic pluggable judges
src/lib/scoring/         Score, energy and cost arithmetic
src/lib/crypto/          Authenticated BYOK encryption
src/server/              Arena service, serializers, fixture/seed, API, SSRF policy
src/db/                  Drizzle schema/repository and initial SQL schema
src/shared/              Domain models and safe public component catalog
public/                  Application static assets
scripts/                 Setup, migration, reference seed, Next.js smoke, Docker
tests/                   Engine, service, migration and test-only memory/fixture helpers
```

## Security and scope boundaries

Hidden inputs, expected values and per-case outputs never leave the arena API on hidden runs, including failure responses. They necessarily reach the selected **model provider**. A user-controlled gateway can observe requests and forge model usage/answers; separate leaderboard lanes make this trust distinction explicit. Public outputs can be inspected; private prompts cannot be read or forked by another player. Forking always clears credential references.

The checked-in fixtures and fixed Secret Keeper secret are for a **local, inspectable MVP**, not a confidential contest benchmark. Replace them with server-private, separately versioned tests/secrets before hosting a real competition. Secret checks catch several obvious encodings but do not prove a general non-disclosure property. Safety Guard is a bounded injection heuristic, not a comprehensive security system.

Community problems and semantically ambiguous failure reports stay pending. Objective output-contract/secret failures can be verified automatically; a valid-shape wrong answer requires review. The V1 has no moderation dashboard, email delivery/password-recovery flow, reward economy, arbitrary-code sandbox or agent marketplace payments. The durable evaluation Worker foundation exists behind explicit outbox configuration, but production deployment and the complete community/Verified integrations remain unfinished. Profile ELO is a documented benchmark-derived rating proxy, not head-to-head Elo. Request-bound execution remains available when the durable scheduler is not configured. Not a multi-tenant production certification.

See `docs/ARCHITECTURE.md`, `docs/SCORING.md` and `docs/VERIFICATION.md` for the implementation and limits. Retired Portable screenshots under `docs/screenshots/` are historical only.

## Development and contribution

Before extending AgentForge, read:

- `AGENTS.md` — repository-wide AI agent rules, architecture boundaries, security invariants and verification requirements.
- `CONTRIBUTING.md` — local development, Git branches/commits/PRs, database changes and the test matrix.
- `.github/pull_request_template.md` — change scope, evidence, compatibility and review checklist.

The repository tracks `pnpm-lock.yaml` and CI uses frozen installation; lint/format scripts are not configured. Versioned database migrations are implemented; the isolated PostgreSQL test command and remaining verification gates are documented in `docs/MIGRATIONS.md`. The contribution guide distinguishes these follow-up improvements from checks already implemented. GitHub branch protection must be configured separately; documentation does not enable it.

## Design and implementation roadmap

See [the project design map](specs/README.md) for the aligned evaluation foundation,
community component library, Verified Gateway, optional Pi and future vendor SDK plans.
These are staged designs, not a claim that durable queues, budget settlement, email
verification or community publishing are already implemented. Current runtime behavior
and verified evidence remain documented separately above.
