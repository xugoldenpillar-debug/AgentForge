# B2 交付范围与独立审查（2026-09-07）

## 当前实现与审查结论

B2 delivers private unconfigured Agent draft persistence/HTTP/history/CAS/Fork, not Agent UI or execution. Independent review inspected actual service, DTO, HTTP, migration, repository and tests. The identified Workflow lane regression is now fixed and independently verified; no remaining blocking finding was identified within this restricted B2 scope. Reviewer did not change code or shared services.

### 已冻结接口与存储

- POST `/api/arena/builds`：`mode: agent`、`agentDefinition`（B1 v1）；沿用 `title`、`problemId`、`visibility`、`buildId`、`currentVersionId`。缺省 mode 仅指 Workflow；拒绝混合定义、未知字段、客户端 digest、bindings/Grant 与 mode 转换，无 `expectedVersionId` 别名。
- 仅 private；允许空 instructions。模型/Profile/输出/环境/runtime 选择必须全部为 null，Skill/能力必须为空。所有非空引用 fail closed；不以结构校验、hash 或静态目录代替授权。
- GET `/api/arena/builds/:id?mode=agent[&version=id]`：Agent 仅 owner 可读；返回所选版本 definition/digest，不返回 workflow；history 对两种 mode 均仅显式 metadata。缺省 mode 的旧客户端读取 Agent 得到 409 `RUNTIME_POLICY_DENIED`。
- POST `/api/arena/builds/:id/fork`：仅 mode/versionId；HTTP Agent 需显式 `mode: agent`。事务内核对源、精确版本归属及访问，创建 private revision 1，`fork_relations.source_version_id` 保存确切来源。旧 lineage 为 null、不猜历史；Agent 无凭据/Grant 支持，Workflow 仍清除凭据引用。
- `0005_agent_build_drafts.sql` 扩展 build_versions.mode（默认 workflow）/agent_definition/definition_digest 与 source_version_id；0001–0004 未改写。保留节点/边和历史；SQL CHECK 是 payload 一致性/格式约束，不是完整定义验证或依赖授权。重复迁移依赖 checksum 台账跳过，不承诺手动重复执行裸 SQL。
- 保存事务维持 owner/problem/mode/CAS；Drizzle 包装的 serialization/deadlock 错误整事务重试。Agent Run/DAG/hunt 拒绝；不存在 Agent 执行入口。

### Closed finding: Workflow hunt lane mismatch (2026-09-07)

Before the fix, hunt classified every platform provider as Verified, while provider resolution used BYOK if either price was null. This selected the wrong leaderboard. The fix adds `src/lib/ai/provider-lane.ts`; both paths share `classifyProviderLane`, without provider construction or authorization side effects. Either missing price means BYOK; both known, including zero, means Verified. Demo/custom lanes are unchanged.

Historical pre-fix probe: a platform with both prices null requested Verified and returned RESOURCE_NOT_FOUND, with zero provider constructions. This was an in-memory reproduction, not a database or paid-model test.

### 验证事实与边界

Pre-fix worker evidence (`/tmp/b2-*.log`): full 183 passed, Pi 23 passed / 1 skipped, typecheck/build and isolated smoke successful; real migration matrix and overlapping PostgreSQL CAS each 1 passed. These are historical worker results inspected by reviewer, not independently rerun or sufficient by themselves to close the lane finding.

Reviewer independently ran the initial draft suite (8 passed) and the pre-fix in-memory probe. After the fix, reviewer ran `node --experimental-strip-types --test tests/provider-lane.test.ts tests/agent-drafts.test.ts`: 23 passed / 0 failed / 0 skipped (15 lane + 8 drafts). Coverage includes missing input/output/both prices, known nonzero/zero prices, Demo/custom, Run/submission/hunt target consistency and historical Agent rejection before provider construction. No shared database, browser, full build or paid models used.

Final worker rerun logs `/tmp/b2-lane-{related,full,typecheck,pi,build,smoke}.log` were inspected: related 41 passed, full 198 passed, typecheck/build successful, Pi 23 passed / 1 skipped, isolated Next/Auth smoke successful. Reviewer did not independently repeat these full/integration commands. Earlier migration/CAS evidence remains separately attributed.

浏览器为主 worker 回报：Chromium 1440×900 / 390×844，既有 Builder/detail 访问 Agent 显示安全错误，无 React Flow 节点；不是 Agent UI 可用性验收，没有截图证据。Demo 三题 smoke 不代表真实模型正确率。远端 CI 未执行；没有生产/付费操作、提交或推送。

主 worker 留存资源：PostgreSQL 容器 `agentforge-b2-drafts-20260907`、localhost 55447、库 b2_drafts；Next 测试服务 localhost:3317。独立 reviewer 未停止/修改/复用这些服务，也未并发运行构建；最终存活状态以主 worker 回报为准。未改依赖/锁文件或实际环境配置。

