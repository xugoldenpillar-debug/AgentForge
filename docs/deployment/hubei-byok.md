# Hubei BYOK 动画竞技场部署 / Hubei BYOK animation-arena deployment

日期 / Date: 2026-09-08

本文描述本仓库两题公开版的单 VPS 拓扑。它采用经典的 **可信控制面 + 每次运行独立 gVisor 沙箱 + 私有不可变产物存储**：模型 API Key 只在可信 Worker 内解密和调用供应商；`runsc` 沙箱禁网且只接收固定 `artifact.read` / `artifact.write` 工具；封存成功后删除整次沙箱，只保留最终文件和数据库元数据。

This is the production runbook for the two-challenge BYOK launch on one VPS. It uses the conventional trusted control-plane/isolated-executor split. A successful run persists only its sealed artifact files and metadata; its gVisor state and per-attempt working directory are disposed.

Current production record (2026-09-08): commit `bd47c913479ccfa9c9217c8a42fa60c2b739d508` is deployed as `agentforge:bd47c913479ccfa9c9217c8a42fa60c2b739d508` at `https://arena.pillarit.cn`. The dedicated PostgreSQL/Redis stack, Worker, loopback web origin, backups, restore-check and Cloudflare route have been verified. See `docs/verification/animation-launch-df6c-2026-09-08.md` for evidence and the remaining real-BYOK success gate.

## 1. 拓扑 / Topology

```text
Internet
  └─ Cloudflare Tunnel
       └─ http://127.0.0.1:53180
            └─ Next.js web container (unprivileged, no Docker socket, no runsc)
                 ├─ agentforge-production-backend Docker network
                 │    ├─ PostgreSQL: users, builds, EF/outbox, bundles, publications, votes, likes
                 │    └─ Redis/BullMQ durable queue
                 └─ /var/lib/agentforge/artifacts (read-only bind mount, shared GID)

Host systemd: agentforge-evaluation-worker.service (trusted root process)
  ├─ PostgreSQL + Redis/BullMQ through dedicated loopback high ports
  ├─ BYOK provider HTTPS calls (allowlisted public hosts only)
  ├─ /usr/local/bin/runsc --network=none
  │    └─ one OCI sandbox per attempt, read-only digest-pinned rootfs
  └─ /var/lib/agentforge/artifacts (write 0640, directories 2750)
```

The web process cannot start containers or mutate sealed files. The trusted host Worker needs root because this deployment uses host `runsc`; it runs with primary group `agentforge-artifacts`, and only that group is shared read-only with the web container. Do not mount `/var/run/docker.sock`, make the web container privileged, or set gVisor as Docker's global default runtime.

## 2. 已验证的 Hubei 基础设施 / Verified host prerequisites

The approved Hubei host has used these pinned paths:

```text
runsc:             /usr/local/bin/runsc
version:           release-20260831.0
rootfs:            /opt/agentforge/rootfs
OCI template:      /opt/agentforge/oci-template.json
rootfs metadata:   /opt/agentforge/rootfs-metadata.json
portable Node:     /opt/agentforge/node-v22.19.0-linux-x64/bin/node
sandbox work:      /var/lib/agentforge/sandboxes
artifact storage:  /var/lib/agentforge/artifacts
image digest:      sha256:9db7b59979c38555a39def84a31fb98b5296952f9e3afd4f6f11f05b07adfab0
```

Do not stop, restart, rename, or prune unrelated Hubei containers. In particular, the AgentForge scripts must not affect:

```text
sillytavern
deeix-chat-cloudflared
deeix-chat-app
deeix-chat-postgres
deeix-chat-redis
```

## 3. Prepare gVisor and the immutable rootfs

Review scripts before running them as root:

```sh
sudo scripts/deploy/install-gvisor.sh --apply
sudo scripts/deploy/prepare-sandbox-rootfs.sh --apply
```

The installer pins a release; the rootfs script pins the BusyBox image digest, exports a never-started image, removes all write bits, and records the digest in `rootfs-metadata.json`. It does not install packages, edit Docker `daemon.json`, change the default runtime, restart Docker, or prune images/containers. Deployment scripts accept `AGENTFORGE_DEPLOY_NODE`; when it is not set they use `node` from `PATH`, then the verified portable Hubei path above. They fail closed if no executable Node is available.

