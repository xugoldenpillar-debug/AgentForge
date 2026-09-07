> 2026-09-07 状态注：下文为 2026-09-06 导出审计快照；当前 lockfile、Pi 依赖和提交状态不自动完成导出/许可审计。

# 社区组件库源代码与公开导出清单（草案）

状态日期：2026-09-07。本文是 T0 的审计证据与待审清单及公开发布清单草案，不是批准的 release manifest、仓库开源声明、许可证授予或法律意见。它只描述仓库中可观察到的来源、贡献、历史和依赖证据；公开仓库、公开产物、拆仓和推送仍需单独授权。

## 1. 审计结论

当前结论：**REVIEW_REQUIRED，不得公开导出**。

D1/D2 的产品决策已确认，但以下技术／法律／发布事项仍未闭合：

- community contract 基础实现已进入可审计的提交历史，但尚未形成独立公开 release manifest 或完成发布审计；
- `src/lib/community/` 的公开契约代码已经抽取到最小的中性 workflow／错误模块，当前自动检查的 public dependency blocker 为 0；独立导出包、权利链和发布审计仍未完成；
- 仓库中存在必须明确排除的隐藏 fixture、评测、凭据、数据库和运营代码；这些路径不应从整仓导出；
- 仓库没有根目录 `LICENSE`，第一方代码的复用条款不能由本清单推定；
- 仓库已提交 `pnpm-lock.yaml`；公开导出仍需自己的可复现依赖清单和精确 release commit，仓库锁文件本身不等于公开发布 Gate 已通过；
- 直接依赖的许可证和来源只是安装包元数据证据，未完成完整传递依赖、NOTICE、贡献者权利和法务审查；
- D1 allowlist 已按产品决策确认：`MIT`、`Apache-2.0`、`BSD-2-Clause`、`BSD-3-Clause`、`ISC`；实际许可证文本、NOTICE／署名、权利链、来源／历史授权及依赖冲突处理仍待审查。D2 已确认 invite-only + fail-closed，当前不开放自测额度，未来额度数值仍为 pending。
- 当前没有获批准的 export manifest，也没有在精确 release commit 上得到 audit `PASS`；`REVIEW_REQUIRED`、扫描机制完成或工作区检查结果都不能替代该 Gate。

可重复检查：

```sh
pnpm audit:community-export
# 机器可读输出（仍以非零退出表示 REVIEW_REQUIRED）：
pnpm exec node scripts/audit-community-export.mjs --json
```

审计脚本只输出路径、包名、模式 ID 和稳定原因，不输出 Prompt、密钥、Cookie、连接串密码、附件内容或 Git blob 内容。

## 2. 计划中的公开 community-contract surface（候选，不是批准的导出范围）

以下是首版**意图**作为公开社区契约／SDK 边界的文件，不代表当前已满足独立发布条件：

| 路径 | 角色 | 来源／贡献证据 | 历史证据 | 许可证据 | 当前结论 |
| --- | --- | --- | --- | --- | --- |
| `src/lib/community/index.ts` | 社区契约入口，重新导出定义解析和公开投影能力 | 第一方仓库文件；已在社区基础提交中跟踪，仍无独立公开贡献声明或 CLA 证据 | 当前可达 Git 历史包含社区组件库基础提交；尚未形成公开 release | 仓库无根 `LICENSE`；不能推定复用许可 | 计划公开；当前 public dependency audit 已无 blocker，仍需完成授权审查 |
| `src/lib/community/contracts.ts` | v1 `workflow-recipe`／`instruction-skill` envelope、附件和公开投影契约 | 第一方仓库文件；已在社区基础提交中跟踪 | 当前可达 Git 历史包含社区组件库基础提交；尚未形成公开 release | 同上；代码可见不等于获得复用许可 | 计划公开；当前 public dependency audit 已无 blocker，仍需完成发布审查 |

公开 surface 只允许携带服务端重新构造的定义／指令投影、明确选择的公开示例和公开参考附件；不得把整仓、数据库行、草稿、运行记录或竞技结果作为公开 DTO。

### 当前公开 surface 的依赖检查

