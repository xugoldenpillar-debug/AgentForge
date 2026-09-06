---
status: accepted
---

# Control verified benchmark execution

The initial Verified Benchmark Profile will use `deepseek-v4-flash` with thinking disabled through an AgentForge-controlled model gateway. The gateway maps the profile to the upstream model and enforces allowed parameters, while AgentForge remains responsible for workflow execution, hidden tests, judging and scoring. Verified leaderboards are bounded by Benchmark Seasons that close when the upstream model materially changes, and they use frozen Benchmark Cost rather than time-varying provider charges.

## Consequences

MVP Verified submissions use one evaluation and replace the build's displayed result with its latest result; formal seasons will use three evaluations and aggregate the median. Users spend Verification Tickets while an internal ledger records Actual Platform Spend. Platform configurations are versioned through draft, test, active and retired states, access is governed by user/developer/admin roles, and gateway failure produces no submission and may refund the reserved ticket rather than falling back to BYOK or simulation.
