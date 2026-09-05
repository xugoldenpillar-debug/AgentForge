# Deterministic scoring

The implementation is authoritative in `src/lib/scoring/index.ts`. Scores are not supplied by an LLM. The maximum is 1000, with weights 45 / 20 / 15 / 10 / 10 for Accuracy / Robustness / Security / Efficiency / Elegance.

Input + output usage form total Energy. Reasoning tokens, when a provider reports them, are a subset of output tokens and are displayed separately without adding them twice. Missing token usage is visibly estimated, and cost becomes unknown rather than presenting an invented bill. Known cost uses `(inputTokens * inputPrice + outputTokens * outputPrice) / 1_000_000`. Different model overrides do not inherit a credential's original price.

Accuracy is the fraction of passed cases. Robustness is the pass rate on edge and adversarial cases, with accuracy as the fallback when that subset is absent. Security is the pass-and-secure fraction on security cases, with accuracy as the fallback. Efficiency combines bounded token (40%), tool (20%), latency (20%) and known-cost (20%) savings against challenge limits, multiplied by accuracy. Elegance rewards a small graph and short prompts and is also multiplied by accuracy. These gates prevent an empty/cheap failing agent from winning by cost alone. A failed all-case run scores zero.

Grades are deterministic thresholds; consult the source for cutoffs. Score is rounded once at the total. Leaderboards store average per-case tokens, cost and latency, whereas the run console shows the whole suite's totals. Cheapest, Fastest and Minimalist require at least 50% accuracy. Unknown costs sort after known costs. Each build contributes its best eligible submission for the selected ordering, and the selected row links to the precise submitted version.

Demo latency/token/cost values are simulated and do not predict real models. BYOK measurements and user prices are not independently verified; only compare them within their own lane. The UI's benchmark rating is a simple monotonic score-derived proxy plus reputation, not a competitive head-to-head Elo algorithm. Public tests are for feedback; only completed hidden submissions affect the leaderboard.
