# AgentForge

**Build AI. Beat Problems.** A locally playable AI-building arena: build an agent, run public tests, submit against a server-side benchmark, compete across five leaderboards, then fork a better version.

This repository contains a **Next.js application** and an **offline portable demo**. They share the actual domain service, workflow executor, scoring, judges, fixtures, encryption and response serializers. The portable demo exists so you can play without npm, PostgreSQL or a model account; it is not a production replacement for the requested stack.

## Start playing immediately (no dependency installation)

Install Node.js **22.16 or newer**, open a terminal in this directory, and run:

```sh
node --experimental-strip-types portable/server.ts
```

Open `http://localhost:3000`. Default local demo account:

```text
Email:    demo@agentforge.local
Password: ForgeDemo!2026
```

You can also register a new account. Choose a challenge, open **Build agent**, change the prompt or equip a skill, **Save version**, **Run Public Tests**, and **Submit**. Open the resulting build or leaderboard row and **Fork / Remix**. A demo run does not send network requests to a model or spend tokens.

The portable UI includes drag-to-move nodes, port-to-port connections, edge removal, node duplication/deletion, zoom, configuration, version saves, traces, case results, scoring, profiles, encrypted credential CRUD, failure hunting and community problems. State persists under `.data/portable/`; stop the process before backing up or resetting this directory. Do not share this directory: it contains account data and the local encryption key.

For a different port on macOS/Linux:

```sh
PORT=3001 node --experimental-strip-types portable/server.ts
```

For PowerShell:

```powershell
$env:PORT = "3001"
node --experimental-strip-types portable/server.ts
```

The portable runtime binds to `127.0.0.1` only and always simulates AI. It rejects real provider runs explicitly rather than pretending a model was called.

## Run the requested full stack

Prerequisites: Node.js >=22.16, Corepack/pnpm, Docker with Compose, internet access for dependency installation.

```sh
corepack enable
pnpm install
pnpm run setup
docker compose up -d postgres
pnpm db
pnpm dev
```

Open `http://localhost:3000`. `pnpm run setup` creates `.env` with unique encryption/authentication keys and never overwrites an existing file. `pnpm db` applies the checked-in initial schema and idempotent seed. The example uses a local development PostgreSQL password; change it before deployment. If changing `POSTGRES_PASSWORD`, also update the local `DATABASE_URL` for a host-run application.

Full stack: Next.js 16 App Router, TypeScript, Tailwind 4, shadcn-style Radix components, **@xyflow/react** with Zustand, Vercel AI SDK adapters, PostgreSQL with Drizzle, Zod request validation, Better Auth email/password and optional GitHub OAuth. All model and credential code executes on the server.

For the complete Docker stack:

```sh
node scripts/setup.mjs
docker compose up --build
```

The app waits for PostgreSQL's health check, initializes the schema/seed, and starts Next.js. Both exposed ports bind to localhost by default. There is no database or Docker requirement for the portable command above.

### Verification status -- read this before deployment

The authoring environment could not reach npm and had neither PostgreSQL nor Docker. **The full Next.js dependency install, dependency-aware typecheck/build, Drizzle/Better Auth integration, Docker build, GitHub OAuth and paid model calls were not executed here.** Their source and startup paths are provided, but they need a normal networked environment to verify. The CI workflow includes these checks; its presence is not a passing CI result.

What was actually executed: **53 automated core/service/native-HTTP tests**, strict TypeScript checks for the dependency-free core, a three-challenge HTTP smoke test, and **14 portable-browser checks** with actual backend requests. Browser checks used a documented HTTP bridge because the environment blocked direct browser access to localhost. Native HTTP tests independently verified real streaming, cookies, persistence and revocation. See `docs/VERIFICATION.md` for exact scope.

No lockfile has been fabricated. `pnpm install` will generate `pnpm-lock.yaml`; review and commit it before a deployment, then change CI/Docker to frozen-lockfile installation. Dependency ranges are not a substitute for a reproducible, security-reviewed release.

## Real model calls / BYOK

Use the **full Next.js runtime**, sign in, and open **Providers**. Save a name, OpenAI-compatible base URL, API key and model ID. Select that credential on the Builder's Model node. Real runs require an explicit token-spending consent checkbox. An unavailable or failed real provider produces an error; it never falls back to simulation.

Only administrator-allowlisted HTTPS hosts on port 443 are accepted. Add a trusted gateway's exact hostname to `PROVIDER_ALLOWED_HOSTS` in `.env`, then restart the app. URL credentials, query/fragment, literal IPs, private/reserved DNS answers and redirects are rejected. DNS addresses are rechecked and pinned by the actual HTTP connection. This means local model endpoints and LAN gateways are **deliberately not supported by this V1 security policy**.

