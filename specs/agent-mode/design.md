# Agent mode design（候选契约，未发布）

本页最初为设计提案；后续单独授权的 B1 纯定义契约已实现，范围见下。B2 于 2026-09-07 扩展既有 BuildVersion 与 ForkRelation，对应当前主序列 0009_agent_build_drafts.sql（Pi 原 0005 保留于历史台账）；没有新增表、依赖或运行许可。五份契约仍须与 [EF 联合冻结](../evaluation-foundation/integration.md) 和 [社区版本](../community-component-library/implementation.md) 协调；B1 本地契约与下述 B2 草稿 HTTP 为已实现范围；其余执行协议仍是候选。职责不新建 EvaluationProfile、AgentJob、AgentQueue 或 AgentBudget。

## 1. Agent Build contract

### B1 已实现范围（2026-09-06）

`src/shared/agent-build-contract.ts` 提供 `AgentBuildDefinitionV1` / `AgentBuildDefinition` 与 `parseAgentBuildDefinition`；版本固定为数字 `1`、`mode: agent`，不修改既有 Workflow/RunDefinition 或数据库类型。

- 必填 `mode` / `definitionSchemaVersion` / `instructions`；空指令允许保存为未配置草稿。`skillRefs` / `requestedCapabilities` 缺省为 `[]`，但拒绝显式 null；模型、输出合同、`profileRef`、`environmentRef`、runtime 选择缺省或显式 null 均规范化为 null。任何显式 undefined 均拒绝。非空选择必须完整钉住身份/版本/digest；runtime 选择仅支持结构上的 Pi kind 与 adapter/policy 版本，不检查是否启用或授予执行许可。
- 引用形态为 `{id, versionId, contentDigest}`；Skill 使用 `{kind: declarative, componentId, versionId, contentDigest}`；本地工具引用复用既有 `ToolId`，未来只读 MCP 引用只携带服务/工具身份、版本/digest。它们仅是请求意图：没有动态工具加载、宿主 shell、URL/path、凭据绑定、任意配置或 runtime Grant。
- 指令最多 8000 UTF-16 code units；身份/版本最多 80 字符；Skill 与能力数组各最多 16 项；结构深度最多 6、节点最多 1024、字符串总量最多 32768 code units、规范化 JSON 最多 65536 UTF-8 bytes。另导出未来 HTTP 原始请求体 128 KiB 上限；当前未修改路由。未知字段、原型/访问器/符号/隐藏属性/稀疏数组/循环对象、可变别名和重复身份均拒绝；错误复用 `REQUEST_VALIDATION_FAILED` 且不反射输入。
- 规范化仅将指令 CRLF/CR 转 LF，其余空白保留；Skill 数组顺序保留，能力集合按身份排序；结果为独立深冻结对象。`src/lib/agent-build/digest.ts` 的 `digestAgentBuildDefinition` 对固定字段顺序 JSON 加 `agentforge:agent-build:v1\n` 域前缀后计算 SHA-256；浏览器契约不引入 Node crypto。固定 golden vector 与顺序/变更/隔离回归见 `tests/agent-build-contract.test.ts`。
- 这不是 Frozen Run 快照、公开投影或已授权 Fork；私有指令仍是私有内容。ComponentVersion/Profile/环境/MCP 的存在、真实摘要、许可/撤销及模式兼容性必须由后续权威服务验证。凭据在定义之外重新绑定；B1 不实施 CAS、持久化或 Fork 授权。

B2 已实现的是下述受限草稿子集；后文配置引用/公开发布和其他四份契约仍待联合冻结。B1 最终离线结果：定向 16 tests、完整 175 tests 全通过，typecheck/build 通过；详见 tasks 的限定证据。

依附既有 Build/BuildVersion：`mode: agent`、`definitionSchemaVersion`、`instructions`、`modelSelection`、`skillRefs[{componentId, versionId, contentDigest}]`、`requestedCapabilities`、`outputContractRef`、`runtimeSelection`。模式是定义，runtime 是执行机制；现有 PoC `RunDefinition.kind=pi` 不自动成为持久化 Agent Build。