### B3 与未来范围

仍缺 Agent 编辑 UI、权威 Component/Profile/输出/环境解析与授权/撤销/公开许可、凭据绑定、可靠 EF Worker、沙箱/artifacts、Agent Run/评分/完整竞技闭环。不要创建新 Profile/组件注册表或把本次验证称为这些能力已验收。

---

## 历史 B2 准备清单（2026-09-06，保留规划上下文）

**以下未勾选项是实现前的完整目标清单，不是当前状态表；已交付子集与待修复项以上文为准。配置引用/公开发布和全 UI 项仍未交付。**

日期：2026-09-06。基于 `feat/pi-runtime-poc` 工作区的只读集成调查；B1 由另一工作包实现。本页是交付边界与待验证清单，不表示代码、迁移、权限或运行 Gate 已通过。

普通代码、文档及已授权的隔离本地验证可以继续，不以本文要求重复授权。真实付费调用、生产操作、服务购买、既有数据删除、权限变更仍需对应明确授权；沙箱供应商、镜像、隔离证据与成本政策另行选型，不阻塞纯 Build 契约工作。

## 1. B1 → B2 契约交接

- [ ] 冻结定义字段、schema 版本、规范化和错误语义；`mode: agent` 与 execution runtime、trust lane 是独立维度。PoC `RunDefinition.kind: pi` 不是持久化 Build，也不是转换器。
- [ ] 仅在明确的兼容入口将旧请求缺省 mode 解释为 Workflow；拒绝未知 mode/schema、混合 DAG/Agent 字段及隐式转换，不生成假节点或空图充当 Agent。
- [ ] 摘要由服务端对通过校验的规范化定义计算；明确对象键序、Skill 顺序、能力集合排序、换行规范化及摘要域/schema。不能直接信任客户端 definitionDigest，定义摘要不等于授权执行快照摘要。
- [ ] 定义仅表达模型/版本、固定组件版本、能力意图、输出/Profile/环境引用及 runtime 选择，不承载秘密或 Grant。结构校验成功不代表引用真实、获准、可公开或可执行。
- [ ] 明确未配置草稿的表示：缺少模型、Profile/输出/环境身份时如何保存；不得凭空生成已批准引用或把缺少凭据等同于完整执行资格。
- [ ] B1 若将凭据绑定排除在定义之外，B2 单独冻结 owner-scoped 绑定的存储、版本/快照关系、DTO 与 Fork 清除规则；不要为绑定悄悄扩展纯定义摘要。
- [ ] helper 保持 Node 原生 `.ts` 导入、无 Next.js/数据库/真实 SDK 依赖。不在 B1/B2 另建 AgentJob、AgentQueue、AgentBudget 或 EvaluationProfile。

## 2. Additive schema 与事务

- [ ] 扩展既有 BuildVersion，存储 mode、schema-versioned Agent 定义及服务端摘要；旧 Workflow 的节点/边/历史不改写。冻结 mode 与 payload 一致性，以及遗留记录的默认解释。
- [ ] 同步 `src/db/schema.ts`、目标 `schema.sql`、版本迁移、共享 Tables、仓储和测试内存表清单。当前迁移已有 `0001`–`0004`；集成前协调新编号，不改已应用 checksum。
- [ ] 保留 `(buildId, revision)` 唯一约束、不可变历史、固定 problemId 和 currentVersionId CAS。当前请求字段是 `currentVersionId`，设计称 `expectedVersionId`；明确兼容映射，不能无声改名。
- [ ] 在同一事务核查 owner、预期版本、依赖授权，写版本/引用并 CAS 更新当前指针；失败回滚全部记录。现有模型凭据检查在事务外，不作为新依赖检查的模板。
- [ ] `builds.currentVersionId` 当前没有 FK，且首次保存先插 Build 后插版本；若增强指针约束，兼顾插入顺序与同 Build 归属，不引入不可满足的循环约束。
- [ ] 处理并发保存的稳定 409 错误；检查 serializable 重试及唯一约束竞争，不能把内存仓储串行事务测试当成 PostgreSQL 并发证明。

## 3. 组件、投影与 Fork

