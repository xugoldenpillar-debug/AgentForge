> **历史验证记录 / Historical verification record：** 本文记录 2026-09-06 的 Portable 退役验证，不代表当前运行或启动入口。Portable 截图和结果仅作历史证据保留。

# 单一 Next.js 应用收敛验证 — 2026-09-06

## 变更与环境

分支 `codex/retire-portable`，基于 `cc45e38`，证据对应本次未提交工作区。
删除 Portable 服务器、浏览器程序、本地 JSON/认证运行时及专用验证脚本。
共享 CSS 从 public/arena.css 迁入 src/app/arena.css；favicon 保留。
内存仓储、模拟竞技 seed 移至 tests/helpers；Node 核心测试仍可独立执行。

唯一应用是 Next.js + PostgreSQL + Better Auth。仅 `APP_ENV=test` 且
`DEMO_MODE=true` 启用模拟模型；`NODE_ENV=production` 的本地构建也可在这个
显式测试模式下接受离线测试。此配置绝不可用于正式部署。
普通应用忽略旧 DEMO_MODE=true，不再创建已知密码的演示账号。

新建/Fork 的 Model 不预选凭据。草稿可保存，运行前必须配置 Provider。
历史 Demo 记录和类型保留，不自动迁移或改成 BYOK；普通榜单默认 BYOK。
正常初始化仅按稳定 ID 补齐参考内容，不覆盖已有目录，不生成假用户和成绩。
普通首页排除种子档案/活动，挑战分数及组件成功率按 BYOK 而非跨通道汇总。

本轮使用新建的独立数据库 `retire_portable_1788680653285`，位于已有本地
PostgreSQL 容器内，未对应用数据库 agentforge 写入。测试服务分别使用
3198（test）和 3199（development，故意保留 DEMO_MODE=true 检查旧配置防护）。
数据库中只有本次测试账号、草稿、模拟运行及测试参考内容；不含用户 DeepSeek Key。
未修改原 .env、凭据加密密钥、现有数据目录、Docker 卷或 stash。

依赖复制自本机已安装的同版本项目到当前工作区，未升级依赖或生成锁文件。
初次外部 node_modules 符号链接被 Turbopack 拒绝；改用当前目录的独立依赖副本后构建通过。
首次构建也发现共享 CSS 仍被正式前端引用，迁移并修复引用后重新构建。

## 实际验证

| 验证 | 结果 |
| --- | --- |
| `pnpm test` | 109 通过，0 失败，0 跳过 |
| `pnpm test:provider-sdk` | 18 个离线 SDK 测试通过，无外部模型网络 |
| `pnpm typecheck` | 通过 |
| `pnpm build` | Next.js 正式构建通过 |
| `pnpm test:migrations` | 1 个真实 PostgreSQL 矩阵通过；新库、旧库升级、重复、回滚、并发及保留数据 |
| 隔离数据库连续两次 `pnpm db` | 首次应用两条迁移；第二次 0 applied / 2 unchanged；仅补齐参考目录 |
| test-mode `pnpm test:smoke` | 三个挑战公开运行、隐藏提交、Demo 榜单及 Fork 全部通过 |
| `SMOKE_EXPECT_TEST_MODE=false pnpm test:smoke` | 普通模式边界通过，无模型调用 |
| `git diff --check` | 通过 |

smoke 新增普通模式与测试模式共享的 HTTP 边界检查：未配置草稿保存/运行拒绝、
匿名和跨域写入拒绝、私有 Prompt 不返回配置、私有 Fork 拒绝、凭据不泄露明文或
ciphertext、跨用户不可见/不可删除、所有者删除后不可见。隐藏响应只允许汇总事件，
并确认 Content-Type 为 NDJSON。测试用 Provider Key 是明确的无效占位值，从不调用它。

## Portable 测试退役后的覆盖对应

| 旧检查关注点 | 保留或替代覆盖 |
| --- | --- |
| 注册、密码、会话与撤销 | 正式 Next.js/Better Auth smoke：注册、登录、错误密码、退出、旧 Cookie 重放 |
| 匿名/跨域、私有 Prompt、跨用户 | 服务回归 + 新增正式 HTTP smoke |
| 凭据加密及用户隔离 | 核心 AES-GCM 篡改/跨用户测试 + 服务凭据测试 + 正式 HTTP CRUD |
| 公开/隐藏流式返回与脱敏 | 服务/HTTP 适配器测试 + Next.js NDJSON smoke；浏览器观察隐藏进度与汇总 |
| 本地 JSON 重启持久化 | 功能已移除；PostgreSQL 实库 smoke/迁移保留矩阵负责当前持久化边界 |
| Portable 静态文件白名单 | 功能已移除；smoke 检查旧源码/环境/数据路径不返回相关内容 |
| Portable 拒绝真实调用 | 功能已移除；正式服务不配置 Provider 时明确失败，不回退模拟模型 |

## 真实浏览器（不是 Portable，也不是仅 HTTP）

使用 Codex 内置 Chromium 页面，直接访问上述本地 Next.js 服务，无 HTTP 桥接。

- 桌面 1280×900、窄屏 390×844 检查：BYOK 空榜单；无 Demo 选项；登录页无快捷演示账号；Providers 空凭据状态。
- 通过临时账号登录，进入真实 React Flow 编辑器：未配置模型有明确提示，保存成功生成不可变 v1，点击运行被提示拦截。
- 发现既有窄屏固定 850px 工具栏/画布布局导致按钮不可达；改为可换行工具栏与纵向面板后复查，保存/运行/提交可见，运行拦截可操作。
- 同一测试账号在 3198 显式选择离线模型：浏览器实际公开运行 3/4，隐藏提交 8/12，显示模拟层级及汇总；未伪造全通过。
- 浏览器观察到加载状态、未配置错误、公开用例结果与隐藏运行中的进度。
- 测试恢复了浏览器尺寸；临时服务完成验证后停止。

## 限制与兼容

未调用真实 DeepSeek/其他付费模型；不验证 Key 是否仍有效、余额、上游可用性。
未进行生产部署、Docker 镜像构建、GitHub OAuth、全新依赖安装或远端 CI 执行。
源码可见的参考用例不构成生产保密评测；Verified Gateway 仍非完成能力。
没有 schema 变更、迁移改写或旧数据清理。临时隔离数据库保留供审阅，未删除其他数据库。

boot/providers 的 runtime 字段固定为 next，保留兼容响应；不再可配置第二种运行时。
历史 Portable 文档和截图仍是历史证据，不再作为当前维护或验收入口。
本次没有提交、推送、合并或发布。
