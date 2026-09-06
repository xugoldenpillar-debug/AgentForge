# 社区组件库：开源展示、个人创作、自测与审核上架

- 日期：2026-09-06
- 状态：T0 技术契约已在本文冻结；仓库内解析／公开投影／契约测试切片、T1 内置目录详情与真实浏览器验收、T2 schema／迁移／仓储注册与不可变版本／附件元数据切片，以及 T2 HTTP/API 与服务端权限子项、repository-backed durable 审计表／默认事务写入路径已完成；整体 T0、T2 完整服务／数据 Gate、公共 SDK 发布和产品／法务 Gate 尚未完成
- 分支：`codex/communitycomponentlibrary`
- 基线：`8025d03497f516a91896eb4d1e1fe61454404b74`
- 范围：记录实现设计、T0 证据边界及 T1/T2 部分实现状态；本文和现有技术切片不授权公开导出、仓库可见性变更、生产数据库／权限／部署操作。
- 相关领域术语：根目录 `CONTEXT.md`
- 相关前置计划：`specs/deepseek-verified-gateway/tasks.md`

## 1. 已确认方向与待确认建议

### 用户已确认

1. 现有 Skill／组件库开源展示，界面提供具体实例。
2. 增加用户自行配置和上传的入口。
3. 用户使用自己的官方模型 API 凭据和额度进行自测。
4. 用户提交后，由平台审核，审核通过才公开上架。

5. 长期必须支持用户 Skill 和 MCP 接入，不能把产品永久限定为 JSON 配方；安全审核是必要准入要求，执行能力分阶段交付。
6. 允许通过发布检查、尚未平台效果评测的“社区实验版”，两个状态分开展示。
7. 平台仅人工挑选作品复测，每批单独批准预算，不承诺所有投稿自动复测。
8. 公共库要求作者明确同意公开可复用定义与 Prompt；私有作品可自用，私有测试数据和凭据不随作品公开。
9. 首版可运行类型包括完整工作流配方、纯指令／参考资料型 Skill；带脚本 Skill、MCP 首版只接收申请与审核材料，不承诺可执行。
10. 声明式配方可直接私有自测；带脚本 Skill／MCP 即使私用也必须先取得执行准入，且执行基础设施已就绪。
11. 后续第一批 MCP 执行仅限经过审核的只读能力，仍限制敏感读取和数据外发；不开放发送、删除、支付等写操作。

### 仍未完成或不可视为实施授权

- T0 已冻结首版 recipe／instruction-skill envelope、SKILL.md 元信息子集、`references/` 附件规则、确定性上下文加载和稳定错误码；当前契约解析、公开投影和回归测试切片已完成，整体 T0 Gate 仍未完成。
- D1 allowlist 已确认仅接受 MIT、Apache-2.0、BSD-2-Clause、BSD-3-Clause、ISC；服务端投稿发布检查与公共投影边界均强制执行这组冻结标识；实际许可证文本、NOTICE／署名要求、作者权利链、历史授权和依赖冲突处理仍待产品／法务与发布审查，不能据此视为 T0 法律／权利链审查已闭合。
- D2 已确认 invite-only + fail-closed，当前不开放任何自测额度或真实自测入口；样例／调用／token／时长／队列／并发数值和预算运营安排仍未批准，不得写成产品承诺。
- 后续 MCP／可执行 Skill 的托管、隔离与凭据方案；不作为首版运行功能实施。

“安全审核”不等于允许无限执行权限。扩展类型需分别定义审核对象、运行时权限、版本身份及撤销方式。首版声明式实现需同时覆盖配方与指令型 Skill，不排除未来 Skill／MCP 扩展；尚未定案的契约细节在后续访谈中确认。

## 2. 目标与非目标

目标闭环：

浏览实现与实例 → 从模板创建／导入 → 私有草稿 → 官方 BYOK 自测 → 提交版本 → 审核 → 上架 → 使用／Fork／反馈。

不改变竞技主闭环：Problem → Build → Run → Submit → Score → Leaderboard → Fork。

长期范围包含用户 Skill 与 MCP。当前不默认批准任意代码托管或第三方工具服务器自动接入；首版执行仅包含配方与纯指令／参考资料型 Skill。作者分成、平台补贴任意自测、组件自动取得 Verified 资格不在当前方案内。

“作品投稿”不是竞技 Submission；“平台上架”不是 Verified Run；“作者自测通过”不是组件带来效果提升的证明。

## 3. 当前代码事实与可复用边界

| 已有能力 | 位置 | 本设计如何使用／缺口 |
| --- | --- | --- |
| 6 个内置 Skill、5 个工具目录 | `src/shared/catalog.ts` | 作为平台内置目录，尚无用户组件投稿 CRUD |
| Skill 执行、DAG 与预算规则 | `src/lib/workflow/engine.ts`、`validate.ts` | 复用，不另外实现一套运行器 |
| 有限工具实现及 SDK 暴露 | `src/lib/ai/tools-core.ts`、`sdk-tools.ts` | 用户只能引用允许工具，不能自行注入实现 |
| 不可变 Build 版本、Fork | `src/server/service.ts` | 复用已有快照与凭据清除原则；不要把草稿指针作为投稿内容 |
| 账号隔离的加密凭据 | `src/lib/crypto/credentials.ts`、`src/server/service.ts` | 自测绑定使用者自己的凭据；发布定义不携带凭据引用 |
| 官方 Flash 实际执行 | `src/lib/ai/sdk-provider.ts` | 已跑通 BYOK，但 Official/Custom 凭据权限分离尚未完成 |
| NDJSON Run 与评分 | `src/server/http.ts`、`src/lib/scoring/` | 借用执行能力；不能把私有组件样例塞进竞技隐藏用例或产出榜单 Submission |
| Skill 使用统计 | `ArenaService.skills()` | 现有成功率为关联提交准确率均值，不是组件对照收益 |
| 唯一应用 | Next.js + PostgreSQL | Portable 已退役；DAG/Pi 为执行适配器而非第二套应用 |

