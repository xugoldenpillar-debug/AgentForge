# 可执行任务与依赖

本表是实施任务定义，不是完成清单。当前 worktree 已有 AA-T0–T5、T7、T9 的部分契约/领域/UI 切片，以及 T3/T6/T10 的 fail-closed 接入口；AA-T0–T10 尚未全部完成，也没有因为这些切片存在就打开执行或生产能力。单任务允许拆小 PR，但必须保持本包 Gate 与契约。默认不启动子代理，不自动提交/推送。范围内本地隔离验证按 AGENTS.md 主动准备，付费/生产/采购/删除/权限操作另授权。

## 当前任务状态（2026-09-07）

| 任务 | 当前状态 | 已有证据/切片 | 未完成的完成条件 |
| --- | --- | --- | --- |
| AA-T0 | 部分实现 | 文档裁决、共享契约、迁移映射、availability 投影 | 完整接口冻结、负责人/安全数值和 AA-V1 证据台账 |
| AA-T1 | 部分实现 | Agent/Artifact/Environment 契约、画布 adapter 与校验、配置版 Save/Read/Fork seam、`CatalogAgentBuildResolver` 六类 release lookup 与撤销/归属校验 | 真实目录/权限数据源、factory 生产 wiring、认证/迁移 Gate 与执行准入 |
| AA-T2 | 部分实现，保持不可用 | SandboxProvider、路径策略、Unavailable provider、测试用内存 provider | 真实隔离实例、网络/资源/停止/快照/跨任务 Gate |
| AA-T3 | 入口切片，未开放 | Pi/EF admission seam 与 fail-closed 依赖检查 | Pi 工具循环、approved sandbox、预算/用量/取消/失联恢复闭环 |
| AA-T4 | 部分实现，未开放 | collector、manifest、owner-scoped read、静态 preview projection | durable object storage、不可变对象、TOCTOU 与真实浏览器/部署安全验证 |
| AA-T5 | 部分实现，未完成 | Agent Builder 基础画布与多格式安全预览 | 实际 Next.js 桌面/窄屏运行闭环、取消/刷新/下载/Fork 验收 |
| AA-T6 | 未完成，入口 fail closed | Creation Brief/Run 基础类型与明确 503 边界 | creation EF purpose/association/v2 message、队列消费者、真实 CreationRun API |
| AA-T7 | 领域切片，未开放 | WorkPublication/Showcase/Voting 领域服务与约束 | PostgreSQL/object storage wiring、审核后台、社区页面、反作弊与并发证据 |
| AA-T8 | 契约切片，未开放 | `src/server/evaluation/adapters/agent-showcase.ts` 提供独立 hidden Agent admission/score boundary；契约测试覆盖 fail-closed、身份漂移、旧评分组件隔离和输入保密边界 | server-owned Profile/Season resolver、真实 hidden judge/执行器、完整隐藏评测证据、durable score/榜单与 AA-V9 Gate |
| AA-T9 | 部分实现 | 独立 Agent canvas、语义 digest/能力校验、approved environment 子图 compiler、能力交集、owner-aware private template 检查、immutable runtime snapshot/boundary；已覆盖同 owner/跨 owner/缺失上下文契约测试 | 真实权威 resolver/目录、approved sandbox/runtime wiring、运行时只读 overlay、真实浏览器 Gate |
| AA-T10 | 未完成，开放 Gate 未通过 | feature flag/kill-switch、safe availability projection，以及已授权历史读取的 HTTP 契约级 gate | 供应商/成本/配额/值守/备份/撤销和受邀/生产演练证据 |

“部分实现”只描述当前代码存在的边界切片；“未完成”表示对应 AA-V Gate 未通过。纯契约/内存/HTTP/构建测试用于回归，不替代真实沙箱、对象存储、浏览器、模型或生产验收。

```text
T0 → T1 → T5（配置/状态 UI；运行验收还依赖 T3/T4）
T0 → T2 → T3 → T4 → T5（首条私有挑战作品纵向切片）
T1 + T3 + T4 + T5 → T6（自由问题）
T4 + T5 + T6 → T7（公开作品与社区榜）
T3 + T4 + T5 → T8（隐藏竞技，独立于社区投票）
T1 + T2 + T5 → T9（环境画布组合）
所有拟开放包的 Gate → T10（对应范围受邀/生产开放）
```

## AA-T0：接口冻结与现状核对

