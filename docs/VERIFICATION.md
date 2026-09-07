> **2026-09-07 Artifact Arena spec:** [Documentation-only verification](verification/artifact-arena-spec-2026-09-07.md). No application, sandbox, browser or paid-model acceptance is implied; future gates are in the linked spec.

> **历史验证记录 / Historical verification record：** 本文记录 2026-09-05 的一次验证及其后补充链接，不代表当前进程、端口、数据库、日志目录或生产环境状态。Portable 结果只属于退役运行时；当前应用只有 Next.js。请以 [当前合并交付评审](PI-MAIN-INTEGRATION-REVIEW.md) 和各 dated verification 文档中的边界为准。

> **2026-09-06 live BYOK update:** [Application Flash evidence](verification/deepseek-app-live-2026-09-06.md) records one authorized real public run; it is not Verified or production acceptance. The offline SDK suite is historical evidence only.

> **2026-09-06 foundation update:** [DeepSeek Gateway Phase 0 evidence](verification/deepseek-gateway-phase0-2026-09-06.md) records the earlier foundation checks. Historical results below remain historical; no Verified Gateway or paid model acceptance is claimed.

# Historical verification record

Date: 2026-09-05. This records executed checks, not planned checks; it is retained for provenance, not as a current status page.

## Passed

| Check | Observed result |
| --- | --- |
| Node 22.16 built-in test runner | **53 tests passed, 0 failed, 0 skipped** |
| Dependency-free core strict TypeScript check | Passed with TypeScript 5.9 and installed Node type definitions |
| Syntax parsing across TypeScript sources | 49 .ts/.tsx files parsed, zero syntax diagnostics; not full dependency-aware typechecking |
| Portable JavaScript parser | `node --check public/portable-app.js` passed |
| Native HTTP integration | 8 included tests passed against a child Node server with an isolated temporary data directory |
| Three-challenge smoke | Account creation, public and hidden runs, scoreboard membership and fork passed for all three challenges |
| Portable browser checks | **14 passed**, zero uncaught JavaScript errors, desktop + 390px mobile |
| Screenshot review | Actual home, edited/scored Builder and mobile home visually inspected; no mock design image used |

### What the 53 tests cover

28 pure-core tests: deterministic JSON/enum/secret judges, schema checks, known/unknown cost math, scoring, authenticated encryption, tampering/ownership, DAG structure, unsupported executable/key config rejection, fork redaction, safe arithmetic/date/text tools, SSRF policy, actual workflow execution, reflection, budgets, single-pass prompt interpolation, sticky validator failures, invalid model metrics, injection heuristic and cancellation.

17 service tests: seed counts, save/run/submit/leaderboard/fork, hidden response non-disclosure, challenge public DTOs, credential and email serialization, credential ownership/deletion, private prompt access, optimistic immutable versions, failure rewards/deduplication, pending community problems, auth/origin checks, transaction rollback, rate limits/leases, run ownership, historical-version fork, all three challenge suites, and multiple real-provider/model routing using an explicitly injected test double. The test double verifies dispatch/pricing rules, **not** the Vercel AI SDK or a real external model.

8 native HTTP tests: signup/session headers/password and session hashing, auth and CSRF rejection, **actual incremental response streaming**, complete game loop, credential encryption/deletion, no fake demo fallback for real model requests, static path/Host restrictions, process-restart persistence, logout and access revocation. These use Node HTTP/fetch directly without the browser bridge. They verify cookie issue/replay/revocation, not a browser's enforcement of SameSite or HttpOnly.

### Actual smoke results

With fresh starter workflows, the simulated hidden test results were:

```text
Messy JSON Extractor:  8 / 12, 551 / 1000
Support Ticket Router: 10 / 12, 774 / 1000
Secret Keeper:        12 / 12, 997 / 1000
```

The browser test then changed the JSON prompt, connected a Safety Guard node and obtained **11 / 12, 901 / 1000**. This is evidence that the demo executes the configured graph and produces scored feedback, not evidence of an actual model's quality. Tool timing may slightly vary; simulation/seed numbers are never benchmark claims.

