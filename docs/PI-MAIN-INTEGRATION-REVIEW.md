# Pi/main integration review and delivery status

> **状态快照 / Status snapshot：2026-09-07。** 本文是长期维护的技术评审与交付说明，不是交接记录，也不代表任何本地服务仍在运行。表格中的测试结果属于**历史验证记录**；它们不代表当前进程、端口、容器、日志目录或生产环境状态。

## 1. 范围与来源

本说明覆盖当前仓库 `main` 上的 Pi/main 合并结果：

- 合并提交：`3981251`（`Merge Pi runtime PoC into main evaluation foundation`）。
- 两个父提交：主线 `04a53c8` 与 Pi/Agent 草稿实现 `8b5d19f`。
- 评审范围：可靠评测基础、Pi 可选运行时、Agent Build 私有草稿、迁移历史兼容、现有竞技与社区边界，以及对应的验证证据。
- 本次文档收尾不修改业务代码、迁移 SQL、依赖或锁文件；代码与测试仍是行为的权威来源，spec 是目标与后续工作边界。

结论：合并实现已经进入主线，但交付级别仍是**本地可验证的 MVP 基础能力**。Pi、Agent Build、Verified、社区公开发布和生产运维均不能因为代码合并或历史测试通过而宣称完成。

## 2. 已完成项

### 2.1 现有应用与信任边界

- 唯一应用运行时保持为 Next.js；React/React Flow/Zustand、PostgreSQL/Drizzle、Better Auth 和服务端模型适配器继续共用同一条应用路径。
- 既有 DAG 校验与执行、不可变 Build 版本、并发保存校验、版本化 Fork、所有权检查、Provider lane、确定性评分、BYOK 凭据加密和隐藏结果投影保持有效。
- Demo、BYOK、Verified 继续分属不同信任等级；排行榜不混榜。Demo 仅用于显式测试模式，BYOK 不等于平台可信执行。
- Portable 已退役；历史 Portable 截图和验证材料保留为历史证据，不是当前启动入口或 Next.js 验收证据。

### 2.2 可靠评测基础（EF）代码切片

- 已落地 `EvaluationJob`、`Attempt`、`Invocation`、事务 Outbox、幂等投递、租约/心跳、取消与不确定上游状态的核对边界，以及 PostgreSQL 事实源和 Redis/BullMQ 投递层。
- Web 进程在显式配置 `EVALUATION_SCHEDULER_MODE=outbox` 时才接入持久化调度；独立 Worker 负责投递、执行和竞争性完成收尾。未配置 Worker 时不会把异步能力伪装成已就绪。
- 生产 Worker 使用完整的竞争性完成适配器，而不是只有模型执行选项的简化服务；队列、用量、提交、幂等和冻结版本路径均有回归覆盖。
- 现有请求绑定的同步/流式兼容路径仍存在。队列等待时间与评分使用的模型执行延迟保持分离，预算预占、实际用量和 Benchmark Cost 不混为钱包余额。

### 2.3 Pi 可选运行时 PoC

- `@earendil-works/pi-agent-core` 版本和加载边界已冻结；动态加载按显式 Feature Flag 和 Node 版本门禁执行，默认关闭。
- `src/server/runtime/pi/` 已提供受控适配器、协议/事件映射、Bridge A、错误脱敏、工具/路径策略和 fail-closed 加载；原始 Pi 事件不会直接透传客户端或普通审计输出。
- Pi 不读取宿主 `AGENTS.md`、宿主工作目录或默认资源加载器，不提供 shell、任意文件读写或用户代码执行入口。它不是沙箱。
- Pi 的离线真实 SDK 流、Fake Agent、工具拒绝、usage/事件/取消映射和安全边界已有测试。Pi 结果不进入现有竞争性排行榜，也不生成竞争性 Submission。
- EF/outbox 已配置时，Pi self-test 在状态和执行边界都 fail closed；真实凭据在未获共享持久化准入、配额和用量收据前不会被读取或解密。当前只保留显式测试模式下的 Demo 自测边界。

### 2.4 Agent Build 私有草稿边界

- B1/B2 私有 Agent 草稿的数据结构、模式校验、不可变版本与精确版本 Fork 来源已落地。
- 入队和 Worker 在模型调用、Job、Outbox、Invocation 之前拒绝 Agent 冻结版本；当前 Build 指针后续变化不会替换已经排队的 Workflow 快照。
- B3、Agent 公共执行、代码/文件产物和沙箱均未被这次合并隐式开启。

