# AgentForge 开发与 Git 协作指南

本文面向项目维护者和贡献者。AI 编码代理还必须遵循根目录 `AGENTS.md`。

## 1. 环境与启动

以 `package.json` 为工具版本来源：Node.js 最低 **22.16.0**，全栈开发优先与 CI 的 **Node 22** 对齐；包管理器为 **pnpm 10.15.1**。不要混用 npm/yarn 生成额外锁文件。

### 免安装演示

```sh
node --experimental-strip-types portable/server.ts
```

访问 `http://localhost:3000`。这是模拟模型，不产生模型 API 费用；账号和数据保存在 `.data/portable/`。不要同时启动多个进程访问同一数据目录。

### Next.js 全栈开发

先确认 Docker 引擎已经运行，并确认使用的是本地开发数据库：

```sh
corepack enable
pnpm --version                     # 应与 packageManager 一致
pnpm install
pnpm run setup                     # 已有 .env 不会被覆盖
# 检查本地 .env 中的数据库目标；不要将含秘密的内容粘贴到日志/PR

docker compose up -d postgres
pnpm db                            # 建表/更新及种子写入，不是只读检查
pnpm dev
```

如果 Corepack 不可用，先准备与 `packageManager` 一致的 pnpm，不能把某台电脑全局安装的版本当作项目规范。

两种服务器默认都使用 3000 端口，一次启动一种。切换时确认占用端口的进程及其工作目录，不要误杀无关服务。不要把旧解压目录的服务器当作当前 Git checkout 的效果。

完整配置与边界见 `README.md`、`.env.example` 和 `docs/ARCHITECTURE.md`。

## 2. 任务与变更范围

- 一个任务围绕一个明确目标，先写清验收标准和非目标。
- Bug 报告包含复现步骤、期望/实际行为、运行时（portable 或 Next.js）、环境和脱敏日志。
- 新功能说明它影响业务闭环的哪一环，以及是否涉及数据、鉴权、评分或真实模型费用。
- 大范围架构变更先在 `docs/` 写设计：方案、替代方案、边界、数据兼容和验证计划，再实现。
- 避免将依赖升级、全量格式化、重构和业务功能塞进同一个 PR。

## 3. 分支策略

`main` 保持可验证、可启动；使用短生命周期任务分支，不建立无必要的长期 `develop` 分支。

| 前缀 | 用途 | 示例 |
| --- | --- | --- |
| `feat/` | 功能 | `feat/builder-node-search` |
| `fix/` | 缺陷 | `fix/db-existing-account-upgrade` |
| `docs/` | 文档 | `docs/development-guidelines` |
| `refactor/` | 不改变外部行为的重构 | `refactor/run-serialization` |
| `test/` | 测试 | `test/private-prompt-access` |
| `chore/` | 工具、依赖、CI | `chore/pnpm-lockfile` |

工作区干净、且尚未在任务分支上时：

```sh
git status --short --branch
git switch main
git pull --ff-only
git switch -c feat/your-change
```

有未提交修改时先确认归属，不自动 stash、丢弃或搬移。存在用户指定分支时遵循指定分支。

## 4. 提交规范

使用 Conventional Commits 风格，说明可用中文或英文，但应描述目的：

```text
<type>(<scope>): <summary>

fix(db): 为已有 accounts 表补充 issuer 字段
feat(builder): 增加节点搜索
docs(dev): 明确双运行时验证和 Git 协作规范
```

- type 使用 `feat`、`fix`、`docs`、`refactor`、`test`、`chore`、`ci`、`perf` 等。
- scope 指向模块，如 `builder`、`workflow`、`auth`、`db`、`judge`、`scoring`、`portable`。
- 一个提交只做一件可解释的事；不要使用 `update`、`fix stuff` 一类无信息说明。
- 破坏性变化使用 `!` 或 `BREAKING CHANGE:` 并说明迁移办法。
- 提交前使用 `git diff --check` 和 `git diff --cached`，确认未夹带密钥、数据或无关文件。
- 推荐按文件暂存；代理只有在用户明确要求提交/推送时才执行相应步骤。

```sh
git diff --check
git diff
# 将 <file...> 替换成此次任务的具体文件
git add <file...>
git diff --cached
git commit -m "fix(scope): describe the change"
git push -u origin <your-branch>
```

## 5. PR、合并与回退

