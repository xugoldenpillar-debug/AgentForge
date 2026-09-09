# 两题 BYOK 动画竞技场故障分类与 Provider 表单修复 — 2026-09-09

## 本轮范围

本轮针对生产用户遇到的 `CREATION_EXECUTION_FAILED`、`RUNTIME_POLICY_DENIED`、上游结果不确定，以及 Provider 表单只显示“部分请求字段无效”的问题进行修复。产品规则保持为：

- 用户显式选择 `openai-chat`、`openai-responses`、`anthropic-messages` 或 `google-generative-ai`，平台不根据 API Key 前缀猜测协议；
- 用户可填写自有公网 HTTPS API 网关，私网、保留地址、URL 内账号密码、查询参数、片段和重定向仍然拒绝；
- API Key 只作为不透明凭据加密保存，不写日志、不进入作品文件或沙箱；
- 作品必须先加载封存后的安全预览，并由作品所有者明确勾选确认后才能直接发布；作品发布不需要管理员审核；
- 新题目提议继续进入待审核状态；
- 上游调用结果不确定时不自动重放，必须由用户确认潜在重复费用后才能解除并手动重试。

## 修复内容

### Provider 接入和具体错误提示

- Provider 表单在提交前逐项校验凭据名称、HTTPS Base URL、模型 ID 和 API Key，并聚焦第一个错误字段；旧 `/providers` 页面和两题创作页复用同一校验规则。
- 常见完整接口地址会按显式协议自动转换为 SDK 所需的 Base URL：
  - `.../chat/completions` → OpenAI Chat Base URL；
  - `.../responses` → OpenAI Responses Base URL；
  - `.../messages` → Anthropic Messages Base URL。
- Gemini 地址不做未经文档确认的路径猜测，保持用户输入的公网 HTTPS Base URL。
- 上游 HTTP 错误按可操作原因分类：
  - `401/403` → `PROVIDER_AUTHENTICATION_FAILED`，提示检查 API Key 和模型权限；
  - `400/404/405/409/415/422` → `PROVIDER_REQUEST_INVALID`，提示检查协议、接口地址、模型 ID 和请求格式；
  - `429/5xx` 等已知失败 → `PROVIDER_REQUEST_FAILED`；
  - 无法判断请求是否已被供应商处理的传输失败 → `UPSTREAM_RESULT_UNKNOWN`。
- 所有分类只展示稳定错误码和安全的本地化说明，不回显供应商响应正文或用户密钥。

### CreationRun 终态和阶段错误

Pi 工具失败与后续 Provider 请求可能并发结束。若最后一次 Provider 请求结果未知，新的优先级规则会保留 `UPSTREAM_RESULT_UNKNOWN`，而不是被较早的本地 `RUNTIME_POLICY_DENIED` 覆盖；这样系统不会把可能已经计费的调用误判成可安全重试。

Creation executor 现在记录并映射执行阶段：状态更新、Pi 加载、沙箱启动/挂载、Pi 运行、作品停止/快照/收集/封存。对应稳定错误码为：

- `CREATION_EXECUTION_AUTHORIZATION_LOST`
- `CREATION_PI_RUNTIME_FAILED`
- `CREATION_SANDBOX_START_FAILED`
- `CREATION_ARTIFACT_POLICY_DENIED`
- `CREATION_ARTIFACT_COLLECTION_FAILED`
- `CREATION_ARTIFACT_SEAL_FAILED`

创作页保留原始错误码，并同时显示中英文可操作解释，不再只显示笼统的执行失败。

## 本地验证

在 `/Users/pillarxu/.codex/worktrees/df6c/AgentForge`、分支 `codex/two-challenge-launch` 执行：

| 命令 | 结果 |
| --- | --- |
| `pnpm test` | 503 通过、0 失败、1 跳过 |
| `pnpm test:provider-sdk` | 31 通过、0 失败 |
| `pnpm typecheck` | 通过 |
| `pnpm build` | Next.js 16.3.4 生产构建通过 |
| `pnpm test:deploy` | 15 通过、0 失败 |
| `git diff --check` | 通过 |

新增或扩展的回归覆盖包括：

- Provider 表单具体字段错误和合法自定义 HTTPS 网关；
- 三类常见完整 endpoint 的 Base URL 归一化；
- 401/403、400/404、429/500 的稳定错误分类；
- 工具策略失败后 Provider 结果 unknown 的竞态；
- 沙箱启动、作品收集、对象存储封存的阶段错误映射；
- unknown 任务停止前端活跃轮询，且只能通过用户确认路径解除；
- 发布要求加载 `index.html` 安全预览并明确勾选 `publishConfirmed`。

## 尚未由本轮本地验证替代的 Gate

- 未使用任何用户真实 API Key，也未发起付费模型请求；协议 SDK 测试使用本地离线 HTTP 模拟。
- 生产发布后仍需验证 Web/Worker 使用同一提交、PostgreSQL/Redis 健康、Cloudflare HTTPS 返回正常，并在浏览器检查字段级提示、unknown 确认、预览确认后发布。
- 两道题各一次真实模型成功运行仍需要作品所有者明确授权可用 BYOK 凭据及可能费用；离线协议测试不能替代该验收。
