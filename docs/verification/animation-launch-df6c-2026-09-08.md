# 两题 BYOK 动画竞技场最终验证 — 2026-09-08

## 结论

分支：`codex/two-challenge-launch`。worktree：`df6c/AgentForge`。

本轮完成并验证以下代码闭环：

```text
选题 → 显式选择 BYOK 协议/模型/Skill → 保存不可变 Build
→ CreationRun v2 / EF outbox → Pi 工具循环 → gVisor/runsc
→ 不可变文件存储 → 安全动画预览 → 发布/审核
→ 点赞/取消点赞 → A/B 盲选 → 社区分/分榜 → Fork
```

上线策略为全部正常注册用户可进入，模型调用使用用户自己提供的 API Key。首版支持 `openai-chat`、`openai-responses`、`anthropic-messages`、`google-generative-ai` 四种显式协议，不按 Key 前缀猜测协议。动画 CreationRun 不设置平台美元费用上限；token、轮次、工具、时长、内存、磁盘、进程、并发、取消和恢复边界仍然保留。

**准确边界：代码闭环、离线真实 SDK 接线、真实 gVisor provider 和部署方案已实现并验证；两题真实付费模型调用的 L7 证据未完成，因为没有用户授权的 BYOK Key。** 本报告也不声称生产域名、Cloudflare Tunnel、自然社区票、生产监控/备份或运营值守已经完成。

## 数据库与应用验证

使用本任务隔离资源：

- PostgreSQL 容器：`agentforge-launch-df6c-pg-20260907`，本机端口 `32769`，数据库 `agentforge_launch`；
- Redis 容器：`agentforge-launch-df6c-redis-20260907`，本机端口 `32770`；
- 测试数据库凭据仅保存在 mode `0600` 的临时文件中，未打印、未提交；
- 未连接或修改生产数据库。

实际结果：

| 命令 | 结果 |
| --- | --- |
| `pnpm test:migrations` | 4 通过，0 失败；覆盖全新库、旧库升级、重复执行、迁移历史/回滚保护 |
| `pnpm test:evaluation-db` | 1 通过，0 失败；真实 PostgreSQL + BullMQ 持久化 |
| `pnpm db` | 0 applied、17 unchanged；目录初始化成功 |
| production Next.js + `pnpm test:smoke` | 通过；认证、权限、私有 Build、CAS、历史与 Fork；未调用付费模型 |

## Hubei 真实 gVisor 与部署验证

目标 SSH 主机：`hubei-4h20g`。本轮没有改变其既有 Docker 容器、Docker daemon、默认 runtime 或公网端口。

环境：

- `runsc release-20260831.0`，路径 `/usr/local/bin/runsc`；
- rootfs `/opt/agentforge/rootfs`；
- OCI template `/opt/agentforge/oci-template.json`；
- Node `/opt/agentforge/node-v22.19.0-linux-x64/bin/node`；
- 固定镜像 digest `sha256:9db7b59979c38555a39def84a31fb98b5296952f9e3afd4f6f11f05b07adfab0`。

以当前项目代码执行 `RunscSandboxProvider` smoke，结果 `passed`：

1. 创建真实 project runsc provider；
2. 在唯一可写 output mount 写入作品并持久化；
3. `stopAll()` 验证 runtime 已停止；
4. snapshot digest 与读取结果一致；
5. dispose 后 attempt bundle 与 runsc state 均被清理。

终态检查：

```text
runsc list --format=json
null
```

本次 attempt 目录无残留。一个早于本轮的 `/var/lib/agentforge/provider-smoke/runsc/null-netns` 挂载未被删除，因为它不是本任务创建的资源。

Worker production preflight 在修复以下真实部署问题后通过：

- `worker.sh` 从 release 自身 `package.json` 解析 `dotenv`，不再依赖调用目录；
- rootfs 可写位检查只检查普通文件和目录，不把 Linux symlink 的 `777` 显示误判为可写；
- rootfs preparation 在移除写权限前预创建 `/output`，避免首次运行修改共享 rootfs。

使用与 Compose 等价的只读 bind 权限模型实测：Worker/root 能写 sealed object，带 artifact GID 的 Web 身份能读但不能写或删除。测试前后 Docker inventory 一致，临时组、配置与目录已移除。

## 浏览器验收

使用真实 production build 的 Next.js 服务和已认证普通账号，在本机端口 `33182` 验证；服务完成后已停止，浏览器 session 已关闭。

桌面 `1440 × 1000` 与窄屏 `390 × 844` 均确认：

- 两道原题和运行 ready 状态可见；
- 四种 BYOK 协议可选；
- Pi/Skill、保存、运行、预览、发布、社区步骤完整；
- 中文与 English 关键文案完整；
- 正式榜显示 `75 / 25`、各 `20` 有效票和 `20` 独立选民；
- 零票作品显示名次 `—`、分数 `—` 和“样本不足”；
- 桌面和 390px 视口的 document scroll width 等于 viewport width，无横向溢出。

点赞协议回归：

```text
PUT    /api/arena/showcase/publications/qa-20260908-publication-1/like  → 200
DELETE /api/arena/showcase/publications/qa-20260908-publication-1/like  → 200
显示计数：0 → 1 → 0
```

本验证发现并修复 Next App Router 适配器漏导出 `PUT` 的问题；新增回归测试保证 route adapter 继续暴露该方法。用于榜单渲染的 20/20 数据是明确标记的 QA 数据，不是自然社区票。

## 最终质量门

在上述修复后实际执行：

| 命令 | 结果 |
| --- | --- |
| `pnpm test` | 合并 2026-09-08 最新 `origin/main` 后 472 tests；471 通过、1 跳过、0 失败 |
| `pnpm typecheck` | 通过 |
| `pnpm test:provider-sdk` | 33 通过、0 失败；四协议离线 wire/auth/usage/cancel，不产生模型费用 |
| `pnpm test:pi-runtime` | 30 tests；29 通过、1 跳过、0 失败；已安装 Pi SDK 的离线真实 loop |
| `pnpm test:deploy` | 11 通过、0 失败；Shell/Python 语法、preflight、拓扑、rootfs、发布/回滚约束 |
| `pnpm build` | Next.js 16.3.4 production build 通过 |
| `git diff --check` | 通过 |
| 产品路径 fixture 扫描 | `src/app`、`src/components`、`src/features`、`src/lib/client-api.ts` 无匹配 |
| diff 秘密模式扫描 | 仅示例占位连接串和测试无效连接串；无真实 API Key、私钥或生产连接串 |

## 尚未关闭的生产 Gate

以下项目需要最终生产资源或用户明确授权，未以测试替代：

1. 每道题至少一次用户授权的真实付费 BYOK 模型运行，并保存 run/attempt、协议、模型、Pi/环境版本、usage 与 artifact digest 证据；
2. 在最终 Cloudflare HTTPS 域名验证注册/登录、secure cookie、真实动画播放/暂停/重播、取消/恢复、发布到 Fork 的完整浏览器路径；
3. 用自然多账号社区流量验证正式榜门槛，不将 QA 票作为线上成绩；
4. 配置并演练生产 PostgreSQL/Redis 备份恢复、监控告警、审核值守、Cloudflare Tunnel 和应用/Worker 匹配版本回滚；
5. 上线后以最终 Web 容器 UID/GID 再次确认 sealed files 只读，并逐个检查真实终态运行没有 runsc/work-root 残留。
