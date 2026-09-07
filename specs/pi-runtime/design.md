# 可选 Pi Runtime：技术设计与验证计划

> 2026-09-06 设计对齐：见 [全项目设计地图](../README.md) 与 [评测基础](../evaluation-foundation/README.md)。本文为分期目标，不宣称全量已实现。共享调度/容量/预算采用 Q1–Q25；领域特有授权、证据和原发布 Gate 保留。未来能力不因基础设施设计获批而自动启用。


- 日期：2026-09-06；状态：分支已有 PI0–PI2 PoC、PI3 Bridge A 与 PI4 的部分实现/样本；不等于 PI0–PI4 全部门禁通过。本次修正及代码工作包回报见下文，非生产验收。公共 UI 选择器未做，Bridge B 保持不可用。
- 目标：在保留现有 DAG 的基础上提供受限的模型驱动 Agent 循环，便于 Skill 开发和未来厂商联调。
- 不是：替换 DAG、默认运行编码 CLI、通用沙箱、可信 Gateway 或要求所有厂商使用 Pi。
- 上游 git 快照见 [核验记录](./upstream-evidence.md)；可安装产物见 [PI0 freeze](./pi0-freeze.md)。冻结文档是安装前历史记录；当前应用清单已精确加入 Pi core 依赖，不能把冻结时状态当作当前状态。

## 当前落地（离线 PoC，非生产启用）

- Feature flag：`PI_RUNTIME_ENABLED` 必须等于精确字符串 `'true'`；`.env.example` 默认 `false`。`TRUE` / `1` / `yes` 均视为关闭。Node `<22.19.0` 拒绝 Pi；应用 `engines.node` 仍为 `>=22.16.0`。
- PI0：`@earendil-works/pi-agent-core@0.85.1`（MIT）精确钉在 dependencies。探针 `scripts/pi0-probe.mjs` 只读 registry。
- 合约：`src/shared/runtime-contract.ts` + `tests/runtime-contract.test.ts`。
- DAG adapter：`src/lib/runtime/dag-adapter.ts` 包装 `executeWorkflow`。`ArenaService.run`／`hunt` 经该适配器执行，公开 trace 即时转发。
- Pi adapter：`src/server/runtime/pi/`。`load.ts` 对字符串 `PI_CORE_PACKAGE` 做 fail-closed 动态 import。
- 模型 Bridge A：官方 Flash + `safeProviderFetch`、thinking disabled、128 token 上限、无重试。Bridge B 仍抛 `RUNTIME_UNAVAILABLE`。
- `0003_runs_runtime_identity.sql` 为可空身份列；新 DAG run 写入 `dag`，旧行不回填。Pi 不写竞技 `submissions`。
- 没有公开 UI 选择器、没有排行榜混榜、没有 coding-agent、没有沙箱。
- `pnpm test:pi-runtime` 在 CI，无付费。付费样例仅 `PI_RUNTIME_LIVE=true pnpm test:pi-runtime:live`。

### 2026-09-06 代码工作包回报（本次文档工作包未重跑）

已核对工作区 diff：protocol/events 将真实 SDK 的 assistant `error` / `aborted` 映射为 failed / cancelled；错误使用私有结构化元数据与安全固定文案，不信任 SDK/provider 错误文本。不支持的模型返回明确配置错误。Bridge A 的上游 SSE 解析按空行分派、支持多行 data 和 CR/LF，丢弃未完成 EOF 事件；这不改变应用对外 NDJSON 协议。

用户转交的代码工作包结果（最终离线验证；HTTP 仅内存仓储覆盖）：`pnpm test` **159 passed, 0 failed, 0 skipped**；`pnpm test:pi-runtime` **23 passed, 0 failed, 1 skipped**；`pnpm typecheck` / `pnpm build` **passed**。这些是本次代码工作包报告，不是本文作者独立重跑，也不是 CI 远端结果。未据此宣称真实付费复测、数据库迁移、浏览器、沙箱、持久化 Worker 或生产安全通过；历史 PI3 样本不增加本次付费许可。

## 0. 本次核验带来的集成约束

精确 npm 身份已写入 [PI0 freeze](./pi0-freeze.md)：`@earendil-works/pi-agent-core@0.85.1`，MIT，`engines.node` `>=22.19.0`。不要使用 `@mariozechner/*` 或 `@earendil-works/pi-coding-agent`。应用 `engines.node` 保持 `>=22.16.0`；Node 不满足 Pi 时拒绝启用，不抬高全应用下限。PI0 冻结步骤当时未修改清单；后续 PoC 已把精确 core 版本写入 `package.json`。冻结记录不证明当前锁文件/完整依赖树已验收。

建议 Pi 放可选服务端边界，明确检查运行条件，不满足就拒绝启用 Pi，而不是整个 DAG 应用不可运行。是否调整全栈 Node 基线在确切依赖版本确定后单独说明并验证 CI。