### 2.5 迁移历史与数据库安全

- 主线 `0001`–`0006` 的 SQL、已应用 ledger 行和 checksum 保持不变；Pi 物理历史以明确的兼容分支继续识别，不通过改名、重写或删除 ledger 行来“修复”历史。
- 规范迁移 `0007`–`0009` 承载运行时身份、Pi 访问标记和 Agent 草稿；原 Pi 文件和字节保留在历史目录，后续迁移仍要求两个物理前缀各自成为合法前缀。
- 迁移执行使用事务级 advisory lock、checksum/文件名校验和目标 schema 指纹。未知历史、间隙、漂移、预创建对象和保留索引名冲突 fail closed；不自动删除、回填或改写已有业务数据。
- 已有 `src/db/schema.sql` 仍是目标快照，不替代版本化升级；新数据库、旧库升级、重复执行、并发、回滚、数据保留和两条历史前缀的兼容性均有测试入口。

### 2.6 本地化基础

- Next.js/React 已有共享消息源、`en`/`zh-CN` 语言类型、浏览器语言识别、显式选择持久化、`<html lang>` 同步、系统内容本地化、错误码映射和格式化工具。
- i18n 单元测试覆盖语言回退、消息键、插值、系统内容边界以及日期/数字/费用格式。后续新增功能仍必须遵守根 `AGENTS.md` 的中英文同步规则。

## 3. 未完成项与后续 Gate

### 3.1 Pi / Agent

- Pi 尚未接入共享的持久化 Pi Job/Attempt/Outbox、跨竞技/自测执行名额、预算预占/结算、供应商用量收据和完整取消/断线恢复语义；因此不开放普通用户选择或真实竞争性运行。
- Bridge B、远程/插件式工具、可执行 Skill/MCP、任意文件处理、宿主或容器沙箱、artifact 采集与安全下载均未完成。
- Pi 的真实付费样本与离线 SDK 验证不能替代生产容量、故障、费用或安全验收；任何 live/paid 测试都需要单独授权。
- Agent Build 尚无面向用户的完整编辑器、运行/提交/评分/排行榜闭环；B3 仍关闭。Python 沙箱、文件 manifest、artifact judge、资源配额和多租户隔离仍是后续设计。

### 3.2 可靠评测、社区与 Verified

- EF 的代码基础和竞争性 Worker 路径已存在，但组件 SelfTestRun 的联合创建、撤销回调、安全结果投影、公开状态页、完整容量/费用运营和跨服务恢复仍未闭合。
- 社区组件的真实许可/权利链、批准的公开 release manifest、导入/冻结绑定、完整真实数据库跨实例 Gate、投稿审核/发布/撤销与首版端到端验收仍未全部完成。已有 T1 展示和部分数据/权限基础不等于可公开 SDK。
- DeepSeek Official/Verified 的完整 Registry/官方凭据流程、独立私有 Gateway、Profile/Season、Ticket/Credit/Receipt、可信费用与正式 Ranked Hidden 流程仍未完成；现有 BYOK/Flash 证据不自动取得 Verified。
- 邮箱验证、密码找回、邮件消费者、公开查询缓存策略和相应的安全/隐私运营仍需独立实施与验收。

### 3.3 生产与质量 Gate

- 没有本次合并提交对应的 CI 全流程、生产部署、托管 Redis、生产 PostgreSQL、真实生产 Gateway 或多副本故障验收记录。
- 生产 TLS/origin、CSP nonce、备份恢复、密钥轮换、滥用监控、内容审核、服务可观测性、负载/压力、完整无障碍和渗透测试仍需部署级验证。
- 仓库仍未配置 lint/format 命令；GitHub 分支保护是远端设置，文档不会自动启用。已跟踪的 `pnpm-lock.yaml` 和 CI 的 frozen install 不应被误写成缺口。
- 本次没有新增浏览器验收；既有 React/Portable 浏览器记录须按其日期和运行时阅读，不得当作本次合并或生产验收。

## 4. 能力边界 / Capability boundaries

