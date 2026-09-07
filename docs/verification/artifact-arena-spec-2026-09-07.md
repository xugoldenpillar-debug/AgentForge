# Artifact Arena 文档与实现状态检查点

日期：2026-09-07。本文记录当前 `codex/artifact-arena-spec` worktree 对 AA-T0–AA-T10 的文档/实现一致性检查，以及已有的可归因验证证据。它不是发布报告，也不代表真实 Pi、隔离沙箱、对象存储、生产数据库、完整浏览器闭环或生产开放验收。

## 工作区与范围

- 工作区：`/Users/pillarxu/.codex/worktrees/770e/AgentForge`。
- 分支：`codex/artifact-arena-spec`；当前未提交、未推送、未创建 PR。
- 本 worktree 已包含此前切片：Artifact/Environment/Agent 契约、0010/0011 additive migrations、路径/投影规则、测试用 sandbox provider、Artifact collector/preview、Showcase/Voting 领域 seam、availability/kill-switch 投影、Agent Builder 基础 UI、catalog resolver seam 和 owner-aware environment contract。
- 本检查点同时记录 AA-T8 的最小 adapter/契约测试与文档状态；不修改旧 Submission、旧 DAG 评分、数据库、依赖、运行配置或历史 Portable 数据。
- 未执行生产写入、付费模型调用、真实 Pi 执行、真实隔离沙箱执行、对象存储上传、采购或部署。缺少真实依赖时，当前产品入口按设计保持 fail closed。

## AA-T0–AA-T10 当前完成度

| 任务 | 当前状态 | 当前 worktree 中可确认的切片 | 仍阻塞完成的条件 |
| --- | --- | --- | --- |
| AA-T0 | 部分实现 | 文档冲突裁决、共享契约、迁移映射、availability 投影 | 完整接口冻结、负责人/安全数值和 AA-V1 证据台账 |
| AA-T1 | 部分实现 | Agent/Artifact/Environment 契约、画布 adapter 与校验、配置版 Save/Read/Fork seam、`CatalogAgentBuildResolver` 的六类 release lookup 与撤销/归属校验 | 真实目录/权限数据源、factory 生产 wiring、认证/迁移 Gate 与执行准入 |
| AA-T2 | 部分实现，保持不可用 | SandboxProvider、路径策略、Unavailable provider、测试用内存 provider | 真实隔离实例、网络/资源/停止/快照/跨任务 Gate |
| AA-T3 | 入口切片，未开放 | Pi/EF admission seam 与 fail-closed 依赖检查 | Pi 工具循环、approved sandbox、预算/用量/取消/失联恢复闭环 |
| AA-T4 | 部分实现，未开放 | collector、manifest、owner-scoped read、静态 preview projection | durable object storage、不可变对象、TOCTOU 与真实浏览器/部署安全验证 |
| AA-T5 | 部分实现，未完成 | Agent Builder 基础画布与多格式安全预览 | 实际 Next.js 桌面/窄屏运行闭环、取消/刷新/下载/Fork 验收 |
| AA-T6 | 未完成，入口 fail closed | Creation Brief/Run 基础类型与明确 503 边界 | `creation` EF purpose/association/v2 message、队列消费者、真实 CreationRun API |
| AA-T7 | 领域切片，未开放 | WorkPublication/Showcase/Voting 领域服务与约束 | PostgreSQL/object storage wiring、审核后台、社区页面、反作弊与并发证据 |
| AA-T8 | 契约切片，未开放 | `agent-showcase.ts` 独立 admission/score boundary；fail-closed、证据 resolver、旧评分隔离和输入保密契约测试 | server-owned Profile/Season/Judge/Environment resolver、真实 hidden judge/执行器、完整隐藏评测、durable score/榜单与 AA-V9 Gate |
| AA-T9 | 部分实现 | 独立 Agent canvas、语义 digest/能力校验、approved environment 子图 compiler、能力交集、owner-aware private template 检查、immutable runtime snapshot/boundary | 真实权威 resolver/目录、approved sandbox/runtime wiring、运行时只读 overlay、真实浏览器 Gate |
| AA-T10 | 未完成，开放 Gate 未通过 | feature flag/kill-switch、safe availability projection，以及已授权历史读取的 HTTP 契约级 gate | 供应商/成本/配额/值守/备份/撤销、生产 provider、受邀/生产演练与完整运维证据 |

