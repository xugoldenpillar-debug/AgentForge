# AgentForge 界面本地化设计与状态

- **状态**：Next.js / React 基础已实现；完整文案覆盖和浏览器验收仍需随功能持续维护
- **日期**：2026-09-07（设计起始于 2026-09-05）
- **适用范围**：当前 Next.js / React 全栈前端、共享系统内容与常见用户可见错误；Portable 已退役，仅在历史验证文档中保留
- **相关文档**：[领域词汇表](../CONTEXT.md)、[ADR-0001](./adr/0001-shared-client-side-localization.md)、[架构说明](./ARCHITECTURE.md)、[验证说明](./VERIFICATION.md)

## 1. 背景

AgentForge 当前只有 Next.js / React / React Flow / Zustand 应用运行时。Portable 已退役，历史 Portable 前端不再属于实现范围或验收入口。

本地化基础已经在当前应用中落地：共享消息源、语言上下文、`en`/`zh-CN` 选择、首屏语言同步、系统内容映射、结构化错误码映射和 `Intl` 格式化均有代码与单元测试。仍需随页面和功能迭代持续补齐文案覆盖、窄屏布局、错误/空态和可访问性文本。

本设计确保语言切换不会改变 Workflow 行为、评测输入、用户内容或任何持久化领域值。

## 2. 目标

1. Next.js / React 应用提供 `English / 简体中文` 切换。
2. 首次访问根据浏览器语言选择显示语言，之后尊重用户的本机选择。
3. 切换立即生效，不刷新页面、不改变 URL，也不重置当前业务状态。
4. 翻译所有界面文案和 AgentForge 控制的内置系统内容。
5. 用户产生的内容、Prompt、模型输出和稳定领域值保持原文。
6. 常见用户可见服务端错误通过稳定错误码本地化，并保留安全英文回退。
7. 日期和普通数字遵循当前显示语言，费用币种、评分精度和排序语义不变。
8. 中文措辞克制、专业、面向开发者，保留适度竞技感但不采用幼稚或角色扮演式语言。
9. 不为本地化增加不必要的第三方 i18n 依赖；共享消息源保持轻量且可独立测试。

## 3. 非目标

本阶段不包括：

- 繁体中文或除 `en`、`zh-CN` 之外的语言；
- `/zh-CN/...` 形式的多语言 URL 或多语言 SEO；
- 自动翻译用户内容、社区挑战、Prompt、模型响应或测试输入；
- 根据显示语言改写系统 Prompt、评测标准、JSON Schema、枚举值或工具参数；
- 在账号或数据库中同步语言偏好；
- 在线翻译管理后台；
- 完整重构所有服务端错误；
- 将本地化结果描述为真实模型、真实浏览器或生产环境验收。

## 4. 领域边界

### 4.1 Display Language

Display Language 只决定 AgentForge 自己如何展示界面和系统内容。第一阶段支持：

```ts
type DisplayLanguage = 'en' | 'zh-CN';
```

它不属于 Workflow、Build、Run、Submission、Problem 或 User 的领域状态。

### 4.2 System Content

下列内容由 AgentForge 控制，可以本地化：

- 导航、按钮、表单标签、占位符、帮助文字；
- 加载、空、成功、警告和错误状态；
- Builder 面板、节点类型、节点辅助说明和运行控制台界面；
- 内置 Challenge 的名称、说明、任务、价值说明和分类显示名；
- 内置 Skill、Tool、Badge 的名称和说明；
- 排行榜表头、信任等级说明、评测分类和失败类型的显示名；
- 可访问性名称、`title` 和其他只服务于界面的文本。

### 4.3 Builder Content

下列内容按原文展示，不自动翻译：

- 用户名、Build 标题和用户自定义节点标签；
- Prompt、模板和 Workflow 中持久化的字符串；
- 用户创建的 Challenge 内容；
- Provider 名称、模型 ID 和用户填写的连接信息；
- 测试输入、模型输出、运行 Trace 中来自 Workflow 的标签；
- 用户提交的失败案例和原因。

### 4.4 Canonical Value

以下值不能因 Display Language 改变：

- `billing`、`bug`、`account`、`refund`、`other` 等评测枚举；
- `demo`、`byok`、`verified` 等信任等级；
- Challenge、Skill、Tool、Badge、Build、Version、Run 等稳定 ID；
- JSON 属性名、Schema、模板变量和协议字段；
- 模型 ID、费用币种和排序依据；
- Workflow 节点 `kind`、配置和边关系。

