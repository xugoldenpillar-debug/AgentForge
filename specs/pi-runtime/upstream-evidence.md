# Pi upstream 核验证据（非集成验收）

- 核验日：**2026-09-06**（Asia/Shanghai）。
- 范围：官方仓库的 6 份文档/清单；不安装依赖、不调用模型、不部署、不修改运行时代码。
- 方式：已调用 `web.run` 打开官方仓库及源码 URL，但工具返回空内容，未获得可引用正文。随后使用只读 `curl` / Python `urllib.request` 读取官方公开 HTTP 资源；以下为实际读到的 upstream 文档声明与包元数据，不冒充源码执行或兼容性测试。
- 快照：`main` 在核验时解析为 **`9767ba275f3e9a5ee0f5c5342249b629ab1b2282`**；官方提交元数据的 committer 时间为 `2026-09-05T22:30:17Z`。下面链接全部固定到该提交，避免随 main 漂移。
- 归属核验：对 <https://github.com/badlogic/pi-mono> 的 HTTP HEAD 请求实际返回 `301`，Location 为 <https://github.com/earendil-works/pi>。提交定位入口：<https://api.github.com/repos/earendil-works/pi/commits/main>。这两个入口只用于重定向和快照定位，不作为新增的行为研究范围。

## 1. 官方来源清单