“部分实现”只表示当前代码存在可测试的边界切片；不表示对应任务的 Gate 已通过。AA-T0–AA-T10 不能因为契约、纯领域、内存 provider、HTTP fail-closed 或构建测试存在而标记全部完成。

## 已存在的安全整合切片

- **AA-T0/T1：共享契约、目录 resolver 与画布适配**：`src/shared/artifact-contract.ts` 是共享 Artifact 合约来源；运行时 collection manifest 与持久化 `ArtifactManifestV1` 保持两个明确的版本化语义，并由 `materializeArtifactManifest()` 适配。`src/lib/agent-builder-definition-adapter.ts` 将已校验的 Agent canvas 转换为共享私有 `AgentBuildDefinition`，但不授予执行、保存、凭据、预算或发布权限；`CatalogAgentBuildResolver` 只提供可注入的 metadata lookup seam，尚未接入生产目录。
- **AA-T0/T10：状态投影与 kill switch**：`src/server/artifact-arena-availability.ts` 提供非秘密能力投影。`ARTIFACT_ARENA_ENABLED=true` 只打开设计和安全预览投影；Artifact 读取、CreationRun、Showcase/Voting 和 Pi 执行仍报告 `dependency_unavailable`。`ARTIFACT_ARENA_KILL_SWITCH=true` 关闭新能力；已注入且已授权的历史 Artifact/Showcase/Voting 读取走独立 `historicalReads` gate，不因 kill switch 被拦截。该行为有 HTTP 契约测试，但不等于真实 durable provider 或生产开放。
- **AA-T2/T3：沙箱与 Pi/EF 入口**：`src/server/sandbox/` 保留 provider 契约、路径规则、不可用 provider 和仅用于纯测试的内存 provider。`src/server/evaluation/adapters/agent-creation.ts` 只做 private B2 配置校验和依赖检查；缺 budget reservation、usage accounting 或 sandbox 时返回 503，依赖齐全时仍因当前 EF 不支持 `creation` purpose 而 503，不创建队列、不调用模型、不启动 Pi。
- **AA-T0/T4：迁移、封存与预览**：加入 `src/db/migrations/0010_artifact_arena_foundation.sql` 与 `src/db/migrations/0011_artifact_arena_showcase.sql`，并同步 `schema.sql`、`schema.ts` 和 migration expectations；覆盖 environment template、creation brief/run、artifact bundle/artifact、WorkPublication/Showcase/Voting/audit。`src/server/artifacts/` 提供 collection、owner-scoped read 和 HTML/Markdown/CSS/SVG/JSON/CSV/text/image data-only projection，以及 path/fence/object-version checks；这些代码级检查不等于真实 TOCTOU 或生产存储安全验证。
- **AA-T6：CreationRun fail-closed**：现有 EF 仍只有 `competitive`、`author-self-test`、`component-evaluation`，没有新增 `creation` purpose/`creation-run` association 或 v2 message。`POST /api/arena/creation-runs` 明确返回 `503 RUNTIME_UNAVAILABLE`，不会将自由问题重解释为 author-self-test。
- **AA-T7/T8：社区与竞技边界**：`src/server/showcase/`、`src/server/voting/` 提供 publication/entry/ballot/vote/leaderboard domain seams，保留 pending/withdrawn、反自投、幂等、过期票和独立榜单约束；真实 route 未注入 durable repository 时继续返回 503，不直接替换 competitive Submission 或混用榜单。
- **AA-T8 最小契约切片**：`src/server/evaluation/adapters/agent-showcase.ts` 已建立独立 hidden Agent admission/score boundary。它只接收 `pi`、sealed/completed hidden evidence 的 opaque ref 和 digest；Profile/Season/Judge/Environment identity 与权重必须由 server-owned resolver 提供。缺 resolver、approved judge 或版本一致性时返回 `503 RUNTIME_UNAVAILABLE`；它拒绝 public bundle、`expected`、`actual`、answer、hiddenAnswer、trace 等字段，不调用旧 DAG judge/scorer，不创建旧 Submission，返回独立 `agent-showcase-score-v1` 且 `legacySubmissionId` 为 `null`。fake judge 仅用于契约测试。
- **HTTP/API**：`src/server/http.ts` 增加可选 `artifactArena` 注入 seam，复用既有 auth、owner/reviewer、Origin/`sec-fetch-site`、限频和 safe-error 约定；`src/app/api/arena/[...path]/route.ts` 继续使用同一 Next.js arena adapter。canonical aliases 可以被路由识别，但未注入 durable service 时统一 fail closed 为 `503 RUNTIME_UNAVAILABLE`。