- `instructions` 与声明式附件有大小/深度限制；`modelSelection` 是受政策校验的模型身份，不是密钥。输出契约由题目/Profile 控制，Build 不能降低标准。
- 后续配置版 Save 在事务内验证 owner、版本前置条件、依赖授权，创建不可变版本并 CAS 更新 currentVersionId；冲突回滚。保存可允许未配置草稿，但 Run 必须重新完整准入。
- 引用固定 ComponentVersion，不跟随 latest；私有引用不得泄露到公开 Build 投影、导出或 Fork。公开发布必须完成依赖可公开性/许可校验，不以脱敏后悄悄换行为。
- Fork 明确选定历史版本、保留来源关系，清除模型/MCP/工具的所有 credential reference，不复制 Grant 或执行秘密。跨用户无权 Fork 的私有内容拒绝；新所有者重新绑定凭据并授权。

### B2 已实现草稿子集（2026-09-07）

- POST builds 使用 `mode: agent` / `agentDefinition` 与既有 title/problemId/visibility/buildId/currentVersionId；缺省 mode 仅兼容 Workflow，未知/混合字段与双向转换拒绝。无 expectedVersionId 别名、客户端摘要、凭据或 Grant API。
- `privateAgentDraft` 只接受 private、全部模型/Profile/输出/环境/runtime 选择为 null、Skill/能力数组为空的定义。B1 能表示引用不等于 B2 允许保存引用。没有组件/Profile 注册与授权服务，默认拒绝，不创建替代注册表。
- BuildVersion 保存 mode、规范化 JSON 定义与服务端摘要；事务内 owner/problem/mode/CAS 检查和不可变追加。历史是显式 metadata DTO；Agent 所选定义仅 owner 可读，没有 workflow 字段。
- GET Agent 必须 `?mode=agent`，可加 `&version=id`；旧客户端得到 409，既有 UI 只显示安全错误，不是 Agent 编辑器。HTTP Fork 同样显式 mode，服务事务内重读源与精确版本并鉴权；新版本 private/revision 1，lineage 保存 sourceVersionId，旧 lineage 保持 null。
- Agent Run / DAG accessor / historical hunt remain denied. Workflow provider resolution and hunt now share pure `classifyProviderLane`: either missing platform price means BYOK, both known (including zero) means Verified; Demo/custom behavior is unchanged. Classification is not authorization. The lane finding is closed after independent focused verification.
- SQL CHECK 约束 mode/payload、private、schema 标记与摘要格式；它不实现完整 B1 校验、摘要重算或依赖授权。完整草稿限制由业务层实施。

## 2. Frozen Run input contract

候选服务端快照：`snapshotSchemaVersion`、`businessRef {kind, id}`、`buildVersionId`、`definitionDigest`、`componentVersionDigests`、`runtimeIdentity {kind, adapterVersion, runtimeVersion, policyVersion}`、`benchmarkIdentity {profileVersionId, seasonId, suiteVersionId, scoringVersionId}`、`trustLane`、`inputRefs[{objectVersion, digest, classification}]`、`grantSetDigest`、`limitsPolicyVersion`、`consentRef`、`snapshotDigest`。自测使用自身不可变样例身份，不伪造竞技 Season/认证身份。

- 竞技 businessRef 指向 Run；自测独立 SelfTestRun；后续平台效果评测沿用 EF 的独立业务类型。一个 Job 只有一种关联，多 Attempt 不等于多次自动付费许可。
- 快照由服务端解析授权版本/输入生成，客户端不能传隐藏 fixture、judge 配置或标准答案。隐藏 Suite 私有引用留在平台，向执行者仅按需投递单个用例输入；judge 预期值不进入 Agent 上下文。
- 创建幂等键按用户/操作作用域绑定摘要；同键同内容返回同业务记录，同键异内容冲突。Job、业务关联、快照和 Outbox 原子提交；查询/重连不创建 Job。
- 快照不含明文秘密或可公开签名 URL；只含 owner-scoped 凭据引用/审计身份，由受控 broker 在调用时核权。冻结身份不冻结永远有效的权限，撤销/凭据删除需在排队出队与受控步骤重查。
- 引用 Profile 是沿用既有 Benchmark Profile，不为 Agent 再发明一套。Profile 未定义 Agent 模式兼容性时禁止比较/提交，不凭 Pi runtime 自行认定兼容。

## 3. Capability grants contract