Re-running either command is idempotent when the installed version/digest matches. A mismatch fails closed. Use `--replace` only after explicit review; the previous rootfs is preserved as a timestamped backup.

## 4. Production environment file

Start from `.env.worker.example`, store the populated file outside the checkout, and restrict it:

```sh
sudo install -d -o root -g root -m 0700 /etc/agentforge
sudo install -o root -g root -m 0600 production.env /etc/agentforge/production.env
```

Required launch state:

```dotenv
APP_ENV=production
DEMO_MODE=false
EVALUATION_SCHEDULER_MODE=outbox
ARTIFACT_ARENA_ENABLED=true
ARTIFACT_ARENA_KILL_SWITCH=false
PI_RUNTIME_ENABLED=true
```

The same root-only environment file is consumed by the dedicated dependency stack, web container and trusted Worker so queue names, encryption key, database, Redis, storage path and launch flags cannot drift. PostgreSQL and Redis each have two equivalent URLs: `DATABASE_URL` / `REDIS_URL` use loopback high ports for the host Worker, while `AGENTFORGE_WEB_DATABASE_URL` / `AGENTFORGE_WEB_REDIS_URL` use the service names on `agentforge-production-backend` for the web container. Their protocol, credentials, database/index and URL options must match; production preflight rejects drift. The file must also include the sandbox paths/digest, `ARTIFACT_STORAGE_GID`, and exact provider host allowlist. User API keys are stored encrypted in PostgreSQL; never place a user's key in this file.

For the dedicated same-VPS data services, set strong random PostgreSQL/Redis passwords and pin both images to exact repository digests. The high ports stay bound to `127.0.0.1`; do not publish them to `0.0.0.0` and do not reuse the existing `deeix-chat-postgres` or `deeix-chat-redis` services.

Supported user-selected protocol shapes are:

```text
openai-chat
openai-responses
anthropic-messages
google-generative-ai
```

Protocol selection is explicit; the platform does not infer provider semantics from an API-key prefix. Custom OpenAI-compatible providers require an operator-reviewed exact host in `PROVIDER_ALLOWED_HOSTS`. DNS resolution to private, loopback, link-local or metadata ranges remains rejected.

This BYOK release has no platform USD model-spend cap. That does **not** remove token, tool-call, duration, memory, disk, process, queue, cancellation, concurrency or unknown-result retry limits. `RUN_MAX_TOTAL_COST` remains the legacy DAG setting and is not an animation-CreationRun budget.

## 5. Start the dedicated data services and prove backups

Pull reviewed PostgreSQL 16 and Redis 7 tags, record each immutable `RepoDigest`, and place those complete `name@sha256:...` values in the production environment. Then render the configuration without changing the host and start only the dedicated `agentforge-data` Compose project:

```sh
sudo scripts/deploy/data.sh check /etc/agentforge/production.env
sudo scripts/deploy/data.sh up /etc/agentforge/production.env
sudo scripts/deploy/data.sh status /etc/agentforge/production.env
```

This creates only the named network and volumes below, and binds host access to the configured loopback high ports (defaults `55432` and `56379`):

```text
agentforge-production-backend
agentforge-production-postgres-data
agentforge-production-redis-data
```

Before the first application migration, create a backup in a root-only directory. On a fresh database the dump can legitimately predate `schema_migrations`; after migration create another backup and exercise a disposable restore database:

```sh
sudo scripts/deploy/data.sh backup \
  /etc/agentforge/production.env \
  /var/backups/agentforge

post_migration_backup=$(sudo scripts/deploy/data.sh backup \
  /etc/agentforge/production.env \
  /var/backups/agentforge)
sudo scripts/deploy/data.sh restore-check \
  /etc/agentforge/production.env \
  "$post_migration_backup"
```

`backup` writes a gzip-tested SQL dump plus SHA-256 sidecar at mode `0600`. `restore-check` creates a uniquely named temporary database, restores into it, verifies a non-empty `schema_migrations` ledger, and drops only that temporary database. Neither command removes volumes or operates on another Compose project.