目前 `SkillId`／`ToolId` 为内置闭集。用户组件 ID 不应直接塞入内置枚举；用单独的配方／定义层解析为受控工作流。指令型 Skill 需要新增受控的定义解析与配置入口，不能因为现有内置 Skill 可用就宣称动态导入已经支持。若决定支持子流程，必须另行定义端口、嵌套深度和展开后预算，不能假装现有引擎已经支持。

## 4. 产品入口与页面

### 4.1 公共目录与详情

T1 已实现内置目录详情的只读代码切片：全部 6 个 Skill／5 个 Tool 均有安全源码投影、参数／Schema、边界、成本信息和一成功一失败静态示例；详情页明确示例不会调用模型或创建 Run，并分开展示竞技关联统计、作者自测与平台效果评测。真实 Next.js 浏览器验收已完成：桌面 `1280x577`、窄屏 `390x844` 均通过，覆盖 `/workshop?skill=structured`、`/workshop?tool=calculator`、错误态、关键交互和无横向溢出；期间发现的 hydration mismatch 已修复。

- 目录：平台内置／社区作品、适用任务、发布检查／效果证据状态。
- 详情：功能、局限、执行步骤、参数、权限、额外调用、源码与版本。
- 示例：输入、配置、输出；成功和失败示例；明确模拟或真实执行、模型及时间。
- “查看示例”不调用模型；“用我的 Key 试跑”进入确认页。
- 不以安装量、作者自测均值替代组件增益证据。
- 源码视图提供经审核的公开材料，不把任意仓库路径变成文件读取接口。
- 内置组件变更后示例需绑定旧版本或重新生成，不沿用旧结果冒充新结果。

### 4.2 我的组件空间

- 从平台模板／已有 Build 创建；编辑说明、Prompt、Schema 与参数。
- 上传入口导入同一种定义；预览内容、权限和校验错误后才能保存。
- 草稿仅作者可见；测试前冻结快照，修改草稿不改变已有证据。
- 自测结果保留错误、用量、版本和样例集标识。
- 投稿页单独选择可公开示例，并预览将公开的全部内容。

### 4.3 扩展接入申请

- 带脚本 Skill／MCP 提交说明、来源、期望能力、权限和审核材料；首版不运行上传代码，不安装依赖，不自动访问提交的 URL。
- 显示“已收件／材料待补充／审核中／待执行能力支持”等准确状态，不提供假运行按钮。
- 材料审核结论可以保存，但尚无可用执行环境时不能赋予有效执行准入；未来启用前重新核对版本、权限和环境。
- 作者自费不等于执行准入，不允许通过其他上传入口绕过。

### 4.4 审核后台

- 显示不可变提交版本、前次审核差异、自测证据来源、权限与风险。
- 明确通过／驳回原因；修改后重新提交，不覆盖旧审核。
- 首版审核角色由服务端认证角色 allowlist 控制，覆盖 owner／reviewer／admin；作者不可审核自己的作品，客户端不能自行声明或提升角色。
- 敏感管理操作必须服务端鉴权、CSRF／来源控制、审计，不能依赖隐藏菜单；默认审计路径将事件写入 repository-backed durable 表并随服务事务持久化，注入式 audit writer 仅作为测试／扩展 seam。
- 并发审核以版本／状态条件更新，重复请求不能造成重复发布。

## 5. 领域对象与数据设计（建议）

| 对象 | 核心内容 | 不变量 |
| --- | --- | --- |
| Component | 作者、名称、类型、草稿指针、可见性 | 作者归属不可由请求伪造；草稿不等于已发布版本 |
| ComponentVersion | 定义、契约版本、内容摘要、依赖版本、公开材料、许可信息 | 冻结后不可覆盖 |
| ComponentTestSuiteVersion | 作者、样例、期望、可见性、内容摘要 | 作者样例不是平台隐藏基准；默认私有 |
| ComponentTestRun | 定义版本、样例集版本、模型、执行来源、限制、usage、状态 | 服务端产生证据；客户端不能上传分数替代执行 |
| PublicationRequest | 版本、申请人、状态、申请时公开材料 | 与竞技 Submission 分开 |
| PublicationReview | 审核者、结论、原因、证据引用、时间 | 不可改写历史；必须属于该次申请 |
| ComponentRelease | 已批准版本、发布时间、状态、禁用原因 | 只发布已批准的精确版本 |
| ExtensionApplication | 类型、来源、权限声明、材料与审查记录 | 首版不因提交或材料审核通过自动执行 |
| ExecutionAdmission | 扩展版本、执行范围、权限边界、决定者、状态 | 与公开发布分离；后续执行能力就绪后才可生效 |
| UsageReference | BuildVersion 到已发布组件版本／展开摘要的绑定 | 不静默升级；支持风险影响追踪 |

T2 已创建上述 Component、ComponentVersion、Attachment、TestSuite、TestRun、PublicationRequest、PublicationReview、ComponentRelease、ExtensionApplication 和 UsageReference 的 Drizzle schema、目标 SQL、版本迁移与 MemoryRepository 注册。ComponentVersion 保存冻结快照与 definition digest，冻结后不覆盖；Attachment 保存版本绑定的路径、媒体类型、大小、SHA-256 和存储键元数据。HTTP/API 与服务端权限子项已完成：角色从认证上下文解析并受 allowlist 约束，覆盖 owner／reviewer／admin 权限边界、作者自审拒绝、CSRF／来源控制、CAS／期望版本并发保护；审计事件已具备 repository-backed durable 持久化表和默认服务事务写入路径，注入式 audit writer 仅作为测试／扩展 seam；不接受客户端提交角色。完整序列化一致性、旧 Build 无破坏升级的完整服务验证、持久化附件读写、真实数据库 Gate 和完整审核产品流程尚未完成。Q19 已确认：ComponentTestRun（SelfTestRun）保留独立业务记录，关联唯一 EvaluationJob，不复用竞技 runs 存放作者自测。Attempt、Invocation、Outbox、配额和预算由 evaluation-foundation 管理；组件侧不复制执行、评分或调度算法。具体关联约束在联合契约冻结时确定。

