# Pi/main integration — review candidate (2026-09-07)

## Scope and provenance

- Worktree: `/Users/pillarxu/Documents/worktrees/AgentForge-pi-main-integration`.
- Branch: `codex/pi-main-integration`; HEAD/main base
  `04a53c8a400404a38d9c35240b4204a5ba9ed629`; MERGE_HEAD/Pi
  `8b5d19faeada98748537c8f6a55a4143d21e1908`.
- Recovered the interrupted merge and preserved staged/unstaged implementation.
  Resolved the 14 conflicted index paths individually. No main/feature checkout
  edits, reset, clean, stash, commit, push, main merge, production or paid calls.
- Community, EF durable outbox/worker/budget, Pi offline runtime and private Agent
  B1/B2 coexist. B3 remains disabled. UI changes during recovery are guard/status
  messaging only; no new browser acceptance claim.

## Review fixes

1. Pi self-test with a configured competitive scheduler or outbox environment is
   unavailable at status/apply/run boundaries, even for Demo. Standalone Demo also
   requires explicit APP_ENV=test and DEMO_MODE=true. There is no racy active-job
   precheck presented as shared admission; real Pi is denied before credential use.
2. Original main 0001–0006 bytes remain unchanged; Pi originals are archived with
   identical bytes and canonical names 0007–0009. Exact known Pi prefixes use the
   documented alternate physical lineage. No physical ledger row, checksum or
   applied_at is rewritten. Pending index namespace collisions fail closed,
   including both EF uniqueness indexes. Golden catalog fingerprints additionally
   detect altered applied schema. See MIGRATIONS.md for PostgreSQL-major limits
   and the explicit future-lineage contract.
3. Enqueue and worker deny Agent frozen versions before model work. A queued DAG
   still executes its frozen version after the current Build pointer changes.
4. The real production worker now constructs its competitive completion adapter;
   the exported service factory is used by the PostgreSQL/BullMQ regression. This
   fixes an actual HTTP-to-independent-worker failure missed by the earlier gate
   that reused the web service object. New EF Runs use runtimeKind=dag with null
   PoC adapter/policy fields, not false PoC version attribution.

## Executed gates

Runtime: Node v26.7.0, pnpm 10.15.1, PostgreSQL 17-alpine, Redis 7-alpine.
Logs: `/tmp/agentforge-pi-main-integration-resume/` (earlier interrupted-agent
logs remain separately at `/tmp/agentforge-pi-main-integration-logs/`).
Environment is supplied by a local wrapper reading this worktree's own `.env`;
MIGRATION_TEST_DATABASE_URL is explicitly set to the owned server's postgres
administrative database, never the application or feature database. No secrets
are printed in the evidence.

| Actual command | Result | Log |
| --- | --- | --- |
| `pnpm install --frozen-lockfile` | passed, pnpm 10.15.1; no resolution changes | install-final.log |
| `pnpm test` with isolated REDIS_URL and queue prefix | 330 passed, 0 skipped | full-final.log |
| `pnpm test:pi-runtime` | 23 passed, 1 skipped; no paid call | pi2.log |
| `pnpm test:provider-sdk` | 18 passed, offline | provider.log |
| `pnpm test:migrations` with explicit isolated URL | 4 top-level tests passed; fresh + every canonical/Pi physical prefix, repeat, target schema, data/ledger preservation, concurrent runs, rollback, invalid histories, drift and index collision faults | migrations-final.log |
| `pnpm exec tsx --test tests/agent-drafts.integration.ts` | 1 passed, real concurrent CAS | cas-final.log |
| `pnpm test:evaluation-db` with isolated PG/Redis | 1 passed using production worker service factory; outbox, idempotency, usage, submission, Agent denial | ef-final.log |
| `pnpm typecheck` | passed | types-last.log / typecheck-final2.log |
| `pnpm exec tsc -p tsconfig.core.json --noEmit` (original attempt) | FAILED; original pass claim corrected below | core-types.log |
| `pnpm build` | passed | build-last.log |
| `pnpm db` on owned integration DB | 0 applied / 9 unchanged, reference catalog only | db.log |
| `SMOKE_EXPECT_TEST_MODE=false pnpm test:smoke` against normal Next | passed auth, guards, Agent history/CAS/Fork; no model calls | smoke-normal.log |
| `pnpm test:smoke` against final test-mode Next | passed three Demo challenge loops, auth, private/credential/Agent boundaries | smoke-spaced-final.log |
| `node --experimental-strip-types scripts/.integration-http-queue.mjs` against outbox Next plus `pnpm worker:start` | passed HTTP 202 → outbox → independent worker → completed; Agent enqueue denied; invited Pi status/run denied | http-queue-final.log |
| `git diff --check` and `git diff --cached --check` | passed | final handoff |

The regenerated merge lock retains all main package resolutions and adds the pinned
Pi package/dependency graph (1138 added lines, zero removals vs main). Frozen install
was rerun here; prior regeneration/install logs are preserved, not represented as a
new dependency upgrade. pnpm reports ignored package build scripts; build and SDK
verification nevertheless passed. No global build-script approval was changed.

