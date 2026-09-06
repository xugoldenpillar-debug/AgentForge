# 本机全栈验证环境（2026-09-06）

工作目录：`/Users/pillarxu/.codex/worktrees/f4f7/AgentForge`。这是独立本地 Demo 测试环境，不是生产配置，也未启用 Verified Gateway。

## 已配置

- OrbStack / Docker 29.4.0；PostgreSQL 17 Alpine。
- 容器 `agentforge-f4f7-postgres`，仅绑定 `127.0.0.1:55437`。
- 持久卷 `agentforge-f4f7-postgres-data`，应用数据库 `agentforge`。
- `.env` 使用随机数据库密码、认证 secret 和加密密钥，权限 0600，已被 Git 忽略。`.data/local-validation/postgres.env` 同样受保护。不要提交或分享这些文件。
- Next.js 地址 `http://localhost:3107`；`BETTER_AUTH_URL` 与此匹配，`DEMO_MODE=true`。
- 本次 Node 26.7.0 / pnpm 10.15.1；尚未在 CI 的 Node 22 上复验。

## 重启与测试

以下命令在上述工作目录执行。已有服务正在运行时不要再启动第二份。

```sh
open -a OrbStack
# 等待 Docker 就绪后；复用已有容器，不重新创建或删除卷。
docker start agentforge-f4f7-postgres
pnpm db:migrate
pnpm build
pnpm exec next start --hostname 127.0.0.1 --port 3107
```

另一终端执行：

```sh
pnpm test
pnpm typecheck
# 必须显式加载 .env；测试创建并清理自己专用的临时数据库。
node --env-file=.env --experimental-strip-types --test tests/migrations.integration.ts
# 会向本地应用数据库写入新的测试账号、Build 和结果。
SMOKE_BASE_URL=http://localhost:3107 pnpm test:smoke
```

`pnpm db` 包含迁移和 seed，本次重复执行得到 `0 applied, 2 unchanged`。日常重启优先使用 `db:migrate`，无需重复 seed。
停止 Next 服务使用其终端 Ctrl+C；停止数据库使用 `docker stop agentforge-f4f7-postgres`，不删除卷。此配置仅适用于这台机器；换机器需重新安全生成本地配置，不能复制演示配置到生产。

## 实际结果与上线边界

- 单元/服务/HTTP 回归：112 通过，0 失败；类型检查通过。此前生产构建通过。
- PostgreSQL 实库矩阵：1 通过；覆盖新库、旧库升级、重复运行、事务回滚、并发锁和数据保留。
- Next + PostgreSQL + Better Auth 冒烟通过：注册、会话读取、退出、旧 Cookie 重放失效、错误密码拒绝、重新登录；三个挑战的公开运行、隐藏提交、榜单、Fork。
- 同一增强冒烟在独立临时目录的 Portable 服务通过；两运行时认证/存储仍然独立。
- 原生 React 浏览器：登录、React Flow 编辑器、保存、公开测试、隐藏提交通过；模型均为 Demo，隐藏结果仅显示汇总。
- **390px 窄屏未通过布局验收**：工具栏操作和右侧配置被裁切，需要后续修复与复测。
- Phase 0 实库阻塞已解除；Phase 1–8 未整体完成。真实 DeepSeek、私有 Gateway、预算/权限/任务持久化以及生产部署都不能由这些测试替代。
- 未产生付费模型调用，未修改生产数据库，未提交、推送或部署。

## 已授权的真实 BYOK 测试补充

本地演示账号下已加密保存 `DeepSeek Flash local validation` 凭据，并完成一次真实公开 Run。`DEMO_MODE=true` 只保留 Demo 选项；该私有测试 Build 明确选择 Flash，结果层级为 byok。详情见 `docs/verification/deepseek-app-live-2026-09-06.md`。后续点击该 Build 的运行会产生真实 API 费用，不属于普通 Demo 冒烟。