数据迁移不把旧 Build 强制标记为用户组件，也不把旧均值回填成平台评测；迁移与旧数据保留的完整真实数据库验证仍待完成。

## 6. 上传、导出与执行契约（T0 已冻结技术形状；仓库内契约解析／投影实现与测试切片已完成）

这里的“已完成”仅指当前仓库的技术实现切片：解析器、公开投影和契约测试已存在并复用既有 DAG 校验语义；它不表示 community surface 已独立、可导出或可发布，也不表示 T0 Gate 已通过。公开发布仍必须经过选定 export manifest、精确 release commit、许可／权利和 source-export audit Gate。

首版只接受 `formatVersion: 1` 的两种定义：`workflow-recipe` 和 `instruction-skill`。导入、预览、保存和导出都使用同一份严格契约；未知字段或未支持能力一律拒绝，不通过“忽略未知字段”获得兼容性。

### 6.1 `workflow-recipe` envelope

允许的顶层字段只有：

```json
{
  "formatVersion": 1,
  "kind": "workflow-recipe",
  "name": "客服分类配方",
  "description": "对输入进行有限标签分类",
  "workflow": { "nodes": [], "edges": [] },
  "dependencies": [],
  "examples": [],
  "license": null,
  "provenance": { "sourceType": "original", "declaration": "作者声明" }
}
```

上例中的空 `workflow` 仅用于展示 envelope，不能保存或执行；可运行版本必须在服务端补齐自测所需的 Provider 身份后，通过现有 `validateWorkflow()` 的节点、边、连通性、环、工具、Schema 和预算边界。recipe 的 `workflow` 使用现有 `Workflow` 形状（`nodes`／`edges`）；节点配置继续按节点类型使用白名单。客户端不得提交 `credentialId`、最终分数、隐藏用例或平台验证标记，执行时由服务端从授权凭据生成固定快照。社区定义不能把任意字符串当作内置 `SkillId`／`ToolId`，只能引用已允许的内置能力。

`dependencies` 是精确快照数组，每项严格包含 `type`、`platformId`、`version` 和 `digest`；`digest` 必须是 SHA-256 内容摘要，不得表示可变远程包、安装命令或运行时自动解析。`examples` 是组件材料，不等同于竞技 TestCase；每项严格包含 `id`、`label`、`input`、`output`、`outcome` 和 `visibility`（`public`／`private`），公开投影只选择作者明确标记为 `public` 且再次显式授权的示例。`license: null` 仅可私有保存，不能提交公开发布申请。`provenance` 严格包含 `sourceType`（`original`／`adapted`／`third-party`）和 `declaration`，保存作者的来源／贡献声明，不代替法律审查。

### 6.2 `instruction-skill` envelope 与 `SKILL.md`

`instruction-skill` 允许的顶层字段只有：`formatVersion`、`kind`、`name`、`description`、`instruction`、`references`、`dependencies`、`examples`、`license`、`provenance`。其中 `instruction` 是不可信的用户指令文本；它不能增加工具、网络、文件系统、代码执行或系统策略权限。

`SKILL.md` 只接受以下元信息子集：

- `name`：必填，作为作者内容保存，不作为系统翻译键。
- `description`：必填，作为作者内容保存，不作为系统翻译键。

正文映射为 `instruction`。除上述元信息外，front matter 的未知键一律拒绝；`scripts`、`assets`、`tools`、`commands`、`install`、`url` 及任意执行／依赖声明均拒绝。首版只接受单个 `SKILL.md`，不接受可执行目录或任意 ZIP 包。

### 6.3 `references/` 附件路径与上下文加载

- 逻辑路径必须是 POSIX 相对路径，并且以 `references/` 开头；拒绝绝对路径、反斜杠、`.`／`..`、宿主路径、符号链接、执行文件和路径规范化后越界。
- 附件必须由作者显式上传并在 `references` 清单中逐项声明 `path`、`mediaType`、`sizeBytes` 和 `sha256` 内容摘要；首版只允许 UTF-8 `text/plain`。
- 加载器只读取当前冻结版本清单中的附件，不递归扫描目录，不根据文件名、正文或远程 URL 发现更多内容；扩展申请中的 URL 仅作材料保存，不自动抓取。
- 按冻结版本中的 `references` 清单顺序加载；清单顺序是契约的一部分，不能依赖文件系统遍历顺序。导入时可用规范化 POSIX 路径做校验和重复检测，但不得在保存后静默重排加载顺序。
- 每份资料都包在“用户提供的参考资料”边界内，不提升为系统指令；正文和资料均视为不可信输入。
- 组装上下文前计算总字节／token／时长等服务端限制；超限直接拒绝，不静默截断、分块、检索、递归加载或回退到网络资源。具体自测数值由 D2 版本化配置批准前保持关闭／fail closed；解析器的结构性上限仅是防御性拒绝边界，不构成自测配额、容量承诺或费用政策。
- T2 当前以 repository-backed `component_attachment_contents` 独立表保存 UTF-8 文本正文（数据库 `octet_length` 上限 256 KiB），与附件元数据在同一事务写入；服务层按 owner 或 active release + public visibility 读取。导入／冻结绑定、公开导出、对象存储和正文 HTTP 路由仍留给后续 T3/T6，不在本切片确定。
- 附件元数据列表不携带正文；读取 body 重新检查所有权及公开选择，缺失正文 fail closed。

### 6.4 安全导入、导出与错误契约