## 可归因的验证证据

以下命令结果来自当前 worktree 的既有运行记录；本次文档审查没有把未重跑的集成命令补写成通过：

- `node --experimental-strip-types --test tests/agent-showcase-adapter.test.ts`：本次复核实际运行 10 tests，10 passed，0 failed；覆盖 resolver/evidence/judge 缺失时的 503、独立 Agent score normalization、public/answer-shaped 输入拒绝、旧 DAG 组件隔离、judge identity 绑定、server-owned evidence 和环境 identity 漂移。
- `pnpm typecheck`：通过（`tsc --noEmit`）。
- `pnpm test`：本次复核最后一次实际运行 411 tests，410 passed，0 failed，1 skipped。该套件主要覆盖纯逻辑、契约、adapter、内存/测试替身和 HTTP 边界；不等于真实沙箱、对象存储、生产持久化或浏览器安全验收。
- `pnpm test:pi-runtime`：24 tests，23 passed，0 failed，1 skipped；其中包含真实已安装 Pi SDK 的离线、fake stream/tool loop 和 fail-closed 分支，但无网络/付费请求、approved sandbox 或生产 EF 闭环，因此不代表 Pi Arena 可用。
- `pnpm build`：通过；生成了 `/agent-builder` 与 `/api/arena/[...path]`。构建通过不等于页面已经完成桌面/窄屏浏览器验收。
- `MIGRATION_TEST_DATABASE_URL=<本任务隔离 PostgreSQL> pnpm test:migrations`：实际运行 4 tests，4 passed，0 failed；覆盖 fresh/legacy/repeat/rollback/concurrency/preservation 及 0010/0011 schema。凭据和完整连接串不写入本记录。
- `MIGRATION_TEST_DATABASE_URL=<本任务隔离 PostgreSQL> REDIS_URL=<本任务隔离 Redis> pnpm test:evaluation-db`：实际运行 1 test，1 passed，0 failed；覆盖真实 PostgreSQL + outbox + BullMQ worker 的旧 EF 闭环和 Agent 拒绝边界，不代表 Agent/Pi Arena 执行已接入。
- `git diff --check`：通过。
- `curl http://127.0.0.1:3107/agent-builder`：实际返回 HTTP 200；检查到 `X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY`、`frame-ancestors: none`、`object-src: none`，页面包含 Agent Builder/Artifact/Environment/Pi 文案。这只是 Next.js HTTP/header 检查，不替代桌面/窄屏浏览器验收。

以下项目不作为本检查点的已通过证据：`pnpm test:smoke`、桌面/390px 浏览器验收、真实沙箱端到端、对象存储/独立 preview domain、生产部署、付费模型和真实开放演练。它们必须在对应隔离资源、版本和权限记录齐全后单独执行；不能用专项纯测试或历史 worker 报告替代。