服务端候选 `grantId`、`subjectId`、`businessRef`、`attemptFence`、`capabilityId/version`、`resourceScope`、`allowedOperations`、`limitsRef`、`expiresAt`、`revocationPolicyVersion`、`grantDigest`；敏感句柄不可序列化到客户端/模型文本。请求能力是意图，Grant 是平台收窄后的授权，未知字段/能力 fail closed。

| 能力 | 最小范围 | 禁止 |
| --- | --- | --- |
| 模型 | 已准入模型/版本、受控出口、用途预算 | 自动发现 Key、任意 base URL、重试绕预算 |
| 沙箱输入 | 本 Attempt 的只读输入卷 | 宿主目录、其他 Run 数据、judge 答案 |
| Python | 固定批准镜像内解释器与显式脚本参数 | 宿主 shell、任意系统命令、隐式依赖安装 |
| 文件输出 | 独立输出卷及文件/总字节配额 | 任意磁盘路径、宿主 socket、跨任务共享可写目录 |
| 未来只读 MCP | 批准服务身份/工具版本、参数/数据范围和受控出站 | 写工具、动态工具自动准入、端点漂移、透传凭据 |

默认拒绝网络；模型/MCP 由 broker 按允许列表调用，保留现有域名/IP/重定向/SSRF 限制。Skill 文本和工具返回都是不可信数据，不能扩展 Grant。撤销时阻止新受控步骤，已发请求不承诺撤回。Skill 首批仅指令/配方，不能 import/安装其依赖或执行其附件。

## 4. Artifact manifest contract

可信 collector 生成（不是 Agent 自报）候选 `manifestVersion`、`businessRef`、`attemptId/fence`、`snapshotDigest`、`outputContractVersion`、`entries[{artifactId, relativePath, mediaType, bytes, sha256, objectVersion, classification}]`、`manifestDigest`、`sealedAt`。对外投影不暴露内部存储键、隐藏文件名或可枚举隐藏 ID。

收集与封存流程：

1. 每 Attempt 独立输入/输出根，输入只读；将输出视作不可信。拒绝绝对路径、`..`、分隔符/编码绕过和规范化冲突，限制路径深度/长度；只允许合同规定的普通文件。不解包归档、不递归跟随链接，拒绝 symlink、hardlink、设备/FIFO/socket。
2. 写入时和收集时都执行文件数、单文件/总字节、磁盘、stdout/stderr、时间配额；扫描本身也有上限。文件扩展名不代表真实内容，校验 MIME/编码/schema；不给巨大 CSV/JSON 无界解析资源。
3. 请求停写并确认全部子进程/写句柄终止，以提供商可验证的不可写快照收集；若无此保证，Gate 不通过。防 TOCTOU：可信侧按根目录句柄相对打开、no-follow、逐段核验文件身份/类型/链接数，固定句柄读/hash/copy，核对前后元数据；任何替换/并发变化拒绝封存，不能仅 realpath 后按原路径再打开。
4. 将已检验的字节复制到平台控制的不可变对象版本，再核验摘要和字节数；通过 Attempt fence 原子登记唯一 manifest。失联旧 Worker 不能封存/覆盖新状态。重试收集只针对已经稳定持久化的字节，不触发模型重跑。
5. 封存后撤去写权限，judge 读取内容寻址的只读副本，验证 manifest/快照/对象摘要绑定。存储版本化或同等不可变性需实测；无法保证封存不变性则未完成，不接受暂存文件为成绩。

下载/预览每次按 Run 所有权、可见性、分类与撤销核权，隐藏产物包括文件名/输入/输出永不通过用户 API 下载。短期、单对象下载授权不可变成永久公开 URL，不以缓存权限或知道 ID 作为准入。安全预览按 [Artifact Arena S3/S4](../artifact-arena/security.md) 增加独立域静态 HTML/CSS、受限 SVG 图片和 Markdown；主站仍仅安全渲染，禁执行作品 JS/MDX/Markdown 内嵌 HTML/远程资源。未通过该 Gate 时回退有界转义文本/表格，不宽松放行；附件使用安全类型、nosniff/attachment、隔离 origin/CSP。CSV 预览/导出防公式执行，展示派生副本不改变 judge 的封存原件。错误、日志、事件及文件元数据沿同一隐藏投影规则脱敏。

## 5. Evaluation result contract