界面可以把 `refund` 显示为“退款”，但存储、提交和评测仍使用 `refund`。

## 5. 产品语言规范

中文翻译以准确、简洁、自然为优先，不追求逐字对应。安全、权限、预算和费用说明必须保持原意，不得为了语气弱化风险。

推荐术语：

| 英文 | 简体中文 |
| --- | --- |
| Arena | 挑战中心 |
| Challenges | 挑战 |
| Leaderboards | 排行榜 |
| Workshop | 组件库 |
| World Boss | 高难挑战 |
| Failure Hunter | 失败案例 |
| Forge / Builder page | 智能体工作台 |
| Build an agent | 构建智能体 |
| Builder（用户） | 开发者 |
| Build（名词） | 构建版本 |
| Build title | 版本名称 |
| Build history | 版本历史 |
| Fork / Remix | 复刻并修改 |
| Skill | 能力 |
| Tool | 工具 |
| Loadout | 已选能力 |
| Season | 赛季 |
| Badge | 徽章 |
| Run Public Tests | 运行公开测试 |
| Submit | 提交评测 |
| Build AI. Beat problems. | 构建智能体，解决真实问题。 |

避免使用“锻造师”“军械库”“世界首领”“终极试炼”“荣耀榜”等过度游戏化表达。`AgentForge`、模型名、代码、Prompt 和技术标识保持原文。

## 6. 语言选择和持久化

### 6.1 优先级

语言解析顺序固定为：

1. 合法的本机显式选择；
2. 浏览器语言；
3. 英文回退。

建议使用固定键：

```text
agentforge.display-language
```

只接受精确值 `en` 和 `zh-CN`，其他值视为无效。浏览器语言以 `zh` 开头时第一阶段统一映射到 `zh-CN`；其他语言映射到 `en`。

### 6.2 存储边界

语言偏好只保存在 `localStorage`：

- 不写入用户表；
- 不通过认证同步；
- 不增加 Cookie；
- 不作为 API 请求的业务参数；
- 同一账号在不同浏览器可以有不同选择；
- 登出不清除语言偏好。

### 6.3 首屏初始化

新增一个无依赖、同源的 locale bootstrap 脚本，在主应用前运行。它只执行语言解析，并设置：

```html
<html lang="zh-CN" data-display-language="zh-CN">
```

或：

```html
<html lang="en" data-display-language="en">
```

脚本不得访问身份、Workflow、Provider 或其他业务数据。读取 `localStorage` 失败时回退英文。初始 HTML 占位改为中性的 AgentForge 标识和 spinner，不显示依赖语言的句子，避免 hydration 前闪过英文。

## 7. 技术设计

### 7.1 总体结构

采用“共享消息源 + React 适配器”，不再维护 Portable 适配器：

```text
src/shared/i18n/
├── messages.ts          # 英文与简体中文消息；唯一消息源
├── system-content.ts    # 按稳定 ID 本地化内置实体
└── types.ts             # DisplayLanguage、MessageKey 等公共类型

src/lib/i18n/
├── locale-provider.tsx  # React Context 和本机偏好
├── translate.ts         # t()、回退和插值
└── format.ts            # number/date/percent 格式化
```

消息只有一个权威来源；组件不得为同一文案手写第二套中文词典。

### 7.2 消息词典

使用稳定的语义键，而不是英文句子作为键：

```ts
const en = {
  'navigation.arena': 'Arena',
  'navigation.challenges': 'Challenges',
  'builder.save': 'Save version',
  'errors.buildVersionConflict':
    'This build changed in another tab. Reload before saving.'
} as const;
```

简体中文词典必须满足完整的英文键集合：

```ts
const zhCN = {
  'navigation.arena': '挑战中心',
  // ...
} satisfies Record<keyof typeof en, string>;
```

实际值应使用中文；上例只展示 TypeScript 约束。消息中禁止包含 HTML。需要图标、链接、强调或换行时由组件组合，不能把可执行标记放进词典。

### 7.3 插值和复数

允许受控命名插值：

```ts
t('runs.completedCases', { completed, total });
```

规则：

- 模板占位符必须在调用时完整提供；
- 测试环境中缺少参数直接失败；
- React 组件把插值结果放入 DOM 时仍须使用框架默认转义；
- 不把用户文本拼成翻译键；
- 英文需要单复数时使用明确的 `one` / `other` 键并由 `Intl.PluralRules` 选择，中文可以让两个键使用相同句式。

