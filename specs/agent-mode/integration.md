# Agent mode integration boundary and delivery status

> **状态快照 / Status snapshot：2026-09-07。** 本文件是 Agent mode 的长期技术边界和交付状态说明，不是交接记录。历史测试结果只说明记录的代码路径曾经通过，不代表当前进程、服务、数据库或生产环境状态。

## 1. 范围与结论 / Scope and conclusion

B1 和受限 B2 已交付：Agent Build 可以保存私有、未配置的声明式草稿，支持不可变版本、并发保存保护、历史读取和精确版本 Fork。B3 的编辑器、引用授权、公开发布和执行能力仍未交付。

本文件保留 Agent mode 的接口、安全和后续接入边界。当前 EF（Evaluation Foundation）已经提供 Job/Attempt/Invocation、Outbox、BullMQ/Worker、幂等、租约、取消和恢复基础；Agent 不得自行创建另一套调度器。Agent-specific execution、SelfTestRun、沙箱和竞技闭环必须经过共同 Gate 后才能开放。

## 2. 已完成项 / Delivered

### 2.1 B1：纯定义契约 / Pure definition contract

- `src/shared/agent-build-contract.ts` 提供 `AgentBuildDefinitionV1`、规范化、严格字段校验、资源界限和深冻结结果。
- `src/lib/agent-build/digest.ts` 对规范化定义计算服务端 SHA-256；固定版本和 Skill 顺序属于摘要协议的一部分。
- 定义不承载凭据或 Grant；结构合法、摘要一致不等于引用真实、获得授权或具备执行资格。
- mode、execution runtime 和 trust lane 保持独立；Pi 的 `RunDefinition.kind: pi` 不等于持久化 Agent Build，也不是转换器。

### 2.2 B2：私有未配置草稿 / Private unconfigured drafts

- `POST /api/arena/builds` 支持显式 `mode: agent` 和 B1 `agentDefinition`；缺省 mode 仍只表示 Workflow。
- Agent 草稿只允许 private；可以保存空 instructions。模型、Profile、输出、环境和 runtime 选择必须为空，Skill/能力也必须为空。非空引用 fail closed。
- `GET /api/arena/builds/:id?mode=agent[&version=id]` 只允许 owner 读取 Agent definition/digest；history 只返回显式安全 metadata，不把 Agent 当作 Workflow 返回。
- `POST /api/arena/builds/:id/fork` 要求明确 mode/version；事务内核对源、精确版本归属和访问，创建 private revision 1，并保存 `fork_relations.source_version_id`。
- `build_versions.mode`、`agent_definition`、`definition_digest` 和 Fork 来源由 `0009_agent_build_drafts.sql` 承载；主线 `0001`–`0006` 不改写。Pi 历史迁移文件和字节继续保留在历史目录。
- 保存事务维持 owner/problem/mode/CAS；序列化和死锁错误按既有事务重试边界处理。Agent Run/DAG/hunt 入口 fail closed，不构造 Agent provider 或模型调用。

### 2.3 已关闭的 lane 回归 / Closed lane regression

Provider lane 的分类和解析现在共用 `classifyProviderLane`。任一价格缺失即为 BYOK；两项价格均已知（包括零）才为 Verified；Demo/custom 行为不变。该分类不触发 provider 构造或授权副作用。

## 3. 接口与安全边界 / Interface and safety boundaries

### 3.1 请求与版本 / Requests and versions

- POST 保存请求拒绝未知字段、混合 DAG/Agent 定义、客户端摘要、bindings/Grant 和 mode 隐式转换。
- 直接 service 调用也必须执行与 HTTP 相同的领域校验，不能只依赖 Zod 或按钮隐藏。
- Build 的 current pointer 和历史版本保持不可变语义；排队快照必须使用精确的 immutable BuildVersion，不随之后的草稿变化。
- `currentVersionId` 是当前兼容字段；不要在没有明确契约变更时引入 `expectedVersionId` 别名或静默重命名。

### 3.2 读取、投影与 Fork / Reads, projections and Fork

- owner 与非 owner 读取路径必须分别核验 Build、所选历史版本和组件访问资格；不能共用未经裁剪的 definition 序列化。
- 加入组件引用后，必须使用显式 DTO，避免私有 instructions、引用或 Grant 经 history、详情、列表和导出泄露。
- Fork 必须保存确切来源版本，在事务内重新核验源和依赖权限，创建 private revision 1，清除全部凭据绑定且不复制 Grant。无权访问时拒绝，不静默替换依赖。
- 组件引用必须固定到不可变版本；普通 withdrawn/deprecated 和安全 revoked 的行为要区分，授权变化不能由缓存绕过。

### 3.3 与 EF 的联合边界 / Shared EF boundary

