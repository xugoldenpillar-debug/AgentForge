---
status: accepted
---

# Decouple verified submission jobs from the HTTP lifecycle

Verified submissions will be durable jobs claimed by a long-running worker instead of work owned by the NDJSON request that created them. The existing request-bound stream aborts when the browser disconnects, but a Verification Ticket and sponsored model spend require recovery, idempotent settlement and a result that remains valid independently of a client connection.

## Consequences

Submission creation returns `202 Accepted`, freezes all benchmark identities and reserves ticket and budget capacity in one transaction. PostgreSQL leases and a reconciler recover interrupted work; if an upstream call completed but its response was not durably received, the attempt fails as chargeable rather than repeating the paid call or fabricating a result.