自动检查沿相对导入和 `@/` 导入遍历 public surface。当前依赖图为：

- `src/lib/community/contracts.ts` → `src/shared/error-core.ts`；
- `src/lib/community/contracts.ts` → `src/shared/workflow-types.ts`；
- `src/lib/community/contracts.ts` → `src/shared/workflow-validation.ts` → `src/shared/workflow-catalog.ts`。

这些是为公开契约抽取的最小中性模块；当前审计报告 `Blockers: 0`，且未发现对 `src/lib/workflow/`、`src/shared/types.ts`、`src/shared/errors.ts` 或 `src/shared/catalog.ts` 的 public-surface 依赖。旧 `src/lib/workflow/validate.ts` 仍保留兼容导出，但不属于 community contract 的可达依赖。独立导出包、许可证、历史和精确 release commit 仍需按本清单完成审查。

## 3. 私有／不可导出范围

下列范围默认不进入 community-contract 导出包。它们可存在于 AgentForge 私有仓库，但必须在导出选择、构建上下文和 Git 历史审查中排除：

### 3.1 平台运行时和运营核心

- `src/app/`：Next.js 页面、API 入口、认证边界和平台路由。
- `src/server/`：服务、序列化、权限、种子、HTTP 适配和运营逻辑。
- `src/db/`：PostgreSQL／Drizzle schema、迁移、仓储和生产数据边界。
- `src/lib/ai/`：Provider、模型网关、受限工具和真实请求适配。
- `src/lib/auth.ts`、`src/lib/auth-client.ts`：Better Auth 和会话边界。
- `src/lib/crypto/`，尤其是 `src/lib/crypto/credentials.ts`：BYOK 凭据加密和归属校验。
- `src/lib/workflow/`：平台 DAG 校验／执行基础；community contract 不直接依赖此目录，公开契约使用已抽取的中性 workflow 校验模块；该目录仍不得作为整目录导出。
- `src/lib/judge/`、`src/lib/scoring/`：确定性评测、隐藏判定、评分和预算规则。
- `src/lib/gateway-contract/`：可信网关契约及运营接入边界。
- `src/shared/catalog.ts`、`src/shared/types.ts`、`src/shared/errors.ts` 和 `src/shared/i18n/`：混合了平台目录、账号、凭据、运行、竞技和内部错误／文案，不作为整文件公开 SDK。

### 3.2 隐藏评测、测试数据和历史运行证据

- `src/server/fixtures.ts`：种子／隐藏挑战和服务测试 fixtures。
- `tests/fixtures/`：迁移和历史结构／数据 fixtures。
- `tests/helpers/seed-arena.ts`：竞技种子和测试活动构造。
- `src/lib/judge/`、`src/lib/scoring/` 及所有隐藏用例、答案、failure fixtures、`Run`／`Submission` 明细：不得导出或作为社区效果证据。
- `tests/`、`docs/screenshots/` 和 `scripts/`：默认是测试、文档或运维材料，不因路径可读就属于公开组件 SDK。

作者自测、发布检查和平台效果评测是不同证据来源；任何测试输出、隐藏答案或竞技排行榜数据都不得被放入组件公开投影。

### 3.3 凭据、配置和本地／运行时产物

- `.env*`：仅 `.env.example` 和明确标记的 `.env.*.example` 模板可在仓库中保留；真实 `.env`、CI 注入值和生产配置不可导出。
- `.data/`、`backups/`、`coverage/`、`node_modules/`、`.next/`、`out/`、`dist/`、`build/`、`runtime/`、`tmp/`。
- `*.pem`、`*.key`、`*.p12`、`*.pfx`、数据库 dump／backup、SQLite／数据库文件、`*.log`、`*.tsbuildinfo`。
- API Key、Cookie、密码、Bearer token、连接串密码、加密凭据、云厂商密钥及任何含实际值的环境变量；审计和导出检查只报告路径／模式，不打印内容。

## 4. 第一方来源、贡献和许可证据

### 4.1 证据口径