上游文档的工具默认并行执行；预算不能只靠收到事件后递减，也不能假设停止循环会强制取消已运行工具。fake PI1/PI2 覆盖串行 calculator、取消与隔离；**真实 SDK 的并发与取消保证须看对应测试证据，不能由 fake 测试或单次无工具 Flash 样本推定**。详细证据与限制见 `upstream-evidence.md`。

## 1. 平台与运行时职责

```text
Next / ArenaService：身份、版本、准入、同意、额度、任务
                          ↓
           RunCoordinator（候选平台接口）
                          ↓
       DAG Adapter  |  Pi Adapter  |  未来 Vendor Adapter
                          ↓
          受控模型出口 + 受控工具分派
                          ↓
             安全事件、用量、评分与持久化
```

权限、预算、秘密、运行版本和评分不下放给 Pi，也不由 Skill 文本控制。Pi 只负责获准的任务执行循环。已有 AIProvider 是单次模型调用边界，Runtime Adapter 是整个任务边界，两者不能混用。

## 2. 类型草案（非已发布 SDK）

本 PoC 已落地的合约见 `src/shared/runtime-contract.ts`。当前 `ExecutionIdentity` 只有 `runtime` / `adapterVersion` / `policyVersion` 及可选 model/tool/skill 版本，没有 `runtimeVersion`、`definitionVersionId`、`modelOfferingId`、`dependencyDigest`。已有可空 `runs.runtime_kind` / `adapter_version` / `policy_version` 持久化子集；下列示意仍是完整目标，不是本 PoC 已持久化的全部字段。

```ts
type RuntimeKind = 'dag' | 'pi';
interface ExecutionIdentity {
  runtime: RuntimeKind;
  runtimeVersion: string;
  adapterVersion: string;
  policyVersion: string;
  definitionVersionId: string;
  modelOfferingId: string;
  dependencyDigest: string;
}
interface RuntimeAdapter {
  readonly kind: RuntimeKind;
  execute(context: AuthorizedRunContext): AsyncIterable<RuntimeEvent>;
}
```

`AuthorizedRunContext`／`RuntimeEvent` 已在共享合约中定义；上表字段是完整目标，本 PoC 未全部落地。合约最少职责如下：

- Context 包含冻结身份、获准输入、工具能力句柄、预算对象、受控模型调用句柄及 AbortSignal。
- 不含可供组件读取的明文 Key、数据库对象、任意 fetch、Shell 或宿主目录。
- Event 使用受限结构：started、progress、tool_started、tool_finished、usage、completed、failed、cancelled；有 runId／sequence，敏感字段通过允许列表投影。
- 现有 RunEvent 与 NDJSON 通过显式映射适配，不默认改变客户端协议。
- 原始 Pi 消息／事件不得直接透传前端或审计日志。
- 输入输出 Schema、事件数量／大小、产物上限、协议版本都需要正反例。

## 3. 初始执行方式

- DAG 保留既有节点依赖语义；DAG adapter 以无行为变化为 Gate。竞技路径尚未迁移：`ArenaService.run` 仍直接调用 `executeWorkflow`。
- Pi 首先作为隔离用户状态的实验性自测路径，选择固定模型、固定工具、显式加载的指令型 Skill。
- 不把 DAG 图原封不动送进 Pi 并假设同样语义；Pi 定义初版为单 Agent 任务模板，和 recipe kind 显式区分。
- 每次运行新建会话状态；不共享历史消息或继承服务进程的用户配置。
- 不启用自动目录发现、未注册扩展、宿主工具、自动模型选择或隐式重试。
- 不支持的资源／宿主工具在付费前拒绝；不静默跳过或改用 DAG。
- 用户可选 Pi 的具体发布时点受已确认 D3 的 PI0–PI4 Gate 控制；PoC 默认不对公共用户开放。

## 4. 模型与工具桥接

现有 SDKProvider、Pi 消息／工具协议不假定兼容。PoC 区分两种实现：**A 已有实现与样本，B 仍不可用**：

A. Pi 的模型流接口适配至受控模型出口，保留官方参数、safe fetch、timeout、响应上限和 usage。
B. 采用 Pi 模型层但注入同等受控出口；必须证实没有旁路网络或 Key 自动读取。

当前 `createBridgeAStreamFn` 接受受控官方出口；`createBridgeBStreamFn` 仍抛 `RUNTIME_UNAVAILABLE`。fake 路径使用注入的 `streamFn`，不发起网络、不读 Key。[PI3 历史 Flash 样本](pi3-flash-sample.md) 仅一次无工具调用，不证明通用工具循环、故障恢复或公共上线验收；后续修正须重新提供对应离线证据，付费复测另行授权。

所有工具经过统一 dispatcher：版本／准入 → 参数校验 → 预算预留 → 执行 → 输出边界 → 结算。模型请求工具不构成授权。第一轮仅 calculator 等已有工具，不提供任意文件读取和 shell。

