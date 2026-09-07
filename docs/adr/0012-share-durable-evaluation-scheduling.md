---
status: accepted
---

# Share durable evaluation scheduling without merging evidence

Extend ADR-0007's request-independent direction to challenge feedback, submissions, Author Self-Test and Platform Component Evaluation. Select Redis/BullMQ through an adapter and independent Node workers; PostgreSQL remains authoritative for authorization, business state, budget and evidence. Transactional Outbox, idempotent processing and reconciliation bridge delivery, without claiming exactly-once external model invocation.

Compared with maintaining request-bound execution or PostgreSQL-only scheduling, shared Node task infrastructure is chosen to avoid separate recovery and quota implementations for component self-tests. Business results remain distinct; author self-tests must not become competitive submissions. Each evaluation job owns exactly one purpose-specific business record: a competitive Run, an author SelfTestRun or a later ComponentEvaluation. Attempts belong to the job; existing Run history is retained without fabricated execution evidence. Concrete constraints are to be specified before migration.

Accepted design on 2026-09-06. The shared Evaluation Foundation, Outbox/BullMQ delivery path and independent Worker now have a code foundation; complete component SelfTestRun, production operations, shared quota/settlement policy and Verified integration remain pending. See ../../specs/evaluation-foundation/README.md and ../../docs/PI-MAIN-INTEGRATION-REVIEW.md. Platform effects evaluation remains a later separately budget-approved scope, not publication review. Workloads sharing a provider account must obey its aggregate quota even when logical budgets and queues differ.
