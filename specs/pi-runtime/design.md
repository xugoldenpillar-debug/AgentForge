# 可选 Pi Runtime：技术设计与验证计划

> 2026-09-06 设计对齐：见 [全项目设计地图](../README.md) 与 [评测基础](../evaluation-foundation/README.md)。本文为分期目标，不宣称全量已实现。共享调度/容量/预算采用 Q1–Q25；领域特有授权、证据和原发布 Gate 保留。未来能力不因基础设施设计获批而自动启用。


- 日期：2026-09-06；状态：高层方向已确认，接口草案／PoC 待执行。
- 目标：在保留现有 DAG 的基础上提供受限的模型驱动 Agent 循环，便于 Skill 开发和未来厂商联调。
- 不是：替换 DAG、默认运行编码 CLI、通用沙箱、可信 Gateway 或要求所有厂商使用 Pi。
- 上游事实见 [核验记录](./upstream-evidence.md)；精确版本、依赖和许可证需在安装 PR 冻结。

## 0. 本次核验带来的集成约束

上游固定快照的仓库清单为 `@earendil-works/pi-agent-core` / `@earendil-works/pi-coding-agent`，版本 `0.85.1`，Node `>=22.19.0`；这不是已经核验的 npm 最新发布版本。当前 AgentForge 声明 Node `>=22.16.0`。PI0 必须确认实际可安装产物、锁文件、引擎与传递依赖，不能照抄旧 scope 或静默抬高项目 Node 最低版本。

建议 Pi 放可选服务端边界，明确检查运行条件，不满足就拒绝启用 Pi，而不是整个 DAG 应用不可运行。是否调整全栈 Node 基线在确切依赖版本确定后单独说明并验证 CI。

上游文档的工具默认并行执行；预算不能只靠收到事件后递减，也不能假设停止循环会强制取消已运行工具。PI1／PI2 必须覆盖真实 SDK 的并发与取消行为。详细证据与限制见 `upstream-evidence.md`。

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

AuthorizedRunContext／RuntimeEvent 是后续需定义的类型，示意代码不能直接编译或称为已完成合约。其最少职责如下：

- Context 包含冻结身份、获准输入、工具能力句柄、预算对象、受控模型调用句柄及 AbortSignal。
- 不含可供组件读取的明文 Key、数据库对象、任意 fetch、Shell 或宿主目录。
- Event 使用受限结构：started、progress、tool_started、tool_finished、usage、completed、failed、cancelled；有 runId／sequence，敏感字段通过允许列表投影。
- 现有 RunEvent 与 NDJSON 通过显式映射适配，不默认改变客户端协议。
- 原始 Pi 消息／事件不得直接透传前端或审计日志。
- 输入输出 Schema、事件数量／大小、产物上限、协议版本都需要正反例。

## 3. 初始执行方式

- DAG 保留既有节点依赖语义；迁移到适配器时以无行为变化为 Gate。
- Pi 首先作为隔离用户状态的实验性自测路径，选择固定模型、固定工具、显式加载的指令型 Skill。
- 不把 DAG 图原封不动送进 Pi 并假设同样语义；Pi 定义初版为单 Agent 任务模板，和 recipe kind 显式区分。
- 每次运行新建会话状态；不共享历史消息或继承服务进程的用户配置。
- 不启用自动目录发现、未注册扩展、宿主工具、自动模型选择或隐式重试。
- 不支持的资源／宿主工具在付费前拒绝；不静默跳过或改用 DAG。
- 用户可选 Pi 的具体发布时点受已确认 D3 的 PI0–PI4 Gate 控制；PoC 默认不对公共用户开放。

## 4. 模型与工具桥接

现有 SDKProvider、Pi 消息／工具协议不假定兼容。PoC 比较两种实现：

A. Pi 的模型流接口适配至受控模型出口，保留官方参数、safe fetch、timeout、响应上限和 usage。
B. 采用 Pi 模型层但注入同等受控出口；必须证实没有旁路网络或 Key 自动读取。

优先选择能复用现有安全边界的路径；验证前不决定使用哪个模型库，不为省事删除网络限制。

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

新运行固定 runtime / adapter / policy / model / Skill / 工具版本。旧结果未记录运行时身份的保留为历史，不编造版本或自动回填成 Pi。

DAG 与 Pi 的结果分别展示，默认组件自测不产生竞技 Submission。将来是否可在同一赛季比较，必须另行定义 Profile、资源和评分规则。

Pi 稳定性、启动时间、峰值内存、依赖规模需测量后记录；“轻量”是选型目标，不是未经测量的验收结论。

## 7. 代码落点候选

- `src/shared/runtime-contract.ts`：安全共享协议，不包含 Pi／数据库依赖。
- `src/lib/runtime/`：平台接口与 DAG adapter。
- `src/server/runtime/pi/`：Pi 适配、模型桥接；可选加载，不能进入浏览器导入树，核心离线测试不强制安装 Pi。
- `src/server/component-tests/`：运行协调与结果保存，复用领域算法。
- `tests/runtime*.test.ts`：无依赖合约与 mock 生命周期。
- `tests/pi-runtime.integration.ts`：安装依赖后的离线真实 SDK 合约测试；不在原生无依赖测试中误导入可选包。

包名、导出路径需以冻结版本为准。若 runtime 实现放独立 package，应先确认构建及部署收益，不为抽象本身增加多仓库复杂度。

## 8. Gate

| Gate | 验证内容 | 启用条件 |
| --- | --- | --- |
| PI0 | 官方项目身份、精确版本／许可证、兼容性、依赖评估 | 安装前 |
| PI1 | 离线工具循环、事件映射、usage、无付费／无隐式网络 | PoC 完成 |
| PI2 | 未注册工具／路径／默认配置拒绝，租户隔离、预算、取消、错误脱敏 | 可受邀试点前 |
| PI3 | 另行授权 Flash 小样本，记录实际 wire 参数及真实结果 | 真实适配验收 |
| PI4 | 版本持久化、幂等、故障／中断语义、可关闭 Feature Flag、回归与性能测量 | 开放用户选择前 |

任何 Gate 失败不静默降级；关闭 Pi 不删除历史记录，不影响 DAG 运行。沙箱脚本／MCP 的执行 Gate 另立，Pi 验收通过不等于这两项已获准。
