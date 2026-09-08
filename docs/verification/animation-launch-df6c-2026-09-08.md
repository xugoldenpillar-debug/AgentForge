# 两题 BYOK 动画竞技场最终验证 — 2026-09-08

## 结论

分支：`codex/two-challenge-launch`。当前生产运行时代码提交：`4131b4bdf3efa19ccf0959ac473046358975db28`，已推送到 `origin/main`；初始公开版提交为 `bd47c913479ccfa9c9217c8a42fa60c2b739d508`。

本轮实现并部署了以下产品闭环：

```text
选题 → 显式选择 BYOK 协议/模型/Skill → 保存不可变 Build
→ CreationRun v2 / EF outbox → Pi 工具循环 → gVisor/runsc
→ 不可变文件存储 → 安全动画预览 → 发布/审核
→ 点赞/取消点赞 → A/B 盲选 → 社区分/分榜 → Fork
```

生产入口为 `https://arena.pillarit.cn`，已对全部正常注册用户开放。模型调用只使用用户自己提供并经服务端加密的 API Key。首版支持 `openai-chat`、`openai-responses`、`anthropic-messages`、`google-generative-ai` 四种显式协议，不按 Key 前缀猜测协议。动画 CreationRun 不设置平台美元费用上限；token、轮次、工具、时长、内存、磁盘、进程、并发、取消和恢复边界仍然保留。

**准确边界：代码、生产数据栈、真实 outbox/Worker、gVisor 沙箱、Cloudflare HTTPS、公开注册和无效凭据失败/恢复路径已经验证。两题各一次成功的真实付费模型运行仍未完成，因为本轮没有用户授权的有效 BYOK Key；因此不能把 L7 写成全部通过，也不能验证成功产物的生产动画播放、发布、点赞和真实盲选。**

## 生产 CreationRun 故障修复

2026-09-08 用户报告 `creation-run-8f7056ec5fb21e49e19874ca1dce656a` 以 `CREATION_EXECUTION_FAILED` 结束。只读生产库检查确认其 EF Attempt 在约 0.31 秒内失败，`evaluation_invocations` 为 0、无 Artifact bundle；因此请求尚未跨越到模型供应商，正常情况下不会产生本次模型调用费用。

根因有两项：

1. Creation executor 的首次 `invocationIndex` 从 0 开始，而生产 PostgreSQL 的 `evaluation_invocations_invocation_index_check` 明确要求 `invocation_index > 0`。第一次 Invocation 落账在发起模型 HTTP 前即被数据库拒绝，并被上层折叠为通用执行错误。修复后 Creation 与既有 competitive executor 一致，使用 1-based 序号；回归测试明确断言 `[1, 2]`。
2. Hubei 的真实 gVisor smoke 复现 `runsc kill/delete` 返回与状态目录收敛之间的短暂竞态。旧实现只检查一次，会把仍在收敛的正常停止误判为失败并残留诊断 bundle。修复后在约 3 秒有界窗口内重试 `state/list/delete`，仍无法独立验证时继续失败关闭并保留现场。

提交 `4131b4bdf3efa19ccf0959ac473046358975db28` 已在 Hubei 构建为不可变镜像并部署。Web 容器与 systemd Worker 均指向该提交；修复版真实 `runsc` smoke 覆盖创建、写入、停止、snapshot 读取和 dispose，全部通过。生产 `runsc list` 为 `null`，沙箱 attempt/bundle 残留为 0。部署前备份 `/var/backups/agentforge/agentforge-20260908T081314Z.sql.gz` 已通过一次性数据库恢复校验。

## 隔离数据库与应用回归

本地集成验证使用本任务专属、可丢弃资源：

- PostgreSQL 容器：`agentforge-launch-df6c-pg-20260907`，本机端口 `32769`，数据库 `agentforge_launch`；
- Redis 容器：`agentforge-launch-df6c-redis-20260907`，本机端口 `32770`；
- 测试数据库凭据仅保存在 mode `0600` 的临时文件中，未打印、未提交。

实际结果：

| 命令 | 结果 |
| --- | --- |
| `pnpm test:migrations` | 4 通过，0 失败；覆盖全新库、旧库升级、重复执行、迁移历史/回滚保护 |
| `pnpm test:evaluation-db` | 1 通过，0 失败；真实 PostgreSQL + BullMQ 持久化 |
| `pnpm db` | 0 applied、17 unchanged；目录初始化成功 |
| production Next.js + `pnpm test:smoke` | 通过；认证、权限、私有 Build、CAS、历史与 Fork；未调用付费模型 |