- 读取 body、解析结构、文本、附件数量／字节、节点／边、Schema 深度和上下文预算均分层限制；任一限制缺少配置时拒绝执行。
- 定义文件不得包含 API Key、Cookie、凭据 ID、连接串密码、私有运行记录、隐藏 fixtures 或客户端声称的分数／验证状态；检测到敏感字段或未知字段即拒绝。秘密检测不是权利或安全的绝对保证。
- 导入只生成不执行的预览；保存时服务端重新解析，不信任客户端回传的预览对象。导出由服务端构造公开投影，不直接序列化数据库对象；Fork 清除作者凭据和私有样例。
- 文本默认转义；作者原文与系统 UI 翻译分离，不把作者文本当作翻译键或未经净化的 HTML。

错误继续使用 `AppError`／`safeError()` 的安全投影。现有通用码沿用 `REQUEST_BODY_TOO_LARGE`、`REQUEST_VALIDATION_FAILED`、`INVALID_WORKFLOW`、`OWNERSHIP_FORBIDDEN`、`ACCESS_FORBIDDEN`、`BUDGET_EXCEEDED`、`RATE_LIMITED`。组件库需要在共享错误契约中新增并本地化以下稳定领域码；这些名称是 T0 契约；即使共享错误码已预留，也不代表组件路由、业务状态或统一评测能力已经完成：

- `COMPONENT_DEFINITION_INVALID`：结构、未知字段或 envelope 不合法。
- `COMPONENT_UNSUPPORTED_CAPABILITY`：脚本、远程抓取、MCP、嵌套或其他首版不支持能力。
- `COMPONENT_ATTACHMENT_INVALID`：路径、类型、摘要、符号链接或附件限制不合法。
- `COMPONENT_LICENSE_REQUIRED`：公开流程缺少许可或权利声明。
- `COMPONENT_LICENSE_UNSUPPORTED`：许可不在产品／法务批准的 allowlist 中。
- `COMPONENT_VERSION_CONFLICT`：草稿／冻结版本的乐观并发冲突。
- `SELF_TEST_NOT_ALLOWED`：用户、版本、凭据或执行准入不满足条件。
- `SELF_TEST_QUOTA_EXCEEDED`：服务端版本化额度或共享并发已耗尽。
- `SELF_TEST_CONSENT_REQUIRED`：未确认数据、调用或费用同意。
- `EVALUATION_NOT_READY`：统一 evaluation-foundation 尚未通过执行／费用 Gate。

错误响应只公开稳定 code 和安全消息；不返回原始 Prompt、宿主路径、凭据、模型原始异常或私有附件内容。

### 6.5 公开投影 allow／deny 规则

公开 DTO 由服务端按冻结的 `ComponentVersion` 和作者选择重新构造，不能直接序列化 Component、数据库行或 SelfTestRun。允许公开的字段限于：

- 组件／版本的公开 ID、类型、名称、说明、版本号、内容摘要和发布状态；
- 经过安全投影的 workflow 节点／边、允许公开的指令文本、参数／Schema、模型策略身份和受控成本／边界说明；模型配置不得包含凭据引用或私有端点；
- 作者明确选择公开的成功／失败示例、`references/` 纯文本附件及其大小／类型／摘要；
- 精确依赖版本／摘要、来源／贡献声明、已批准的许可证和必要的 NOTICE／署名信息；
- 发布检查状态及范围受限的作者自测／平台效果评测摘要，且必须标明证据来源、版本、时间和适用范围。

禁止公开的字段和材料包括：

- API Key、Cookie、凭据 ID、base URL、连接串密码、私有 Provider 配置、内部路径和宿主信息；
- 未被作者选择公开的样例、附件、测试套件、自测明细、原始模型回包、日志、EvaluationJob／Attempt／Invocation 标识和队列／预算内部数据；
- 隐藏 fixtures、竞技隐藏 Suite、运行数据、其他用户对象、草稿／未冻结内容及客户端上传的分数、`platformVerified` 或其他未经服务端产生的验证标记；
- 可变远程依赖、脚本／命令／MCP 端点、安装指令和任何能够扩大运行权限的材料。

服务端投稿发布检查与公开投影边界均只接受 D1 冻结 allowlist：MIT、Apache-2.0、BSD-2-Clause、BSD-3-Clause、ISC；任何其他许可证均 fail closed。公开投影缺少许可、来源声明、受支持的发布状态或作者的明确公开选择时，发布流程同样 fail closed；投影入口要求服务端确认非草稿状态，并为示例／`references/` 传入显式选择清单，且只接受标记为 `public` 的示例。发布检查、自测摘要和平台效果评测摘要必须分栏展示，不得合并成“已验证”或组件收益标签。

上述投影实现与测试仍只是仓库内切片。T0 还要求为选定的 export manifest 固定精确 release commit，并在该 commit 上获得 source-export audit `PASS`；当前／历史二进制和 secret-like 命中、禁止路径、私有依赖、根／第一方许可证、贡献者权利及可复现依赖证据都必须逐项闭合。`source-export-inventory.md` 记录的是 draft／audit evidence，不是批准的 release manifest。

## 7. BYOK 自测和效果证据

自测入口的业务顺序是：选择冻结版本 → 选择自己的官方凭据 → 选择允许的样例 → 确认发送内容与服务端预算 → 请求统一评测作业 → 查询结果。该入口只描述组件业务层，不新建一套请求内执行器。

### 7.1 社区组件层职责

1. 验证用户拥有 ComponentVersion、TestSuiteVersion 和凭据引用，并固定定义、依赖、样例、运行时／策略身份、同意版本和请求摘要。
2. 从 Official Registry 选择合法模型；拒绝此入口的 Custom Endpoint，且不能通过普通 Run API 绕过该准入。
3. 在统一创建边界内写入独立 SelfTestRun，并关联唯一 EvaluationJob；客户端不能上传最终分数、usage、平台评测标记或成功声明替代执行。
4. 提供查询／取消的所有权检查和安全结果投影；页面断线不自动重发付费任务。自测结果不写竞技 Submission、声望、排行榜或生产隐藏 Suite。
5. 在 Worker 开始前及后续受控步骤提供版本／组件撤销和凭据有效性检查；失效时阻止实际调用。

