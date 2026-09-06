# DeepSeek Official BYOK 与 Verified Benchmark 需求

> 2026-09-06 设计对齐：见 [全项目设计地图](../README.md) 与 [评测基础](../evaluation-foundation/README.md)。本文为分期目标，不宣称全量已实现。共享调度/容量/预算采用 Q1–Q25；领域特有授权、证据和原发布 Gate 保留。未来能力不因基础设施设计获批而自动启用。


- 状态：已确认
- 确认日期：2026-09-05
- 范围：AgentForge 全栈 Next.js 运行时与独立 Platform Model Gateway
- 唯一应用：Next.js；Portable 已退役，不维护真实或模拟运行入口。

## 1. 问题

当前 AgentForge 允许用户保存管理员白名单内的任意 OpenAI-compatible Base URL，并按 `demo / byok / verified` 三种 `tier` 排行。Base URL、模型和价格均可能由用户提供，现有平台执行仅支持固定 AI Gateway Key 与 Model，运行又依赖当前 HTTP/NDJSON 请求生命周期。因此系统不能仅凭“官方 URL”证明正式排行榜中的执行公平性，也不能安全地提供平台赞助额度。

本功能建立以下闭环：

```text
Official Provider Registry
→ Official BYOK / Platform-Sponsored Execution
→ Benchmark Profile
→ Evaluation Suite
→ Benchmark Season
→ Verified Submission
→ Certified Leaderboard
```

## 2. 目标

1. 普通用户只能添加 DeepSeek 官方凭据，不能填写 Base URL、任意模型或自报价格。
2. Official BYOK 直接请求 DeepSeek 官方端点，并与 Verified 排行榜隔离。
3. Verified Run 通过 AgentForge 控制的独立模型网关执行，平台 Token 不进入浏览器。
4. Verified 结果绑定 Profile、Season、Evaluation Suite、Scoring Version 和 Gateway Config Version。
5. 排行榜使用冻结的 Benchmark Cost；实际平台费用仅用于预算控制。
6. 新用户通过认证券获得有限的免费 Verified Submission。
7. 网关、认证券、预算和管理员操作具备幂等、审计、熔断与失败关闭行为。
8. 旧凭据和旧成绩保留历史，但不被静默升级为新的可信结果。
9. 生产隐藏测试不存放在公开源码包中。
10. 测试模型仅在显式隔离测试模式启用，普通应用不回退 Demo。

## 3. 非目标

- 首版不支持 DeepSeek V4 Pro、思考模式或其他模型厂商。
- 首版不开放普通用户自定义网关。
- 首版不把真实费用用于排行榜排序。
- 首版不让 Platform Gateway 执行 DAG、评测或评分。
- 首版不实现认证券购买、充值、退款到法币或财务结算。
- 首版不向 CI 提供真实付费 DeepSeek Key。
- 首版不把现有静态 fixtures 声称为生产隐藏基准。
- 首版不宣称上游浮动模型具有供应商提供的不可篡改版本证明。

## 4. 参与者

- **User**：使用 Official BYOK，持券提交 Verified Run。
- **Developer**：除 User 能力外，可使用 Custom Endpoint 运行公开测试。
- **Admin**：管理网关、Profile、Season、Evaluation Suite、角色、认证券和预算。
- **AgentForge Application**：持有工作流、测试集、Judge、Score 和排行榜状态。
- **Platform Model Gateway**：执行受控模型调用，返回 Execution Receipt。
- **DeepSeek Official API**：首版唯一官方上游模型服务。

## 5. 业务需求与验收标准

### R1：官方 Provider Registry

- 当普通用户查看 Provider 设置时，系统应只展示已注册的官方 Provider 和允许模型。
- 当用户添加 DeepSeek 凭据时，系统应从 Registry 解析 `https://api.deepseek.com`，不得接受客户端 Base URL。
- 当用户选择模型时，系统应只允许 Official Provider Registry 当前启用的 `deepseek-v4-flash` 非思考 offering；是否可进入排行另由对应 Profile 和 Season 决定。
- 当 Registry 中没有对应 Provider/Model 时，系统应在任何外部请求发生前拒绝运行。

### R2：凭据隔离

- 当用户保存 Official BYOK Key 时，系统应使用认证加密并绑定 User、Credential 和 Credential Kind。
- 当浏览器读取凭据列表时，系统应只返回 Provider、显示名、状态和末四位掩码。
- 当用户 Fork Build 时，系统应删除全部 Credential 引用。
- 当管理员轮换 Platform Token 时，系统不得提供读取旧 Token 明文的能力。

### R3：Trust Lane 隔离