| 能力 | 当前可说 | 当前不可说 |
| --- | --- | --- |
| Pi | 可选、默认关闭、受控离线 PoC；在 EF 配置下会拒绝不安全 self-test | 不是沙箱、不是普通用户运行时、不是竞争性排行榜通道、不是生产容量证明 |
| EF Worker | 有 PostgreSQL/Outbox/BullMQ/Worker 代码和本地真实回归入口 | 不是已部署的生产服务，也不等于全部社区/Verified 业务已接入 |
| Agent Build | 私有草稿和拒绝执行边界存在 | 不是可执行 Agent 产品、沙箱或 B3 完成 |
| Demo | 显式测试模式下的确定性离线模型 | 不是真实模型质量、费用或竞赛成绩 |
| BYOK | 用户凭据加密后的非可信模型通道；可做有限真实调用 | 不证明上游诚实、费用准确或平台控制 |
| Verified | 既有设计/部分基础与安全边界 | 不表示完整 Gateway、Ticket、Receipt、Profile/Season 或生产认证已上线 |
| 历史验证 | 能证明表中列出的特定代码路径曾在指定日期通过 | 不能证明当前进程仍在运行、生产可用或完成全面安全认证 |

## 5. 历史验证记录（不代表当前运行）

下表汇总合并后记录的本地验证证据。测试资源、运行服务和一次性日志位置不写入长期文档；需要复现时按 `README.md`、`docs/MIGRATIONS.md` 和 `docs/evaluation-worker-operations.md` 使用新的隔离资源。

| 验证入口 | 历史结果 | 证据边界 |
| --- | --- | --- |
| `pnpm test` | 330 passed, 0 skipped | 核心、服务、HTTP、EF、Pi fake/Bridge A 等离线回归；不是生产验收 |
| `pnpm test:pi-runtime` | 23 passed, 1 skipped | 真实 Pi SDK 的离线 fake stream；无付费模型调用 |
| `pnpm test:provider-sdk` | 18 passed | Provider SDK 离线契约；不等于上游可用性 |
| `pnpm test:migrations` | 4 个顶层测试通过 | PostgreSQL 新库/升级/重复/并发/回滚/漂移/索引冲突矩阵；使用一次性隔离数据库 |
| `pnpm test:evaluation-db` | 1 passed | PostgreSQL + Redis/BullMQ Worker 完成收尾、幂等、用量和 Agent 拒绝边界 |
| `pnpm exec tsx --test tests/agent-drafts.integration.ts` | 1 passed | PostgreSQL 并发 CAS；不是全部 Agent 产品 Gate |
| `pnpm exec tsc -p tsconfig.core.json --noEmit` | passed | Node 原生核心类型检查 |
| `pnpm typecheck` | passed | 全项目 TypeScript 类型检查 |
| `pnpm build` | passed | Next.js 构建；不是生产部署证明 |
| `pnpm test:smoke` | passed in historical test/normal-mode runs | 真实 Next.js HTTP/认证/边界和 Demo smoke；不代表当前服务仍在运行 |
| HTTP 202 → Outbox → independent Worker → completed | passed in a historical isolated run | 证明独立 Worker 完成适配器曾闭环；不代表生产可用或 exactly-once 外部调用 |

独立记录中的真实 DeepSeek Flash/BYOK 样本、Pi PI3/PI4 单次样本、社区 T1 浏览器验收和退役 Portable 截图继续保留在各自 dated verification/spec 文档中；它们均属于历史证据，不能扩大为 Verified、生产、全面浏览器或安全结论。

## 6. 交付判断与下一步

当前合并可以作为主线中的**可审阅、本地可验证的基础实现**保留。下一次功能交付至少应：

1. 先更新对应 spec/ADR 和本评审的完成/未完成状态；
2. 为新增功能和新增界面同时完成简体中文与 English，覆盖文案、状态、错误、空态、帮助/提示、可访问性文本、i18n key/fallback 和测试；
3. 为真实数据、权限、费用或生产操作建立隔离验证证据，不用 Demo、截图、HTTP 单测或 CI 构建冒充真实验收；
4. 若启用 Pi/Agent/社区自测/Verified，先通过共享 EF、权限、预算、撤销和隐私 Gate，再增加用户入口；
5. 在文档中只记录稳定的 commit、命令、结果和日期，不记录本地绝对路径、端口、PID、临时日志目录或“服务当前仍在运行”的一次性状态。

关联文档：`docs/ARCHITECTURE.md`、`docs/MIGRATIONS.md`、`docs/SCORING.md`、`docs/VERIFICATION.md`、`specs/README.md`、`specs/evaluation-foundation/README.md`、`specs/pi-runtime/design.md`。