### 7.2 evaluation-foundation 职责

evaluation-foundation 负责 EvaluationJob、Attempt／Invocation、Outbox、Worker、幂等、队列与容量、预算预占／结算、取消／超时／中断和不确定上游状态的收敛。它是执行状态和真实 usage 的权威来源；社区层只保存 SelfTestRun 的业务关联和对外允许的汇总，不复制这些基础表或账本。

失败样例不等同于作业失败：完成所有获准样例后，可以生成含失败样例的完成报告；基础设施中断或上游状态不确定时，不伪造完整报告，也不自动以付费重跑解决不确定状态。具体 API／消息版本和原子创建协议以 [跨分支交付](../evaluation-foundation/integration.md) 的联合契约为准，当前文档不宣称它们已经存在。

当前价格未知时 `cost = null`：可报告已有依据的 token／调用／时长限制，不能承诺金额硬上限。任何真实调用仍须等待 evaluation-foundation、容量／费用、Official 凭据、撤销和 D2 配置 Gate。

发布检查、作者自测和平台效果评测是三类独立证据：

| 证据来源 | 产生者 | 可公开内容 | 不得替代 |
| --- | --- | --- | --- |
| 发布检查 | 平台审核／发布流程 | 检查状态、范围和原因 | 作者自测或平台效果评测 |
| 作者自测 | 作者使用自己的授权凭据，经统一评测基础执行 | 版本化摘要、状态、时间和限制 | 平台发布检查或组件收益结论 |
| 平台效果评测 | 平台精选、单独预算批准的对照实验 | 固定范围、样本、失败／中止、usage／成本摘要 | 竞技 Verified 或作者自测 |

作者样例存在选择偏差；平台效果评测如实施，须使用有无组件对照、固定模型／样例集／版本，并记录预算差异、失败和中止情况。任何来源都不能由客户端写入 `platformVerified` 或将单次结果表述为所有任务收益。

## 8. 生命周期和风险处置

草稿与测试：draft → frozen version → test run；修改生成新版本。

投稿与发布：submitted → in_review → approved／rejected／withdrawn；approved 后原子创建 release。

已发布版本：active → deprecated 或 revoked。

- 驳回：原版本保留，作者修改后提交新版本。
- 普通退化：标记／弃用，已有引用不自动升级。
- 严重安全问题：撤销版本的继续执行资格，历史记录保留原因。
- 撤销检查须追踪引用和展开后的快照，不能只在组件详情隐藏按钮。
- 撤销的处置时点建议至少覆盖新运行与后续模型／工具步骤；在途付费请求的取消和已产生费用不保证可逆。
- 工具故障、模型输出错误、工作流错误分别记录；是否影响竞技成绩沿用赛季规则，不能自动改历史成绩。
- 公开副本的撤回不能假定能收回他人已获取的源码；具体产品规则待 Q4 确认。

## 9. 建议 API 与实现边界

以下是候选路由，不是现有 API：

- `GET /api/arena/components`：公开发布目录。
- `GET /api/arena/components/:id/versions/:versionId`：按可见性读冻结版本。
- `POST /api/arena/components`：创建自己的草稿。
- `POST /api/arena/components/import`：严格解析，不执行。
- `POST /api/arena/components/:id/versions`：乐观并发冻结。
- `POST /api/arena/component-tests`：受保护的官方 BYOK 自测。
- `GET /api/arena/component-tests/:id`：仅授权者读结果。
- `POST /api/arena/publication-requests`：提交冻结版本。
- `POST /api/arena/admin/publication-requests/:id/reviews`：审核并记录审计。
- `POST /api/arena/admin/component-releases/:id/revoke`：撤销执行资格。

HTTP 入口放 `src/app/`，业务规则放 `src/server/`，公共契约放 `src/shared/`，数据库实现放 `src/db/`；秘密与私有样例不进入公共目录。

Portable 已退役，不再安排本地导入或 Demo 自测产品功能。唯一 Next.js 应用仅在显式隔离测试模式启用模拟模型；DAG/Pi 能力按服务端准入控制。

## 10. 分阶段实施与 Gate（阶段摘要）

可执行任务清单、PR 依赖和 R1–R15 追踪以 `tasks.md` 为准；本节 P 编号保留早期讨论摘要，不是另一套并行任务。

| PR | 范围 | 前置 | Gate |
| --- | --- | --- | --- |
| P0 | 确认访谈决策、契约与公开边界 | 第 12 节确认 | 没有以建议冒充已确认要求；关键架构决策再写 ADR |
| P1 | 内置目录、源码与实例详情 | P0；公开许可安排明确 | 6 Skill／5 Tool 均有准确边界；模拟／真实示例分开；无自动付费 |
| P2 | 个人草稿、冻结版本、配方／指令型 Skill 导入导出 | P0；版本契约 | 新库／旧库／重复迁移／保留数据；越权、非法上传、秘密投影测试 |
| P3 | 官方 BYOK 组件自测 | P2；evaluation-foundation 执行与费用 Gate；Official 凭据边界 | 真实小样本另行授权；错误、取消、重复请求、无榜单副作用；默认 CI 离线 |
| P4 | 投稿、Admin 审核、发布，以及不可执行扩展的材料申请 | P2；服务端角色／审计 | 不可自审、并发审批、固定版本、私有样例不公开 |
| P5 | Fork 引用、弃用／撤销、反馈 | P4 | 历史版本可追踪；撤销不可绕过；反馈不影响原始证据 |
| P6 | 平台效果评测与推荐 | Q2/Q3 确认；P3/P4 | 有对照证据与费用控制，不授予竞技 Verified |

P1 与 P2 可在契约冻结后分别开发；P4 依赖账号权限基础，不能只做后台 UI。P6 不应在预算和审核含义未确认时成为隐性发布前提。

### 与 Gateway 计划的关系

