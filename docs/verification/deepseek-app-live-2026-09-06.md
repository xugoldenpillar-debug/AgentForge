# 应用侧 Flash 真实验证 — 2026-09-06

## 范围与授权

用户明确授权把测试 Key 留在本地测试环境，并执行一次 Build → Run → 真实模型 → 评分。调用仅针对官方 Flash，非 thinking、无工具、单模型节点、每个用例最多输出 128 tokens、无重试。本次唯一公开 Run 包含挑战原有的 4 个用例，没有删除测试或降低预算来通过测试。

## 实现

- `src/lib/ai/sdk-provider.ts` 复用现有 OpenAI-compatible SDK 和安全 Fetch。
- 官方域名只接受根路径及 `/v1`，规范化到 Registry canonical endpoint；只允许 `deepseek-v4-flash`，对实际执行模型再次验证。
- 显式发送 `thinking.type=disabled`，保留 timeout、DNS/IP、禁止重定向、响应上限、token/tool/cost 原有预算检查和错误脱敏。
- 官方响应必须有非负整数输入/输出 usage；不以估算替代，reasoning usage 非零时拒绝。
- 通过已认证 `/api/arena/providers` 保存 Key，数据库字段使用现有 AES-256-GCM + owner/credential AAD 加密；API 不返回明文或 ciphertext。只为本地 `.env` 的精确域名允许列表增加 `api.deepseek.com`。
- 未新增依赖、未改数据库 schema。官方域名的旧模型名/任意路径现在会拒绝；其他已有兼容 BYOK 保留原行为。

## 实际链路与结果

使用本地演示账号（真实 Better Auth session）创建私有 Build，并选择该账号下的真实 Flash Credential；演示账号不等于 Demo 模型。

| 项目 | 观察值 |
| --- | --- |
| 服务 | 本地 Next.js + PostgreSQL，端口 3107 |
| 挑战 | support-router |
| Build | c81ff952-604d-4a35-8791-e22c39cc94ab |
| Run | 568e0072-a08f-4f42-a865-a63de66d7fd4 |
| 层级 | byok（不是 demo 或 verified） |
| 结果 | 4/4 通过；976/1000 |
| 输入/输出 | 236 / 6 tokens，共 242 |
| reasoning/tool calls | 0 / 0 |
| 估算标记 | estimated=false |
| 累计模型执行耗时 | 1424.64 ms（单次样本，不是性能 SLA） |
| Submission | null；数据库中该 Run 的 submissions=0 |
| 持久化 | completed；4 条 run_cases；1 条 v1 格式加密测试凭据 |

逐用例输入/输出 tokens：57/2、58/1、59/1、62/2，全部通过。
价格配置为 null，`cost=null`，不伪造费用或官方冻结价格。本次以用例数、输出 token、无工具及无重试限制开销；**未知价格下现有费用逻辑不能提供可靠金额硬上限**，不得视为生产预算系统已验收。976 是现有评分器含延迟/未知费用处理的结果，不是通用模型能力分数。

## 回归与边界

- `pnpm test`: 112 通过，0 失败。
- `pnpm test:provider-sdk`: 18 个离线 SDK 测试通过，无真实网络，包含参数、模型/URL 拒绝、缺失/负 usage、reasoning、错误脱敏/无重试和其他兼容 BYOK。
- `pnpm typecheck` / `pnpm build`: 通过。
- `test:provider-sdk` 已加入 CI；CI 仍不调用付费模型。
- 真实链路使用 HTTP API/NDJSON 和数据库验证；本轮没有重新进行浏览器交互验收。
- 仅现有 BYOK 适配接入；尚未实现 `/models` 保存前认证、Official/Custom API 权限拆分、Verified worker、私有 Gateway Receipt 全链路。1.3 仍属部分完成。
- 无隐藏测试、榜单提交、生产写入、部署、提交或推送。

凭据留在本地数据库，页面中名称为 `DeepSeek Flash local validation`。本地演示账号只能用于本地；公开部署前应关闭该账号、轮换 Key 并完善权限及预算门禁。