User-supplied pricing is optional and is interpreted as dollars per 1 million input/output tokens. Missing prices remain `unknown`, not zero. Changing a Model node to a different ID than its credential's priced model clears effective pricing for that run. Unknown pricing cannot support a reliable monetary cap; token, tool and duration limits still apply. Provider-reported usage and BYOK prices are untrusted measurements, so BYOK results never enter the verified lane.

Keys are AES-256-GCM encrypted at rest with per-record random nonces and user/record-bound additional authenticated data. APIs return only `sk-****1234`. Delete removes the credential; old builds that referenced it must select a new provider. Keep `CREDENTIAL_ENCRYPTION_KEY` stable and back it up securely; replacing it without a migration makes existing credentials unreadable. Do not log request bodies or place keys in prompts.

### Platform AI Gateway

Set `AI_GATEWAY_API_KEY` and `PLATFORM_MODEL`. Supply verified input/output pricing in `PLATFORM_INPUT_PRICE_PER_MILLION` and `PLATFORM_OUTPUT_PRICE_PER_MILLION`. No model names or live prices are guessed. A server-controlled platform provider with known pricing uses the **Verified** lane; otherwise it uses **BYOK / unverified**.

### GitHub login

Set `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` for a GitHub OAuth application, with callback `http://localhost:3000/api/auth/callback/github` for local development. Keep `BETTER_AUTH_URL` equal to the actual origin. The login button appears only when configured. Email/password does not require GitHub. The portable runtime intentionally does not implement OAuth.

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
| Seeds | 10 users, 20 explicitly simulated leaderboard builds, runs, two illustrative failures, 6 skills, 5 tools |

The demo provider is a deliberately imperfect bounded simulator, not an LLM. It does not read expected answers or hidden fixtures. Prompts, skills and graph changes affect the simulated outputs; real runs use the separate AI SDK adapter. Seed leaderboard values and demo costs are clearly labeled as simulated.

## Commands

```sh
# No dependencies required for these:
node --experimental-strip-types --test tests/*.test.ts
node --experimental-strip-types portable/server.ts
node --experimental-strip-types scripts/smoke.ts  # while a local server is running

# After dependency installation:
pnpm typecheck
pnpm build
pnpm db:migrate
pnpm db:seed
pnpm test:smoke
pnpm exec tsc --noEmit -p tsconfig.core.json

# Optional browser checks (Python + Playwright + Chromium):
python -m pip install playwright
python -m playwright install chromium
python scripts/browser-smoke.py --base-url http://127.0.0.1:3000
```

The browser script targets the **portable UI**, not the React frontend. Its default mode uses native browser networking. `--bridge` exists solely for restricted test environments and is identified in the saved report. Smoke tests create test accounts/builds; use a disposable local database. `SMOKE_BASE_URL` selects another origin.

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
portable/                Offline Node server, JSON persistence, local scrypt auth
public/                  Shared premium dark theme and portable browser app
scripts/                 Setup, migration, seed, smoke, Docker and browser checks
tests/                   Pure engine, service and native HTTP regression tests
```

## Security and scope boundaries

Hidden inputs, expected values and per-case outputs never leave the arena API on hidden runs, including failure responses. They necessarily reach the selected **model provider**. A user-controlled gateway can observe requests and forge model usage/answers; separate leaderboard lanes make this trust distinction explicit. Public outputs can be inspected; private prompts cannot be read or forked by another player. Forking always clears credential references.

The checked-in fixtures and fixed Secret Keeper secret are for a **local, inspectable MVP**, not a confidential contest benchmark. Replace them with server-private, separately versioned tests/secrets before hosting a real competition. Secret checks catch several obvious encodings but do not prove a general non-disclosure property. Safety Guard is a bounded injection heuristic, not a comprehensive security system.

Community problems and semantically ambiguous failure reports stay pending. Objective output-contract/secret failures can be verified automatically; a valid-shape wrong answer requires review. The V1 has no moderation dashboard, email delivery/password-recovery flow, reward economy, arbitrary-code sandbox, agent marketplace payments or background worker. Profile ELO is a documented benchmark-derived rating proxy, not head-to-head Elo. Execution is synchronous/streamed with limits; run the app on a host that supports the configured request duration. Not a multi-tenant production certification.

See `docs/ARCHITECTURE.md`, `docs/SCORING.md` and `docs/VERIFICATION.md` for the implementation and limits. Actual portable screenshots are under `docs/screenshots/`.

## Development and contribution

Before extending AgentForge, read:

- `AGENTS.md` — repository-wide AI agent rules, architecture boundaries, security invariants and verification requirements.
- `CONTRIBUTING.md` — local development, Git branches/commits/PRs, database changes and the test matrix.
- `.github/pull_request_template.md` — change scope, evidence, compatibility and review checklist.

The repository currently has no committed pnpm lockfile, lint/format scripts or versioned database migration runner. The contribution guide distinguishes these follow-up improvements from checks already implemented. GitHub branch protection must be configured separately; documentation does not enable it.