- 使用仓库 PR 模板，说明范围、验证结果、风险和数据升级步骤。
- 合并前要求相关 CI 全绿，并审阅实际 diff；有失败必须解释并修复，不绕过。
- 推荐 Squash merge 为一个清晰变更；有必要保留独立历史时由维护者决定。
- 合并后删除已完成任务分支；共享分支不要强推。
- 已发布代码回退优先 `git revert <commit>`，仍需验证及正常审阅。
- 数据库回退不等于代码回退：涉及结构或数据变化时单独评估，优先采用兼容性修复。
- 推荐远端保护 `main`：通过 PR 合并、要求实际存在的 CI 检查、禁止强推和删除；团队协作时增加审阅要求。
- **这些是协作约定，不代表 GitHub 已配置对应规则。** 远端配置需维护者另行操作。

## 6. 验证矩阵

| 变更类型 | 最低验证要求 |
| --- | --- |
| 纯文档、模板 | `git diff --check`，路径和命令核对；不要求无意义地重新部署 |
| 引擎、评分、评测、服务 | Node 回归测试、新增针对性用例；依赖可用时 typecheck/build；两个运行时的相关路径 |
| HTTP/API/权限 | 回归测试、授权失败与跨用户访问、敏感字段序列化、目标运行时 smoke |
| React/Builder UI | typecheck/build、真实 Next.js 页面桌面/窄屏交互；不能以 portable UI 测试替代 |
| Portable UI/服务器 | 原生 HTTP 回归、portable smoke、必要时 portable 浏览器测试 |
| 数据库/认证 | 新库、旧库升级、重复迁移、数据保留、注册登录、全栈 smoke、typecheck/build |
| 依赖或 CI | 安装一致性、完整测试、typecheck/build、全栈 CI |

常用命令：

```sh
node --experimental-strip-types --test tests/*.test.ts
pnpm typecheck
pnpm build
# 已在另一终端启动服务器，且目标是可丢弃的开发/测试数据
pnpm test:smoke
```

`pnpm test` 与上面的 Node 测试命令等价。生产构建 smoke 先 `pnpm build`，再另开终端 `pnpm start`。

可选免安装 UI 浏览器检查（需 Python、Playwright 和 Chromium）：

```sh
python scripts/browser-smoke.py --base-url http://127.0.0.1:3000
```

- smoke 会创建账号和 Build，不是只读检查；不得指向生产数据库或服务器。
- 使用 HTTP 桥接时必须注明方式与覆盖范围，不当作原生浏览器网络验证。
- 验证记录写明日期、提交/分支、运行时、命令、结果和未验证项；截图必须来自本次实际页面。
- `docs/VERIFICATION.md` 中历史记录不能自动代表当前分支已通过。

## 7. 数据库与依赖管理的已知边界

当前 `pnpm db` 执行 schema 脚本和 seed；`pnpm db:migrate` 没有版本台账。`db:generate` 生成的 Drizzle 文件不会被该执行器自动应用。

每次结构变更同时维护 SQL 和 Drizzle 定义，并为旧库设计升级路径。`CREATE TABLE IF NOT EXISTS` 不能补字段，例如旧库的 `accounts.issuer` 仍需升级。不要通过删除开发数据来掩盖迁移问题。

仓库当前无 `pnpm-lock.yaml`，CI 使用 `pnpm install --no-frozen-lockfile`，依赖尚未完全锁定。下一次依赖治理应：

1. 使用项目指定 pnpm 生成锁文件。
2. 验证安装、测试、类型检查、构建和数据库/认证集成。
3. 提交锁文件并将 CI 安装改为 `--frozen-lockfile`。

尚无 lint/format 脚本；新增工具需同步 package scripts、CI 和文档，不要只写检查口号。

## 8. 安全与完成检查

- 不提交实际 `.env`、API Key、私钥、数据库导出、`.data/`、构建产物或会话信息。
- 不擅自重建凭据加密密钥；更换密钥可能导致原凭据无法解密，必须设计轮换方案。
- 泄露真实凭据时先撤销/轮换，再处理历史；删除文件或加入 `.gitignore` 不会清除 Git 历史。
- 不在公开 issue/PR 发布完整 Cookie、连接串或含用户私有 Prompt 的日志。
- 安全问题先通过私下渠道通知维护者，不先公开可利用细节。
- 完成时检查闭环兼容、回归用例、文档、数据升级、秘密扫描及未验证项；说明修改是否已提交、是否已推送。
