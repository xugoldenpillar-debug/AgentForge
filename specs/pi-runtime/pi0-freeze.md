# PI0 freeze（安装前，非安全验收）

- 冻结日：**2026-09-06**。
- 范围：registry / 已发布 tarball 身份核验。不向应用 `package.json` 添加依赖，不启用 feature flag，不调用付费模型，不修改应用源码，不提交、不推送。
- 结论用途：后续可选服务端安装的**精确包名与版本**。本文不是生产安全验收、不是签名核验通过、不是 SDK 兼容验收。

先前 git 文档快照见 [upstream-evidence.md](./upstream-evidence.md)（`main` 当时为 `9767ba275f3e9a5ee0f5c5342249b629ab1b2282`）。PI0 冻结的是 **npm 可安装产物**，不是浮动 `main`。

## 已验证 vs 未验证

| 项 | 状态 |
| --- | --- |
| 官方 npm scope / 包名 / 0.85.1 与 `latest` dist-tag 一致 | 已验证（`npm view`） |
| 发布 tarball URL、shasum、integrity；本机下载后 SHA-1 / SHA-512 与 registry 字段一致 | 已验证（下载 tarball，未安装到应用） |
| `package.json` `license` / README “License: MIT” / 仓库根 LICENSE 文本 | 已验证（声明与仓库文本）；tarball **不含** `LICENSE` 文件 |
| `engines.node` | 已验证：`>=22.19.0` |
| npm `dist.signatures` 与 SLSA provenance **元数据存在** | 已观察到 URL / keyid；**未**用 npm 公钥做密码学验签，**未**核验 attestation 构建来源 |
| 传递依赖完整许可证清点、漏洞扫描、lockfile 解析 | **未**做（仓库尚无 `pnpm-lock.yaml`；本次未 `pnpm add`） |
| 导入主入口是否有网络 / 读宿主目录 / 执行 shell 的副作用 | **未**运行代码，未验证 |
| 旧 scope 与新 scope API 兼容 | **未**验证；禁止当同一产物使用 |

## 1. 官方身份（不要用旧 npm scope）

当前可安装官方包在 **`@earendil-works/*`**，仓库 `https://github.com/earendil-works/pi`。

| 包 | npm `latest`（冻结时） | 说明 |
| --- | --- | --- |
| `@earendil-works/pi-agent-core` | `0.85.1` | **冻结目标**。描述：`General-purpose agent with transport abstraction, state management, and attachment support` |
| `@earendil-works/pi-coding-agent` | `0.85.1` | CLI / 编码宿主。描述：`Coding agent CLI with read, bash, edit, write tools and session management`。**不要作为产品依赖安装** |
| `@earendil-works/pi-ai` | `0.85.1` | core 的直接依赖（caret `^0.85.1`） |
| `@earendil-works/chord` | `0.85.1` | core 的直接依赖（caret `^0.85.1`） |
| `@earendil-works/pi-telemetry` | `0.85.1` | core 的直接依赖（caret `^0.85.1`） |

同一批包另有 dist-tag **`legacy-node20` = `0.74.2`**。那不是本次冻结版本，也不匹配 0.85.1 API 文档。

仍存在的旧 scope（**禁止安装**）：

| 包 | latest | 事实 |
| --- | --- | --- |
| `@mariozechner/pi-agent-core` | `0.73.1` | repository `git+https://github.com/badlogic/pi-mono.git`，`engines.node` `>=20.0.0`，`time.modified` `2026-05-07T15:34:04.771Z` |
| `@mariozechner/pi-coding-agent` | `0.73.1` | 同上旧仓库；描述仍含 `read, bash, edit, write`；`engines.node` `>=20.6.0` |
| `@mariozechner/pi` | `0.70.6` | **不是** agent core。描述为 `CLI tool for managing vLLM deployments on GPU pods`，directory `packages/pods` |

