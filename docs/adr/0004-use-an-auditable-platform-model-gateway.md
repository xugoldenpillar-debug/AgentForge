---
status: accepted
---

# Use an auditable platform model gateway

Verified model calls will use a restricted OpenAI-compatible gateway contract so the existing workflow engine can retain model and tool orchestration while the gateway maps a platform model alias to the active Benchmark Profile. MVP service authentication uses a server-held Bearer secret together with timestamps, request identifiers and idempotency keys; the gateway returns an Execution Receipt containing profile/configuration identity, normalized usage, observed upstream identity and Actual Platform Spend. Verified execution is non-streaming, forces the profile parameters and does not retry completed model calls.

## Consequences

The gateway stores operational metadata but not raw prompts, hidden inputs, secrets or complete model responses. Idempotency suppresses duplicate upstream calls but does not replay completed model text; a response lost before AgentForge durably receives its normalized output fails closed as a chargeable attempt. AgentForge calculates Benchmark Cost independently from frozen profile prices, reserves and settles Verification Tickets idempotently, and never falls back to BYOK or simulation after a Verified failure. Production hidden Evaluation Suites are imported from private deployment assets rather than served from the public source repository.