- [ ] 引用解析检查 component/version 归属与权威 digest、读权限、声明式 eligibility、发布状态及公开依赖/许可。现有 buildSkills 仅关联静态 skills，不是 ComponentVersion 使用关系。
- [ ] 依赖固定版本，不跟随 latest。普通 withdrawn/deprecated 阻止新引用、保留合法旧绑定；安全 revoked 阻止执行，历史结果仍可读。冻结新 BuildVersion/Fork 是否属于新增引用的判定。
- [ ] 公开发布必须检查依赖可公开性，不以删掉私有依赖来偷偷改变行为。默认拒绝无法授权的引用；测试适配器不代表真实组件权限系统。
- [ ] **替换原始版本投影**：当前 `build()` 直接返回 version 与全部 history。加入定义后必须显式构造 DTO，防止私有 instructions/refs 经历史、公开详情、列表或导出泄露。
- [ ] 同时核查当前 Build 和所选历史版本 visibility，再独立核查组件访问；owner 的详情与非 owner 的详情不能共用未经裁剪的定义序列化。
- [ ] Fork 指定历史版本，保存确切来源版本身份。当前 forkRelations 仅保存 parent/child Build ID；来源版本需要 additive 方案。
- [ ] Fork 在事务内重新核查源与依赖权限，产生 private revision 1，清除模型/MCP/工具全部 credential bindings，不复制 Grant；新 owner 自行绑定并授权。无权私有内容拒绝，不静默替换依赖。

## 4. HTTP 与旧客户端

| 现有入口 | B2 要求 |
| --- | --- |
| `POST /api/arena/builds` | 判别式严格校验，保留旧 workflow 请求；保存路由复用领域规则。 |
| `GET /api/arena/builds/:id?version=…` | 返回明确 mode、安全的选定版本及 history DTO；验证所选版本属于 Build。 |
| `POST /api/arena/builds/:id/fork`，`{versionId}` | 严格校验历史版本字段；当前 validateBody 按完整路径查 schema，嵌套路由未匹配 builds schema，需要补齐。 |
| `POST /api/arena/runs` | 执行前显式检查持久化 mode；未接入可靠执行的 Agent 返回清楚的不可执行错误，不进入 DAG/provider 路径。 |

- [ ] 保留 auth、Origin/跨站限制、安全错误 envelope、请求 128 KiB 上限，定义容量限制与入口协调。
- [ ] 旧 DAG NDJSON 协议不变；不把 Pi 长请求自测接成新的生产 Agent 执行入口。查询/取消等可靠作业 API 与 EF 联合冻结，不由 B2 猜定。
- [ ] 审计所有读取 workflow 的服务及 UI；旧客户端不能把 Agent 当空 Workflow 编辑/保存/运行。支持模式分流或明确不支持，禁止隐式模式改写。
- [ ] 不仅依赖 HTTP Zod：直接 service 调用也必须经过领域校验，保持测试/其他入口的相同约束。

## 5. 当前缺失的真实依赖

以下是此 checkout 的实现缺口，不是新增库或权限的批准：

- Component/ComponentVersion/Release/UsageReference 表、权威版本解析与授权/撤销服务尚不存在；共享静态 Skill 目录不替代它们。
- EF EvaluationJob/Attempt/Invocation/Outbox、独立可靠 Worker、持久化 SelfTestRun、取消确认/fencing、共享容量与预算预占账本尚未实现。
- package.json 没有 BullMQ/Redis 客户端依赖；不要为了 B2 草稿保存抢建另一套队列或顺带引入它们。
- Benchmark Profile/version、Season/Suite/Scoring 的 Agent 兼容身份尚无对应实现；未定义兼容性前不开放跨模式评分/提交。
- Pi SDK 已在依赖中，但只是 PoC 基础，不意味着沙箱、组件权限、异步执行或 Verified 已可用。
- `pnpm-lock.yaml` 已被此 checkout 跟踪，AGENTS §9 的缺失锁文件说明已过时；本工作包不修改该文件。

**可独立推进**：纯契约、摘要/版本 helper、additive 草稿持久化及安全 HTTP 投影。组件-backed 引用/公开发布需权威组件服务；缺失时明确拒绝，不用伪造目录解锁。Agent 执行依赖 EF 和对应 Profile/准入 Gate；沙箱文件任务还需独立真实隔离验收。

## 6. 后续验收与证据

- [ ] 全新库、旧结构升级、重复迁移、原数据保留；真实并发 CAS/事务回滚；注册与登录。
- [ ] 正常/错误/越权保存，未知 schema、混合定义和双向隐式转换拒绝；legacy DAG 回归。
- [ ] 私有当前/历史版本、原始 history、公开导出不泄露；跨用户 Fork 和全部绑定清除。
- [ ] 伪造组件归属/digest、撤回与安全撤销、公开依赖许可、授权变化竞争。
- [ ] B2 实现后按范围执行相关测试、typecheck/build、隔离 Next.js/auth smoke；同 worktree 不并发写构建目录。
- [ ] UI 集成后真实 Next.js 桌面/窄屏的加载、空、错误、保存冲突与历史选择；不以 HTTP 测试或历史截图代替。

本次仅文档与静态调查，未运行上述 Gate。参考：[Agent 设计](design.md)、[EF 联合边界](../evaluation-foundation/integration.md)、[社区实现边界](../community-component-library/implementation.md)。
