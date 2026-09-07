# 契约、数据与集成设计

状态：目标设计与当前实现边界。下列新表/API/枚举名仍是工作包接口目标；当前 worktree 已有部分契约、迁移和 fail-closed seam，但新路由/持久化/执行能力不因此可用。T0 冻结类型和 SQL 后才能按 Gate 继续实现，不能依靠 JSON metadata 绕过已有 parser。

## 1. 领域边界

| 对象 | 关联/唯一性 | 规则 |
| --- | --- | --- |
| EnvironmentTemplate / Version | template → 多个不可变 version；version 有 digest | 用户只选择/组合批准模块，不编辑平台权限上限 |
| CreationBriefVersion | owner、指令与附件引用、digest | 自由问题的不可变输入；不是竞技 Suite |
| CreationRun | owner、BuildVersion、BriefVersion、Job | 自由创作证据；不生成竞技 Submission |
| ArtifactBundle | 唯一 Attempt + output slot；snapshotDigest、manifestDigest | 单个 bundle 不混合不同 case、不同分类或 Attempt |
| Artifact | 唯一 bundle + 规范化 path；对象版本、digest、大小、探测类型 | DB 不保存大文件；不保存可任意获取的外部 URL |
| WorkPublication | owner、固定 bundle、公开文件子集/入口、releaseDigest | 每次新作品版本新记录；不得替换已有票指向的字节 |
| ShowcaseEntry | publication、Problem/Profile/Season、lane、comparatorKey | 公开作品参赛；不是现有 Submission |
| Ballot / Vote | voter、pair、policyVersion、entryA/B；每 voter/pair 至多一票 | 配对服务端发放，不能由客户端任意挑作品刷分 |

约束：publication 的文件必须来自同一个完整、非隐藏且有权公开的 bundle；发布经过版权/敏感内容和安全撤销检查。一个作者在同一评选分区首版最多一个 active ShowcaseEntry；换作品退出旧 entry，旧票留审计不转移。不同 owner 的公开复制不能绕过素材许可。

Build 可私有而输出公开，但公开投影不包含私有指令、附件、依赖名称、内部路径、凭据或日志。输出本身可能复述私有输入：自动检查只能辅助，作者需明确选择发布，审核不能被“已脱敏 metadata”替代。

## 2. 与现有 Build / EF 的兼容协议

### 配置版 Agent

- B1 `AgentBuildDefinitionV1` 已能表示引用，先增加服务端权威 resolver 与独立配置准入；不得只删 `privateAgentDraft` 的拒绝条件。
- 原 B2 API 继续接受未配置 private 草稿。沿用实际 `currentVersionId` 作为 CAS 前置条件，不新增 `expectedVersionId` 别名。Run 再核对权限、撤销、摘要和费用同意。
- 凭据绑定在定义之外，按 owner 重新解析；Fork 清空凭据与 Grant；跨用户私有依赖拒绝 Fork。

### 新用途不能假装现有用途

当前 `EvaluationPurpose` 仅 `competitive | author-self-test | component-evaluation`，Association 与 snapshot v1 也有限定；当前 snapshot 要求 Suite 等字段。T6 必须：

1. 增加 `creation` 用途与 `creation-run` association，继续一 Job 一业务关联的数据库约束。
2. 为快照增加版本化判别结构：challenge 分支保留 Suite/Profile 身份；creation 分支使用 BriefVersion 与平台输出政策。保留旧快照/消息的读和执行能力，新消息版本由升级后的消费者明确接受。
3. 不伪造 testSuiteVersionId、不把自由问题塞进 metadata、不冒充组件自测；Q15 的 Author Self-Test 官方凭据政策保持不变。
4. creation 按用户选择的获准 provider/trust lane 和显式费用同意执行，无平台免费赞助默认值；与竞技/自测共享每用户一个执行名额、共享供应商实际配额，新增用途预算而非另建钱包。
5. 当前 Build API 要求 problemId。T6 显式扩展外层构建上下文为 challenge(problemId) / creation(briefVersionId)，只有 agent+creation 可使 problemId 为空；更改 DB CHECK、仓储、序列化、授权与页面。旧 Build 全保留 challenge；旧客户端读新上下文明确不支持，不能将自由问题关联到虚构平台题目。Agent 指令结构无需因此破坏 B1 schema。

