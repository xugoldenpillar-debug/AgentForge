# hubei 部署与沙箱验收 / Deployment and sandbox verification

日期 / Date: 2026-09-07

> **交付状态：基础设施可验证，动画产品尚不能一键上线。** 下列应用脚本部署的是当前 Next.js 应用（含 BYOK 协议配置），不是完整 L0–L8。真实 gVisor 验证脚本只运行固定测试代码，不是生产 `SandboxProvider`，没有对外执行 API。
>
> **Status: infrastructure probe available; animation launch incomplete.** App scripts deploy the existing Next.js app, including BYOK protocol settings, not the complete L0–L8 product. The gVisor probe executes fixed test code only; it is neither a production provider nor a remote execution API.

## 1. 部署分工 / Topology

- `hubei`：已授权的 Ubuntu 22.04 x86_64 root 主机，4 核、约 19 GiB RAM、剩余约 20 GB 系统盘。Docker 已在承载其他业务，禁止全局清理、修改默认 runtime 或重启来影响它们。
- `grokbox`：受限容器，可以作为网站部署候选；不假定拥有宿主 Docker/KVM 权限。
- 推荐后续：主站/可信 Pi/model broker 与沙箱执行服务分离；用户 Key 不进入沙箱、作品、日志。
- 私有对象存储、数据库、主域、无共享认证 Cookie 的预览域尚需确定；不要从其他业务提取配置或借用数据库。

`hubei` is the approved Linux sandbox test host, with existing unrelated containers. Do not prune or restart them. `grokbox` is a restricted container, not a Docker host. A future trusted Pi/model broker should use a narrow authenticated execution service on hubei. Object storage, production databases and domains are not configured by these scripts.

## 2. gVisor 安装 / Installation

先审阅脚本，在 **hubei 宿主机** 执行；不在网站容器执行。依赖 root、curl、Python 3、tar、zstd。脚本不会 apt install、改防火墙、写 Docker daemon.json 或重启 Docker。

Review and run on the **hubei host**, not inside the web container. Requires root, curl, Python 3, tar and zstd. It does not install OS packages, edit firewall/Docker settings or restart services.

```sh
sudo bash scripts/deploy/install-gvisor.sh --apply
```

固定官方版本 `20260831.0`，同时安装 `runsc`、shim 与配套 `gvisor-bin/`。同版本重复运行会检查并保留；不同版本拒绝覆盖。官方 tar 包先校验 SHA-512。安装中断可能留下不完整目录，脚本会拒绝继续覆盖，需人工检查后恢复，不自动删除既有二进制。

Pins official release `20260831.0` including companion binaries. Repeated installation preserves the same release; mismatches/incomplete installations fail closed. Interrupted installation requires operator recovery, not automatic deletion of existing binaries.

hubei 下载慢时，可在可信机器从同一个固定官方 URL 下载，再用 scp 传输到专用目录：

If direct downloads are slow, download from the same official pinned URL on a trusted machine and transfer both files:

```sh
mkdir -p /tmp/agentforge-gvisor-download
cd /tmp/agentforge-gvisor-download
BASE=https://storage.googleapis.com/gvisor/releases/release/20260831.0/x86_64
curl -fSLO "$BASE/gvisor.tar.zstd"
curl -fSLO "$BASE/gvisor.tar.zstd.sha512"
# Transfer this directory to hubei, then / 传输到 hubei 后执行：
sudo bash /absolute/path/AgentForge/scripts/deploy/install-gvisor.sh --apply /absolute/path/download
```