- 第一方来源证据：文件位于本仓库，路径和 Git 对象可由 `git ls-files`／`git log` 复核；不代表作者身份或权利链完整。
- 贡献证据：当前没有独立的社区组件作者、CLA、版权转让或逐文件贡献者清单；现有 `CONTRIBUTING.md` 是工程协作规范，不是权利授予文件。
- 历史证据：审计脚本检查当前所有可达 refs 的文件名和 blob 内容；被删除或改名的历史路径仍需人工复核。
- 许可证据：当前没有根 `LICENSE` 或 `LICENSE.md`；`package.json` 和安装包 `package.json` 的 license 字段只是声明性元数据，不替代许可证全文、NOTICE 或法律审查。

### 4.2 第一方文件盘点

| 文件／范围 | 预期用途 | 是否计划公开 | 来源／贡献／历史审查状态 | 许可／动作 |
| --- | --- | --- | --- | --- |
| `src/lib/community/index.ts` | 公开契约入口 | 是（条件） | 已在社区基础提交中跟踪；无独立作者权利链记录 | 待补充第一方许可与贡献证据 |
| `src/lib/community/contracts.ts` | 公开契约解析／投影 | 是（条件） | 已在社区基础提交中跟踪；无独立作者权利链记录 | public dependency audit 已无 blocker；仍待完成独立导出、许可与历史审查 |
| `src/lib/workflow/validate.ts` | 私有 DAG 约束实现 | 否 | 历史第一方核心代码；含内置能力闭集和执行约束 | 不导出；不能作为公开 SDK 依赖 |
| `src/shared/catalog.ts` | 私有内置目录和示例 | 否 | 历史第一方核心代码；包含系统目录和演示材料 | 不导出；示例需重新审查后单独投影 |
| `src/shared/types.ts` | 混合平台领域类型 | 否 | 历史第一方核心代码；包含账号、凭据、运行和评分类型 | 不导出整文件；公开类型需单独抽取 |
| `src/shared/errors.ts` | 混合平台错误实现 | 否 | 历史第一方核心代码；包含非社区错误码和 `AppError` | 不导出整文件；公开错误契约需单独边界 |
| `src/server/fixtures.ts`、`tests/fixtures/`、`tests/helpers/seed-arena.ts` | 测试／隐藏活动数据 | 否 | 脚本会检查当前树和 Git 历史路径 | 永久排除，人工确认无隐藏数据外泄 |
| `src/lib/crypto/credentials.ts`、`.env*` | 密钥与配置 | 否 | 路径规则和内容模式双重检查 | 永久排除；不得打印或提交实际值 |

## 5. 直接包依赖来源与许可证元数据证据

以下表格来自当前 `package.json` 的直接依赖声明和本地 `node_modules/*/package.json` 的观察值。`requested` 是声明范围，`observed` 是本次审计记录的安装版本；仓库已提交 `pnpm-lock.yaml`，但公开导出仍需单独的可复现依赖清单和精确 release 证据。source 是包元数据中的 repository 字段，license 是包元数据声明；两者均需人工核对许可证全文、NOTICE、传递依赖、版本和导出用途。