T3 先打通真实题目的公开反馈 Run，T6 后才开自由问题。公开反馈仍不自动形成旧 Submission。T8 隐藏竞技沿完整隐藏评测唯一 Submission 规则；T7 社区参赛仅写 ShowcaseEntry。

## 3. 冻结身份与执行

执行快照固定：owner/businessRef、BuildVersion、问题或 BriefVersion、允许输入对象及 digest、组件版本及许可状态、模型身份、环境版本、有效能力集合、输出契约、runtime/adapter/policy、费用同意、预算引用、比较分区。

有效能力 = 用户请求 ∩ 环境上限 ∩ 题目/Profile 政策 ∩ 用户授权。Skill 文本和画布边只能表达请求。运行前与每个受控调用重新检查安全撤销；普通撤回按社区既有合法旧引用政策处理。

```text
Next.js → 准入/冻结 → EF Job + Outbox（同一事务）
 → 公共 Worker/Attempt/fence → Pi Adapter
    ├─ Model Broker → 已有安全 Provider/Gateway → Invocation/usage
    └─ Tool Broker → 每 Attempt 独立沙箱
 → 停写/稳定快照 → collector → 不可变对象 + manifest
 → 独立 judge → 业务结果
    ├─ public feedback / CreationRun → 私有作品 → 发布/ShowcaseEntry
    └─ 完整 hidden Run → 原 Submission（不公开隐藏 bundle）
```

沿用 EF 状态机，不新增另一套 job 状态：accepted/queued/running/cancelling/completed/failed/cancelled/incomplete/unknown/reconciling/expired。Artifact 子状态为 collecting → sealed 或 rejected；只有 sealed 不代表 job 一定完整，发布须同时核查业务完成与 judge/输出政策。

取消由执行者确认；不能确认停止则 unknown/reconciling 并保持需核查占用。发生模型调用后中断不自动恢复执行；全部结果持久化后的收尾可幂等重试。只有未发模型调用或不重复执行的收尾可自动恢复。费用未知与模型质量失败分开，不记零费用。

## 4. 持久化与迁移

候选表：`environment_templates`、`environment_template_versions`、`creation_brief_versions`、`creation_runs`、`artifact_bundles`、`artifacts`、`work_publications`、`showcase_entries`、`showcase_ballots`、`showcase_votes`。共用既有身份、组件、EF 及审计设施，不新增用户/模型/组件注册表。

数据库和服务共同约束：

- FK 指向确切 version/Attempt；artifact 路径唯一，bundle 使用 fence 原子登记，不允许旧 Worker 覆盖。
- publication 内容引用不可变，展示标题/审核状态可变且审计；entry 固定 publication releaseDigest。
- pair 用规范化两个 entry ID 计算唯一身份，ballot 绑定 voter、到期时间、策略版本；重复请求返回同一票结果，不接受同键不同选择。
- 投票/资格变动与排行榜失效事件同事务；清理/撤下不会静默删除审计票。
- 输出对象存储私有，读取通过授权层；存储失败不创建完整 publication。

分批 additive 迁移，不在 spec 预占编号；当前主线 0001–0009 及历史 Pi checksum 不改写。先部署能双读旧/新类型的代码与消费者，再允许新写；未知消息 fail closed 而不是错误 ack 完成。关闭新增功能禁止新提交，仍保留授权历史读取与取消/核查路径。回退前停止新格式写入、排空/核查新作业，不把新记录传给旧消费者。

每个 schema 包同步 `schema.ts`、`schema.sql`、版本迁移、仓储、fixtures、seed（仅目录，无模拟活动），验证空库/旧库/重复/并发/保留与认证。删除、非空改造及存储 GC 另有备份/恢复窗口，不自动清除数据。

## 5. HTTP 与事件目标

复用 `/api/arena` 适配器、Better Auth、统一错误与大小限制。现有路径不无声改变响应；下列新增路径须 T0 结合 `src/server/http.ts` 固定后同步客户端。