安装脚本在目标服务器再次校验，不使用不明镜像或关闭 TLS。官方参考：
[Install gVisor](https://gvisor.dev/docs/user_guide/install/)、[Platforms](https://gvisor.dev/docs/user_guide/platforms/)。

## 3. 真沙箱测试与清理 / Real sandbox probe and cleanup

```sh
sudo python3 scripts/deploy/sandbox-smoke.py --apply
```

使用官方 BusyBox **digest**，从新建且未启动的 Docker 容器导出干净 rootfs。测试实际由 `runsc --platform=systrap --network=none` 执行，不把默认 runc 容器冒充 gVisor。

The probe exports a clean rootfs from a new, never-started digest-pinned BusyBox container. Execution uses `runsc` directly, leaving Docker's runtime configuration unchanged.

检查 / Checks:

- nobody 身份、空 capabilities、no-new-privileges、只读根、无 Docker socket；non-root and read-only boundary.
- 外部请求拒绝；external request denied (not a complete network security audit).
- 专用可写 output；生成 index.html → 本地 archive/fsync → 文件一致与摘要校验。
- 独立 cgroup 的 256 MiB / 0.5 CPU / 64 pids 配置读回；**不是 OOM/CPU/PID 压力测试**。
- 启动 sleep 任务、确认 running、取消、确认退出。
- 回收运行实例、任务挂载、rootfs/output/runtime，核对 cgroup 消失；不使用全局 prune 或 lazy umount。
- 测试前后的已有 Docker 容器 ID/启动时间对比，不读取它们的环境变量。

保留 `/tmp/agentforge-gvisor-probe.<random>/archive/index.html`、`report.json`、日志和配置作为本次证据。**这是本地临时归档，不是长期对象存储或备份；也不是动画播放验收。** 脚本 finally 会在正常异常路径尝试回收；SIGKILL/断电后的自动回收仍属未来生产 supervisor 工作。清理失败会报错并保留路径供人工检查，不伪报成功。

Evidence stays under a unique `/tmp/agentforge-gvisor-probe.*` directory. This is local temporary evidence, not durable object storage. Normal exceptions trigger cleanup; crash/power-loss recovery requires a future production supervisor. Cleanup failures are surfaced, not ignored.

## 4. 当前应用部署 / Deploy the existing application

### 环境准备 / Prerequisites

本脚本要求 Docker Compose v2（支持 `up --wait`）及 Node.js >=22.19、pnpm 10.15.1。先在仓库执行 `pnpm install --frozen-lockfile` 以运行 dotenv 配置预检。若只拥有 grokbox 容器，不能直接使用此 Docker 部署脚本；应使用外部数据库 + 进程管理器启动应用，另做部署验收，不尝试挂载 Docker socket。

Requires Docker Compose v2 with `up --wait`, Node >=22.19 and pnpm 10.15.1. Install repository dependencies first for the dotenv preflight. This Docker deployment script targets a Docker-capable host, not the restricted grokbox container.

创建独立生产 PostgreSQL，确认网络可达和备份恢复；脚本不创建、删除或借用数据库。通过受限配置文件提供变量，权限 `0600`，不要提交。下面只有占位符：

Provision a dedicated PostgreSQL database and tested backups separately. Store secrets in a mode-0600 file outside Git. Values below are placeholders, not usable credentials:

```dotenv
DATABASE_URL=<dedicated-production-postgresql-connection-url>
BETTER_AUTH_URL=https://<public-hostname>
BETTER_AUTH_SECRET=<random-secret-at-least-32-characters>
CREDENTIAL_ENCRYPTION_KEY=<canonical-base64-of-32-random-bytes>
APP_ENV=production
DEMO_MODE=false
PI_RUNTIME_ENABLED=false
ARTIFACT_ARENA_ENABLED=false
ARTIFACT_ARENA_KILL_SWITCH=false
PROVIDER_ALLOWED_HOSTS=api.openai.com,api.anthropic.com,generativelanguage.googleapis.com,api.deepseek.com
AGENTFORGE_HTTP_PORT=53180
```

加密密钥必须和数据库一起妥善备份，升级时保留；丢失/更换会导致已有 BYOK 无法解密。模型域名按实际准入选择，不通配、不放行私网。用户选择协议不意味着任意 Base URL 自动获准。

Preserve encryption keys across upgrades; losing them breaks saved credentials. Allow only reviewed provider hosts. Selecting a protocol does not authorize arbitrary destinations.

### 发布 / Release

```sh
# Check only; no writes / 仅配置检查：
bash scripts/deploy/app.sh check /absolute/private/agentforge.env agentforge:release-20260907
# After backing up the target database / 目标数据库备份完成后：
bash scripts/deploy/app.sh release /absolute/private/agentforge.env agentforge:release-20260907 --backup-confirmed
```

使用固定 Compose project `agentforge-production`，只操作自己的 app 服务。不复用别的项目名。镜像 tag 必须是新版本，不允许 latest/覆盖已有 tag。build 使用 frozen lockfile；启动前用一次性 app 容器执行 `pnpm db`（会迁移/补目录），应用重启不重复迁移。健康检查仅说明 HTTP 应用可响应，不等于真实模型/用户闭环成功。

Uses its own Compose project and immutable release tag. `release` builds, runs an explicit one-off migration/seed and starts the app. Health checks do not prove real-model or product acceptance. Migration failure aborts before replacing the old app. A failed new-app health check requires operator rollback; no automatic database reversal.

### Tunnel 与验证 / Tunnel and validation

Tunnel 映射主站域名到 `http://127.0.0.1:53180` **仅在 cloudflared 和 app 端口处于同一宿主网络时适用**。如果 cloudflared 在其他容器，localhost 是它自己，应配置专用网络中的 app 地址；不要暴露数据库或 Docker API，不关闭 TLS 校验。

Map the public hostname to the local app port only if the connector shares the host network context. A connector in another container needs an explicitly configured internal network address. Do not expose databases or Docker APIs.

验证公网注册/登录、Cookie、退出、Provider 保存刷新、未授权访问拒绝。长任务应依靠持久任务状态，而不是 Tunnel HTTP 连接存活；创建任务和重连恢复尚未接通。

Verify public HTTPS auth, cookies, provider persistence and access denial. Durable task recovery must not depend on a long-lived Tunnel HTTP connection; creation wiring is still pending.

### 回滚 / Rollback

```sh
bash scripts/deploy/app.sh rollback /absolute/private/agentforge.env agentforge:previous-release
```

不重建旧镜像、不执行降级 SQL、不删卷。0012/0013 是增量迁移，0013 旧行默认 openai-chat；回滚前仍需核对旧版本读写兼容性。数据库恢复必须单独确认，不能自动回退覆盖新数据。保留上一版镜像与密钥；发布前演练恢复。

Rollback uses the preserved previous image, never destructive SQL or volume deletion. Check schema compatibility; restoring a backup is a separate authorized operation, not automatic rollback.

## 5. 最终公开版的阻塞 / Remaining launch blockers

1. `SandboxProvider` 的真实受限调用、租约/fence/孤儿回收与私有对象存储适配。
2. creation v2 → EF → Pi 接线、取消/重启恢复、共享配额（不做模型美元费用上限不等于取消资源限制）。
3. 安全动画净化与浏览器验收、完整创作 UI、发布/点赞/盲选/得分/排名/Fork 接线。
4. 两题真实 BYOK 验收、生产目标参数、监控、审核及 L7–L8 开放/回滚。

The production sandbox/storage adapters, creation v2 execution/recovery, safe animation UI, community lifecycle, real BYOK acceptance and operational rollout remain incomplete. **Do not enable flags to bypass these gates.**
