# 两题目录切片验证 — 2026-09-07

## 范围与状态

当前分支 `codex/two-challenge-launch`，worktree `df6c/AgentForge`。
仅交付 L0/L1 的目录、政策契约、迁移、幂等初始化和公开只读 API 切片。
**没有完成用户要求的两题完整闭环，L0–L8 均不能关闭。**

新增 `0012_animation_challenge_catalog.sql`；同步 schema.sql、schema.ts、Repository Tables、seedCore。
英文翻译与中文原文分字段保存；内容 digest 绑定版本、原文、翻译与输出政策。
题目与旧 DAG Problem/TestSuite 隔离。题目 published 只表示目录可见，运行返回 dependency_unavailable。
版本应用写入只有插入与 seed 冲突检查，尚无数据库 UPDATE/DELETE 触发器。

## 本次实际命令

| 命令 | 结果 |
| --- | --- |
| `pnpm install --frozen-lockfile` | pnpm 10.15.1，成功；无依赖/锁文件变动；安装器提示部分依赖构建脚本未运行 |
| `pnpm test` | 416 测试，415 通过，1 跳过，0 失败 |
| `pnpm typecheck` | 通过 |
| `pnpm build` | Next.js 16.3.4 通过 |
| `pnpm test:pi-runtime` | 24 测试，23 通过，1 跳过；真实已安装 SDK 离线协议检查，不是付费调用 |
| 显式本任务 `MIGRATION_TEST_DATABASE_URL` + `pnpm test:migrations` | 4 通过；全新库、旧库升级、重复迁移、并发/回滚/历史保留；新增目录外键/唯一约束与重复DDL保留原文检查 |
| `pnpm db`，随后再次 `pnpm db` | 初次12 applied；再次12 unchanged；目录幂等初始化成功 |
| 显式本任务 PG/Redis + `pnpm test:evaluation-db` | 1 通过；既有 DAG EF/outbox/BullMQ/receipt，不是 creation v2 |
| `SMOKE_BASE_URL=http://localhost:53126 pnpm test:smoke` | 通过；真实 Next.js HTTP 注册/认证、旧三题 Demo、草稿/CAS/Fork/权限；没有 Agent 模型调用 |
| GET `/api/arena/animation-challenges` | 实际 Next.js 返回两题、各一个版本、运行 disabled |
| `git diff --check` | 通过 |

没有运行真实浏览器；HTTP smoke 不等于浏览器验收。没有供应商隔离实例、真实模型生成、动画播放、公开社区或生产验证。未使用历史截图或测试票冒充自然社区数据。

## 本任务隔离资源

- PostgreSQL 容器 `agentforge-launch-df6c-pg-20260907`，localhost:32769，应用数据库 `agentforge_launch`。
- Redis 容器 `agentforge-launch-df6c-redis-20260907`，localhost:32770。
- Next.js 生产构建测试服务 localhost:53126，`APP_ENV=test` / `DEMO_MODE=true`。
- 本任务本地 `.env` 由 setup 生成后配置隔离资源，无真实模型凭据，未纳入 Git。
- 资源保留；未触碰其他任务容器/数据库。迁移/EF集成测试仅清理自身创建的 UUID 数据库。
- 用户原有 `.codex/` 未跟踪目录保留。未提交、推送、创建 PR、部署或更改线上权限。

## 下一阶段与发布边界

详见 `specs/artifact-arena/launch/implementation-status.md`：creation v2、真实 provider/对象存储、Pi 工具循环与预算取消恢复、动画安全 renderer、完整 UI、社区与开放运维仍须实现。
基础设施、模型验收预算、生产目标与审核负责人待明确；这些参数阻塞真实依赖验收/发布，但不是其余代码尚未实现的替代说明。
