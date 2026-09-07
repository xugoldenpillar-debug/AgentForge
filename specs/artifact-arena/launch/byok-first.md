# BYOK 首发范围调整（2026-09-07）

用户本轮明确授权：先提交已有目录切片；首发用户自行填写 API Key 并选择常见接口协议，使用平台隔离沙箱，面向全部正常注册用户。暂不实现模型美元费用上限。

该调整覆盖 product.md P3 的平台模型首发/缺价格拒绝及 USD 0.10 候选限制；不修改旧 DAG 的预算规则。BYOK 未报告用量/价格时费用仍为 unknown，不能当零或 Verified。调用成本由用户的供应商账号承担，运行前仍须明确同意；不能将“不做美元上限”扩大为不限制 token、工具、时长、并发、队列或每日新任务数。失联/不确定调用不自动重试。

接口协议显式选择（不是根据 Key 前缀识别）：
- openai-chat：现有 OpenAI-compatible Chat Completions，兼容存量 credential。
- openai-responses：OpenAI Responses。
- anthropic-messages：Anthropic Messages。
- google-generative-ai：Gemini 原生 generateContent。

保留加密、owner 隔离、HTTPS/allowlist/DNS/IP/重定向防护，不允许用户配置任意认证头。API Key 只用于可信服务器模型请求，绝不注入 sandbox、Artifact、日志或客户端响应。平台模型凭据不作为本轮验收回退。

## 依赖安装前记录

现有 @ai-sdk/openai-compatible 只实现 Chat Completions，无法正确覆盖其余三种原生报文/工具/用量协议。引入与现有 AI SDK 6 / LanguageModelV3 匹配的官方 provider：@ai-sdk/openai 3.0.109、@ai-sdk/anthropic 3.0.116、@ai-sdk/google 3.0.121；固定版本，更新 pnpm 锁文件，不升级 ai/Next/Pi。继续将 safeProviderFetch 注入每种 provider，禁用 SDK 自动重试/遥测。通过离线 SDK wire tests 验证认证头、URL、解析/失败、取消及无网络回退，并复用 CI test:provider-sdk。

生产部署、sandbox 供应商、对象存储和独立预览域仍待用户明确目标；“全部开放”不授权任意生产账号写入，也不授权匿名执行。L7 真实模型调用仍需安全配置测试凭据与执行同意，不能借用其他任务密钥。API 协议支持不等于沙箱执行链已经完成。

后续授权更新：用户已批准 hubei 作为 gVisor 实机测试节点并授权安装/测试，见 [部署文档](../../../../docs/deployment/hubei-byok.md)。这不改变其他尚未确定的生产参数或真实模型凭据边界。