## Failures retained, not hidden

- Initial catalog negative-test failure was an assertion comparing postgres.js
  Result against plain Array; fixed comparison, repeated real matrix passed.
- Expanded completed-Pi fixture initially passed alternate physical files as the
  canonical release; fixed the fixture to construct physical history explicitly,
  without relaxing production canonical checksum validation.
- First real independent-worker HTTP gate produced one unknown Job after 12
  successful Demo invocations/known usage records. Missing worker completion
  adapter was fixed. That Job/evidence is retained; only new requests verified the
  fix. See http-queue.log (failure), http-queue2.log and http-queue-final.log (success).
- Running the full auth smoke immediately after queue smoke hit the existing auth
  signup 429 limit on its final user. Earlier full smoke passed; rate-limit settings
  were not relaxed. smoke-final.log preserves this failed attempt; the spaced final
  rerun is recorded in the final handoff.

## Resource ownership / limits

- Existing dedicated containers verified with label `task=pi-main-integration`:
  `agentforge-pi-main-integration-postgres-20260907` at 127.0.0.1:55457 and
  `agentforge-pi-main-integration-redis-20260907` at 127.0.0.1:56389.
- Application DB `agentforge_pi_integration`; Next at 127.0.0.1:3327 with matching
  BETTER_AUTH_URL. Own node_modules/.next/.env; no copies from other worktrees.
- Standalone queue `integration-resume-20260907`, prefix
  `pi-main-integration-resume`, worker `pi-main-integration-resume-worker`.
  UUID tests create/drop only their own databases, and use unique queue names.
- Containers, volume, application records and failed-job evidence are retained.
  Worker stopped after verification; Next test-mode service is retained for review.
  Feature PG55447 and Next3317 were not used or modified.
- No browser run during recovery; no paid Pi/live-provider test, production safety,
  production migration, other PostgreSQL major, or CI execution is claimed.
- Candidate is staged for independent review only; no commit/main integration
  authorization is inferred from passing local gates.

Final spaced auth smoke passed in full (`smoke-spaced-final.log`); no limits changed.
Local probe/wrapper/generator scripts used above are archived outside the repository in
`/tmp/agentforge-pi-main-integration-resume/` under their `.integration-*.mjs` names.

## Evidence correction and closing-worker verification — 2026-09-07

The original `core-types.log` contains compiler errors, not a passing Gate. The
closing worker independently reran the exact command and obtained exit 2 with 29
TypeScript diagnostics (`core-recovery-before.log`). The old log is retained.

Minimal changes are confined to nine test files: discriminated-union assertions,
explicit unknown input/array/callback types, structural property narrowing,
projecting migration ledger identities, and async wrappers for rejection assertions.
No application runtime, compiler strictness, test coverage scope, dependencies,
migration bytes or security policy was changed. Existing security assertions remain;
new mode/property assertions make the fixture assumptions explicit at runtime.

All following commands were rerun with Node v26.7.0 and pnpm 10.15.1, and each
exited 0. Logs reside in `/tmp/agentforge-pi-main-integration-resume/`.

| Command | Current result | Log |
| --- | --- | --- |
| `pnpm exec tsc -p tsconfig.core.json --noEmit` | passed; replaces the incorrect original claim | core-recovery-final.log |
| `pnpm typecheck` | passed | types-recovery.log |
| `pnpm exec node --experimental-strip-types --test tests/pi-self-test.test.ts tests/migration-history.test.ts` | 10 passed, 0 skipped | findings-recovery.log |
| `pnpm test:migrations` | 4 passed, 0 skipped, including schema drift/index-collision rejection and rollback | migrations-recovery.log |
| `pnpm test` | 330 passed, 0 skipped; dedicated local Redis supplied | full-recovery.log |
| `pnpm test:pi-runtime` | 23 passed, 1 skipped; offline only | pi-recovery.log |
| `pnpm exec tsx --test tests/agent-drafts.integration.ts` | 1 passed; real PostgreSQL concurrent CAS | cas-recovery.log |

The migration/CAS commands used the dedicated PG55457 administrative database
via explicit `MIGRATION_TEST_DATABASE_URL`; they create/drop only UUID test databases.
No application records or retained failed-job evidence were cleared. Redis56389
was used for the full test suite's isolated queues.

Both original findings now have implementation plus rerun regression evidence:
Pi is denied under configured EF (not claimed to share accounting), and index
collisions/schema drift are rejected transactionally. This is not a production
security certification. Build, HTTP smoke, independent-worker HTTP and provider
SDK entries above remain prior-implementer evidence, not reruns by the closing
worker. No build was needed for test-only changes; retained Next3327 was not stopped
or rebuilt. No browser, paid model, production or CI verification was performed.

At the closing-worker review checkpoint, no commit, main merge or push had been
performed; the test/doc corrections were left unstaged for review. The subsequent
user-authorized local Git integration stages these exact corrections and retains
the two source parents; it does not rerun or upgrade the evidence above.