## 6. Build and stage one immutable release

Build on the target Hubei host so the Docker image and host Worker use the same reviewed source SHA. Place each release in a new directory; do not overwrite a prior release:

```sh
release_sha=$(git rev-parse --verify HEAD)
sudo install -d -o root -g root -m 0755 "/opt/agentforge/releases/$release_sha"
# Copy/export exactly this committed source into that directory, then:
cd "/opt/agentforge/releases/$release_sha"
corepack pnpm install --frozen-lockfile
corepack pnpm test
corepack pnpm typecheck
corepack pnpm build
```

Keep `node_modules` in the host release because the Worker runs the TypeScript entrypoint through Node 22 native type stripping. The web image is built by `scripts/deploy/app.sh` from the same checkout.

## 7. Preflight and install the trusted Worker

Choose an unused numeric system GID and write it as `ARTIFACT_STORAGE_GID`. Then run:

```sh
sudo AGENTFORGE_WORKER_NODE=/opt/agentforge/node-v22.19.0-linux-x64/bin/node \
  scripts/deploy/worker.sh install \
  /etc/agentforge/production.env \
  "/opt/agentforge/releases/$release_sha"

sudo scripts/deploy/worker.sh check \
  /etc/agentforge/production.env \
  "/opt/agentforge/releases/$release_sha"
```

`install` creates only:

```text
agentforge-artifacts system group at the configured GID
/var/lib/agentforge/artifacts  root:agentforge-artifacts  2750
/var/lib/agentforge/sandboxes root:root                  0700
/etc/systemd/system/agentforge-evaluation-worker.service
```

It normalizes only the dedicated artifact tree to directory mode `2750` and file mode `0640`, reloads systemd, and enables—but does not start—the Worker. The script verifies the pinned Node executable, frozen host dependencies, runsc, read-only rootfs, OCI template, metadata digest, shared group and paths.

## 8. Release the web app, migrate, and start the Worker

Confirm the dedicated data services are healthy and record the pre-migration backup path first. From the staged release:

```sh
sudo scripts/deploy/app.sh check \
  /etc/agentforge/production.env \
  "agentforge:$release_sha"

sudo scripts/deploy/app.sh release \
  /etc/agentforge/production.env \
  "agentforge:$release_sha" \
  --backup-confirmed

sudo scripts/deploy/worker.sh restart \
  /etc/agentforge/production.env \
  "/opt/agentforge/releases/$release_sha"
```

`worker.sh restart` refreshes the systemd unit from the supplied immutable release directory before restarting it; verify `systemctl show agentforge-evaluation-worker.service -p WorkingDirectory` after every cutover. The app release order is immutable image build → one-off additive migration/seed → container health wait. It joins only `agentforge-production-backend` and binds HTTP only to `127.0.0.1:${AGENTFORGE_HTTP_PORT:-53180}`. Immediately create and restore-check a post-migration backup using Section 5. The Worker is an independent systemd service, so a web rollback does not silently leave a mismatched Worker; install/restart the matching prior Worker release explicitly.

Useful checks:

```sh
sudo scripts/deploy/worker.sh status /etc/agentforge/production.env "/opt/agentforge/releases/$release_sha"
sudo journalctl -u agentforge-evaluation-worker.service -n 200 --no-pager
sudo -u root env $(cat /etc/agentforge/production.env | sed '/^#/d') \
  /opt/agentforge/node-v22.19.0-linux-x64/bin/node \
  --experimental-strip-types scripts/worker-healthcheck.ts
curl --fail http://127.0.0.1:53180/api/arena/boot
```

Do not paste environment files into a shell on a multi-user host; the expanded `env $(cat ...)` form above is only illustrative. Prefer `systemctl show`, the service `ExecStartPre`/health command, or a root-only shell that sources a safely reviewed file.

## 9. Cloudflare Tunnel

The tunnel ingress should proxy the production hostname to:

```text
http://127.0.0.1:53180
```

Set `BETTER_AUTH_URL` to the exact public HTTPS origin. Preserve the original host and HTTPS scheme through the tunnel. Do not expose the systemd Worker, Redis, PostgreSQL, runsc state, sandbox work root or artifact filesystem as public tunnel ingress.

