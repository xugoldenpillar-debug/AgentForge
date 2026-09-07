# AgentForge 开发代理规范

本文件适用于整个仓库，是 AI 编码代理的默认工作约定。更深层目录若有 `AGENTS.md`，仅在该目录内补充或覆盖本文件。与用户当前明确要求冲突时，先说明影响再遵循用户要求；安全与平台规则始终优先。

## 1. 项目目标与范围

AgentForge 是以 AI Workflow 为核心的挑战竞技应用，必须保持以下业务闭环：

**Problem → Build → Run → Submit → Score → Leaderboard → Fork**

- 全栈版：Next.js / React / React Flow / Zustand、PostgreSQL / Drizzle、Better Auth、Vercel AI SDK。
- 唯一运行时为 Next.js；开发、测试和正式环境使用同一套应用。Portable 已退役，不再维护。
- 仅 APP_ENV=test 且 DEMO_MODE=true 启用测试模型；普通初始化只补齐业务目录，不生成模拟活动。
- Demo / BYOK / 平台可信模型是不同信任等级，排行榜不得混榜。
- 本项目仍是 MVP。不要将模拟结果、历史截图、HTTP 测试或 CI 构建通过描述为真实模型、真实浏览器或生产安全验收。

## 2. 开始任务前

1. 阅读本文件、`README.md`；按任务查阅 `docs/ARCHITECTURE.md`、`docs/SCORING.md`、`docs/VERIFICATION.md`。
2. 检查 `pwd`、`git status --short --branch`、当前分支和相关 diff，确认操作的是用户指定仓库，而不是旧解压副本。
3. 先找现有类型、服务、组件及测试，尽量扩展现有实现，避免复制一套业务逻辑。
4. 非简单修改先给出短计划：范围、风险、验证方式。需求影响数据、计费或权限且不明确时先澄清。
5. 默认不启动子代理；只有用户或适用指令明确要求委派、并行代理时才使用。
6. 用户未提交的改动必须保留。发现同一文件有冲突性改动时停止覆盖，先说明情况。

## 3. 目录职责与依赖边界

| 路径 | 职责与约束 |
| --- | --- |
| `src/app/` | Next.js 页面和 HTTP 路由；处理入口适配，不复制领域规则 |
| `src/components/` | 共用 UI 和页面组合；禁止直接访问数据库或服务器密钥 |
| `src/features/builder/` | React Flow 编辑器、节点配置和 Zustand 状态 |
| `src/shared/` | 公共类型、错误和安全目录；禁止放秘密、隐藏测试答案和服务端专用依赖 |
| `src/lib/workflow/` | DAG 校验与执行引擎；保持 Node 原生类型剥离运行路径可用 |
| `src/lib/judge/`、`src/lib/scoring/` | 确定性评测、评分、预算计算；修改规则须同步文档和回归测试 |
| `src/lib/ai/` | Provider 接口、Demo、真实模型适配器、受限工具及安全请求 |
| `src/lib/crypto/` | 凭据加密；禁止向客户端或日志输出明文 |
| `src/server/` | 业务服务、验证、序列化、仓储抽象使用及 HTTP 适配 |
| `src/db/` | PostgreSQL / Drizzle schema 和仓储实现 |
| `public/` | 正式应用静态资源；共享主题位于 src/app/ |
| `tests/helpers/` | 内存仓储和模拟活动 fixtures，仅测试使用 |
| `scripts/` | 环境初始化、数据库和验证脚本 |
| `tests/` | Node 原生核心、服务及 HTTP 回归测试 |
| `docs/` | 架构、评分、验证证据；行为变化必须更新对应文档 |

核心逻辑不得反向依赖 Next.js、React、数据库实例或真实 AI SDK。服务端通过适配器注入仓储和模型能力。领域逻辑保持可独立测试，不再维护第二套运行时。

## 4. 编码约定

- 使用 TypeScript strict 模式；新增代码禁止无说明的 `any`、`@ts-ignore` 和吞错式空 `catch`。
- 新增或实质修改代码使用清晰多行表达，默认两空格缩进。不要为格式化顺带重写无关文件。
- 在外部输入边界做校验，并由业务层实施权限和领域约束；不要仅靠按钮隐藏或前端校验保障安全。
- 复用 `src/shared/types.ts` 等已有契约；API、事件或序列化结构变化须同步两端和测试。
- Node 原生执行路径保留可解析的 `.ts` 相对导入，不引入仅靠编译器转换的语法或仅 Next.js 可解析的路径别名。
- 流式运行协议当前为 NDJSON（`application/x-ndjson`），不是 SSE；修改协议需同时修改服务端、客户端和测试。
- React 组件区分服务端与客户端边界；用户文本默认转义，不直接注入未经净化的 HTML。
- 新增依赖需说明用途、现有方案为何不够，以及测试和部署影响；不要顺带升级整个依赖树。
- 非显然的业务限制说明“为什么”；不要添加重复代码含义的注释。