## 独立复核补充

- **AA-T9 owner boundary 已有契约级实现**：`EnvironmentTemplateVersionV1` 兼容地支持 `scope/ownerId`，`compileApprovedEnvironmentSubgraph()` 会把 Agent owner 传给 resolver，并拒绝缺失 owner 上下文或跨 owner 的 private template；新增定向测试覆盖同 owner、跨 owner 和缺失上下文。真实目录、sandbox/runtime admission 与浏览器 Gate 仍未完成。
- **AA-T10 historical-read boundary 已有 HTTP 契约级实现**：`handleArena()` 的已授权 Artifact/Showcase/Voting 读取使用 `historicalReads` gate，kill switch 只阻断新写入/新能力；新增测试验证 kill switch 下历史 Artifact bundle 仍可读而 publication 创建返回 503。真实 durable provider、撤销/审计/运维演练仍未完成。


## 明确剩余阻塞

1. **生产 durable wiring（Artifact/Showcase/Voting）**：当前已有 `DrizzleRepository`、领域 durable adapter 和 `ArtifactStorageAdapter` seam，但没有经过验证的生产对象存储 provider；`src/app/api/arena/[...path]/route.ts` 也尚未向 `handleArena` 注入真实 durable services。因此生产 HTTP 路径按设计返回 `RUNTIME_UNAVAILABLE`，不是已上线能力。
2. **AA-T2 Sandbox Gate**：缺真实隔离 provider 证据，包括网络拒绝、资源限制、全进程终止、跨任务隔离和稳定 snapshot。内存 provider 只用于契约测试。
3. **AA-T3 Pi/EF execution Gate**：有 Pi SDK 离线纯测试，但仍缺真实 Pi 工具循环对应的批准沙箱、并发/取消/失联恢复全链路及生产资源证据；不开放 Pi Arena production execution。
4. **AA-T4 production artifact Gate**：缺真实对象存储、不可变对象版本、独立预览域、TOCTOU、恶意 MIME/XSS/跨 bundle/隐藏泄露的真实浏览器与部署验证。
5. **AA-T6 CreationRun**：`src/shared/evaluation-types.ts` 尚未新增 `creation` purpose、`creation-run` association 和 v2 snapshot；现有 EF DB constraint 仍只接受既有用途。为避免改变历史消息、Q15/Q23 或伪造 production persistence，本检查点未开放 creation 入口。
6. **AA-T5/T7 UI 与社区闭环**：尚无针对实际 Next.js 的完整桌面/窄屏浏览器证据，且社区持久化、审核、榜单和多格式独立预览入口尚未接 durable services；纯组件/HTTP 测试不替代浏览器验收。
7. **AA-T8 hidden Agent judge**：已完成最小 admission/score contract slice 与定向契约测试，但仍未创建 hidden production evaluation；真实 server-owned resolver、approved judge/执行器、Pi/EF/approved sandbox worker、durable score、失败/基础设施中断分类、排行榜和 AA-V9 Gate 均未完成。该切片不写 Submission，也不暴露 expected/actual/trace。
8. **AA-T9 environment canvas compiler**：服务端 approved-environment compiler、能力交集、owner-aware private template 检查和 immutable runtime permission snapshot/boundary 已有非执行切片；仍缺真实权威目录、批准 sandbox/runtime admission、只读 overlay 和真实浏览器 Gate。
9. **AA-T10 production opening**：供应商/区域、成本与配额、值守、清理、审核和 kill switch 的生产演练尚未冻结并通过对应 Gate。

以上阻塞属于真实 provider、durable persistence、隔离环境、浏览器安全或产品开放 Gate，不通过放宽类型检查、内存生产 fallback、模拟链接或 frontend 变更解决。
