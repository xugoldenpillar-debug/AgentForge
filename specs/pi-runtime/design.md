# 可选 Pi Runtime：技术设计与验证计划

> 2026-09-06 设计对齐：见 [全项目设计地图](../README.md) 与 [评测基础](../evaluation-foundation/README.md)。本文为分期目标，不宣称全量已实现。共享调度/容量/预算采用 Q1–Q25；领域特有授权、证据和原发布 Gate 保留。未来能力不因基础设施设计获批而自动启用。


- 日期：2026-09-06；状态：PI0–PI2 离线适配器、PI3 Bridge A（官方 Flash 安全出口）、PI4 身份列／可关 flag／幂等助手／测量已落地。公共 UI 选择器与混榜未做。Bridge B 保持不可用。
- 目标：在保留现有 DAG 的基础上提供受限的模型驱动 Agent 循环，便于 Skill 开发和未来厂商联调。
- 不是：替换 DAG、默认运行编码 CLI、通用沙箱、可信 Gateway 或要求所有厂商使用 Pi。
- 上游 git 快照见 [核验记录](./upstream-evidence.md)；可安装产物见 [PI0 freeze](./pi0-freeze.md)。应用清单仍未加入 Pi 依赖。

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

## 0. 本次核验带来的集成约束

精确 npm 身份已写入 [PI0 freeze](./pi0-freeze.md)：`@earendil-works/pi-agent-core@0.85.1`，MIT，`engines.node` `>=22.19.0`。不要使用 `@mariozechner/*` 或 `@earendil-works/pi-coding-agent`。应用 `engines.node` 保持 `>=22.16.0`；Node 不满足 Pi 时拒绝启用，不抬高全应用下限。冻结未把包写入 `package.json`，也未生成 lockfile。

建议 Pi 放可选服务端边界，明确检查运行条件，不满足就拒绝启用 Pi，而不是整个 DAG 应用不可运行。是否调整全栈 Node 基线在确切依赖版本确定后单独说明并验证 CI。

上游文档的工具默认并行执行；预算不能只靠收到事件后递减，也不能假设停止循环会强制取消已运行工具。fake PI1/PI2 覆盖串行 calculator、取消与隔离；**真实 SDK 的并发与取消行为仍属后续（PI3 及真实 SDK Gate）**。详细证据与限制见 `upstream-evidence.md`。

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

本 PoC 已落地的合约见 `src/shared/runtime-contract.ts`。当前 `ExecutionIdentity` 只有 `runtime` / `adapterVersion` / `policyVersion` 及可选 model/tool/skill 版本，没有 `runtimeVersion`、`definitionVersionId`、`modelOfferingId`、`dependencyDigest`，也不写入 `runs` 表。下列示意仍是完整目标，不是本 PoC 已持久化的字段。

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

现有 SDKProvider、Pi 消息／工具协议不假定兼容。PoC 比较两种实现，**均推迟到 PI3**：

A. Pi 的模型流接口适配至受控模型出口，保留官方参数、safe fetch、timeout、响应上限和 usage。
B. 采用 Pi 模型层但注入同等受控出口；必须证实没有旁路网络或 Key 自动读取。

当前 `createBridgeAStreamFn` / `createBridgeBStreamFn` 直接抛 `RUNTIME_UNAVAILABLE`。fake 路径使用注入的 `streamFn`，不发起网络、不读 Key。优先选择能复用现有安全边界的路径；验证前不决定使用哪个模型库，不为省事删除网络限制。

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

本 PoC 不改 `runs` 表、不加 `runs.runtime` 列。新运行的 runtime / adapter / policy 身份写在 `ExecutionIdentity` 与适配器事件上；旧结果未记录运行时身份的保留为历史，不编造版本或自动回填成 Pi。持久化身份属于 PI4，未做。

DAG 与 Pi 的结果分别展示，默认组件自测不产生竞技 Submission。将来是否可在同一赛季比较，必须另行定义 Profile、资源和评分规则。

Pi 稳定性、启动时间、峰值内存、依赖规模需测量后记录；“轻量”是选型目标，不是未经测量的验收结论。

## 7. 代码落点候选

- `src/shared/runtime-contract.ts`：安全共享协议，不包含 Pi／数据库依赖。
- `src/lib/runtime/`：平台接口与 DAG adapter。`ArenaService` 尚未改道。
- `src/server/runtime/pi/`：fake 适配器加 `load.ts`（fail-closed 可选动态 import 字符串 `PI_CORE_PACKAGE`，无静态 specifier，无 DAG 回退）；`tsconfig` 排除该目录，不能进入浏览器导入树。`package.json` 仍无 Pi 依赖。
- `src/server/component-tests/`：运行协调与结果保存，复用领域算法（候选，未建）。
- `tests/runtime-contract.test.ts`、`tests/runtime-dag.test.ts`、`tests/runtime-pi-fake.test.ts`：随 `pnpm test`；不要求安装 Pi。
- `tests/pi-runtime.integration.ts`：已存在。`pnpm test:pi-runtime` **不在 CI**；缺包 skip，除非 `PI_RUNTIME_REQUIRED=true`。真实 SDK 测试默认 skip。PI3/PI4 未做。

包名、导出路径需以冻结版本为准。若 runtime 实现放独立 package，应先确认构建及部署收益，不为抽象本身增加多仓库复杂度。

## 8. Gate

| Gate | 验证内容 | 启用条件 |
| --- | --- | --- |
| PI0 | 官方项目身份、精确版本／许可证、兼容性、依赖评估 | 安装前 |
| PI1 | 离线工具循环、事件映射、usage、无付费／无隐式网络 | PoC 完成 |
| PI2 | 未注册工具／路径／默认配置拒绝，租户隔离、预算、取消、错误脱敏 | 可受邀试点前 |
| PI3 | 另行授权 Flash 小样本，记录实际 wire 参数及真实结果 | 真实适配验收 |
| PI4 | 版本持久化、幂等、故障／中断语义、可关闭 Feature Flag、回归与性能测量 | 开放用户选择前 |

当前：PI0–PI4 技术门禁已在本分支落地（Bridge A、身份列、可关 flag、幂等助手、测量）。公共用户选择器仍关闭。任何 Gate 失败不静默降级；关闭 Pi 不删除历史记录，不影响 DAG 运行。沙箱脚本／MCP 的执行 Gate 另立，Pi 验收通过不等于这两项已获准。