| 包 | requested | observed | source evidence | declared license | review |
| --- | --- | --- | --- | --- | --- |
| `next` | `16.3.4` | `16.3.4` | `vercel/next.js` | `MIT` | human review |
| `react` | `19.2.8` | `19.2.8` | `https://github.com/react/react.git` | `MIT` | human review |
| `react-dom` | `19.2.8` | `19.2.8` | `https://github.com/react/react.git` | `MIT` | human review |
| `@xyflow/react` | `^12.8.4` | `12.11.6` | `https://github.com/xyflow/xyflow.git` | `MIT` | range/lock review |
| `ai` | `^6.0.0` | `6.0.277` | `https://github.com/vercel/ai` | `Apache-2.0` | range/lock review |
| `@ai-sdk/openai-compatible` | `^2.0.0` | `2.0.74` | `https://github.com/vercel/ai` | `Apache-2.0` | range/lock review |
| `@ai-sdk/gateway` | `^3.0.0` | `3.0.189` | `https://github.com/vercel/ai` | `Apache-2.0` | range/lock review |
| `drizzle-orm` | `^0.44.5` | `0.44.7` | `git+https://github.com/drizzle-team/drizzle-orm.git` | `Apache-2.0` | range/lock review |
| `postgres` | `^3.4.7` | `3.4.9` | `porsager/postgres` | `Unlicense` | license/usage review |
| `better-auth` | `^1.7.2` | `1.7.3` | `git+https://github.com/better-auth/better-auth.git` | `MIT` | range/lock review |
| `@better-auth/drizzle-adapter` | `^1.7.2` | `1.7.3` | `git+https://github.com/better-auth/better-auth.git` | `MIT` | range/lock review |
| `zod` | `^4.1.5` | `4.5.4` | `git+https://github.com/colinhacks/zod.git` | `MIT` | range/lock review |
| `zustand` | `^5.0.8` | `5.0.15` | `git+https://github.com/pmndrs/zustand.git` | `MIT` | range/lock review |
| `lucide-react` | `^0.468.0` | `0.468.0` | `https://github.com/lucide-icons/lucide.git` | `ISC` | range/lock review |
| `@radix-ui/react-slot` | `^1.2.3` | `1.3.3` | `git+https://github.com/radix-ui/primitives.git` | `MIT` | range/lock review |
| `class-variance-authority` | `^0.7.1` | `0.7.1` | `https://github.com/joe-bell/cva.git` | `Apache-2.0` | range/lock review |
| `clsx` | `^2.1.1` | `2.1.1` | `lukeed/clsx` | `MIT` | range/lock review |
| `tailwind-merge` | `^3.3.1` | `3.6.0` | `https://github.com/dcastil/tailwind-merge.git` | `MIT` | range/lock review |
| `server-only` | `^0.0.1` | `0.0.1` | not declared | `MIT` | source/usage review |
| `undici` | `^7.15.0` | `7.29.1` | `git+https://github.com/nodejs/undici.git` | `MIT` | range/lock review |
| `typescript` | `^5.9.2` | `5.9.3` | `https://github.com/microsoft/TypeScript.git` | `Apache-2.0` | range/lock review |
| `@types/node` | `^22.18.0` | `22.20.1` | `https://github.com/DefinitelyTyped/DefinitelyTyped.git` | `MIT` | range/lock review |
| `@types/react` | `^19.1.12` | `19.2.18` | `https://github.com/DefinitelyTyped/DefinitelyTyped.git` | `MIT` | range/lock review |
| `@types/react-dom` | `^19.1.9` | `19.2.7` | `https://github.com/DefinitelyTyped/DefinitelyTyped.git` | `MIT` | range/lock review |
| `tailwindcss` | `^4.1.12` | `4.3.3` | `https://github.com/tailwindlabs/tailwindcss.git` | `MIT` | range/lock review |
| `@tailwindcss/postcss` | `^4.1.12` | `4.3.3` | `https://github.com/tailwindlabs/tailwindcss.git` | `MIT` | range/lock review |
| `drizzle-kit` | `^0.31.4` | `0.31.10` | `git+https://github.com/drizzle-team/drizzle-orm.git` | `MIT` | range/lock review |
| `tsx` | `^4.20.5` | `4.23.13` | `privatenumber/tsx` | `MIT` | range/lock review |
| `dotenv` | `^17.2.2` | `17.4.2` | `git://github.com/motdotla/dotenv.git` | `BSD-2-Clause` | range/lock review |

This table does **not** mean all packages belong in a community SDK. In particular, Next.js, database, auth, AI provider, crypto, evaluation, and build tooling must not be bundled into the public contract surface unless a separate export design and legal review explicitly authorizes it.

## 6. Automated checks and current evidence

`scripts/audit-community-export.mjs` performs these checks without printing sensitive contents:

1. Confirms the public surface files exist and are listed in this inventory.
2. Enumerates tracked files and non-ignored untracked files in the current tree.
3. Reports prohibited path classes: `.env*` (except examples), `.data/`, backups, credentials, keys, fixtures, hidden data, runtime/build artifacts, database dumps and logs.
4. Walks reachable Git history file names and blob contents; reports only path/pattern IDs for prohibited paths and secret-like matches.
5. Resolves relative and `@/` imports from the public surface, including transitive imports, and fails closed on private platform modules or unresolved internal imports.
6. Reads direct dependency metadata and checks the inventory covers every direct dependency; missing metadata and unpinned ranges remain review-required.
7. Checks for a repository-level `LICENSE` and reports the absence as human/legal review, never as an implied license.