- 当 Run 使用模拟模型时，系统应标记为 Demo。
- 当 Run 使用用户 DeepSeek 官方凭据时，系统应标记为 Official BYOK。
- 当 Run 使用 Platform Gateway 和有效 Profile 时，系统应标记为 Verified。
- 当 Developer/Admin 使用自定义端点时，系统应标记为 Custom，且只允许公开测试。
- 当查询排行榜时，系统不得混合不同 Trust Lane、Profile、Season、Evaluation Suite 或 Scoring Version 的结果。

### R4：Benchmark Profile

- 当 Admin 创建 Profile 时，系统应记录 Provider、Model、thinking、强制参数、能力、冻结价格和版本。
- 当 Profile 激活时，首版应强制 `deepseek-v4-flash`、thinking disabled、temperature 0、non-streaming 和 no model retry。
- 当执行 Verified Run 时，系统应忽略或拒绝 Workflow 中与 Profile 冲突的模型参数，并展示实际参数。
- 当 Profile 被修改时，系统应创建新版本，不得原地改写已有 Submission 的执行语义。

### R5：Benchmark Season

- 当 Admin 开启 Season 时，系统应绑定 Challenge、Profile、Evaluation Suite 和 Scoring Version。
- 当 Canary 发现可能的模型变化时，系统应暂停相关 Verified Submission 并通知 Admin，而不是自动永久关闭 Season。
- 当 Admin 确认上游模型发生实质变化时，系统应关闭旧 Season，新成绩不得进入旧榜。
- 当 Evaluation Suite 或 Scoring Version 改变时，系统应创建新的 Season。

### R6：Platform Gateway 配置

- 当 Admin 新建配置时，系统应保存为 Draft，并认证加密 Token。
- 当 Admin 请求测试时，系统应执行网络、协议、能力、隐私和幂等检查。
- 只有全部检查通过的配置才可激活。
- 当新配置激活时，旧配置应原子进入 Retired 状态。
- 当同一 Active Gateway Config 连续三次返回协议不匹配 Receipt 时，系统应自动暂停配置并拒绝新 Verified Run；一次有效 Receipt 应重置该连续计数。

### R7：Execution Receipt

- 当网关完成一次模型调用时，应返回 Request ID、Idempotency Key 摘要、Profile Version、Gateway Config Version、上游 Provider/Model、thinking 状态、usage、latency 和 Actual Platform Spend。
- 当 Receipt 缺字段、ID 不匹配、模型不匹配或 thinking 被开启时，AgentForge 应使整个 Verified Run 失败且不产生 Submission。
- AgentForge 不得用估算 usage 补足 Verified Receipt。
- 系统应保存脱敏 Receipt 元数据，不保存认证 Token、完整 Prompt、隐藏输入或完整响应。

### R8：持久化 Verified Job

- 当用户提交 Verified Run 时，系统应在同一事务中冻结 Build Version 和评测版本、预留认证券并创建持久化 Job。
- 当浏览器断开或关闭页面时，已经排队或运行的 Job 应继续执行。
- 当 Worker 崩溃时，系统应通过租约超时恢复可安全继续的 Job，而不得重复结算认证券或重复调用已完成的模型请求；若上游已完成但响应正文未被 AgentForge 持久接收，系统应失败关闭为已产生费用的终态，不得重试上游。
- 当 Job 完成时，Run、Run Cases、Submission、Receipt、Spend 和 Ticket Settlement 应具有一致终态。

### R9：认证券

- 当用户完成邮箱验证或可信 OAuth 时，系统应一次性赠送 3 张新用户认证券，有效期 30 天。
- 当用户提交 Verified Run 时，系统应按最早过期优先预留一张券。
- 当外部调用前失败或平台协议故障未产生有效结果时，系统应退款。
- 当用户取消已产生上游结果的 Run、Workflow 超预算、模型低分或拒答时，系统应结算认证券而不是退款。
- 当客户端重放相同 Idempotency Key 时，系统应最多预留和结算一次。
- 当故障退款恢复已过期券时，系统应至少提供 24 小时可用期。

### R10：频率与预算

- 当同一用户一天内已提交 3 次 Verified Run 时，系统应拒绝新的 Verified Submission。
- 当同一 Build Version、Profile 和 Season 当天已有一次尝试时，系统应拒绝重复尝试。
- 当用户已有运行中 Verified Job 时，系统应拒绝并行 Verified Job。
- 在激活 Verified 能力前，Admin 必须设置单次、单用户每日、全局每日和全局每月 Actual Spend 上限；系统应按 Profile 的最坏允许成本原子预留预算，结算后释放差额，不能只检查已经发生的 Spend。
- 当预算达到警告阈值时，系统应通知 Admin。
- 当预算达到硬上限时，系统应暂停新的 Verified Run，不得回退到 BYOK 或 Demo。

