# 本机验证记录（历史）

> **历史验证记录 / Historical verification record：2026-09-06。** 本文只汇总一次本地验证的范围和结果，不代表当前运行。为避免把一次性环境误当作长期配置，本文不记录绝对工作目录、端口、PID、容器名、卷名或临时日志位置。需要重新验证时，请为当前任务创建新的隔离资源，并以 `README.md`、`docs/MIGRATIONS.md` 和 `docs/evaluation-worker-operations.md` 为准。

## 验证范围

- 使用 Next.js + PostgreSQL + Better Auth 的当前应用运行时；Portable 记录只作为退役历史，不是当前验收入口。
- 使用显式测试模式运行离线 Demo；未把测试配置当作生产配置。
- 使用一次性隔离数据库和本地服务检查迁移、认证、Build/Run/Submit、排行榜、Fork、凭据隔离和隐藏结果投影。
- 另行记录了有限的官方 DeepSeek Flash/BYOK 样本；该样本有单独授权，不属于普通 Demo 验收，也不属于 Verified 或生产验收。

## 历史结果

| 验证项 | 历史结果 | 边界 |
| --- | --- | --- |
| 单元/服务/HTTP 回归 | 通过 | 证明已覆盖的代码契约，不替代生产验收 |
| PostgreSQL 迁移矩阵 | 通过 | 覆盖新库、旧库升级、重复执行、回滚、并发锁和数据保留 |
| Next.js + PostgreSQL + Better Auth smoke | 通过 | 覆盖认证、会话撤销、挑战运行、隐藏提交、排行榜和 Fork |
| React/React Flow 浏览器检查 | 通过部分关键路径 | 需按对应 dated verification 文档阅读；未宣称全面浏览器或无障碍验收 |
| 390px 窄屏 | 曾发现并修复部分布局问题 | 每次 UI 变更仍需在真实目标前端复测，中文文本可能改变布局 |
| Demo 挑战循环 | 通过 | 模拟模型结果只证明配置的图可以执行，不证明真实模型质量 |
| DeepSeek Flash/BYOK | 一次授权样本通过 | 不代表 Verified、余额、持续可用性、成本或生产安全 |
| 生产部署、托管 Redis、CI 全流程 | 未执行/未验收 | 仍是后续部署 Gate |

## 结果解读

- `APP_ENV=test` + `DEMO_MODE=true` 是隔离测试开关；正常初始化不会创建模拟账号、运行或成绩。
- BYOK 凭据保持用户隔离并使用认证加密；真实模型失败不会静默回退到 Demo。
- Evaluation Foundation 的代码切片和独立 Worker 回归已在当前合并中存在，但 Worker 部署、社区 SelfTestRun 联合接入、Verified Gateway 全链路、Pi 共享持久化准入和 Agent 沙箱仍未完成。
- 退役 Portable 的历史截图和检查不证明 React 前端、浏览器原生 Cookie/流式行为或生产安全。

## 复现指引

当前应用的通用验证顺序：

```sh
pnpm install
pnpm run setup
docker compose up -d postgres
pnpm db
pnpm test
pnpm typecheck
pnpm build
```

迁移矩阵必须显式设置一次性本地 `MIGRATION_TEST_DATABASE_URL`；完整 smoke 必须显式设置当前任务的 `SMOKE_BASE_URL`，并使用隔离的测试数据库。不要复用工作数据库、生产凭据或其他任务的服务。

各项历史证据：

- `docs/verification/retire-portable-2026-09-06.md`：Portable 退役和当前 Next.js 收敛记录；
- `docs/verification/deepseek-app-live-2026-09-06.md`：一次应用侧 Flash/BYOK 样本；
- `docs/verification/deepseek-gateway-phase0-2026-09-06.md`：Gateway 基础代码和阶段边界；
- `docs/VERIFICATION.md`：更早的验证矩阵及其限制；
- `docs/PI-MAIN-INTEGRATION-REVIEW.md`：当前合并的稳定状态汇总。