- 复用 Registry／安全调用；不重写模型网关。
- 依赖 Phase 1 官方凭据边界及 Phase 2 角色／审计的必要子集；本轮已完成社区 HTTP/API 所需的服务端角色 allowlist、repository-backed durable 审计表／默认事务写入和并发保护子集，但不等于 Gateway Phase 2 或真实自测已开放。
- 私有自测不必等待 Verified worker 全部建成，但不得借此开放可信榜单。
- 若平台复测使用平台资金，应先落实自己的预算预留和执行策略，不能直接把作者 Key 当平台测试凭据。

## 11. 验证矩阵与交付要求

### 本轮已完成的验证证据（2026-09-06）

- T1 真实浏览器：桌面 `1280x577` 与窄屏 `390x844` 均完成；验证 `/workshop?skill=structured`、`/workshop?tool=calculator`、错误态、详情交互和无横向溢出；hydration mismatch 已修复。
- T2 HTTP/API 与权限：服务端认证角色 allowlist 已接入；已回归 owner／reviewer／admin 权限边界、作者自审拒绝、CSRF／来源控制、CAS／期望版本并发保护，以及 repository-backed durable 审计表的默认事务写入路径和注入式 audit writer seam；HTTP 错误路径也已回归。客户端不能声明或提升角色。
- T2 附件正文切片：`persistTextAttachment` 服务端重新计算 UTF-8 字节数与 SHA-256，校验冻结版本 `references` 清单，原子写入元数据与正文并默认保持 private；`readTextAttachment` 只返回正文并复用 owner／active release + public attachment 访问检查。当前不提供上传／导入／正文 HTTP 路由，整体 T2 Gate 仍未关闭。
- 工程回归：`pnpm typecheck` 通过；社区聚焦测试 `64 passed, 0 failed`；`git diff --check` 通过。该测试结果仅记录本轮实际聚焦命令，不代表 T0 发布 Gate、完整 T2 数据 Gate 或 T5 已完成。

- 领域：状态转换、不可变版本、依赖快照、禁止自审、重复发布和撤销。
- 安全：伪造 owner、他人凭据、跨用户版本／测试记录、秘密导出、超大上传、未知操作、说明注入。
- 数据：空库、旧库升级、重复迁移、并发、原数据保留；不自动删除测试外数据。
- 执行：mock 官方调用的正常／失败／用量异常／无重试；预算、取消、重复付费防护。
- UI：桌面与 390px 窄屏、加载／空／失败、上传错误、费用确认、审核驳回后修改。
- 真实模型：仅在明确授权范围与费用限制下跑小样本；和普通 CI 分开。
- 迁移与接口必须保留 Demo／BYOK／Verified 边界；公开组件审核不改变竞技判定。

本文件为文档产物：未执行这些未来功能的测试，不将表内 Gate 记为已通过。

## 12. 决策树与访谈记录

根目标已定：开源展示 + 用户创作／上传 + 自费官方模型自测 + 平台审核上架。

### 第 1 轮结论

- Q1：用户明确要求长期支持 Skill／MCP；没有确认首版只做配方，也没有授权立即执行任意代码。
- Q2：接受社区实验版上架，发布检查与效果评测独立。
- Q3：接受平台人工精选、单独批准预算后复测。
- Q4：接受公共作品公开定义与 Prompt，私有数据不随之公开。

### 第 2 轮结论（用户“全按建议”确认）

- Q5 首版交付：已确认先支持配方、纯指令／参考资料型 Skill；带脚本 Skill 和 MCP 先提供投稿／审核入口，不可用时明确显示待支持，审核通过不能误显示为可运行。完整执行能力分后续里程碑。
- Q6 私有试用：已确认声明式配方可直接私有试用；带脚本 Skill／MCP 即使不上架，也须完成执行准入，避免“仅自己用”成为绕过安全控制的入口。
- Q7 MCP 副作用：已确认首批仅接入明确审核的只读工具，暂不开放发送消息、删除数据、支付等写操作；只读也要限制敏感信息读取和外发。

后续决策依赖：

- Q5 → Skill 文件／资源契约、MCP 托管方式、安装依赖边界、输入输出适配、执行隔离和调度。
- Q6/Q7 → 凭据授权、网络范围、数据披露、执行审核证据、运行监控／撤销语义。
- 已确认 Q2/Q3 → 审核材料、容量／响应目标、复测样例和预算机制。
- 已确认 Q4 → 具体许可、来源声明、MCP 服务源码公开边界、Fork／撤回规则。

涉及服务集成时需要区分“公开集成定义”与“第三方服务本身源码”；现有公开定义原则不自动要求用户有权公开第三方服务实现。待具体接入形式确定后再询问。

### 技术设计跟进约束

- 扩展定义按类型区分：配方、指令型 Skill、可执行 Skill、MCP 集成；统一目录不意味着统一执行权限。
- 原有 ComponentVersion／Release 设计须保留执行类型与审核范围；执行准入作为独立领域概念已确认；数据库与接口细节在后续执行能力设计时确定。
- 新能力不直接扩展内置 ToolId 为任意字符串；通过受控适配器映射，权限与预算由平台在外层强制执行。
- 对可变外部服务的审核范围、变更后复审及禁用机制必须明确；一次审核不能代表永久可信。
- 首版范围已按第 2 轮更新；未来执行里程碑尚未批准，不创建沙箱或远程连接。

### 第 3 轮结论（用户“全按建议”确认）

- Q8 Skill 导入：已确认支持单个 `SKILL.md` 与界面编辑；附加参考资料作为显式上传的受限纯文本附件，清单绑定，不自动抓取链接或安装依赖；不支持任意目录／ZIP 执行包。导入格式只接收明确定义的字段子集，不承诺兼容所有工具生态。
- Q9 正常撤回：已确认作者可停止新发现／新引用，但已发布不可变版本保留给已有 Build；严重安全问题由平台撤销执行资格，所有使用者均受限制。普通撤回不修改历史结果。
- Q10 审核角色：已确认首版由现有运营者对应的 Admin 手工审核，不开放社区审核员；禁止自审。平台内置组件以独立维护者发布路径管理，不通过伪装社区投稿规避规则。