## Hubei 生产部署与数据恢复

目标主机：`hubei-4h20g`。生产 release 和镜像均固定到提交 `bd47c913479ccfa9c9217c8a42fa60c2b739d508`：

```text
release: /opt/agentforge/releases/bd47c913479ccfa9c9217c8a42fa60c2b739d508
image:   agentforge:bd47c913479ccfa9c9217c8a42fa60c2b739d508
```

生产配置位于 `/etc/agentforge/production.env`，权限为 `0600 root:root`；秘密未写入仓库或验证文档。AgentForge 使用专属依赖，不复用也不修改既有 `deeix` 数据服务：

```text
PostgreSQL: agentforge-data-postgres-1 · 127.0.0.1:55432 · PostgreSQL 16.15
Redis:      agentforge-data-redis-1    · 127.0.0.1:56379 · Redis 7.4.11
Web:                                      127.0.0.1:53180
Network:    agentforge-production-backend
Volumes:    agentforge-production-postgres-data
            agentforge-production-redis-data
```

PostgreSQL 与 Redis 使用完整 digest 固定的镜像。迁移结果为 `17 applied, 0 unchanged`，正式题库已初始化，未生成模拟活动。备份：

```text
迁移前: /var/backups/agentforge/agentforge-20260908T054903Z.sql.gz
迁移后: /var/backups/agentforge/agentforge-20260908T061359Z.sql.gz
```

两份备份均通过 gzip 与 SHA-256 sidecar 校验，权限为 `0600`。迁移后备份已恢复到一次性数据库，`schema_migrations` 台账验证成功，之后仅删除该一次性数据库。

## 真实 gVisor、Worker 与对象存储

主机运行环境：

- `runsc release-20260831.0`，路径 `/usr/local/bin/runsc`；
- rootfs `/opt/agentforge/rootfs`；
- OCI template `/opt/agentforge/oci-template.json`；
- Node `/opt/agentforge/node-v22.19.0-linux-x64/bin/node`；
- 固定 rootfs 镜像 digest `sha256:9db7b59979c38555a39def84a31fb98b5296952f9e3afd4f6f11f05b07adfab0`。

`RunscSandboxProvider` smoke 已真实执行并通过：独立 provider、只写 output mount、停止全部进程、稳定 snapshot digest、封存读取、dispose 清理。生产 Worker `agentforge-evaluation-worker.service` 为 `enabled + active`；Worker 依赖从同一生产镜像提取，避免主机与容器依赖漂移。

生产权限探针确认：Worker 能写不可变产物；Web 容器能读，但不能创建、修改或删除产物。探针已清理。2026-09-08 生产失败运行后的终态再次确认：

```text
runsc list --format=json → null
/var/lib/agentforge/sandboxes 无 attempt/bundle 残留
Worker 本次启动以来 warning/error 日志数 → 0
Worker 日志常见 API Key/Bearer 模式命中数 → 0
```

失败运行 `creation-run-42e71766c4ee7a59042ebd04182db0a4` 的数据库记录一致：CreationRun 与 EF job 均为 `failed`，错误码为 `CREATION_EXECUTION_FAILED`，attempt 已结束、lease expiry 已清除，accepted outbox 已发布；无 artifact bundle、provider invocation 或美元预算记录。仅保留历史 worker lease 标识用于审计，不保留有效 lease 或沙箱工作目录。

取消竞态也在生产验证：对 `creation-run-e94dacf69862d5c255118fa76dc53b7c` 的取消请求返回 `202` 并持久化 `user-requested` 与请求时间；无效供应商凭据的失败先完成，所以最终状态合法地收敛为 `failed`，不是 `cancelled`。终态同样无 runsc/work-root 残留。单元与集成测试另覆盖取消先到时的 `cancelled` 终态。

## Cloudflare 与公开入口

Cloudflare Tunnel：

```text
hostname: arena.pillarit.cn
origin:   http://127.0.0.1:53180
tunnel:   edge-hubei-pillarit-cn
id:       e5e2298c-8487-4a75-9ec9-f8236d6eb2c9
```

Tunnel 配置从版本 4 更新为版本 5，仅在最终 `http_status:404` fallback 前增加 AgentForge 规则；`deeix.pillarit.cn`、`st.pillarit.cn`、`claw.pillarit.cn`、`newapi.pillarit.cn` 的既有 ingress 保持不变。新增的 proxied CNAME 指向该 Tunnel。`newapi.pillarit.cn` 在变更后仍返回 `502`，但其 ingress 未改变，视为无关 origin 的既有问题，本轮未擅自修改。