After the tunnel is active, verify the exact public origin, registration/login, secure cookies and `/api/arena/boot`. Browser origin/CSP checks must use that HTTPS hostname, not only localhost.


The current production route is:

```text
hostname: arena.pillarit.cn
tunnel:   edge-hubei-pillarit-cn
tunnelId: e5e2298c-8487-4a75-9ec9-f8236d6eb2c9
origin:   http://127.0.0.1:53180
```

The rule was inserted immediately before the existing `http_status:404` fallback. Preserve all unrelated ingress rules. Do not inspect or copy the tunnel token from process command lines; the token serves multiple live hostnames and rotation requires a separately planned coordinated change.

## 10. Sandbox and artifact lifecycle

For every CreationRun attempt:

1. Worker claims a fenced EF attempt from PostgreSQL/BullMQ.
2. Trusted Worker decrypts the owner's BYOK key and calls only the selected allowlisted provider protocol.
3. A new `runsc --network=none` OCI sandbox starts with a read-only digest-pinned rootfs and per-attempt output mount.
4. Pi can invoke only approved bounded artifact tools; the API key is never inserted into prompt, tool args, sandbox environment, files or logs.
5. Worker stops all sandbox processes and computes a stable snapshot.
6. Required `index.html` and optional files are validated, sanitized, digested and written immutably to artifact storage.
7. Bundle/manifest and `CreationRun.artifactBundleId` are committed atomically.
8. `runsc delete --force` runs and the per-attempt bundle directory is recursively removed in success, failure, cancellation and unknown-result paths.

Only the sealed files and database evidence survive. If disposal cannot be verified, the attempt fails closed and must be investigated; never expose the working directory as a fallback artifact.

## 11. Public-launch verification

Before routing users, execute and record:

```sh
pnpm test
pnpm typecheck
pnpm build
pnpm test:deploy
MIGRATION_TEST_DATABASE_URL='postgres://…isolated-test-db…' pnpm test:migrations
pnpm test:evaluation-db
SMOKE_BASE_URL='http://127.0.0.1:<isolated-port>' pnpm test:smoke
sudo /opt/agentforge/node-v22.19.0-linux-x64/bin/node --experimental-strip-types scripts/deploy/runsc-provider-smoke.ts
```

Then use two fresh normal accounts in the real browser:

- both original challenges visible without an invitation;
- save each supported provider protocol configuration without exposing the key;
- run, refresh/recover, cancel and retry;
- preview animation, pause, replay and reduced-motion behavior;
- publish/review, like/unlike, blind vote, sample-insufficient leaderboard and Fork;
- malicious script/event handler/external URL/cross-bundle cases are rejected;
- sandbox work and runsc state are empty after each terminal attempt;
- web container can read sealed files but cannot create, change or delete them.

The two required real-model acceptance runs need user-authorized BYOK credentials. Offline provider-wire tests, a fixed sandbox smoke, or a previous unrelated model sample cannot replace them.

## 12. Kill switch and rollback

To stop new creation/publication/voting while preserving authorized historical reads:

1. set `ARTIFACT_ARENA_KILL_SWITCH=true` in the root-only environment file;
2. restart web and Worker;
3. confirm boot availability reports the kill-switch reason;
4. allow in-flight cancellation/reconciliation and moderation reads to continue.

Application rollback:

```sh
sudo scripts/deploy/app.sh rollback \
  /etc/agentforge/production.env \
  agentforge:<previous-release>

sudo scripts/deploy/worker.sh install \
  /etc/agentforge/production.env \
  /opt/agentforge/releases/<previous-release-sha>
sudo scripts/deploy/worker.sh restart \
  /etc/agentforge/production.env \
  /opt/agentforge/releases/<previous-release-sha>
```

Do not roll back migrations by dropping tables/columns, delete sealed artifacts, remove the dedicated data volumes, or prune shared Docker resources. Preserve EF v2 messages and use a compatible Worker. Restore PostgreSQL only under a separately approved disaster-recovery procedure using a verified backup; application rollback must leave the dedicated PostgreSQL and Redis services running.