复用 Run 的结果与既有评分服务，不引入新作业领域。候选 `resultSchemaVersion`、`businessRef`、`snapshotDigest`、`manifestDigest`、`benchmarkIdentity`、`trustLane`、`completion`、`artifactValidity`、`judgeVersion`、`metrics`、`usageRefs`、`usageCertainty`、`score`、`submissionEligibility`、`safeSummary`。私有逐用例证据独立存储，不直接序列化此对象给客户端。

| 情形 | 判定 | 成绩/Submission |
| --- | --- | --- |
| 执行与收集完整，但缺 CSV、JSON 错误、报告不满足或内容错误 | artifact invalid / case failed | 按已冻结 Profile 的确定性规则计失败；完整隐藏评测可产生失败成绩，不冒充基础设施故障 |
| 明确选手超出题目规定的资源限制 | 经 Profile 定义归责的 case failure | 仅在整次评测完整且证据充分时按规则评分；未定义归责不能临时判零 |
| Worker/沙箱/存储故障、取消、中断、TOCTOU 无法排除、未知调用状态 | incomplete / infrastructure or uncertainty | score 未最终确定，无 Submission；保留允许汇总，已知/未知费用分别核查 |
| 全部必要结果已持久化，业务提交响应丢失 | 可幂等收尾 | 唯一约束/CAS 创建至多一个 Submission；禁止重新调用模型 |

judge 与 Agent 执行隔离，无 Agent 可写挂载、不运行报告中的代码，不以 Agent 的自评或 sandbox exit 0 代替验收。judge 规则/版本由服务端固定；隐藏答案仅 judge 可见。隐藏输入会到被选模型/沙箱提供商，必须显式同意并受 trust lane 政策约束，不声称 BYOK 供应商看不见输入。

Agent Scoring 需在现有 Benchmark Profile 中固定任务正确性、鲁棒性、安全、资源效率与文件合同；具体权重待冻结，不沿用 DAG 节点数/连线数/短 Prompt 的 Elegance，也不默默改历史 DAG 45/20/15/10/10。排队时间不入效率；执行、模型、工具、沙箱时间分开留证，未知费用不伪造，Benchmark Cost 不等于预算或平台实际支出。榜单 comparator 必须绑定 Profile/Season/Suite/Scoring 及 lane；mode/runtime 是否兼容由 Profile 明示，缺兼容定义默认隔离。自测不产 Submission，不自动获得 Verified。

## 可靠执行与兼容

目标链：Next.js 准入/事务 → EF Outbox/Job → 独立 Worker/Attempt → runtime adapter/能力 broker → 外部隔离沙箱 → collector → 独立 judge → Run/Submission。不是当前运行路径。

执行占用/心跳/fencing、取消确认、调用预占/结算全由 EF 负责。调用前持久化 Invocation 意图；结果不确定时停止自动执行、保留核查状态及审计，不把预占当花费或全部释放。已发生调用后的故障不自动续跑付费步骤或拼接成绩；新重跑需新操作和费用同意。模型前安全恢复与全部结果落库后的幂等收尾是例外边界，不是无限恢复许可。停止沙箱须确认；无法确认则维持待核查占用/状态，不提前声称取消成功。

仅提出 additive 兼容策略：为 BuildVersion 扩展模式定义和引用，为 Run 增补可空快照/manifest/结果关联，复用 EF 表；不分配迁移编号或改已有 checksum。旧 DAG 图、BuildVersion、Run/Submission、Portable 历史全部保留；历史缺失版本/Attempt/manifest 标记 unknown/not recorded，不伪造回填。先双读旧/新合法结构再逐步允许新写，旧客户端遇到 Agent 模式应明确不支持而非解析为 DAG；关闭 feature flag 禁新执行而不删历史。具体列/外键/约束与回滚窗口待联合冻结，迁移须空库/升级/重复/并发/原数据保留及认证验证。

## 2026-09-07 作品协议扩展

以上五契约继续用于 Agent 的授权与证据；[作品集成设计](../artifact-arena/design.md) 明确新增 ArtifactBundle/WorkPublication/ShowcaseEntry、creation EF v2 输入与构建上下文。章节 5 的 Run/Submission 指隐藏竞技结果，并非自由创作/公开投票的通用记录。章节 2 的 Suite 身份仅用于 challenge 分支；creation 不伪造 Suite。沙箱/封存/隐藏投影仍必须满足上述安全条件。B1 定义版本不因外层创建上下文自动改写，已有历史保持可读。