模型多步／并行请求需防止每个请求单独通过而总预算超额；不支持原子预算时先限制为串行。maxSteps、maxToolCalls、tokens、总时间和取消都需硬限制；未知价格不能保证金额上限。

## 5. 任务生命周期

组件自测与现有请求绑定 Run 的差异必须明确。调度复用 evaluation-foundation 已确认的 Redis/BullMQ + PostgreSQL/Outbox 基础，不由 Pi 或 T5 再选一套，不能拿内存异步函数冒充可恢复 Worker。

建议状态：queued → running → completed／failed／cancelled；另记录 cancel_requested，不把请求取消等同于外部调用已停止。

- 重复请求使用用户＋请求幂等键绑定冻结内容；同键不同内容冲突。
- 若进程崩溃后上游是否计费不可知，标记待核对，不自动重发付费调用。
- 不承诺 exactly-once 外部调用，除非供应商提供可验证保证。
- 网络断线后状态查询只读，不触发新运行。
- 生产长任务需租约／心跳／过期状态处理；真实调用试点前须通过共享执行与费用 Gate；未通过只进行离线 PoC。
- 安全撤销在新运行及后续受控步骤检查；已发出的网络请求无法保证收回。

## 6. 版本、证据与比较

本分支已有 `0003_runs_runtime_identity.sql`，新增可空 `runtime_kind` / `adapter_version` / `policy_version`；新 DAG Run 持久化此子集。不是新增 `runs.runtime`，也不是完整冻结 Run 契约。旧结果保持未知身份，不编造版本/Attempt 或回填成 Pi。迁移文件存在不等于本次真实数据库升级/并发 Gate 已通过。

DAG 与 Pi 的结果分别展示，默认组件自测不产生竞技 Submission。将来是否可在同一赛季比较，必须另行定义 Profile、资源和评分规则。

Pi 稳定性、启动时间、峰值内存、依赖规模需测量后记录；“轻量”是选型目标，不是未经测量的验收结论。

## 7. 当前代码与目标边界

- `src/shared/runtime-contract.ts`：现有安全 Context/Event/定义联合，不等于 [Agent Build 五契约](../agent-mode/design.md) 已实现。
- `src/lib/runtime/`：DAG adapter；`ArenaService.run` / `hunt` 已经由适配器调用同一引擎。
- `src/server/runtime/pi/`：适配器、Bridge A/B 和 fail-closed 动态加载；core 已在 dependencies。当前 `tsconfig.json` 包含服务端源码，不再声称排除此目录；不允许从客户端导入 Pi。
- `tests/runtime-contract.test.ts`、`tests/runtime-dag.test.ts`、`tests/runtime-pi-fake.test.ts`：现有离线测试文件。
- `tests/pi-runtime.integration.ts` 与 `pnpm test:pi-runtime`：真实 SDK 离线测试入口，CI 已调用。实际通过/失败/skip 以本次代码工作包运行结果为准，不以配置存在冒充通过。
- 组件自测协调、持久化 EF Worker、Agent Build、沙箱/artifact 仍是后续目标，不由 Pi PoC 自动提供。

包名和导出路径以冻结版本为准；未授权拆包、多仓库或依赖升级。

## 8. Gate

| Gate | 验证内容 | 启用条件 |
| --- | --- | --- |
| PI0 | 官方项目身份、精确版本／许可证、兼容性、依赖评估 | 安装前 |
| PI1 | 离线工具循环、事件映射、usage、无付费／无隐式网络 | PoC 完成 |
| PI2 | 未注册工具／路径／默认配置拒绝，租户隔离、预算、取消、错误脱敏 | 可受邀试点前 |
| PI3 | 另行授权 Flash 小样本，记录实际 wire 参数及真实结果 | 真实适配验收 |
| PI4 | 版本持久化、幂等、故障／中断语义、可关闭 Feature Flag、回归与性能测量 | 开放用户选择前 |

当前：Bridge A、身份列、flag、幂等助手有代码；[PI3 样本](pi3-flash-sample.md) 与 [PI4 测量](pi4-measurement.md) 是历史单次证据。幂等助手不是持久化 Job/Attempt/Outbox，import 时间/RSS 不是长期容量或故障验收；因此不能宣称 PI0–PI4 全部门禁通过。公共用户选择器仍关闭；受邀开放还需共享执行/费用 Gate 和相应实际验证。任何 Gate 失败不静默降级；关闭 Pi 不删除历史记录，不影响 DAG 运行。沙箱脚本／MCP 的执行 Gate 另立，Pi 验收通过不等于这两项已获准。

Agent Build 的首批设计与后续阶段见 [Agent mode](../agent-mode/README.md)。当前唯一应用运行时仍是 Next.js，独立 Worker 是 EF 目标；Agent 是 Build 模式、Pi 是执行机制、Verified 是信任政策，三者互不授予资格。
