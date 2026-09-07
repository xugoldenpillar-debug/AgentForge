# Deterministic scoring

The implementation is authoritative in `src/lib/scoring/index.ts`. Scores are not supplied by an LLM. The maximum is 1000, with weights 45 / 20 / 15 / 10 / 10 for Accuracy / Robustness / Security / Efficiency / Elegance.

Input + output usage form total Energy. Reasoning tokens, when a provider reports them, are a subset of output tokens and are displayed separately without adding them twice. Missing token usage is visibly estimated, and cost becomes unknown rather than presenting an invented bill. Known cost uses `(inputTokens * inputPrice + outputTokens * outputPrice) / 1_000_000`. Different model overrides do not inherit a credential's original price.

Accuracy is the fraction of passed cases. Robustness is the pass rate on edge and adversarial cases, with accuracy as the fallback when that subset is absent. Security is the pass-and-secure fraction on security cases, with accuracy as the fallback. Efficiency combines bounded token (40%), tool (20%), latency (20%) and known-cost (20%) savings against challenge limits, multiplied by accuracy. Elegance rewards a small graph and short prompts and is also multiplied by accuracy. These gates prevent an empty/cheap failing agent from winning by cost alone. A failed all-case run scores zero.

Grades are deterministic thresholds; consult the source for cutoffs. Score is rounded once at the total. Leaderboards store average per-case tokens, cost and latency, whereas the run console shows the whole suite's totals. Cheapest, Fastest and Minimalist require at least 50% accuracy. Unknown costs sort after known costs. Each build contributes its best eligible submission for the selected ordering, and the selected row links to the precise submitted version.

Demo latency/token/cost values are simulated and do not predict real models. BYOK measurements and user prices are not independently verified; only compare them within their own lane. The UI's benchmark rating is a simple monotonic score-derived proxy plus reputation, not a competitive head-to-head Elo algorithm. Public tests are for feedback; only completed hidden submissions affect the leaderboard.

## Asynchronous execution boundary

The [evaluation foundation](../specs/evaluation-foundation/README.md) now has shared Job/Outbox/Worker code; purpose-specific integration and production gates remain separate. Its queue waiting time must not enter the existing execution-latency score. Incomplete or interrupted competitive evaluations create no Submission; fully executed evaluations may legitimately contain failed cases. Author Self-Test and Platform Component Evaluation produce their own evidence, not competitive points or Verified certification. Operational budget reservations and actual spend are distinct from Benchmark Cost; introducing the scheduler must not silently change scoring formulas.


## Planned artifact/showcase scoring (2026-09-07)

[Artifact Arena](../specs/artifact-arena/design.md) defines separate functional compliance,
community preference and efficiency views. WorkPublication/ShowcaseEntry and ballots do
not write existing hidden Submissions, rating or rewards. Community scores are versioned
pairwise preference statistics with a sample threshold, not Verified/model-quality scores.
The proposal keeps trust/Profile/runtime/environment comparison partitions; unknown cost
cannot win the artifact cheapest ranking. These are future showcase rules, not changes
to the existing DAG leaderboard's unknown-cost ordering above.

Agent hidden scoring needs its own frozen Profile/judge/weights in AA-T8; it must not
reuse graph-size Elegance or rewrite historical DAG 45/20/15/10/10. Hidden artifacts
remain inaccessible even if a public work from another authorized run exists. Public
visual output compliance is not a deterministic assessment of aesthetic quality.

## AA-T8 contract status (2026-09-07)

The repository now contains a minimal, isolated hidden-Agent admission and score boundary at
`src/server/evaluation/adapters/agent-showcase.ts`. This is a contract slice, not a production
judge. It requires a server-owned resolver for versioned Profile/Season/Judge/Environment identity
and weights, accepts only a sealed/completed hidden-evidence opaque reference, and fails closed with
`503 RUNTIME_UNAVAILABLE` when the resolver or an approved hidden judge is absent or inconsistent.

The boundary is deliberately incompatible with the legacy `Judge.evaluate(expected, actual, context)`:
it never accepts public bundle content, `expected`, `actual`, hidden answers, raw output, or trace, and
it never calls `src/lib/judge/`, `src/lib/scoring/`, EF workers, or writes the legacy `Submission`.
Normalized results are an independent `agent-showcase-score-v1` record with
`legacySubmissionId: null`; profile components cannot be the legacy five DAG components and their
weights are not defaulted by the adapter. The fake judge in the contract tests is not model quality,
production safety, a leaderboard result, or a substitute for the future deterministic/approved
hidden evaluator.