`@earendil-works/pi-agent-core@0.85.1` 的 npm `gitHead` 为 **`d981de1229ef899957bbe968bc8dcda02a21f477`**（GitHub 提交说明 `Release v0.85.1`，committer `2026-09-05T11:54:46Z`）。先前 evidence 快照 `9767ba…` 相对该 release commit **ahead 4 / behind 0**，因此 git 文档快照新于已发布 tarball。安装以 npm 0.85.1 tarball 为准。

发布者元数据：`_npmUser` = `GitHub Actions <npm-oidc-no-reply@github.com>`；maintainers 含 `mitsuhiko`、`badlogic`、`rwachtler`。这只是 registry 字段，不是签名核验通过。

## 2. 冻结推荐（后续可选安装用）

**精确依赖（仅服务端可选，尚未写入应用清单）：**

```text
@earendil-works/pi-agent-core@0.85.1
```

- 包类型：ESM（`"type": "module"`）。
- License 声明：`MIT`。
- Engines：`"node": ">=22.19.0"`。
- 主入口：`./dist/index.js` / `./dist/index.d.ts`。
- 不要安装 `@earendil-works/pi-coding-agent`。
- 不要安装 `@mariozechner/*` Pi 包。
- 不要把 Pi 放进客户端 / 浏览器导入树。
- 不要把 `engines.node` 从应用的 `>=22.16.0` 抬到 `>=22.19.0`。Node 不满足 Pi 时拒绝启用 Pi。

### 已发布 tarball 身份（core 0.85.1）

来源：`npm view @earendil-works/pi-agent-core@0.85.1`；随后 `curl` 下载同一 URL 并本地哈希。

| 字段 | 值 |
| --- | --- |
| tarball | `https://registry.npmjs.org/@earendil-works/pi-agent-core/-/pi-agent-core-0.85.1.tgz` |
| shasum (SHA-1) | `8a85116c0d4494e4d9e82341237d91ad360fdc2a` |
| integrity | `sha512-hIXIP3eAWueAYiAl8aMvWCvvZ8Q5gT3Dip5bE5uJyIGh4+YlWRjtMLI4BaeoXoSs93zndjue61u1B/vhefLnuA==` |
| fileCount | `362`（解压后文件数与 registry 一致） |
| unpackedSize | `3627164` |
| 本机 SHA-1 | 与 `dist.shasum` 一致 |
| 本机 SHA-512 (base64) | 与 `dist.integrity` 的 digest 一致 |
| tarball 内 `files` | `["dist", "README.md"]`（无 `LICENSE` 文件） |

npm 还给出 `dist.signatures`（keyid `SHA256:DhQ8wR5APBvFHLF/+Tc+AYvPOdTpcIDqOhxsBHRwC7U`）和 attestations URL `https://registry.npmjs.org/-/npm/v1/attestations/@earendil-works%2fpi-agent-core@0.85.1`（`predicateType` `https://slsa.dev/provenance/v1`）。**未验证这些签名。**

## 3. License / engines / 传递依赖（高层）

### 3.1 core 自身

- `license`: `MIT`（npm 与 tarball `package.json`、README 末行、仓库 `LICENSE` 在 `d981de…` 的文本均为 MIT，版权行 `Copyright (c) 2025 Mario Zechner`）。
- `engines.node`: `>=22.19.0`。
- 直接依赖（tarball `package.json` 原文）：

```json
{
  "@earendil-works/chord": "^0.85.1",
  "@earendil-works/pi-ai": "^0.85.1",
  "@earendil-works/pi-telemetry": "^0.85.1",
  "diff": "8.0.4",
  "ignore": "7.0.5",
  "typebox": "1.3.7",
  "yaml": "2.9.0"
}
```

冻结时这三个 `@earendil-works/*` 的 `latest` 均为 `0.85.1`，但清单是 **caret**。安装后 lockfile 才会钉死解析结果；若安装时 registry 已有 `>0.85.1 <0.86.0`，可能解析到更新的 patch/minor。需要钉死 sibling 包时用 pnpm override，本次未加。

