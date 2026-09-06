# Evaluation Worker operations

This document describes the independent Node worker that publishes the PostgreSQL evaluation Outbox to Redis/BullMQ and executes durable evaluation Attempts. It is an operations guide, not evidence of a live production deployment.

## Runtime contract

The worker is started from `scripts/evaluation-worker-production.ts`, which reuses the loop in `scripts/evaluation-worker.ts`, the PostgreSQL evaluation repository, the BullMQ adapter, and the existing competitive executor. It fails closed rather than selecting an in-memory queue.

Required configuration:

- `DATABASE_URL`: PostgreSQL connection for the AgentForge application database. The database must already have the versioned migrations applied.
- `REDIS_URL`: Redis connection used by BullMQ. Use a TLS URL (`rediss://`) when required by the managed service.
- `EVALUATION_SCHEDULER_MODE=outbox`: explicit durable scheduling opt-in. Any other value stops the worker.
- `EVALUATION_QUEUE_NAME` and `EVALUATION_QUEUE_PREFIX`: stable queue identity shared by the web scheduler and worker fleet.
- `EVALUATION_WORKER_ID`: unique identity for this process or replica. When `EVALUATION_WORKER_CONCURRENCY` is greater than one, the launcher appends a worker slot suffix.
- `CREDENTIAL_ENCRYPTION_KEY`: the existing AgentForge credential encryption key. Do not print it or place it in an image layer.

Start from [.env.worker.example](../.env.worker.example). The populated file belongs in the operator's secret/configuration store and must not be committed.

The worker also reads the existing provider allowlist, platform gateway settings, and run budget settings. These are application policy inputs; the worker does not invent or increase business quotas.

## Operational controls

These values control process behavior only:

| Variable | Default | Purpose |
| --- | ---: | --- |
| `EVALUATION_WORKER_CONCURRENCY` | `1` | Number of independent worker loops in this process. Increase only after checking database, Redis, provider and upstream aggregate limits. |
| `EVALUATION_WORKER_LEASE_TTL_MS` | `60000` | PostgreSQL Attempt lease duration. Heartbeats renew at approximately one third of this interval. |
| `EVALUATION_WORKER_POLL_INTERVAL_MS` | `250` | Delay between publish/receive passes. |
| `EVALUATION_WORKER_RECONCILIATION_INTERVAL_MS` | `5000` | Stale Attempt scan interval. |
| `EVALUATION_WORKER_RECONCILIATION_BATCH_SIZE` | `50` | Maximum stale Attempts inspected per scan. |
| `EVALUATION_PUBLISHER_LEASE_TTL_MS` | `30000` | PostgreSQL Outbox publisher lease. It must remain shorter than the worker Attempt lease. |
| `EVALUATION_PUBLISHER_BATCH_SIZE` | `50` | Outbox rows claimed by one publish pass. |
| `EVALUATION_QUEUE_READINESS_TIMEOUT_MS` | `1000` | Redis readiness and health probe timeout. |
| `EVALUATION_QUEUE_COMPLETED_RETENTION_SECONDS` | `86400` | BullMQ completed-job retention. |
| `EVALUATION_QUEUE_FAILED_RETENTION_SECONDS` | `604800` | BullMQ failed-job retention. |

Queue concurrency is not a substitute for provider RPM/TPM or account-wide limits. Capacity and budget policy remain authoritative in PostgreSQL and at the upstream provider.

## Image and entrypoint

Build the worker image from the repository root:

```sh
docker build -f Dockerfile.worker -t agentforge-evaluation-worker:local .
```

The image uses Node 22 and the repository's pinned pnpm version. It installs from `pnpm-lock.yaml`, includes the source needed by the existing TypeScript worker entrypoint, and starts:

```text
pnpm worker:start
→ tsx scripts/evaluation-worker-production.ts
→ runEvaluationWorkerLoop() from scripts/evaluation-worker.ts
```

The image contains no environment file or secret. Inject configuration at runtime through the deployment platform's secret/configuration mechanism.

The image healthcheck runs `scripts/worker-healthcheck.ts`. It checks:

1. all required non-secret configuration names are present;
2. `EVALUATION_SCHEDULER_MODE=outbox`;
3. PostgreSQL connectivity and the `evaluation_jobs` table;
4. Redis connectivity and `PING`.

Healthcheck failures print only configuration names or a generic dependency failure. They never print URLs, passwords, keys, prompts, or model responses.

## Local profile validation

The default `docker compose up` path is unchanged. The Redis and worker services are behind the opt-in `evaluation-worker` profile:

```sh
# Prepare .env with a local test-only CREDENTIAL_ENCRYPTION_KEY and
# EVALUATION_SCHEDULER_MODE=outbox. Do not use production credentials.
pnpm run setup
docker compose up -d postgres
pnpm db

docker compose --profile evaluation-worker up -d redis evaluation-worker
```

The last command uses `Dockerfile.worker`, local PostgreSQL, and local Redis. The worker profile is a disposable development/validation setup; it is not a production deployment recipe.

For a cleaner operator-managed setup, use an environment file outside the repository:

```sh
docker run --rm --env-file /path/to/agentforge-worker.env \
  agentforge-evaluation-worker:local \
  node --experimental-strip-types scripts/worker-healthcheck.ts
```

Do not paste the populated environment file or its connection strings into logs, tickets, or pull requests.

## Migration gate

Run migrations against the application database before starting the worker. The migration integration gate must use a separate disposable database connection supplied through `MIGRATION_TEST_DATABASE_URL`; it must never use the application's `DATABASE_URL` implicitly:

```sh
# Start a disposable PostgreSQL test service using the repository's normal
# project-specific procedure, then set this variable in the shell securely.
export MIGRATION_TEST_DATABASE_URL='postgres://<test-user>:<test-password>@<test-host>:<test-port>/<test-database>'
pnpm test:migrations
```

The gate covers fresh initialization, legacy upgrade, repeat execution, concurrent migration locking, rollback/recovery, checksum protection, and preservation of existing business rows. Replace the placeholder with a local disposable connection; never point it at production or a shared environment.

After the gate, apply migrations to the intended non-production or production database with the normal release procedure, then verify the worker healthcheck against that same database and Redis pair.

## Shutdown, restart and failure handling

- Send `SIGTERM` for normal termination. The launcher aborts all loops, stops claiming new work, waits for in-flight execution to drain, performs a final stale-Attempt reconciliation pass, closes BullMQ connections, and closes the PostgreSQL pool.
- Allow at least the configured Attempt lease plus the provider request timeout as the termination grace period. The Compose example uses `90s`; deployment platforms should choose a value appropriate for their configured lease and model timeout.
- Use a supervisor with restart-on-failure and exponential backoff. A crashed worker must be restarted by the platform; the worker does not silently convert Redis/DB failures into healthy idle operation.
- A lost lease fences the old worker. Reconciliation marks indeterminate or possibly-dispatched upstream work for reconciliation/unknown handling rather than issuing an automatic paid retry.
- Redis unavailability makes the queue unready and prevents new delivery work. PostgreSQL remains the source of truth for Job, Attempt, Invocation, Outbox and usage state.
- Run at least two replicas only when each has a unique `EVALUATION_WORKER_ID`; the database lease and BullMQ job identity provide duplicate-delivery protection, not exactly-once external model calls.

## Deployment checklist

Before deployment:

- [ ] Build from the exact reviewed commit and retain the image digest.
- [ ] Inject `DATABASE_URL`, `REDIS_URL`, queue identity, worker identity, scheduler mode and credential encryption key from the platform secret manager.
- [ ] Apply and verify versioned migrations; do not use `src/db/schema.sql` as a production upgrade substitute.
- [ ] Run `pnpm typecheck`, focused evaluation tests, `pnpm build`, and the isolated migration gate.
- [ ] Run `scripts/worker-healthcheck.ts` with the deployment's actual database and Redis endpoints.
- [ ] Configure readiness/liveness, restart backoff, termination grace, CPU/memory limits, logs and alerting.
- [ ] Confirm upstream provider aggregate quotas separately from this worker's concurrency setting.
- [ ] Confirm no test/demo model configuration is enabled in the production environment.

No production deployment, provider call, or live managed Redis validation is claimed by this repository change unless an operator records that evidence separately.