公网 `/api/arena/boot` 返回 `200`，并确认：

```text
demoMode=false
creationRuns=true
showcase=true
voting=true
piRuntime=true
```

## 生产浏览器验收

通过真实 HTTPS 域名和一个新注册的正常用户完成以下检查：

- 公开注册成功，认证后可进入 `/agent-builder`；
- 两道原题均可见并显示运行服务 ready；
- 简体中文与 English 均可切换；
- `openai-chat`、`openai-responses`、`anthropic-messages`、`google-generative-ai` 四个协议选项均可见；
- 390px 窄屏 `innerWidth=390`、`scrollWidth=390`，无横向溢出；
- 明确无效的 QA Key 被服务端加密保存，页面只显示掩码；
- 私有 Pelican Build 保存成功，并可 Fork 为新的私有 Build；Fork 后名称增加 `/ remix`，版本 digest 保持可审计；
- 真实 CreationRun 经 Web → PostgreSQL outbox → BullMQ → 独立 Worker 调度；无效凭据按预期失败并显示 Retry；
- Retry 可创建新 run，页面刷新后会从 localStorage 中的 run ID 恢复终态；
- 取消 API 在真实生产路径返回 `202` 并持久化取消请求；本次因失败竞态未收敛为 `cancelled`；
- 空榜显示 `0` 有效票、`0` 独立选民和“样本不足”，不伪造分数；
- 请求盲选时没有两个其他作者的已发布作品，明确显示无可用 pair；
- 登录 Cookie 为 `__Secure-better-auth.session_token`，属性为 `Secure=true`、`HttpOnly=true`、`SameSite=Lax`、`Path=/`。

生产 QA Build：

```text
原 Build: 7a3abcfb-17b4-486c-9026-d13f92af4798 · v1
Fork:     4847fbaa-b8be-4850-8d4e-7a30637f8308 · v1
digest:   sha256:03905f5dad1b00800…
```

浏览器 session 已关闭，mode `0600` 的本地临时 QA 凭据文件已删除。没有有效 BYOK 产物，因此生产发布、审核、点赞、成功动画预览和有效盲选没有伪造执行；这些能力由隔离回归和浏览器 QA 数据验证，仍需首个有效用户作品做生产成功路径复验。

本地真实 production build 浏览器回归另验证了安全预览、发布/审核、点赞/取消点赞、盲选、社区分、正式榜门槛和 Fork。用于正式榜渲染的 `20/20` 是明确标记的 QA 数据，不是自然社区票。

## 最终质量门

实际执行结果：

| 命令 | 结果 |
| --- | --- |
| `pnpm test` | 474 tests；473 通过、1 跳过、0 失败 |
| `pnpm typecheck` | 2026-09-08 最终文档更新前后均通过 |
| `pnpm test:provider-sdk` | 33 通过、0 失败；四协议离线 wire/auth/usage/cancel，不产生模型费用 |
| `pnpm test:pi-runtime` | 30 tests；29 通过、1 跳过、0 失败；已安装 Pi SDK 的离线真实 loop |
| `pnpm test:deploy` | 15 通过、0 失败；Shell/Python 语法、preflight、数据拓扑、rootfs、发布/回滚约束 |
| `pnpm build` | Next.js 16.3.4 production build 通过；Hubei 冷构建也通过 |
| `git diff --check` | 通过 |
| 产品路径 fixture 扫描 | `src/app`、`src/components`、`src/features`、`src/lib/client-api.ts` 无匹配 |
| diff 秘密模式扫描 | 仅示例占位连接串和测试无效连接串；无真实 API Key、私钥或生产连接串 |

## 尚未关闭的生产 Gate

1. 每道题至少一次用户授权的有效 BYOK 模型成功运行，并记录 run/attempt、协议、模型、Pi/环境版本、usage、artifact/snapshot/manifest digest 和终态清理证据；
2. 基于上述成功产物，在公网验证动画播放/暂停/重播、reduced-motion、安全拒绝、发布/审核、点赞/取消点赞、有效 A/B 盲选、社区分和 Fork 的完整闭环；
3. 用自然多账号社区流量达到正式榜最低有效票与独立选民门槛，不将 QA 票作为线上成绩；
4. 持续配置生产监控告警和审核值守，并在有真实在途运行时演练 kill switch 与应用/Worker 匹配版本回滚；
5. 若需要一个确定的生产 `cancelled` 证据，应在不影响其他用户队列的维护窗口，用可控慢响应 provider 或专属队列执行，不能通过停掉公共 Worker 制造结果。