### 7.4 React 适配器

`LocaleProvider` 位于 `ArenaApp` 的业务 Provider 外层或相邻位置，向组件提供：

```ts
interface LocaleContextValue {
  language: DisplayLanguage;
  setLanguage(language: DisplayLanguage): void;
  t(key: MessageKey, params?: MessageParams): string;
  formatNumber(value: number): string;
  formatDate(value: string | Date): string;
}
```

语言状态不得进入 Builder Zustand store。组件切换语言只触发界面重新渲染，不重新创建 Workflow、请求数据或重置页面状态。

`src/app/layout.tsx` 保留可预测的服务端默认值，客户端 bootstrap 和 Provider 在浏览器中同步真实 `lang`。`src/app/error.tsx`、Suspense fallback 和公共加载组件也必须进入本地化范围，或使用无语言占位。

### 7.5 当前实现边界

Next.js 的 `LocaleProvider`、首屏 bootstrap、语言开关、系统内容映射、错误码翻译和格式化工具已经接入。语言状态不进入 Builder Zustand store，切换只触发界面重新渲染，不创建版本、不改变 Workflow、不取消运行。

Portable 已退役；不得新增 Portable 入口、词典、启动命令或将历史 Portable 检查描述为当前验收。

### 7.6 内置系统内容

服务端继续返回稳定 ID 和现有英文内容作为回退。客户端只对已知内置 ID 应用本地化覆盖：

```ts
localizeProblem(problem, language)
localizeSkill(skill, language)
localizeTool(tool, language)
localizeBadge(badge, language)
```

规则：

- 内置实体通过稳定 ID 查词典；
- 找不到翻译时保留服务端英文；
- 用户创建的 Challenge 不做本地化覆盖；
- 不修改数据库 schema；
- 不把翻译后的名称写回 Build、Workflow 或其他记录；
- 搜索内置 Challenge 时，可同时匹配当前语言显示值和服务端原值，保证用户输入中文或英文都能找到内置内容；
- 标签和分类可以显示翻译，但筛选和判断必须继续使用 Canonical Value。

### 7.7 Workflow 和 Builder

第一阶段不翻译任何会持久化进 Workflow 的字符串，包括默认 Workflow 的节点标签和系统 Prompt。

可以翻译：

- 节点类型 `Input / Prompt / Model / Skill / Tool / Validator / Output` 的界面名称；
- 节点配置面板标签；
- 画布操作、工具提示、空状态和运行控制台外壳；
- `Output contract`、`tokens (est.)` 等由组件实时生成且不持久化的辅助说明。

保持原文：

- `Challenge input`、`Mission instructions`、`Agent engine` 等已存节点标签；
- Prompt 和 `{{input}}`；
- Schema、枚举、工具配置和模型 ID；
- Trace 中由 Workflow 节点提供的 `label`。

切换语言不能制造未保存改动，也不能创建新的 Build Version。

### 7.8 服务端错误

用户可见错误逐步迁移为：

```json
{
  "error": {
    "code": "BUILD_VERSION_CONFLICT",
    "message": "This build changed in another tab. Reload before saving."
  }
}
```

其中：

- `code` 是稳定 Canonical Value；
- `message` 是经过清理的安全英文回退；
- 客户端优先按 `code` 查本地翻译；
- 未知错误显示安全英文回退；
- 旧的字符串 `error` 在迁移期继续兼容；
- 不把原始 Provider 错误、异常堆栈或秘密送入翻译系统。

优先覆盖：

- 登录、注册和限流；
- Challenge / Build / Version 不存在；
- 所有权和访问拒绝；
- 并发保存冲突；
- Workflow 校验；
- 运行、提交和预算错误；
- Provider 配置与安全网络策略；
- 请求体和表单校验。

纯启动错误、终端诊断和仅供开发者查看的底层异常第一阶段可以保持英文。

## 8. 界面设计

### 8.1 Header 开关

在 Next.js/React 公共 Header 中增加分段语言开关：

```text
[ EN | 简中 ]
```

位置：Season 标签之后、Provider/账户操作之前。未登录页面和登录页也显示同一个公共开关，不在表单里重复放置。

无障碍要求：

- 控件组名称为当前语言下的“语言”或 `Language`；
- 两个选项的 accessible name 分别为 `English` 和 `简体中文`；
- 当前选项使用 `aria-pressed="true"` 或等效单选语义；
- 键盘可以访问，焦点样式清晰；
- 切换后焦点保留在操作按钮；
- 不使用国旗代表语言。