## 5. 不得破坏的业务与安全约束

- DAG 必须真实按依赖执行，保持连通性、无环、必需节点、禁止绕过 Model 及节点/边数限制。
- 保持模型调用、工具、token、费用、延迟及重试预算限制；不得靠取消限制来修测试。
- Demo 不得读取标准答案或隐藏 fixtures 来伪造模型正确率；自动测试默认不得调用付费模型。
- 隐藏测试只返回允许的汇总和进度；包括错误路径在内，不得泄露输入、答案、逐条输出或秘密。
- 保持资源所有权检查、私有 Prompt 保护、不可变 Build 历史、并发保存约束及 Fork 清除凭据引用。
- BYOK 凭据继续使用认证加密和用户隔离；不记录 API Key、密码、Cookie、token、连接串中的密码。
- 不放宽 Provider 域名/IP、重定向及 SSRF 防护；禁止宿主执行用户代码、任意 shell 或未准入执行能力。作品方向仅允许按 `specs/artifact-arena/` Gate 后续实现平台批准的隔离沙箱能力；Skill 上传/画布配置不授予执行权，文档确认不等于启用能力或付费/生产授权。
- 不得删除历史 Portable 数据；数据清理需单独授权。
- `.env.example` 只允许占位值或明确标记的本地演示值。不要提交 `.env*` 实际配置、`.data/`、数据库备份、私钥。
- 真实模型费用、生产部署、生产数据库写入、删除数据及权限变更须取得对应明确授权。

## 6. 数据库变更

- 修改数据结构时同时检查 `src/db/schema.ts`、`src/db/schema.sql`、仓储、种子和 Better Auth schema 映射。
- 当前 `pnpm db:migrate` 按顺序执行 `src/db/migrations/*.sql`，通过 postgres.js `sql.begin`、事务 advisory lock 和 `schema_migrations` checksum 台账保护升级；`src/db/schema.sql` 保持全新库目标结构，不能替代版本迁移。
- 不在池化连接上用普通 `sql.unsafe` 执行手写 `BEGIN/COMMIT`；不要将连接池全局设为单连接来掩盖事务问题。
- `CREATE TABLE IF NOT EXISTS` 不会升级已有表。新增字段必须提供可重复执行的升级语句或明确迁移方案，不能只改建表定义。
- `pnpm db:generate` 输出到 `drizzle/`，当前执行脚本不会自动应用这些产物；禁止声称生成即完成迁移。
- 数据库结构变化至少验证：全新库初始化、旧结构升级、重复执行、原数据保留；涉及认证时还要验证注册/登录。
- 删除字段、重命名、非空约束、大批量回填需说明兼容窗口、备份及恢复方案。不得自动执行删库或 `docker compose down -v`。

## 7. 验证与完成标准

按 `CONTRIBUTING.md` 中的验证矩阵执行。常用命令：

```sh
# 核心与服务回归
node --experimental-strip-types --test tests/*.test.ts

# 全栈依赖安装后
pnpm test
pnpm typecheck
pnpm build

# 在可丢弃的本地测试数据库上；需要 PostgreSQL
pnpm db
# 另一个终端已启动目标服务器后；会写入测试账号和 Build
pnpm test:smoke
```

- Bug 修复尽量添加能复现原问题的回归测试；功能变更覆盖正常路径、错误路径和授权边界。
- UI 变更验证实际目标前端，至少检查桌面和窄屏、关键交互、加载/空/错误状态。
- 浏览器验收必须针对实际 Next.js / React Flow 前端。
- 遇到依赖或本地环境缺口，先按第 7.1 节主动准备；仍被 Docker、网络或权限阻塞时，精确记录实际尝试、未执行项目及原因；不得用 Demo 测试替代真实集成测试。
- 交付说明应包含：变更摘要、文件/行为影响、执行命令与结果、未验证项、数据兼容风险、Git 提交/推送状态。
- 不固定宣称历史测试数量；报告本次命令的实际结果。无实际运行，不写“验证通过”。

## 7.1 依赖安装与 worktree 隔离验证（默认主动执行）

