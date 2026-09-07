# BYOK 协议接入验证 — 2026-09-07

## 交付边界

用户要求先提交上一轮：已提交 `e08de60`（目录与 launch 契约），未推送。
随后完成此 BYOK 协议增量，尚未提交；**没有完成或开放全部 L0–L8**。

- 显式选择 Chat Completions、Responses、Anthropic Messages、Gemini generateContent。
- 复用现有 SDKProvider 的超时/取消、token/工具限制、错误净化、零自动重试、秘密去除与 safeProviderFetch。
- 每个 native provider 注入相同安全 fetch；不新增通配域名、不允许任意认证头、不向 sandbox 传 Key。
- credential 新增 protocol；旧行通过 0013 默认为 openai-chat。旧客户端省略该字段仍保持原行为。
- Providers UI 中英文、协议基础 URL 默认值和已存凭据协议标签；自定义网关 URL 不因切换协议被静默替换。原生 Key 的掩码不虚构 sk- 前缀。
- 新创作候选契约版本变为 animation-launch-byok-v1，美元上限 null，其他资源限制保持；这还不是运行配额的完整生产接线。旧 DAG 预算未放宽。

新增官方 SDK：@ai-sdk/openai 3.0.109、@ai-sdk/anthropic 3.0.116、@ai-sdk/google 3.0.121。pnpm 锁文件语义新增对应3包，不升级原依赖。安装前记录位于 launch/byok-first.md。CI 原有 test:provider-sdk 步骤包含新离线协议测试文件。

## 本次实际验证

| 命令/操作 | 最终结果 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 成功；安装器仍提示部分依赖构建脚本未运行，未修改全局设置 |
| `pnpm test` | 421 测试，420 通过，1 跳过，0 失败 |
| `pnpm test:provider-sdk` | 33 通过；新旧协议的 wire、认证头、用量、错误净化、取消、不重试；全程替代 fetch、不调用真实模型 |
| `pnpm typecheck` | 通过 |
| `pnpm build` | 通过，Next.js 16.3.4 |
| `pnpm test:migrations`，显式本任务 local PG URL | 4 通过；新增旧凭据协议默认值、旧数据保留、非法值拒绝、重复 DDL；未修改历史迁移 checksum |
| `pnpm db`，再次 `pnpm db` | 0013 升级成功；重复执行 13 unchanged，未覆盖原数据 |
| `SMOKE_BASE_URL=http://localhost:53126 pnpm test:smoke` | 通过，注册/登录和旧 DAG Demo/Agent 草稿边界；不是 creation v2 验收 |
| `git diff --check` | 通过 |

实际浏览器通过 agent-browser 独立 df6c-byok 会话打开本 worktree 的生产构建 Next.js：
- 注册一个本地普通测试账号、登录，进入 Providers。
- 四个可选协议、Anthropic/Gemini 切换后的基础 URL，保存协议并刷新显示持久记录。
- 使用无效测试 Key，只保存凭据，未点击模型运行；为测试持久化使用 allowlisted URL，不声称该 URL/协议组合可调用。
- English/简体中文，1440px 桌面、390px 窄屏；document scrollWidth 与 viewport 一致。
- 检查最终截图：`docs/screenshots/byok-protocols-2026-09-07/desktop-zh.png`、`mobile-en.png`。截图显示测试模式模拟入口及离线凭据，不是生成作品证据。
- 专用浏览器会话已关闭；Next.js 53126、PG 32769、Redis 32770 保留，仅使用本任务资源。无生产凭据/付费调用/部署。

## 未验收与未完成

沙箱 provider、不可变对象存储、creation v2/Pi/EF 执行、运行级预算取消恢复、动画净化/播放、完整创作 UI、发布/点赞/盲选/排名、L7–L8 均不能因此关闭。

本轮没有新建沙箱/对象存储替身来冒充交付，没有启用 production feature gate。已经向用户询问具体上线环境、沙箱、对象存储和独立预览域；目标未知不能擅自写其现有云账户。