Q8–Q10 已确认，下一步确定许可选择、公开授权、审核证据和容量参数。后续 MCP 具体部署与写权限不在本轮首版范围内，不要求现在做架构锁定。

确认共同理解后，才将本文转为批准实施并生成对应任务清单。


## 13. 整包 Skill 的运行方式（高层架构已确认，不是已实现能力）

### 13.1 不是把目录直接发送给模型

Skill 包是指令和资源的交付格式，不是一个自动可执行的程序入口。官方 Agent Skills 格式允许 SKILL.md、scripts、references、assets；客户端负责发现、激活和按需加载，脚本语言支持取决于宿主实现。

资料核对（2026-09-06）：
- Agent Skills Specification：`https://agentskills.io/specification`
- Adding skills support：`https://agentskills.io/client-implementation/adding-skills-support`
- MCP Architecture：`https://modelcontextprotocol.io/docs/learn/architecture`

### 13.2 推荐的平台职责分工

用户已确认以下高层方向；不代表选定供应商、批准未来可执行扩展或部署。

1. Next 控制面：账号、包版本、审核、额度与提交任务，不执行用户脚本。
2. Skill 加载器：根据固定版本加载指令与参考资料；只暴露获准的资源，不递归扫描平台文件。
3. 执行 Worker／Agent Runtime：组织模型上下文、调用模型、接收工具请求、校验与分派、汇总结果。首版复用现有工作流执行和 AI SDK；组件自测及后续长任务的持久化调度由 evaluation-foundation 提供，社区层不另建 Worker 或队列。
4. 模型适配器：通过用户自己的官方凭据调用 Flash 等支持模型；密钥由受控后端使用，不因脚本要求而写入沙箱。
5. 工具层：已有确定性工具、未来获准的脚本入口、未来获准的 MCP 集成。执行前逐次校验权限与预算。
6. 脚本隔离环境：后续执行可执行 Skill 时才需要；按任务隔离文件、进程、资源和网络，不共享平台数据库凭据、Docker socket 或宿主目录。
7. 结果层：校验输出、记录真实用量与失败、评分与持久化；不凭模型声称“执行完成”确认脚本成功。

推荐数据流：BuildVersion → 授权／预算检查 → 固定 Skill 版本 → 指令／资料上下文 → 官方模型 → 受控工具请求 → 真实工具结果 → 模型后续步骤 → 输出验证／评分。

纯指令 Skill 不需要代码沙箱。带脚本 Skill 则需兼容性检查、隔离执行和依赖准备。模型输出的命令只是请求，不是平台必须执行的授权。

### 13.3 整包导入的额外前置条件

- 解包前后限制压缩大小、展开大小、文件数；防路径穿越、符号链接逃逸与压缩炸弹。
- 显式声明受支持的运行时、依赖、工具与网络范围；不支持的环境要求应拒绝或报告不兼容。
- 依赖安装同样可能执行代码，不能在 Web 服务进程或拥有生产密钥的构建环境中进行。
- 包审核固定内容摘要；受控构建产物、依赖与运行时版本也应绑定，不能审核后下载不固定的可变代码。
- 实际隔离方案需要后续威胁模型与选型验证；普通容器不能仅凭“用了 Docker”就视为完整的不可信代码安全边界。
- 不承诺所有为其他 Agent 编写的 Skill 可直接运行：缺少其依赖的宿主工具时，标记不兼容，不静默跳过。

### 13.4 MCP 是另一个工具接入路径

在候选设计中由 Runtime 的 MCP Client 调用获准的 MCP Server 工具。远程服务执行工具逻辑；若未来托管本地子进程型服务，则它也需受控执行环境。MCP 连接能力不等于代码沙箱，也不代替网络／权限审核。

未来 Runtime 不默认采用 Codex／Claude Code CLI。推荐先扩展现有执行引擎与 AI SDK，避免为用户提供的 DeepSeek 凭据再引入另一家模型或 CLI 订阅前提；用户已确认此高层方向；具体接口与隔离方案仍需设计验证。

## 14. 未来厂商 Agent 接入 SDK

用户已提出未来给厂商提供接入 SDK，让 AgentForge 用户测试厂商的 Agent 服务，包括国内厂商。路线图见 `specs/vendor-agent-sdk/roadmap.md`。

该方向与本模块复用版本、授权、审核和执行证据概念，但厂商 Agent 是待测服务，不等于 Skill、MCP 工具或官方模型 Provider。当前仅记录未来扩展，不进入首版 PR，不实现 SDK，不对厂商发起请求，不承诺付费、数据分享或 Verified 认证。厂商服务不因社区作品的开源要求自动被要求公开商业源码；接入材料与服务实现的边界待具体合作时确认。


## 15. 可选 Pi Runtime

用户确认继续按 Pi／pi-mono 的额外运行时方向整理开发文档。保留 DAG，平台拥有权限、预算、凭据、运行身份和证据边界；Pi 不作为脚本沙箱，不要求未来厂商使用 Pi。设计见 `specs/pi-runtime/design.md`，官方核验见 `specs/pi-runtime/upstream-evidence.md`。

ADR 0010 的“不依赖编码 CLI”与嵌入 Pi 核心 SDK 不冲突。确切包版本、模型桥接、隔离与性能必须 PoC 验证；Pi 默认关闭、是否进入首发按 `decisions.md` 的 D3 确认。首版正文中“复用现有引擎”仍成立，不能因为加入 Pi 而绕过 DAG 或共同业务规则。

开发入口：`README.md`；完整需求：`requirements.md`；任务：`tasks.md`；待决策：`decisions.md`。历史访谈用于解释来源，执行时以最新已确认范围和这些合约为准。

## 16. 首版接口与数据库不变量补充（开发草案）

### 16.1 创建与导入