- Agent C 阶段复用现有 EvaluationJob/Attempt/Invocation/Outbox 和独立 Worker；不创建 AgentJob、AgentQueue 或 AgentBudget。
- SelfTestRun、Agent Run 和后续 ComponentEvaluation 仍是不同业务记录；自测不得生成竞技 Submission 或排行榜成绩。
- Agent-specific 联合创建必须一次性绑定冻结的 definition、Profile/输出合同、凭据准入、同意版本、预算和幂等摘要。页面断线不等于取消，取消和不确定上游结果由 EF 收敛。
- 在 EF scheduler/outbox 配置下，尚未接入共同持久化准入的 Agent/Pi 真实调用必须 fail closed；不可用长 HTTP 请求冒充可靠执行。

## 4. 未完成项 / Not delivered

### B3：编辑器与发布 / Editor and publishing

- [ ] Agent 编辑器、历史选择、保存冲突、加载/空/错误状态及桌面/窄屏可访问性验收。
- [ ] Component/ComponentVersion/Release/UsageReference 的权威解析、digest、读权限、许可、撤回/撤销和公开依赖检查。
- [ ] Agent definition 的安全 DTO、公开发布、凭据重新绑定和跨用户 Fork 的完整端到端验证。

### C：可靠执行 / Reliable execution

- [ ] Agent 与 EF 的 SelfTestRun/Job 原子创建、状态查询、确认取消、fencing、恢复和安全结果投影。
- [ ] 双 API 幂等、重复投递、Redis 断线/补投、Worker 失联/旧写回、排队撤销、取消完成竞态及真实容额/费用验收。
- [ ] 邮箱验证、密码找回、共享认证限流和邮件消费者等配套 Gate。

### D：沙箱与 artifacts / Sandbox and artifacts

- [ ] Python 或其他执行环境的真实隔离、镜像/digest、资源配额、默认禁网、无宿主 shell 和停止确认。
- [ ] 路径穿越、symlink/hardlink、竞态替换、超额输出、artifact 封存/下载/预览、XSS/CSV 公式/远程资源和隐藏内容泄露验证。
- [ ] 独立 judge、失败与基础设施故障区分，以及可审计的不可变产物摘要。

### E/F：竞技闭环与扩展 / Competitive loop and extensions

- [ ] Agent Profile/Season/Suite/Scoring 兼容身份和资源归责；Run → Submit → Score → Leaderboard → Fork 全链路。
- [ ] Demo/BYOK/Verified 隔离、自测/平台复测不产竞技成绩、隐藏输入/输出只投影允许汇总。
- [ ] 只读 MCP、可执行 Skill、其他语言/厂商 SDK 和多 Agent 需单独完成身份、许可、供应链、SSRF、数据同意、配额和沙箱准入。

## 5. 历史验证记录 / Historical verification record

以下结果属于 2026-09-07 及之前的历史记录，不代表当前运行或生产验收：

- B1 定向 Agent contract 测试：16 passed；覆盖定义规范化、严格字段、资源限制和摘要 golden vector。
- B2 定向 draft/lane 测试：23 passed / 0 failed / 0 skipped；覆盖价格缺失/零值、Demo/custom、Run/submission/hunt 一致性和 Agent 执行前拒绝。
- 相关工作包记录：full suite、Pi suite、typecheck/build 和隔离 Next/Auth smoke 均曾成功；该记录不是本文件当前执行结果，也不代表生产服务仍在运行。
- 迁移矩阵、PostgreSQL 并发 CAS 和 EF PostgreSQL/Redis Worker 测试有独立历史记录；它们只覆盖记录的场景，不能替代生产容量、费用、故障或安全验收。
- 没有以本文件中的历史测试结果宣称 Agent UI、Agent 真实模型执行、沙箱、Verified 或社区公开发布已完成。

## 6. 后续验收 / Next acceptance gates

- [ ] 运行全新库、旧结构升级、重复迁移、原数据保留、并发 CAS、事务回滚和注册/登录矩阵；保持已应用迁移 checksum 不变。
- [ ] 验证正常、错误、越权、未知 schema、混合定义、摘要伪造、撤回/撤销、公开许可和授权变化竞争。
- [ ] 验证私有当前/历史版本、公开 DTO、跨用户 Fork、凭据清除和 Grant 不复制；禁止通过缓存泄露私有内容。
- [ ] 在真实 Next.js/React 前端验证桌面和窄屏的加载、空、错误、保存冲突、历史选择、语言切换和可访问性；不得以 HTTP 测试或历史截图代替。
- [ ] 只有在共同 EF、权限、预算、撤销、沙箱和隐私 Gate 全部有实际证据后，才开放 Agent 执行或公开发布；真实模型、付费服务和生产操作仍需单独授权。

参考：[Agent mode README](README.md)、[Agent design](design.md)、[Evaluation Foundation](../evaluation-foundation/README.md)、[community implementation](../community-component-library/implementation.md)、[当前合并交付评审](../../docs/PI-MAIN-INTEGRATION-REVIEW.md)。