- 前置：本 spec。
- 范围：新契约文档、existing schema/EF/runtime/http 的映射；不做生产操作。
- 交付：每个拟新增对象对应旧字段/新列/API/消息版本表；确认 v1/v2 兼容、失败码、feature flag、迁移发布顺序与明确负责人。AA-T1–T5 可先冻结 challenge 分支，creation 写入口必须等 T6 的 v2 准入。
- 冻结安全数值：原始请求/导入包/附件/作品文件/总存储/事件/日志上限；数值须非空且有测量依据，不能以“bounded”占位进入执行上线。
- Gate：AA-V1；旧文档冲突有裁决记录，B1/B2 和历史证据不被重标。

## AA-T1：配置版 Agent、Skill 与固定环境目录

- 前置：T0。
- 主要落点：`src/shared/agent-build-contract.ts`、`src/server/agent-drafts.ts`、`src/server/community-service.ts`、`src/server/service.ts`、`src/db/`、`src/lib/agent-build/`。
- 交付：环境不可变版本元数据；权威引用 resolver；声明式 Skill 导入到现有组件版本流程；配置版 Save/Read/Fork 与 CAS；原 private/unconfigured 路径兼容。环境目录只列获准固定模板，模板执行状态先 unavailable。
- 不做：隐式删除 privateAgentDraft 限制、自动批准引用、导入脚本执行、模型付费探测。
- Gate：AA-V2/V3；配置引用不存在/摘要伪造/撤销/私有泄露/旧客户端均拒绝，迁移及真实认证验证。

## AA-T2：SandboxProvider 和固定环境验证

- 前置：T0；供应商实际资源与费用须相应授权。
- 主要落点（新目录建议）：`src/server/sandbox/`、隔离测试与运维文档。
- 交付：security S1 决策表、provider adapter、create/stop/snapshot/cleanup 契约；视觉静态文件环境与 Python 标准库环境；批准工具的结构化能力表。
- Gate：AA-V4，在真实隔离实例验证宿主/跨任务/网络拒绝、资源限制和全进程停止/稳定快照。fake 只用于单测；无真实证据保持 unavailable。

## AA-T3：Pi → 公共 EF 执行链

- 前置：T1/T2。
- 主要落点：`src/server/runtime/pi/`、`src/server/evaluation/`、`src/shared/evaluation-types.ts`、`src/db/evaluation-repository.ts`。
- 交付：Agent challenge 公共反馈执行器、冻结与 broker、共享预算/Invocation、Attempt fence、状态/取消/安全事件；保持旧 PoC EF 配置下 fail closed，不挪用 request-bound 自测路径。
- Gate：AA-V5；真实 SDK 离线工具循环/并发/取消，真实隔离 DB/Redis 的重复投递、失联、恢复与不确定用量。付费样本另授权，不以 fake 模型证明真实质量。

## AA-T4：Artifacts 封存、读取与安全 renderer

- 前置：T3（manifest 纯契约可在 T0 后先做）。
- 主要落点：新增 `src/server/artifacts/`、共享安全投影类型、`src/db/`、`src/components/`、独立预览入口部署配置。
- 交付：bundle/manifest/object storage adapter、原子封存、授权文件树/读取/下载、格式矩阵、工作中快照与正式作品的区别、孤儿对象审计。
- Gate：AA-V3/V6；TOCTOU/链接/恶意 MIME/大小/隐藏泄露/XSS/跨 bundle/撤下测试通过；独立预览域与不可变对象是真实验证，不是模拟链接。

## AA-T5：Agent Builder 与私有作品纵向切片

- 前置：T1；最终验收依赖 T3/T4。
- 主要落点：`src/features/builder/`、`src/lib/client-api.ts`、`src/components/`、`src/app/`。
- 交付：模式隔离、指令/Skill/固定环境/模型/输出契约配置，运行时间线、文件树、多格式预览、版本冲突、取消与刷新；桌面分栏、窄屏 tabs。
- Gate：AA-V7；实际 Next.js 从题目运行到封存预览与下载。不得把旧 B2 的“错误页面安全拒绝”当新 Agent UI 验收。

## AA-T6：自由问题与 CreationRun

