# DeepSeek Gateway foundation verification — 2026-09-06

## Scope and provenance

- Working tree: `/Users/pillarxu/.codex/worktrees/f4f7/AgentForge`
- Branch: `codex/deepseek-verified-gateway`
- Base commit: `6b7054eaf7d02d2f7ebc3fd9dd4630d3a8b9f10e`
- These changes are **uncommitted**; the base SHA is not a commit containing them.
- Local runtime: macOS, Node **26.7.0**, pnpm **10.15.1**. CI's Node 22 run was not executed locally.
- Existing specification/ADR/CONTEXT files and `next-env.d.ts` changes were present before implementation and retained.

This delivery implements Phase 0 foundations, the standalone Phase 1.2 Registry,
and the receipt-validator portion of Phase 5.3. It does **not** implement or enable
Official credential API changes, Trust Lane migration, roles, benchmark management,
ticket/budget ledgers, a persistent Verified worker, private Gateway deployment,
Beta or three-replica seasons. The Phase 0 real-database gate was subsequently verified; see the follow-up below.

## Implementation evidence

| Task | Artifact | Boundary |
| --- | --- | --- |
| 0.1 / 1.2 | `src/lib/ai/provider-registry.ts`, `docs/PROVIDER-REGISTRY.md`, Registry tests | Official documentation checked; no model call or credential connection test |
| 0.2 | `scripts/migration-runner.ts`, `scripts/migrate.ts`, `src/db/migrations/`, schema ledger | Checksummed immutable migration history, pinned transaction, advisory lock; database execution verified in the follow-up below |
| 0.3 | `tests/fixtures/migrations/`, `tests/migrations.integration.ts` | Synthetic legacy auth/credentials/results, isolated opt-in fresh/upgrade/repeat/concurrency/rollback matrix |
| 0.4 | `src/lib/gateway-contract/`, native tests and optional Zod entry | Strict offline validation, not a network service |
| 5.3 (partial) | `src/lib/ai/execution-receipt.ts` | Context/usage/spend binding and safe audit projection; no HTTP provider or live receipt |
| Roadmap | `specs/deepseek-verified-gateway/tasks.md` | Phase 0–8 DAG, G0–G8, R1–R18 traceability, PR dependencies; remaining work not marked complete |

## Commands and results

| Command / check | Actual result |
| --- | --- |
| `node --experimental-strip-types --test tests/*.test.ts` before changes | 72 passed, 0 failed |
| `pnpm install --offline --ignore-scripts --lockfile=false` | Passed using local cache; pnpm 10.15.1; peer warnings noted below |
| Final `pnpm test` | **112 passed, 0 failed, 0 skipped**; includes native core/service/HTTP, 12 migration, 6 Registry and 22 Gateway tests |
| Final `pnpm typecheck` | Passed |
| Final `pnpm build` | Passed; Next.js 16.3.4 compilation, TypeScript and page generation |
| `git diff --check` | Passed |
| Focused secret-pattern scan of 18 new/modified foundation source/test files | 0 matches for private-key, long sk-token, GitHub-token and AWS-access-key patterns; heuristic only |

An intermediate build/typecheck failed while the contract files were being authored
(literal-type inference and message union narrowing). Those errors were fixed; the
**final** sequence above ran after integration fixes and exited successfully. A
read-only code review identified tool argument validation and reused historical call
IDs; both were fixed with dedicated regression cases before the final run, and a focused
read-only re-review confirmed both fixes. This is not a comprehensive security audit.

## Initial blocked gates (historical, before environment setup)

- `docker info` failed because `/Users/pillarxu/.orbstack/run/docker.sock` is absent.
  No running local PostgreSQL service was available for this task.
- `pnpm test:migrations` exited 1 **as expected for its opt-in guard**, with
  `MIGRATION_TEST_DATABASE_URL is required; DATABASE_URL is never used.` This is
  evidence of safe refusal, **not** evidence that migration integration passed.
- Actual PostgreSQL fresh initialization, legacy upgrade, repeated application,
  concurrent locking, DDL rollback and data preservation have **not run**.
- Better Auth registration/login and Next.js + PostgreSQL smoke have **not run**.
- No React UI changes; no native-browser UI acceptance was performed in this delivery.
- No dedicated secret-scanning executable was available. Review/heuristic checks are
  not a production security audit or comprehensive secret scan.
- No DeepSeek credential, paid API call, real Gateway, Staging activation, production
  database operation, deployment, commit, push or PR creation was performed.
- No lockfile was generated or dependency ranges upgraded. Offline installation
  reported existing Better Auth/Drizzle peer warnings; a successful build does not
  certify those integrations or production security.

## Compatibility and next gate

The migration change adds only the runner ledger and the missing nullable issuer
column. It retains old credential and result data and does not perform Legacy
Archive backfill or promote history into a trusted lane. Application API/UI behavior
is unchanged; standalone contract modules are not yet wired into production paths.

The initial next step was to start an approved disposable local PostgreSQL server, set
`MIGRATION_TEST_DATABASE_URL` securely, run `pnpm test:migrations`, and record actual
results. Then run the full-stack authentication smoke on a disposable app database.
Do not check G0 solely because the in-memory tests or Next.js build pass. Subsequent
schema, authz and Official execution work follows the roadmap's PR dependencies;
private Gateway work and paid/production gates require separate authorization.


## Environment follow-up — 2026-09-06

The earlier Docker/database/auth/browser blockers above are historical, not the
current status. Started OrbStack and an isolated loopback PostgreSQL 17 container
`agentforge-f4f7-postgres` on port 55437 with its own persistent volume. Generated
ignored local secrets with mode 0600; no production database was accessed.

- Real migration matrix rerun: **1 passed, 0 failed**, fresh/legacy/repeat/rollback/
  concurrency/preservation, using explicit `--env-file=.env`.
- `pnpm db`: first run **2 applied**; repeated run **0 applied, 2 unchanged**, seed succeeded.
- `pnpm test`: **112 passed, 0 failed, 0 skipped**; `pnpm typecheck`: passed.
- Enhanced `scripts/smoke.ts` passed against both Next/PostgreSQL (3107) and an
  isolated temporary Portable runtime (3108). Includes signup, session lookup,
  logout, replayed old-cookie rejection, wrong-password rejection and sign-in,
  then three challenges, public/hidden runs, leaderboards and forks.
- An initial Portable check incorrectly expected an email in the privacy-filtered
  public user DTO. Corrected the test to compare authenticated user IDs without
  widening production serializers; both runtimes passed afterward.
- Native React browser: demo login, challenge, four-node/three-edge React Flow,
  save, public 3/4 and hidden 8/12 summary verified. **390px layout fails usability**:
  toolbar and right configuration are clipped. No responsive acceptance claimed.

G0's real-database prerequisite is now satisfied. This is still Demo model execution,
not real Gateway/DeepSeek acceptance, production security certification or Phase 1–8
completion. Startup commands and remaining boundaries: `docs/LOCAL-VALIDATION.md`.
