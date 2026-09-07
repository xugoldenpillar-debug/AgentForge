# AgentForge 快速启动

> 当前应用只有 Next.js 运行时。Portable 已退役；相关截图和验证材料仅保留作历史证据，不是启动入口。

## 1. 启动完整应用

需要 Node.js 22.16 或更新版本、Corepack/pnpm、Docker Compose，以及安装依赖所需的网络。

```sh
corepack enable
pnpm install
pnpm run setup
docker compose up -d postgres
pnpm db
pnpm dev
```

在终端显示的本地应用地址打开浏览器。也可以用 Docker 启动完整服务：

```sh
node scripts/setup.mjs
docker compose up --build
```

`pnpm run setup` 只生成缺失的本地配置，不覆盖已有 `.env`。请使用独立的本地数据库和测试密钥，不要把真实凭据写入仓库或提交到 Git。

## 2. 测试模式与真实模型

正常环境默认是 `APP_ENV=development`、`DEMO_MODE=false`。离线 Demo 只在明确设置 `APP_ENV=test` 和 `DEMO_MODE=true`，并指向一次性测试数据库时启用；测试模式不能用于部署。

真实模型必须在 Next.js 应用的 Providers 中配置用户自己的 BYOK 凭据，并在 Builder 的 Model 节点显式选择。真实运行不会在失败时回退到 Demo；BYOK 结果也不进入 Verified 排行榜。

Pi 是默认关闭的可选离线 PoC，不是用户可选运行时、沙箱或竞争性运行通道。启用前必须满足代码中的 Feature Flag、Node 版本和评测调度边界；接入 EF/outbox 时，Pi self-test 会 fail closed。

## 3. 当前可体验的闭环

登录后可以选择内置挑战，创建或编辑 Build，拖动 Workflow 节点，保存不可变版本，运行公开测试，提交隐藏评测，查看评分/排行榜，并从选定版本 Fork。内置 Demo 是有界的确定性模拟器，不读取标准答案或隐藏 fixtures，也不代表真实模型质量。

当前实现还包括：

- Next.js/React/React Flow Builder 与共享 `en` / `zh-CN` 本地化基础；
- DAG 校验、实际边驱动执行、确定性评分、Demo/BYOK/Verified 信任分层；
- BYOK 凭据的用户隔离与认证加密；
- PostgreSQL 版本化迁移、事务锁、历史 checksum/schema 校验；
- Evaluation Job/Attempt/Invocation、事务 Outbox、Redis/BullMQ 独立 Worker 的可靠评测基础；
- 私有 Agent Build 草稿的数据边界与在模型调用前拒绝执行的安全策略；
- 社区组件库的内置展示、部分数据/权限基础和独立设计边界。

## 4. 验证入口

```sh
pnpm test
pnpm typecheck
pnpm build
pnpm test:migrations         # 显式使用一次性隔离 PostgreSQL 目标
pnpm test:evaluation-db      # 隔离 PostgreSQL + Redis/BullMQ Worker
pnpm test:smoke              # 指向当前任务自己的 Next.js 测试服务
pnpm test:pi-runtime         # Pi SDK 离线测试，不产生付费调用
```

具体迁移约束见 `docs/MIGRATIONS.md`，Worker 配置见 `docs/evaluation-worker-operations.md`，当前合并的完成/未完成状态见 `docs/PI-MAIN-INTEGRATION-REVIEW.md`。历史验证结果必须按日期阅读，不代表当前进程、资源或生产环境状态。

## 5. 当前边界

AgentForge 仍是本地 MVP。生产 TLS/origin、CSP nonce、备份恢复、密钥轮换、滥用监控、内容审核、完整可观测性、负载/压力、全面无障碍和渗透测试尚未完成。完整 Verified Gateway、Agent 执行/沙箱、社区公开发布、邮箱验证/找回密码和生产 Worker 部署也不能由本快速启动说明替代。