- 前置：T1/T3/T4/T5。
- 主要落点：Build 上下文与仓储、EF 用途/快照/消息、业务 adapter、创建页面。
- 交付：私有 BriefVersion/附件；显式 creation 构建上下文与 CreationRun；versioned EF 契约、队列消费者兼容、总并发/用途预算；不强造 Problem 或 Suite。
- Gate：AA-V2/V3/V5/V7；旧 Build/API/队列消息可读，未知新类型 fail closed；creation 与竞技/自测并发不能越限；无竞技 Submission。

## AA-T7：发布、盲选与社区榜

- 前置：T4/T5/T6；公共开放另需 T10。
- 主要落点：新增作品/评选服务、数据库约束、作品页/广场/排行榜/最小审核入口。
- 交付：pending 发布、管理员审核/撤下、ShowcaseEntry、Ballot/Vote、幂等/禁自投/限频、分区/样本门槛/可重算统计、举报审计。确认 design 中候选投票数值与策略版本；不修改 DAG scoring/rating。
- Gate：AA-V3/V8；实际角色授权、并发票、换作品不带票、异常票审计与榜单重算、私有 Build 的公开作品/Fork 边界。

## AA-T8：Agent 隐藏竞技

- 前置：T3/T4/T5；沿既有 Profile/Season/Suite/Scoring Gate，不依赖投票。
- 主要落点：先在 `src/server/evaluation/adapters/agent-showcase.ts` 建立独立 admission/score boundary；真实执行器、持久化和页面仍属于后续 Gate，不把 AA-T8 直接接入旧 `src/lib/judge/`、`src/lib/scoring/` 或旧 `Submission`。
- 当前最小交付：admission 最终只允许 `pi` + 由 server-owned evidence resolver 返回的 sealed/completed hidden evidence opaque ref；调用方不能自带 bundle id/digest 伪造 hidden 证据。Profile/Season/Judge/Environment identity 和权重必须由 server-owned resolver 提供；无 resolver、evidence resolver 或 approved hidden judge 时返回 `503 RUNTIME_UNAVAILABLE`。judge port 不接受 `expected`、`actual`、public bundle、答案或 trace，并只返回有界 Agent-specific components；结果使用独立 `agent-showcase-score-v1` record，`legacySubmissionId` 固定为 `null`。
- 评分隔离：不得复用 DAG 的 Accuracy/Robustness/Security/Efficiency/Elegance 或 45/20/15/10/10，不写入旧 Submission/rating/reward/Verified，不与社区投票榜混榜。fake judge 仅用于契约测试，不能作为生产 judge 或质量证据。
- Gate：AA-V9 仍要求完整隐藏 Run、失败用例与基础设施中断区分、错误/文件投影隐藏、durable score 与 runtime/env/lane 分区；当前仅通过最小契约检查，未通过生产开放 Gate。Verified 仍需原链独立 Gate。

## AA-T9：环境画布组合

- 前置：T1/T2/T5；独立于投票榜。
- 主要落点：Agent canvas schema/compiler/validator、环境版本目录、属性面板。
- 交付：批准模块的有类型子图、能力交集编译、实时校验和下一运行快照、运行中只读 overlay；布局不改变语义 digest；保存新环境版本不热提权。
- Gate：AA-V2/V7；客户端伪图/未批准能力/环/跨 owner 引用被服务器拒绝；旧 Workflow DAG 单独回归；窄屏与冲突交互通过。

## AA-T10：对应范围开放与运维

- 前置：拟开放包所有 Gate；无需等待独立后续 JS/厂商能力。
- 交付：按包能力开关（缺失默认禁用，具体名字 T0 冻结）、kill switch、容量/费用熔断、存储保留、内容审核值守、队列告警/失联核查、备份恢复、域名/TLS/CSP/撤销时延、最小权限和成本来源。
- Gate：AA-V10；受邀真实模型样本在授权限额内完成，记录实际费用/版本/局限；生产部署另明确授权。安全开关停新任务但不阻断取消、审计、核查或合法历史读取。

## 与旧任务衔接（不重复实现）

| 旧任务 | 新任务 |
| --- | --- |
| B1/B2 已交付 | 保留；T1 配置准入、T6 上下文是增量 |
| B3 | T5；环境组合另 T9 |
| C | T3/T6；公共 EF 已有代码，缺的是 Agent/creation 联合接入 |
| D | T2/T4；静态安全预览扩展见 security |
| E | T8；社区榜另 T7，不偷换 Submission |
| F | 仍后续；可执行 Skill/JS/MCP/厂商/多 Agent 未自动获得准入 |