### 8.2 窄屏

在 390px 宽度下：

- 优先隐藏 Season 标签；
- 语言开关可以视觉缩写为 `EN | 中`，accessible name 仍完整；
- 不允许整个页面产生横向滚动；
- Builder 自身已有的内部宽画布或工具栏滚动不能扩散成页面级溢出；
- 中文按钮允许自然扩展或换行，不能依赖英文固定宽度。

### 8.3 文档语言属性

每次切换都同步更新：

```ts
document.documentElement.lang = language;
document.documentElement.dataset.displayLanguage = language;
```

这用于屏幕阅读器、浏览器语言工具和后续语言相关样式，不用于业务判断。

## 9. 日期、数字和费用

使用 `Intl`，不再在组件中散落固定 `en-US` / `en-GB`：

| 类型 | `en` | `zh-CN` |
| --- | --- | --- |
| 日期 | `Sep 5, 2026` | `2026年9月5日` |
| 普通数字 | `1,234` | `1,234` |
| 百分比 | 保持现有精度 | 保持现有精度 |
| 时长 | `320 ms`, `1.25 s` | `320 毫秒`, `1.25 秒` |
| token | 保持产品术语 | 保持产品术语 |
| 美元费用 | 保持美元语义 | 保持美元语义 |

格式化结果只用于展示。排行榜排序、预算比较和评分计算继续使用原始数值。

## 10. 缺失翻译和回退

回退链固定为：

```text
当前语言消息 → 英文消息 → 安全的缺失消息处理
```

环境行为：

- 生产：缺失中文时显示英文，不显示空白或调试键；
- 开发：控制台报告缺失键和调用位置；
- 测试：中英文键集合不一致、插值参数缺失或未知键时失败；
- 系统内容：缺少 ID 对应翻译时保留服务端内容；
- 服务端错误：缺少错误码翻译时显示安全英文 `message`。

## 11. 当前实现与剩余工作

已实现的主要入口：

| 路径 | 当前状态 |
| --- | --- |
| `src/shared/i18n/*` | 共享语言类型、消息、系统内容、回退和格式化已实现 |
| `src/lib/i18n/*` | React Provider、翻译与格式化适配已实现 |
| `src/app/layout.tsx` | 首屏 locale bootstrap 和 `lang` 同步已接入 |
| `src/components/common.tsx`、`src/components/arena-app.tsx` | 公共导航、页面状态和系统内容已接入主要翻译路径 |
| `src/features/builder/*` | Builder 界面本地化基础已接入；Workflow 持久化字符串保持原文 |
| `src/shared/errors.ts`、`src/lib/client-api.ts` | 稳定错误码与安全英文 fallback 已有兼容路径 |
| `tests/i18n.test.ts`、相关 runtime 测试 | 语言选择、回退、插值、格式化和错误映射已有回归覆盖 |

剩余工作包括：逐页检查新增/旧页面的硬编码文本、补齐所有加载/成功/错误/空态/帮助/提示/可访问性文本、核对中文窄屏布局，并在每次功能交付时同步中英文 key/fallback 和测试。完整支持声明仍需真实 Next.js 浏览器检查与当前证据记录。

## 12. 实施与维护顺序

### 阶段 1：基础设施（已实现基础）

1. 维护 `DisplayLanguage`、消息键和英文基准词典；
2. 维护简体中文词典并保持键集合一致；
3. 维护 locale 解析、持久化、翻译、插值和格式化；
4. 维护首屏 bootstrap、`<html lang>` 和语言开关。

### 阶段 2：页面与组件持续迁移

1. 公共组件、首页、挑战、排行榜、组件库、Provider、Profile、Build 详情和认证；
2. Builder 与 React Flow 辅助界面；
3. 内置系统内容、日期/数字/费用和可访问性文本；
4. 每个新功能同时完成英文与简体中文，禁止留下单语言半成品。

### 阶段 3：错误码与回退持续维护

按高频用户路径逐步补齐稳定错误 code，同时保持旧响应兼容。不得为了翻译一次性重写领域错误或改变 HTTP 状态码。

### 阶段 4：验证和文档

执行自动测试、Next.js 浏览器检查、构建检查和人工 UI 检查，并更新真实执行证据。未实际执行的项目必须明确标记为未验证。

## 13. 验证计划

### 13.1 依赖无关自动测试

新增测试应至少覆盖：

