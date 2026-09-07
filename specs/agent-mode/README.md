# Agent Build 模式：B1 契约 / B2 私有草稿（未上线）

日期：2026-09-07。本目录记录已实现的 B1 纯契约、B2 私有未配置草稿持久化，以及 B3 UI / C–F 后续边界；不是完整 Agent 产品验收。按当前任务推进普通代码、文档及已授权隔离验证无需重复授权；生产操作、付费调用、服务购买、既有数据删除或权限变更仍需对应明确授权，沙箱供应商决策另行处理。

Agent Build 是构建定义的一种模式：用户描述目标、固定声明式 Skills 与获准能力，让单 Agent 完成任务并交付可验证文件。它不是 Pi 的别名，不是新的信任等级，也不是在 Next.js 宿主执行编码 CLI。

- [需求与边界](requirements.md)
- [五份候选契约与安全设计](design.md)
- [阶段、依赖和验收清单](tasks.md)
- [B2 持久化与 HTTP 交付及审查记录](integration.md)
- 上位政策：[评测基础 Q1–Q25](../evaluation-foundation/README.md)、[跨分支交付边界](../evaluation-foundation/integration.md)。Agent 模式不另建评测 Profile、Job、队列或预算架构。
- 依赖：[组件版本与准入](../community-component-library/requirements.md)、[Pi 当前状态](../pi-runtime/design.md)、[现有 Benchmark Profile / Season 设计](../deepseek-verified-gateway/design.md)。这些目标能力各自仍须验收，不因本文被视为已实现。
- 当前事实：[架构](../../docs/ARCHITECTURE.md)、[DAG 评分](../../docs/SCORING.md)、[验证记录及历史限制](../../docs/VERIFICATION.md)。Next.js 仍是唯一应用运行时，独立 Worker 是目标；当前没有 Agent Build 编辑器、代码沙箱或文件竞技闭环。

## 首个 MVP 候选

单 Agent、Python 文件处理任务：读取批准的输入 CSV，提交 `result.csv`、`summary.json` 与 `report.md`。judge 独立验证 CSV 内容/结构、JSON schema/数值一致性和报告要求；Agent 自述“成功”不是成绩。默认仅 Python 标准库，不自动 pip/npm 安装，不预设供应商支持或隔离效果。沙箱提供商、镜像与版本、具体 CPU/内存/磁盘/文件/网络/时间上限及价格均待调查与验证冻结。首期不含多 Agent、任意终端、可执行社区 Skill、MCP 写操作或自动安装依赖。

## 三条独立轴

| 轴 | 含义 | 不可推导 |
| --- | --- | --- |
| Build mode | 现有 Workflow；拟新增 Agent | 不能由 runtime 自动转换定义 |
| execution runtime | 现有 DAG adapter、可选 Pi PoC；未来受控 adapter | Pi 不等于已具备沙箱或公共上线资格 |
| trust lane | Demo / BYOK；平台可信路径按现有 Verified Gate | Official 凭据或沙箱都不自动取得 Verified |

B1 and B2 private-draft APIs are implemented; other execution/sandbox contracts remain proposals. The Workflow hunt lane finding was fixed and independently verified on 2026-09-07. Acceptance is limited to private unconfigured B2 drafts, not Agent UI, execution, or production readiness.