| 路径（相对 `/api/arena`） | 输入 / 输出 | 权限/幂等 |
| --- | --- | --- |
| POST `builds`（扩展） | 配置版 Agent + currentVersionId → immutable version | owner/CAS/依赖 resolver；409 冲突 |
| GET `environment-templates` | 可用固定版本与安全能力摘要 | 只返回有权使用模板，不发宿主配置 |
| POST `agent-runs` | BuildVersion、题目版本、provider binding、consent、idempotencyKey → 202 jobId/businessRef | 服务端冻结；用户不可给 judge/expected/Grant |
| GET `evaluation-jobs/:id`；POST `evaluation-jobs/:id/cancel` | 状态/安全事件游标；取消请求 | 当前 `src/server/http.ts` 已有这两个路径，扩展授权投影，不重复建设；取消幂等 |
| GET `artifact-bundles/:id` | 授权 manifest 投影 | 隐藏 bundle 统一不可见，含不存在情况采用同等安全错误 |
| GET `artifacts/:id/content` | 有界读取/下载 | 不收任意 URL/path；每次核权；不返回存储密钥 |
| POST `creation-briefs`；POST `creation-runs` | 私有问题版本/附件引用；执行引用 | T6 后才支持；creation 新契约 |
| POST `work-publications` | bundle、公开文件 ID、入口、发布同意 → pending | owner/完整/非隐藏/许可/敏感内容检查 |
| POST `work-publications/:id/review` | approve/reject/take-down + reason | 服务端管理员角色、审计；作者不能自批 |
| POST `showcase-entries` | publication + challenge/profile/season | 时间窗口、资格、分区；不代写 Submission |
| POST `showcase-ballots`；POST `showcase-votes` | 分区 → 匿名 pair；ballotId + A/B/tie/skip | 服务端配对、禁自投、限频、防重放 |
| GET `showcase-leaderboard` | comparator + cursor → 已满足样本结果 | 只公开安全字段；撤下实时授权优先 |

所有写操作校验 Origin/CSRF 与会话，限制原始请求和递归结构；未授权不反射输入/路径。新 API 用稳定错误码而非 provider 原始异常。分页有上限。

第一版状态轮询支持刷新重连，不等于恢复执行。若提供流，保持 `application/x-ndjson`；事件带 schemaVersion/jobId/sequence/type，按游标重放/去重；日志/事件有总量限制，超限返回安全摘要或游标缺口后拉权威状态，不无限积压。隐藏事件仅状态与汇总，不带文件路径。不得把 Pi 上游 SSE 当成前端协议。

## 6. 画布契约

复用 `src/features/builder/` 的 React Flow/Zustand 基础组件；Workflow 和 Agent 分别校验/编译，不改现有 DAG 连通性/Model 必经规则。Agent 图节点类型：Task、Agent、Model、Skill、Environment、InputMount、Capability、OutputContract；单 Agent，静态配置图无反馈环。

边类型明确为 configures / supplies / grants-request / expects，不解释为 DAG 执行顺序。布局坐标不进入执行 digest；规范化语义（Skill 顺序、能力集合、版本引用）进入 digest。服务端重编译并验证，不能信浏览器“校验通过”。

T5 先固定模板选择与 Agent 配置；T9 才允许子图组合 approved 模块。画布实时显示不兼容、缺权限、有效配额和下一运行所用版本。运行中编辑形成新草稿，不热变更沙箱；进度 overlay/文件刷新不修改配置。Provider grant、秘密和宿主路径不在图 JSON 中。

## 7. 发布、评分与投票 v1

Publication：pending → published/rejected；published → withdrawn/taken-down。撤下立即拒绝新预览/票/参赛，缓存失效；已下载到用户设备的字节无法撤回，披露此限制。首版不允许作者改文件后复用 release ID。

合规结果：确定性输出检查；视觉美感不自动打分。静态网页可加载/文件完整不等于符合“鹈鹕”的语义，语义质量由社区选择；Python 工程轨使用独立 judge，Agent 自述或 exit 0 不算正确。