### 3.2 一层传递（registry `license` 字段，非完整 SPDX 树）

| 包 | 版本（清单或 npm latest@冻结） | npm `license` |
| --- | --- | --- |
| `diff` | `8.0.4` | BSD-3-Clause |
| `yaml` | `2.9.0` | ISC |
| `ignore` | `7.0.5` | MIT |
| `typebox` | `1.3.7` | MIT |
| `@earendil-works/pi-telemetry` | `0.85.1`（无 dependencies） | MIT；engines `>=22.19.0` |
| `@earendil-works/chord` | `0.85.1`；依赖 `esbuild@0.28.1` | MIT；engines `>=22.19.0` |
| `esbuild` | `0.28.1` | MIT |
| `@earendil-works/pi-ai` | `0.85.1` | MIT；engines `>=22.19.0` |

`@earendil-works/pi-ai@0.85.1` 直接依赖（安装 core **会**带上，即使适配器自备 `streamFn`）：

| 包 | 版本 | npm `license` |
| --- | --- | --- |
| `openai` | `6.40.0` | Apache-2.0 |
| `@anthropic-ai/sdk` | `0.123.0` | MIT |
| `@google/genai` | `1.52.0` | Apache-2.0 |
| `@aws-sdk/client-bedrock-runtime` | `3.1048.0` | Apache-2.0 |
| `@smithy/node-http-handler` | `4.7.3` | Apache-2.0 |
| `http-proxy-agent` | `7.0.2` | MIT |
| `https-proxy-agent` | `7.0.6` | MIT |
| `partial-json` | `0.1.7` | MIT |
| `typebox` | `1.3.7` | MIT |
| `@earendil-works/pi-telemetry` | `^0.85.1` | MIT |

高层风险（未做安全验收）：core 依赖 `pi-ai`，因此产品可选依赖会拉入多家云厂商 SDK、代理 agent，以及 `chord` → `esbuild`。这不证明这些库在 import 时会发起网络请求；也未排除。

coding-agent 另有 `undici@8.9.0`、`cross-spawn@7.0.6`、`jiti@2.7.0`、`@silvia-odwyer/photon-node@0.3.4`、shrinkwrap（`_hasShrinkwrap: true`）、unpackedSize 约 21.9MB。这是不选它的体积与工具面原因之一。

## 4. Node 兼容裁决（相对应用 `>=22.16.0`）

- 应用 `package.json`：`"engines": { "node": ">=22.16.0" }`。仓库无 `.npmrc` / `engine-strict`。
- Pi core / pi-ai / chord / telemetry / coding-agent 0.85.1：`"node": ">=22.19.0"`。
- **裁决：Pi 0.85.1 不能覆盖应用声明的完整 Node 区间。** `22.16.0 <= node < 22.19.0` 上应用应仍可运行 DAG；Pi 必须拒绝启用，而不是抬高全应用 `engines.node`。
- 本机 `node --version` 为 `v26.7.0`，数值上高于 Pi 下限，但本次未运行 Pi。
- 不要用 `legacy-node20` / `0.74.2` 绕过该差异。

启用时建议检查（尚未实现）：`process.version` 不满足 `>=22.19.0` 则返回明确错误，且不加载 Pi。

## 5. 为何用 core + 允许列表工具，而不是 coding-agent

### 5.1 coding-agent 默认就是编码 CLI

npm 描述原文：`Coding agent CLI with read, bash, edit, write tools and session management`。发布 README 的 built-in tools 列表为：

`read`, `bash`, `powershell`（Windows）, `edit`, `write`, `grep`, `find`, `ls`

Philosophy 原文包括 **No permission popups**（建议容器或自建确认）。CLI 有 `--tools` / `--no-builtin-tools` / `--no-tools` 以及资源自动发现开关；这不是 AgentForge 的授权模型，且 SDK/CLI 默认发现与宿主目录相关（见 upstream-evidence S2/S3）。产品依赖 coding-agent 会引入 CLI bin `pi`、TUI、默认文件系统/shell 工具和自动发现。