### R11：角色与审计

- 当部署配置命中 Bootstrap Admin Email 时，系统应幂等授予 Admin Membership。
- 当环境变量后来被移除时，系统不得自动撤销已授予角色。
- 只有 Admin 可管理 Token、Profile、Season、Budget、Role 和 Ticket Grant。
- 系统不得允许删除或撤销最后一个 Active Admin。
- MVP 敏感操作应要求最近重新认证并产生不可修改的 Audit Event。
- 紧急暂停可由单一 Admin 立即执行；生产增强阶段的扩权和预算提高支持双人审批。

### R12：生产 Evaluation Suite

- 当生产部署导入隐藏测试时，系统应从私有评测包创建版本化 Evaluation Suite。
- 当普通 API 查询 Challenge、Run 或 Submission 时，系统不得返回隐藏输入、答案、逐条输出或私有 Prompt。
- Gateway 只应收到完成当前模型调用所需的 Prompt，不应获得完整 Evaluation Suite。
- 公开仓库中的 fixtures 只能用于 Demo、开发和非生产测试。

### R13：排行榜

- 当查询 Verified 排行榜时，系统应按 Challenge、Profile、Season、Suite 和 Scoring Version 精确过滤。
- 每个 Build 应只使用其最新 Completed Verified Submission 作为候选。
- 每个 User 应只展示其候选 Build 中得分最高的一行。
- 同分时依次比较 Accuracy、Robustness、Security、Benchmark Cost、Tokens、Latency 和 Submitted At。
- Actual Platform Spend 不得用于公开排序或返回普通用户。
- MVP 使用单轮评测；正式 Season 切换为三轮并取中位数。

### R14：Consent 与透明度

- 当用户首次执行 Official BYOK 或 Verified Run，或 Consent 文本版本变化时，系统应要求重新确认。
- Official BYOK Consent 应说明测试输入直接发送给 DeepSeek 并消耗用户 Key。
- Verified Consent 应说明测试输入经 Platform Gateway 发送给 DeepSeek并消耗一张认证券。
- Verified 详情应公开 Profile、Season、Suite Version、Scoring Version、执行参数、冻结价格和脱敏 Receipt ID。
- 系统不得公开 Actual Spend、网关 Token、DeepSeek Key 或隐藏测试内容。

### R15：Legacy 迁移

- 当旧 Credential 的规范化地址精确匹配 DeepSeek 官方地址时，迁移应将其标记为 Official DeepSeek 并要求模型重新符合 Registry。
- 其他旧 Credential 应标记为 Legacy Custom；普通 User 不得继续执行，Developer/Admin 仅可用于公开测试。
- 旧 BYOK 和 Verified Submission 应进入 Legacy Archive，不得进入新榜。
- 旧 Demo Submission 可继续作为明确标注的模拟历史展示。
- 迁移不得删除、解密显示或改变 Credential 所有权。

### R16：单一应用与隔离测试（保留需求编号）

- Portable 已退役，不再建设第二套运行时。
- 唯一 Next.js 应用仅在 APP_ENV=test 且 DEMO_MODE=true 启用模拟模型。
- 测试不得自动触发真实费用，也不得将测试结果升级为 Official/Verified 证据。
- 领域核心保留 Node 原生可测试路径，不依赖 Next.js、数据库实例或真实 SDK。

### R17：隐私与保留

- Gateway 不得持久化原始 Prompt、隐藏输入、Secret 或完整模型响应正文；AgentForge 不得持久化上游原始响应封装，只能按评测和审计所需保存受访问控制的规范化 Workflow 输出与脱敏 Receipt。
- Profile/Season 生命周期和 Submission 历史应长期保留。
- Receipt 元数据默认保留 90 天，失败脱敏错误保留 30–90 天。
- Admin/Token/Role Audit 和 Credit Ledger 至少保留 365 天。
- 当旧 Platform Token 退役时，应销毁其可用密文或使其永久不可用，同时保留非秘密审计记录。

### R18：阶段发布

- 在 Official BYOK 基础未完成前，系统不得向普通用户开放 Verified。
- 在私有 Gateway、生产 Evaluation Suite、Ticket Ledger、Budget Fuse 和迁移验证完成前，Verified 只能处于 Internal Preview。
- 在全栈测试、数据库升级、故障演练和安全审查完成前，系统不得将 Verified 标为正式认证榜。
- 正式三轮中位数赛制应作为单独发布阶段，不得与 MVP 单轮结果混榜。