创建草稿的输入只含 kind、name、description 与合法定义；ownerId 从服务端 session 获取。输出为 id、draftRevision 与受控定义，不含任何凭据字段。

导入分两步：解析并返回不执行的预览（kind、发现的能力、附件清单、errors）；用户确认后按同一 Schema 创建自己的草稿。不能因为预览通过就直接信任客户端回传的对象，保存时重复校验。

冻结请求带 expectedDraftRevision；不匹配返回明确版本冲突，禁止覆盖。新 ComponentVersion 包含 definitionDigest；名称、说明、公开示例和许可材料若是审核依据，应随版本固定或绑定独立不可变审查快照。

### 16.2 自测请求

业务关联字段为：componentVersionId、testSuiteVersionId、credentialId、runtimeKind、consentVersion、idempotencyKey；具体数据库列名和 API 类型仍待 T2／联合 T5 实现冻结。

服务器拒绝客户端指定 owner、官方 baseURL、厂商价格、最终分数、platform-evaluated 标记或无限制工具；模型 offering 从合法选择解析，使用者无权扩大默认执行范围。SelfTestRun、EvaluationJob 和 Outbox 按 [跨分支交付](../evaluation-foundation/integration.md) 的统一创建边界关联，不能先各自创建再事后拼接。

成功响应返回 testRunId 和状态／事件入口。completed 的必要条件是实际完成全部获准样例、完成结果保存；部分样例失败可形成完成的测试结果，基础设施中断则形成失败状态，不能把两者混淆。

### 16.3 投稿与审核

投稿仅引用作者拥有的冻结版本与明确公开材料；附带声明绑定该内容摘要。审核请求带 expectedRequestRevision、decision 与 reason，审核者从 session 获取，不接受客户端身份字段。

批准事务内验证：申请仍可审、版本／摘要未变、审核者合格且非作者、公开材料有效、无已存在 release；写入审核与 release 必须原子完成。重试应返回同一个结果而非发布两份。

建议唯一约束：ComponentVersion(componentId, versionNumber)、Release(componentVersionId)、ComponentTestRun(evaluationJobId)；创建幂等统一按 (userId, operation, idempotencyKey) 记录并绑定请求摘要；同幂等键内容不同必须拒绝。实际字段名在 T2 冻结，不以 SQL IF NOT EXISTS 代替旧库升级。

### 16.4 发布可见性与执行资格

release 状态与执行资格不是同一个字段。

- active：满足权限者可发现和新增引用。
- withdrawn／deprecated：不再新增引用；已绑定 Build 的版本读取／执行按既定规则保留。
- revoked：服务端禁止新执行和后续受控步骤；历史结果可读，展示原因。
- 扩展材料审核通过：没有可用执行能力和有效执行准入仍不可运行。

API 不提供“管理员直接改分”路径。评价、举报和审核结论与不可变原始执行记录分离。

### 16.5 附件与受控加载

每个文本附件绑定 owner、componentVersion、大小、类型和内容摘要；引用只能命中该版本清单，不能解析为任意宿主路径。读附件同样检查私有访问权。

首版以第 6.3 节明确选择的附件文本组装上下文，执行前计算容量并拒绝超限，不自动让模型遍历磁盘；首版不提供按需读取工具、检索、分块服务或远程抓取。

这些约束用于指导实现和测试，不代表现有 HTTP 路由已经支持上述字段。


## 17. 后续确认与商业授权问题

用户已确认 D1–D3：投稿明确许可／来源声明、小范围邀请首发与有限自测、Pi 默认关闭且不阻塞 DAG 首版。

D4 已确认：商业保护针对复制整个平台并经营竞争服务，不针对组件与 SDK 的正常商业使用。采用“平台核心私有 + 明确许可的公开组件／示例／SDK”的分层发布方向，具体边界与公开前检查见 [决策记录](./decisions.md#d4项目商业保护边界已确认)。

实施时建立可审查的公开导出清单，禁止包含私有核心、隐藏评测、凭据、生产配置及运行数据；检查发布文件和 Git 历史。公开组件和 SDK 必须能在不获取私有平台源码的情况下使用或接入。投稿的来源声明、许可证和不可变版本一起保存，下载／Fork 保留所需许可说明。

具体 LICENSE、历史贡献权利和商业条款尚待核对；文档不是法律授权。本次未调整仓库可见性、拆仓或公开代码，也不承诺阻止独立实现的竞争产品。

## 18. evaluation-foundation 联合交付契约（2026-09-06）

已确认方向以 [Q1–Q25](../evaluation-foundation/README.md) 为准；分工见 [跨分支交付](../evaluation-foundation/integration.md)。本节不代表接口或数据库已经实现。

- T5 经统一创建流程写入自测记录、EvaluationJob 和 Outbox，调用方不得先私自创建两份任务再事后关联；原子边界在联合接口设计中落实。
- 一次自测固定组件/样例/依赖/运行时/策略/费用同意身份。Worker 执行前及受控步骤调用组件侧授权/撤销检查；凭据只使用作者本人符合官方准入的凭据。
- 返回 202 和 testRunId/jobId；具体路由和类型名待冻结。查询/取消验证所有权；首版轮询，不将请求断开当取消。
- 首版用户跨竞技与自测最多一个执行中作业；用途额度分开但共享用户总占用和上游实际额度。限额由配置和测试确定。
- 部分用例判定不通过不等于任务执行失败：完整执行可以产出含失败样例的报告；基础设施中断则不伪造完整报告，不跨故障续跑拼成绩。
- 自测明细默认 30 天，可提前删除；最小汇总和版本身份保留，清理后明确证据限制，不向公共详情泄露私有样例。清理任务及备份策略须独立实现验收，不执行现有数据删除。
- 邮件验收和启用门槛后，新真实自测/投稿要求邮箱验证；不阻止登录/草稿，不追溯取消已接收任务。
- 上架审核是 Publication Review；T9 为 Platform Component Evaluation，后续另行预算批准，不自动进入 Verified。