- `en` 和 `zh-CN` 词典键完全一致；
- 非法 localStorage 值回退；
- `zh-CN`、`zh-SG`、`zh-Hans` 和其他 `zh-*` 首次映射到 `zh-CN`；
- 非中文浏览器回退英文；
- 显式选择优先于浏览器语言；
- 翻译缺失回退英文；
- 插值参数校验；
- 日期和数字使用正确 locale；
- 系统内容仅覆盖已知内置 ID；
- 用户创建内容保持原文；
- Canonical Value 不被翻译；
- 结构化错误和旧字符串错误都可被客户端解析。

目标命令：

```sh
node --experimental-strip-types --test tests/*.test.ts
```

### 13.2 Next.js 浏览器检查

在真实 Next.js/React 前端检查：

1. 首次中文浏览器显示简体中文；
2. 切换为英文后立即更新并在刷新后保持，再切回简体中文；
3. 导航、首页、挑战详情、排行榜、组件库、登录、Providers 和 Builder 的主要系统文案均有中英文；
4. 内置 Challenge、Skill、Tool 和 Badge 根据稳定 ID 显示中文；
5. 用户填写的 Build 标题、Prompt、节点标签、模型输出和 Workflow 文本保持原文；
6. Builder 有未保存修改时切换语言，dirty 状态和 Workflow 数据不变；
7. 运行期间切换不取消请求或清空结果；
8. 桌面和窄屏没有页面级横向溢出，焦点、`aria-label`、`title` 和状态提示可用；
9. 无未捕获浏览器 JavaScript 错误。

Portable 浏览器检查不再作为当前验收；如需引用，必须链接对应的退役历史记录并注明不代表当前 Next.js。

### 13.3 全栈检查

依赖可用时执行：

```sh
pnpm test
pnpm typecheck
pnpm build
```

React 前端还需要在正常浏览器中人工检查桌面和窄屏关键路径；单元测试、历史截图或 HTTP 检查不能替代这一验收。

## 14. 验收标准

只有满足以下条件，才可以声明“AgentForge 支持简体中文”：

- Next.js/React 前端提供可访问的语言开关；
- 选择会持久化，刷新后保持；
- `<html lang>` 与当前语言同步；
- 所有主导航和核心业务路径均已本地化；
- 内置挑战、能力、工具和徽章能够中文显示；
- 用户内容和 Workflow 语义保持不变；
- 切换语言不改变 dirty 状态、不创建版本、不取消运行；
- 高频用户错误可中文显示，未知错误安全回退英文；
- 中英文消息键通过一致性测试；
- 390px 中文界面没有新增页面级横向溢出；
- 已实际执行的验证结果被准确记录，未执行项没有被描述为通过。

## 15. 风险与控制

### 翻译覆盖面较大

React 页面仍可能存在遗漏的硬编码字符串。应按页面分批迁移，但同一功能交付必须同时补齐 English、简体中文、状态/错误/空态、可访问性文本和测试，避免形成单语言半成品。

### 持久化字符串边界混淆

如果把 Workflow 标签或 Prompt 当作普通界面文案翻译，可能产生未保存修改或改变模型行为。实现时必须把 Workflow 数据视为 Builder Content。

### 结构化错误迁移范围扩大

错误码应兼容式、渐进式引入，不改变既有 HTTP 状态码和安全清理逻辑。不能为了中文化重写整个错误系统。

### 中文文案影响布局

不能只做字符串替换。Header、表格、按钮、Builder 工具栏和移动端必须单独检查溢出、换行、焦点和可读性。

### 产品语气失真

翻译评审应重点检查是否准确、自然、克制。遇到竞技隐喻时优先解释功能，不机械直译，不额外创造游戏叙事。

## 16. 决策摘要

- 当前只支持 Next.js / React；Portable 已退役，仅保留历史证据；
- 支持 `en` 与 `zh-CN`；
- 使用本机偏好，不修改 URL；
- 首次按浏览器语言选择，之后尊重显式选择；
- 共享内部词典，不引入第三方 i18n 依赖；
- 界面和内置系统内容可翻译，用户内容保持原文；
- Workflow、Prompt 和 Canonical Value 不随语言变化；
- 客户端通过稳定错误码本地化常见错误；
- 日期和普通数字跟随 locale，业务数值语义不变；
- 中文采用克制、专业、面向开发者的表达；
- 只有核心页面、状态、错误、空态、帮助/提示、可访问性文本和中英文 key/fallback 测试都同步后，才声明功能完成。