| ID | 固定提交来源 | 本次用途 |
| --- | --- | --- |
| S1 | [packages/agent/README.md](https://github.com/earendil-works/pi/blob/9767ba275f3e9a5ee0f5c5342249b629ab1b2282/packages/agent/README.md) | 嵌入 API、streamFn、事件、工具循环 |
| S2 | [packages/coding-agent/README.md](https://github.com/earendil-works/pi/blob/9767ba275f3e9a5ee0f5c5342249b629ab1b2282/packages/coding-agent/README.md) | 权限定位、上下文和资源自动发现 |
| S3 | [packages/coding-agent/docs/sdk.md](https://github.com/earendil-works/pi/blob/9767ba275f3e9a5ee0f5c5342249b629ab1b2282/packages/coding-agent/docs/sdk.md) | createAgentSession、工具启用及 ResourceLoader |
| S4 | [packages/agent/package.json](https://github.com/earendil-works/pi/blob/9767ba275f3e9a5ee0f5c5342249b629ab1b2282/packages/agent/package.json) | 包名、仓库版本、Node 要求、license 字段 |
| S5 | [packages/coding-agent/package.json](https://github.com/earendil-works/pi/blob/9767ba275f3e9a5ee0f5c5342249b629ab1b2282/packages/coding-agent/package.json) | 包名、仓库版本、Node 要求、license 字段 |
| S6 | [LICENSE](https://github.com/earendil-works/pi/blob/9767ba275f3e9a5ee0f5c5342249b629ab1b2282/LICENSE) | 仓库根许可证文本 |

正文读取使用上述相同路径的 `https://raw.githubusercontent.com/earendil-works/pi/<完整提交 SHA>/<路径>`，6 份均成功返回文本。没有使用第三方教程或搜索摘要补充行为结论。

## 2. 已核验的官方声明

### 2.1 身份与版本边界

- `packages/agent` 清单名称为 **`@earendil-works/pi-agent-core`**；`packages/coding-agent` 为 **`@earendil-works/pi-coding-agent`**。两者仓库清单版本均为 **`0.85.1`**，均声明 ESM、Node **`>=22.19.0`**、`license: MIT`，repository 指向新仓库。不得继续将旧 scope 当作本快照包名。[S4, S5]
- 根 LICENSE 为 MIT，版权行是 2025 Mario Zechner。此处仅记录许可证事实；没有完成所有传递依赖许可证清点。[S6]
- **未验证（git 文档快照当时）**：npm dist-tag/latest、实际发布 tarball、签名或来源证明、release 与清单版本是否一致、旧包是否继续发布或兼容。`0.85.1` 是本次仓库快照版本，不宣称为 npm 最新可安装版本。
- **PI0 补充（2026-09-06）**：registry 与 tarball 冻结记录见 [pi0-freeze.md](./pi0-freeze.md)。npm `latest` 当时即为 `@earendil-works/pi-agent-core@0.85.1`（tarball shasum / integrity 已与本机下载哈希对照）。npm `gitHead` 为 `d981de1229ef899957bbe968bc8dcda02a21f477`（`Release v0.85.1`），比本文件的 `main` 快照 `9767ba…` 少 4 个后续提交。旧 scope `@mariozechner/*` 仍发布但停在 0.73.1 / 0.70.6，禁止当作本产物。npm 签名与 SLSA attestation **仅观察到元数据，未做密码学核验**。PI0 不是安全验收。

### 2.2 pi-agent-core 嵌入与工具循环

以下均为 S1 的 API 文档声明（重点位置：Quick Start；Event Flow；Agent Options；Tools；Low-Level API）：

- `new Agent({ initialState, streamFn })` 是嵌入入口；使用 `agent.subscribe(...)` 观察事件，`await agent.prompt(...)` 发起运行。文档把 `streamFn` 标为必需，并以 `models.streamSimple.bind(models)` 注入 Pi 模型流；消息转换与上下文变换分别由 `convertToLlm`、`transformContext` 承担。[S1]
- 事件涵盖 agent/turn 的 start/end、message 的 start/update/end、tool_execution 的 start/update/end。工具结果进入后续模型 turn，因此是工具循环而非一次文本生成；`message_update` 内还有 Pi 的 `assistantMessageEvent`。[S1]
- 默认 `toolExecution` 是 **parallel**；预检按序，获准工具并行执行，完成事件按完成时间产生，而工具结果消息保留 assistant 原始调用顺序。单个工具的 `executionMode: sequential` 可使整批顺序执行。[S1]
- `AgentTool.execute(toolCallId, params, signal, onUpdate)` 接受取消信号及进度回调。`beforeToolCall` 可阻止调用；`afterToolCall` 可后处理结果。`terminate: true` 只有在整批最终工具结果都要求终止时才跳过自动后续模型调用，不能把单条 terminate 当作硬预算断路器。[S1]
- `shouldStopAfterTurn` 在本 turn 已完成后运行，不取消当前模型流或运行中工具。文档另提供 `agent.abort()` 和 `waitForIdle()`；不能由这些 API 的存在推断恶意工具可被强制隔离。[S1]
- `Agent.subscribe` 的异步监听器按注册顺序等待；`agentLoop` / `agentLoopContinue` 低层事件流仅供观察，不等待消费端异步处理成为后续执行屏障。权限或预算控制不能仅依赖消费端看到事件后再阻断。[S1]

**证据限制**：本次未展开实现文件逐函数审计，也未编译类型契约。S1 的低层示例仍出现 `getModel(...)`，而 Quick Start 使用 `createModels()`；复制代码前必须以锁定版本的导出与类型检查确认，不能假设所有文档片段可直接混用。

### 2.3 pi-coding-agent 默认权限与自动发现

- SDK 入口 `createAgentSession()` 在未传 `ResourceLoader` 时使用 `DefaultResourceLoader` 标准发现，资源包括 extensions、skills、prompt templates、themes、context files。自定义 loader 后，`cwd` / `agentDir` 不再决定资源发现，但仍影响会话命名和工具路径解析。[S3，约 50、365、913 行]
- 默认内置工具为 **read、bash、edit、write**。`noTools: "all"` 禁用所有工具；`noTools: "builtin"` 只禁内置工具，仍允许扩展/自定义工具。`tools` 可做名称允许列表，`excludeTools` 在其后排除名称；自定义工具会与扩展注册工具合并。[S3，Tools]
- README 明确不提供权限弹窗，建议容器或自行实现扩展确认流程。**这不等于自带沙箱、多租户隔离或 AgentForge 授权机制**；默认工具和 loader 不能直接用于不可信社区代码。[S2，Philosophy；S3，Tools]
- 启动加载全局 `~/.pi/agent/AGENTS.md`、从 cwd 向上的父目录及当前目录的 `AGENTS.md` / `CLAUDE.md`。同目录有 `AGENTS.override.md` 时替代普通上下文文件，跨目录内容仍拼接；CLI `--no-context-files` 可禁用该发现。[S2，Context Files]
- Skills 文档入口列出 `~/.pi/agent/skills/`、`~/.agents/skills/`、项目 `.pi/skills/`、`.agents/skills/`（cwd 及父目录）以及 pi package。Extension 入口包括 `~/.pi/agent/extensions/`、`.pi/extensions/` 和 pi package。[S2，Skills / Extensions]
- SDK 的 `agentsFilesOverride` 示例会扩展已有上下文；简单追加虚拟 AGENTS.md 不等于清除宿主上下文。只换 cwd 也不等于关闭全局发现。若设计为封闭资源集合，必须验证 loader 的完整输出。[S3，Context Files / ResourceLoader；后两句为据此推论]

## 3. 本地环境事实（不是 upstream 兼容性证据）

- 工作区：`/Users/pillarxu/.codex/worktrees/f4f7/AgentForge`；分支 `codex/component-library-design`。开始时已有 `CONTEXT.md` 修改及 ADR/spec 未跟踪目录，本任务保留它们。
- 本机 `node --version` 返回 `v26.7.0`，数值上高于 Pi 清单最低版本，但未运行 Pi。AgentForge `package.json` / README 仍支持 Node `>=22.16.0`；直接引入该 Pi 快照将产生最低版本差异，必须另行决策和验证。[本地 package.json；S4, S5]
- 本地 `src/lib/ai/types.ts` 的 `AIProvider.execute(AIRequest): Promise<AIResult>` 是请求/结果契约，带剩余 token/工具次数/费用与取消信号；不是 Pi 的模型消息流契约。`package.json` 声明 Vercel `ai` 与相关适配器不证明与 Pi 可互换。[本地源码和清单]
- 仓库规范要求共享核心保持 Node 原生运行、便携版不增加必须安装的依赖，运行流为 NDJSON，禁止任意 shell/用户代码执行并保留预算、SSRF 和隐藏评测保密约束。[本地 AGENTS.md / README.md]

## 4. 候选设计与验证门槛（未批准、未实现）

下面不是 upstream 已提供的 AgentForge 功能，也不是依赖选型结论：

1. **优先评估 core + 显式受限工具**，而非直接嵌入默认 coding-agent。是否采用 Pi、是否引入隔离进程仍由主任务决策；不能把发现机制当作权限机制。
2. **必须做 bridge 实测**：Pi `streamFn` 与 Vercel AI SDK 不假定兼容。桥接需逐项核对 model/context/options、增量文本与工具参数、调用 ID、结束原因、usage/cost、错误及 AbortSignal。还需明确唯一工具循环所有者，避免 Pi 和现有适配器双重执行/重试。
3. 先以离线假流/假工具做契约测试：多 turn、并行乱序完成、串行覆盖、阻断、错误、取消、慢监听器、usage 缺失与重复事件。下一阶段在授权且不默认付费的条件下验证真实 provider；本任务不执行这些测试。
4. 将现有预算和访问约束放在模型请求与工具副作用之前实施；不能只靠 `shouldStopAfterTurn` 或流事件观察做硬上限。验证并行工具对同一剩余预算的竞争、取消后残留副作用、重试重复计费。
5. 若必须使用 coding-agent，候选方案是封闭自定义 ResourceLoader、工具允许列表、隔离凭据/会话目录，并测试宿主 home/父目录/包资源不会被带入。是否还需 OS 隔离须单独设计；CLI `--no-*` 不能未经核对直接当 SDK 参数。
6. Pi 原始事件不得直接转发为 AgentForge NDJSON。bridge 必须使用既有允许字段、隐藏评测脱敏、用户凭据隔离和可信执行计量；Demo/BYOK/平台可信榜保持分离。
7. 包版本、Node 最低版本和依赖隔离路径须锁定后再编译/测试；便携 Demo 不得因此强制安装 Pi。

## 5. 完成与未验证项

本次完成只读仓库检查、官方重定向/提交定位、6 份官方文档/清单读取，并仅新建本文件。没有安装、模型调用、数据库操作、部署、提交或推送；未运行功能测试、Pi 类型检查、bridge 或安全隔离实测。此文可供设计提问与开发门槛引用，不能作为生产安全、SDK 兼容或真实模型验收结论。
