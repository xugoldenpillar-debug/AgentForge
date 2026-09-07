# 作品挑战赛（Artifact Arena）实施规格

日期：2026-09-07。状态：产品规格与当前实现切片对照版。本文仍不是功能启用、执行准入或安全验收证明；当前 worktree 已包含部分契约、迁移、领域 seam、画布与预览代码，因此不能再描述为“本次仅形成 spec”或“本次不修改源码”。本次未授权付费、生产、数据删除、提交/推送；缺 Gate 的能力继续 fail closed。

### 当前状态摘要

- **已存在的实现切片**：Artifact/Environment/Agent 合约、0010 additive migration、路径与投影规则、测试用 sandbox provider、Artifact collector/preview、Showcase/Voting 领域 seam、availability/kill-switch 投影，以及 Agent Builder 基础 UI。
- **仍未形成可开放能力**：真实隔离沙箱、Pi→EF→sandbox 执行链、durable Artifact/Showcase/Voting repository 与对象存储、CreationRun v2、完整浏览器闭环、hidden Agent judge 的真实 resolver/执行器、环境画布的真实目录/runtime wiring、生产运维 Gate。AA-T8 目前只有独立的 admission/score contract slice，仍保持 fail closed；AA-T9 已有 owner-aware 编译和 immutable snapshot 的非执行契约切片。
- **完成度口径**：AA-T0–T10 是实施路线，不是已完成清单；只有对应 Gate 有真实证据时才可标记完成。契约、纯领域、内存 provider、HTTP fail-closed 和构建测试不等于生产安全、真实模型、真实浏览器或生产开放验收。

## 阅读顺序与所有权

1. [需求与范围](requirements.md)：AA1–AA16、MVP 和非目标。
2. [契约与集成](design.md)：领域对象、EF 扩展、数据/API、运行、画布、兼容。
3. [安全与预览](security.md)：执行隔离、封存、访问授权、格式矩阵。
4. [实施任务](tasks.md)：AA-T0–T10，可领取工作包、依赖、交付与 Gate。
5. [验收矩阵](verification.md)：AA-V1–V10、可运行命令与证据要求。
6. [文档冲突裁决](reconciliation.md)：替代哪些旧目标，哪些历史/安全约束保留。

本 spec 拥有作品领域、公开作品评选和环境画布的新增语义；[Agent mode](../agent-mode/README.md) 继续拥有 Build 模式与五契约；[EF](../evaluation-foundation/README.md) 拥有任务、取消、预算和用量；[社区组件](../community-component-library/README.md) 拥有 Skill 版本/许可/撤销；[Gateway](../deepseek-verified-gateway/design.md) 拥有 Verified。发生范围冲突按 reconciliation 精确裁决，不以“新文档优先”覆盖上位权限、Q1–Q25 或历史证据。

## 基线：按当前代码核对，不按历史测试推断

| 能力 | 当前事实 | 本 spec 的增量 |
| --- | --- | --- |
| Workflow | React Flow/Zustand、不可变 BuildVersion、DAG 与既有评分 | 保持语义不变 |
| Agent Build | B1 定义；B2 仅 private、未配置草稿；`privateAgentDraft` 拒绝模型/环境/Skill/runtime 等实际选择 | 权威引用解析、配置版保存、B3 UI |
| Pi | 精确依赖 core 0.85.1；默认关闭；已有 adapter/Bridge A；Bridge B 不可用 | EF 接入、能力 broker、真实隔离工作区 |
| EF | 已有 `src/server/evaluation/`、`src/db/evaluation-repository.ts`、BullMQ/Outbox/Worker；主迁移 0006 | 扩展用途/快照/执行器，不另造队列 |
| Pi/EF | 当前 Pi self-test 在 EF 配置下 fail closed，真实凭据自测不可用 | 通过共享准入/用量 Gate 后才引入新入口，不移除旧拒绝来“接通” |
| Artifacts/投票/环境画布 | 已有契约、领域 seam、迁移与基础 UI；无 durable wiring/生产开放 | 后续补齐真实 provider、持久化、浏览器与运维 Gate |

证据入口：[当前架构](../../docs/ARCHITECTURE.md)、[Agent 集成](../agent-mode/integration.md)、[Pi 设计](../pi-runtime/design.md)、[本次状态与验证记录](../../docs/verification/artifact-arena-spec-2026-09-07.md)。上述“有代码”只表示当前 worktree 存在实现切片；不表示路由已开放、Gate 已全部通过或可生产上线。

## 交付路线

固定平台环境 → 配置版 Agent Builder → Pi/EF/沙箱 → 私有文件与预览 → 自由问题 → 作品发布与盲选 → Agent 隐藏竞技 → 可组合环境画布。

公开视觉样板：单 Agent 生成 `index.html`、`README.md` 和可选本地素材。首版静态 HTML/CSS/SVG，不执行作品 JS。Python CSV → `result.csv` / `summary.json` / `report.md` 保留为确定性工程验收轨，不再是唯一用户 MVP。两者各用固定环境和输出契约，不强制用户一次交付两套作品。

目标纵向切片仍按 T0–T5 排序：挑战题目 → 固定环境 → Pi 运行 → 私有封存作品预览；当前 worktree 只具备其中的契约/基础设施切片，尚未形成可运行闭环。自由创作需 T6，公开社区需 T7，隐藏竞技需 T8，环境画布组合需 T9，生产开放需 T10；这些任务目前均不能因纯契约或 UI 证据标记为完成。T8 的契约切片也不等于隐藏评测、排行榜或生产开放已完成。