## Browser transport limitation

Chromium in this environment denied direct navigation to localhost with `ERR_BLOCKED_BY_ADMINISTRATOR`. The policy was not changed. `scripts/browser-smoke.py --bridge` loaded the same actual frontend JS/CSS on an about:blank page, gave the application a virtual SPA location, and forwarded requests through a Python HTTP bridge to the real Node backend. The bridge used the real server's auth cookies and persisted data.

Thus the 14 checks exercise DOM rendering, forms, pointer dragging, link edits, saves, server runs, results, forks, profile, registration, providers, failure hunting, pending problems and mobile overflow. **They do not verify native browser network streaming, cookie enforcement or browser history behavior.** Native server streaming and session behavior were covered independently as described above. `docs/browser-report.json` identifies the bridge explicitly. The script's default non-bridge mode is available for local verification in a normal browser environment.

These browser checks target the retired Portable UI. They do not claim React Flow, the current React frontend or Better Auth were mounted in a native browser here. Screenshots are actual historical Portable UI captures and remain clearly labeled by their in-page runtime banner.

## Not executed in the authoring environment

The following require available npm dependencies, PostgreSQL/Docker, credentials, or an unrestricted browser/network and were **not** passed off as verified:

- Full `pnpm install`, lockfile generation, package audit, Next.js dependency-aware `pnpm typecheck` and `pnpm build`.
- Drizzle schema application to a PostgreSQL server, PostgreSQL transaction/lease behavior, and Better Auth database integration.
- Docker image build/Compose startup and the provided GitHub Actions workflow.
- Real provider requests through Vercel AI SDK, connection-time SSRF protections in undici, provider usage/tool calling interoperability, AI Gateway, or billable costs.
- GitHub OAuth callback and actual third-party credentials.
- Native-browser React Flow drag/connect behavior, full React UI integration, or native browser security enforcement.
- Load, race stress, full accessibility, comprehensive penetration testing, general prompt-injection resistance, or production certification.

## Reproduce the current application

The following is a current, generic Next.js verification outline. It is an instruction, not a record that a service is running now:

```sh
pnpm install --frozen-lockfile
pnpm run setup
docker compose up -d postgres
pnpm db
pnpm test
pnpm typecheck
pnpm build
```

For full-stack smoke, use `APP_ENV=test` and `DEMO_MODE=true` only with a disposable database, and set `SMOKE_BASE_URL` to the current task's isolated Next.js service. For migration integration, set `MIGRATION_TEST_DATABASE_URL` explicitly to a disposable local PostgreSQL administrative database. Never substitute a working credential database, production service, or another task's process.

The old Portable server and `scripts/browser-smoke.py` bridge are not current startup or acceptance commands. Portable screenshots and bridge results remain historical evidence in the retirement record.

## Evaluation Worker operations gate

The durable evaluation foundation now includes a reproducible worker image and fail-closed operational probe. The deployment artifacts are:

- `Dockerfile.worker`
- `scripts/evaluation-worker-production.ts`
- `scripts/evaluation-worker.ts`
- `scripts/worker-healthcheck.ts`
- `.env.worker.example`
- `docs/evaluation-worker-operations.md`

The worker requires `DATABASE_URL`, `REDIS_URL`, `EVALUATION_SCHEDULER_MODE=outbox`, explicit queue name/prefix, a unique worker identity, and the credential encryption key. The healthcheck verifies PostgreSQL, the evaluation schema, Redis `PING`, and required configuration without printing secrets. Missing configuration or unavailable dependencies is a failure; there is no in-memory fallback.

The migration integration gate remains separate from application runtime configuration:

```sh
MIGRATION_TEST_DATABASE_URL='<disposable-local-test-connection>' pnpm test:migrations
```

Use an isolated disposable PostgreSQL service for this command. Do not substitute `DATABASE_URL`, a shared database, or a production database. See [evaluation worker operations](evaluation-worker-operations.md) for shutdown, restart/backoff, lease/heartbeat, queue retention, local profile and deployment checklist details.

This is configuration and validation tooling, not evidence of a live production deployment or real managed Redis/provider acceptance.