### 5.2 core 的 Agent 默认不注册那些工具

tarball `dist/agent.js`：

```js
let tools = initialState?.tools?.slice() ?? [];
```

README Quick Start 的 `new Agent({ initialState, streamFn })` 不传入工具。工具需 `agent.state.tools = [readFileTool]` 这类显式赋值。`streamFn` 为必需；省略时 `getDefaultStreamFn()` 抛错：`No default stream function configured. Pass streamFn explicitly or call setDefaultStreamFn().` 默认 model 占位为 `id: "unknown"`，不是某个付费模型目录。

因此：**可以**只用 core 的 `Agent` / `agentLoop`，注入受控 `streamFn` 和允许列表内的 `AgentTool`（例如已有 calculator），不调用 `createBashTool` / `createReadTool` / `createEditTool` / `createWriteTool`。

### 5.3 但 core tarball 仍带有这些工厂

主入口 `dist/index.js` 含 `export * from "./harness/tools/index.js"`。该目录导出 `createBashTool`、`createReadTool`、`createEditTool`、`createWriteTool`。`bash.js` 工厂的 `name` 为 `"bash"`，`execute` 通过 `toolContext.env` 跑命令。

含义：

- **不**等于 Agent 默认启用 bash/read/edit/write。
- **等于**官方 core 包内含这些实现，且从主入口再导出。适配器不得注册它们。
- 是否 `import "@earendil-works/pi-agent-core"` 就会执行 shell：**未运行验证**。从源码看 `createBashTool` 是工厂，`execute` 才调用环境；但 ESM `export *` 会加载该模块。

后续适配器约束（尚未实现，此处只记录冻结含义）：只注入允许列表工具；不要从 core 导入 harness 文件/shell 工厂；不要用 coding-agent 的 `createAgentSession` / `DefaultResourceLoader`。

## 6. 给后续工程师的可复制事实

应用当前 **没有** Pi 依赖，也 **没有** lockfile。下面命令仍不要在 PI0 执行；仅供安装工作流复制。

```text
# OPTIONAL, server-only, after PI0 freeze is accepted.
# Do not add @earendil-works/pi-coding-agent.
# Do not add @mariozechner/pi, @mariozechner/pi-agent-core, or @mariozechner/pi-coding-agent.
# Do not bump package.json engines.node (keep >=22.16.0).
# Refuse Pi enablement unless Node satisfies >=22.19.0.

exact package: @earendil-works/pi-agent-core@0.85.1
registry tarball: https://registry.npmjs.org/@earendil-works/pi-agent-core/-/pi-agent-core-0.85.1.tgz
integrity: sha512-hIXIP3eAWueAYiAl8aMvWCvvZ8Q5gT3Dip5bE5uJyIGh4+YlWRjtMLI4BaeoXoSs93zndjue61u1B/vhefLnuA==
shasum: 8a85116c0d4494e4d9e82341237d91ad360fdc2a
npm gitHead: d981de1229ef899957bbe968bc8dcda02a21f477
license field: MIT
engines: { "node": ">=22.19.0" }
type: module

# suggested package.json line (optionalDependency or server-only dependency; exact pin, no caret):
"@earendil-works/pi-agent-core": "0.85.1"

# sibling packages at freeze time (core depends on them via ^0.85.1):
#   @earendil-works/pi-ai@0.85.1
#   @earendil-works/chord@0.85.1
#   @earendil-works/pi-telemetry@0.85.1
```

安装后必须：生成并审查 lockfile；确认解析到的 `@earendil-works/pi-ai` / `chord` / `pi-telemetry` 版本；把 Pi 限制在服务端适配器动态导入；对 Node `<22.19.0` 拒绝启用。