### Current tree / history findings

The exact findings are generated by the audit command rather than hand-maintained here. At this checkout, expected review items include:

- tracked test/hidden fixture paths under `src/server/fixtures.ts` and `tests/fixtures/`;
- private credential implementation under `src/lib/crypto/credentials.ts`;
- current and historical binary files that the content scanner cannot inspect; each item requires a human disposition and an unscanned binary is never treated as a pass;
- current and historical secret-like matches, including test or fixture matches; each match requires a recorded disposition and no secret contents may be printed;
- current and historical prohibited paths, including private core, fixtures, credentials, `.env*`, `.data/`, runtime artifacts and deleted／renamed paths;
- reachable history containing old fixture/test paths, which must be checked before any split or public mirror;
- current ignored local artifacts such as `.next/`, `node_modules/` and `tsconfig.tsbuildinfo` are excluded from export candidates but remain documented here;
- no repository-level `LICENSE` or approved first-party／SDK license text;
- repository lockfile is committed, but the public export still needs a dedicated reproducible dependency manifest and release evidence;
- public-contract import findings listed in section 2.

The audit exits non-zero while any blocker or review-required finding remains. This is intentional fail-closed behavior; it does not mark T0 complete.

## 7. Human review still required

### Product／legal

- D1 产品 allowlist 已确认：`MIT`、`Apache-2.0`、`BSD-2-Clause`、`BSD-3-Clause`、`ISC`；仍需完成实际许可证文本、NOTICE／署名、作者／贡献者权利链、来源／历史授权及依赖冲突的产品／法务审查。该确认不等于公开导出批准。
- Decide NOTICE／署名展示、文档／示例材料许可、第三方依赖冲突和作者来源／贡献声明的处理。
- Verify first-party authorship, historical contributions, any external source adaptation, and rights to redistribute each public definition／Prompt／attachment.
- Provide the actual repository／SDK license text; this inventory cannot infer one.

### Engineering／release

- Verify that the extracted community contract remains independently usable without `src/lib/workflow/`, `src/shared/types.ts`, `src/shared/errors.ts` or other private platform modules; preserve the single neutral workflow-validation implementation and do not create a second evaluator or execution foundation.
- Produce a selected export manifest, compare the packaged files against this draft inventory, and obtain the required product／legal approval before treating it as the release manifest.
- Commit and validate reproducible dependency evidence (normally the project lockfile, or an explicit zero-runtime-dependency export record) before using dependency versions as release evidence.
- Complete root／first-party license text, NOTICE／attribution, contributor rights, source／history authorization, current and historical binary review, secret-like match disposition and prohibited-path review.
- Re-run the audit on the exact release commit and require `PASS`; inspect every review-required path, including reachable old refs and deleted／renamed files.
- Confirm no public export includes private core, hidden fixtures, credentials, secrets, `.env*`, `.data/`, database/runtime artifacts, or evaluation internals. Do not solve these findings by weakening the audit or by creating a second evaluator／execution foundation.

### Product／operations (D2)

- D2 产品决策已确认 invite-only + fail-closed，当前不开放任何自测额度或真实自测入口。未来开放前，仍需单独批准样例、调用、token、时长、并发、队列、预算和告警值；本审计不实现或开启额度。

## 8. T0 status boundary

This artifact completes the auditable inventory/check mechanism only. It intentionally does **not**:

- replace the confirmed D1/D2 product decisions with public-release evidence; D1 的法律／权利审查仍未完成，D2 额度仍保持关闭；
- change repository visibility or push an export;
- add Component tables, routes, evaluator jobs, queues, workers, budget ledgers or another runtime;
- declare the current community contract implementation independently publishable or make the SDK public;
- mark any unchecked T0 item as complete; this draft cannot be used as evidence that T0 or public release is complete.