社区偏好策略 `showcase-pairwise-v1`（实现默认候选，T7 上线前确认）：同 comparator 服务端平衡曝光、随机 A/B 顺序；同一选民对同一 pair 一轮至多一票；A/B 胜方得 1、平局双方 0.5、跳过不计。作品分数为总得分/有效对决数，显示分子/分母与策略版本，不声称统计模型质量或 Elo。至少 20 有效票、10 个独立选民才入正式社区榜，否则显示“样本不足”；按分数、有效票数、entryId 稳定排序。每用户最多 60 次 ballot 请求/小时、30 张有效票/小时，ballot 10 分钟失效；这些不是经流量验证的生产安全阈值。

禁投任一己方作品；投票前的 API 也隐藏作者/模型/热度（作品内署名无法完全技术去识别，不宣称严格双盲）。活动窗口冻结，不允许模型/Skill 作者用题目规则作动员权重。异常票隔离而非静默删除，管理员审计；按原票集合和排除理由可重建结果，榜单带 revision/asOf。撤下 entry 剔除榜单，关联票不再计当前有效得分，历史审计保留。

社区 comparator：题目版本 + Profile/Season + 输出契约/评选策略版本 + 预算档位 + 环境兼容组 + mode/runtime 兼容政策 + trust lane；缺兼容定义默认隔离。自由作品可发布，不进入某挑战榜，除非通过题目准入；不同自由问题不做模型强弱总榜。

效率：只对满足相应功能门槛且证据完整者按同分区排序；未知费用不进“最便宜”排名。展示模型/工具/沙箱执行时间与排队时间分列，排队不计效率。现有 DAG 45/20/15/10/10、rating、奖励不变；T8 Agent 隐藏评分需另冻结 Profile judge/scoring，不能直接套图节点 Elegance。

### AA-T8 最小 hidden Agent judge admission/score boundary

AA-T8 的第一步是一个独立的契约边界，不是生产 judge，也不是把 Agent 作品解释成旧
`Submission`。当前实现位于 `src/server/evaluation/adapters/agent-showcase.ts`，只负责：

1. 严格解析 `pi` runtime、trust lane、BuildVersion、hidden Run/Attempt，并要求 server-owned
   evidence resolver 返回 sealed/completed evidence 的 opaque reference；调用方不能自带 bundle
   id/digest 伪造 hidden 证据。evidence 只携带内部标识和 digest，不提供文件字节、读取 API、
   public bundle、`expected`、`actual`、答案或 trace。
2. 从 server-owned resolver 获取版本化 Profile、Season、Judge、Environment identity 及完整权重。
   adapter 不定义默认 Profile 或默认权重；profile 权重和必须为 1，且不得使用旧 DAG 的
   `accuracy`、`robustness`、`security`、`efficiency`、`elegance` 组件。
3. 仅向独立 `HiddenAgentJudgePort` 传递 admission + opaque evidence ref。该 port 不兼容旧
   `Judge.evaluate(expected, actual, context)`，也不接收任何 public bundle 或答案形状字段。
4. 只接受 judge 返回的有界 Agent-specific component 分数，规范化为独立
   `agent-showcase-score-v1` record；record 的 `legacySubmissionId` 固定为 `null`，不写旧
   `Submission`、rating、reward、Verified 或社区投票统计。

没有 server-owned resolver、approved hidden judge，或 judge 返回不可验证的版本/组件时，边界
统一返回 `503 RUNTIME_UNAVAILABLE`（fail closed）。注入的 fake judge 仅用于契约测试，不能作为
真实模型、生产 judge、排行榜或质量证据。该切片不创建 EF Job、worker、durable score，亦不开放
隐藏评测入口；完整 hidden Run、失败与基础设施中断分类、持久化和榜单属于后续 AA-V9 Gate。

## 8. 邮件与发布准入沿用上位政策

新真实创作/评测/投稿纳入 Q21 的验收后邮件门槛与老用户告知流程；不因新增 API 自动启用邮箱限制，也不免除正式启用后的门槛。Q21 尚未验收时只在明确受邀范围验证，不宣称已完成公开平台的账户安全。受信角色来自服务端，未知角色无审核权限。