- 缺少任务所需依赖或本地测试环境时，代理应主动补齐并继续验证，不得仅以“未安装依赖”“没有 PostgreSQL”“没有运行中的 Next.js”作为结束理由。此规则授权当前任务必要的项目级依赖安装，以及新建本任务专属、可丢弃的本地测试资源；不授权生产操作、真实费用、既有数据删除或系统级配置变更。
- 安装前检查实际 worktree、Node、`package.json` 的 `packageManager`、锁文件和相关 spec Gate。使用项目指定的包管理器及版本；已有匹配锁文件优先冻结安装。无锁文件时正常安装并检查生成的锁文件；锁文件不匹配须查明原因，不能删除锁文件或盲目关闭冻结检查来掩盖问题。新增依赖仍遵守第 4 节及安装前 Gate，不顺带升级依赖树；锁文件/CI 缺口按第 9 节协调处理。
- 每个 worktree 独立安装依赖、生成构建产物；可以复用包管理器的正常下载缓存，但不复制或软链接其他 worktree 的 `node_modules`、`.next` 或实际 `.env`。同一 worktree 的构建与开发服务不要并发写同一个构建目录。
- PostgreSQL、Redis 和 Next.js 仅按本次验证需要启动。优先使用已有可用运行工具，为本任务新建隔离容器/数据库；先检查端口、Compose 项目名、数据卷和数据库身份。仓库默认端口不能直接当作隔离方案。不得修改、停止或复用其他任务的业务数据库、队列和开发服务；队列前缀只有实现且验证生效后才算隔离。
- 使用项目 setup 流程生成当前 worktree 的本地配置，保留已有密钥且不输出秘密。测试服务使用明确的隔离数据库、`APP_ENV=test`、`DEMO_MODE=true` 和与实际服务地址一致的 `BETTER_AUTH_URL`；不配置真实模型凭据。配置缺失时可生成测试专用值，不索要或借用生产凭据。
- `pnpm test:migrations` 按实际脚本显式设置 `MIGRATION_TEST_DATABASE_URL`，指向本地可丢弃测试服务，账号具备所需建库权限；不得用生产连接或默认 `DATABASE_URL` 代替。允许测试清理它自己新建的临时数据库，不允许删除已有数据库或数据卷。
- `pnpm test:smoke` 前先初始化本任务测试数据库、启动当前 worktree 的真实 Next.js 服务并确认就绪；显式设置 `SMOKE_BASE_URL`，不能默认连接另一个会话占用的 `localhost:3000`。Smoke 会写入测试账号和 Build，必须限制在本任务资源内。
- 按变更范围执行验证：代码任务在依赖就绪后执行相关测试、typecheck/build；数据变更增加真实迁移验证；HTTP/认证/闭环变更增加隔离 smoke。纯文档任务不必安装完整运行环境；Pi 离线 PoC 不必为无关验证启动数据库，但仍须满足其真实 SDK 离线 Gate。
- 若需要安装系统级软件、修改全局 Node/包管理器配置、使用管理员权限、启动付费服务或放宽网络/安全限制，先请求对应授权；不得禁用 TLS 校验或使用未知镜像源绕过安装问题。无法在已授权范围内解决时，报告实际尝试命令、具体失败原因、未验证项和用户所需的最小操作，不用模拟结果替代验收。
- 交付记录依赖/锁文件变更、验证命令与结果，以及本任务资源名称、端口和保留状态，不记录密码、token 或带密码连接串。不擅自清理其他任务资源；新建本地资源也不自动转成生产配置。

## 8. Git 与协作

- 遵循 `CONTRIBUTING.md` 的短分支、原子提交和 PR 规范；默认不在 `main` 直接开发。
- 用户已有任务分支时继续使用；在 `main` 上开始实现前创建 `feat/`、`fix/`、`docs/`、`refactor/`、`test/` 或 `chore/` 短分支。
- 不自动提交、推送、创建 PR、合并或发布；用户明确要求相应操作后才执行。请求“写开发规范”本身不授权这些操作。
- 提交前检查差异和秘密，按文件暂存，避免不加检查地 `git add .`。
- 禁止未经授权使用 `reset --hard`、`clean -fd`、强推、丢弃用户修改或改写已发布历史。
- 不绕过失败 CI，不为通过构建删除测试或降低类型/安全约束。
- 依赖锁文件与 schema 变更属于源码，应跟踪；生成产物、运行数据和秘密不跟踪。

## 9. 当前工程缺口（不是已完成能力）

- 仓库已跟踪 `pnpm-lock.yaml`；使用 `packageManager` 指定的 pnpm，CI 执行 `--frozen-lockfile`。依赖变更必须语义合并清单后重新生成并验证锁文件，禁止删除锁文件绕过冲突。
- 尚未配置 lint/format 命令。版本化迁移已有实现；真实 PostgreSQL Gate 须以本次 `pnpm test:migrations` 结果为准，不得以单元测试替代。
- 旧库的 `accounts.issuer` 由 `0002_accounts_issuer.sql` 以可重复执行的 nullable ADD COLUMN 补齐；升级后仍需验证真实注册/登录。
- GitHub 分支保护是远端设置，本文件和 PR 模板不会自动启用。

新增工程工具时应在同一变更中更新脚本、CI 和文档。解决上述缺口后同步删改本节，避免过期说明。

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
