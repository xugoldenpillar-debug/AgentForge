> Current architecture: Next.js only. Portable records below are retired historical evidence, not current acceptance. See [retirement evidence](verification/retire-portable-2026-09-06.md).

> **2026-09-06 live BYOK update:** [Application Flash evidence](verification/deepseek-app-live-2026-09-06.md): one authorized real public run, 4/4, 976/1000, 242 tokens; not Verified or production acceptance. Offline SDK suite: 18 passed.

> **2026-09-06 foundation update:** See [DeepSeek Gateway Phase 0 evidence](verification/deepseek-gateway-phase0-2026-09-06.md) for this working tree's 112 passing native tests, successful typecheck/build, and subsequently passed PostgreSQL/authentication gates. Historical results below remain historical; no Verified Gateway or paid model acceptance is claimed.

# Verification record

Date: 2026-09-05. This records executed checks, not planned checks.

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

These browser checks target the portable UI. They do not claim React Flow, the React frontend or Better Auth were mounted in a browser here. Screenshots are actual portable UI captures, clearly labeled by its in-page runtime banner.

## Not executed in the authoring environment

The following require available npm dependencies, PostgreSQL/Docker, credentials, or an unrestricted browser/network and were **not** passed off as verified:

- Full `pnpm install`, lockfile generation, package audit, Next.js dependency-aware `pnpm typecheck` and `pnpm build`.
- Drizzle schema application to a PostgreSQL server, PostgreSQL transaction/lease behavior, and Better Auth database integration.
- Docker image build/Compose startup and the provided GitHub Actions workflow.
- Real provider requests through Vercel AI SDK, connection-time SSRF protections in undici, provider usage/tool calling interoperability, AI Gateway, or billable costs.
- GitHub OAuth callback and actual third-party credentials.
- Native-browser React Flow drag/connect behavior, full React UI integration, or native browser security enforcement.
- Load, race stress, full accessibility, comprehensive penetration testing, general prompt-injection resistance, or production certification.

## Reproduce locally

```sh
node --experimental-strip-types --test tests/*.test.ts
node --experimental-strip-types portable/server.ts
# In another terminal:
node --experimental-strip-types scripts/smoke.ts
python scripts/browser-smoke.py --base-url http://127.0.0.1:3000
```

After installing dependencies, check the full stack rather than assuming portable success implies integration success:

```sh
pnpm run setup
docker compose up -d postgres
pnpm db
pnpm typecheck
pnpm build
pnpm start
# Another terminal, with DEMO_MODE=true:
pnpm test:smoke
```

Start from disposable local data for smoke/UI tests. The GitHub Actions workflow automates full-stack install, PostgreSQL, typechecking, build and smoke, but was not itself executed here. For public deployment, add genuine versioned migrations, locked dependencies and a deployment-specific security review.
