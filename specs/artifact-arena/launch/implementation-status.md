# 当前实现、契约映射与发布阻塞

2026-09-07；本文件记录 df6c worktree 的实际增量，不代表 L0–L8 完成。

## 已实现切片

- `animationChallenges` / `animationChallengeVersions`：两题专用目录，不复用旧 Problem/TestSuite；数据库 ID 与 slug 分离，版本编号唯一，原文与 English 翻译独立保存。
- `0012_animation_challenge_catalog.sql`：增量建表、外键、唯一约束。旧 migration 不改 checksum；目标 SQL 与 Drizzle 同步。
- `seedCore`：同一事务只补缺失题目版本；发现原版本内容或 digest 漂移报冲突，不覆盖。保留已有 draft/retired 状态。不插入账号、作品、投票或运行。
- `GET /api/arena/animation-challenges`：公开读取数据库已 published 的目录，包含历史版本和输出政策；明确返回运行依赖不可用。published 是题目可见，不是执行开关。
- `src/shared/animation-challenge.ts`：冻结 svg-animation-v1 候选限制和社区门槛；不是 renderer、计费授权或已实现的共享配额。
- 版本目前通过应用 insert-only 路径和 seed 防漂移保护；数据库高权限直接 UPDATE/DELETE 尚无不可变触发器，不应视为全面防篡改验收。

## 后续必须复用的实体与入口

| 需求 | 已有落点 | 尚缺工作 |
| --- | --- | --- |
| 挑战到配置 | Agent Build/BuildVersion、agent-drafts、catalog-agent-build-resolver | challengeVersionId 绑定，权威环境/模型版本解析与真实配置保存测试 |
| 题目内容到执行 | CreationBrief/Version、CreationRun、creation build context v1 | creation v2 增量契约与可空挑战引用；不得把新字段塞入 strict v1 |
| 异步执行 | EF jobs/attempts/invocations/reservations/outbox、BullMQ worker | v2 message/purpose、Pi 执行器与计费/取消/核查完整接线；先兼容 consumer 再启 producer |
| 隔离与存储 | SandboxProvider、collector、ArtifactBundle/manifest、durable read port | 真实隔离 provider、不可变私有对象存储、停止/快照证明 |
| 作品与动画 | artifact preview、read authorization | 结构化净化、受限 CSS/SVG 动画、独立域与浏览器控制；不改变旧静态 renderer 冒充动画支持 |
| 社区 | WorkPublication、ShowcaseEntry/Ballot/Vote/audit、durable repository | 生产接线、WorkLike、持久 season/comparator、独立选民门槛、共享限流、审核 UI |

## 待补齐的发布参数（后续 hubei 授权见下）

没有从本机配置、其他 worktree 或插件账号推断授权，也未采购/调用真实模型/部署。

- 沙箱：供应商、地区、镜像 digest、网络和资源限制、容量/价格、停止/快照契约、退出方案。
- 对象存储：供应商、地区、私有桶与不可变对象方案、保留期、孤儿审计、备份恢复。
- 模型：平台批准模型固定版本、价格、凭据安全注入来源、两题真实验收的总费用上限。
- 公开部署：目标环境/数据库/主域、无共享 Cookie 的预览域、全站日预算和并发、告警与审核负责人。

这些缺口阻塞依赖验收和发布；不阻塞后续代码实现。旧每 run USD 0.10 候选值已由 BYOK 首发调整覆盖；仍未授权使用任何现有真实模型凭据。L0 尚未完整关闭，L1 仅目录切片，L2–L8 未交付。本轮未改变 PoC 邀请 gate、运行开关或生产权限。

## BYOK 首发后续增量

用户已覆盖平台模型首发和美元上限要求，见 [BYOK 首发调整](byok-first.md)。
已完成四种协议的凭据持久化/SDK/UI接入与本地验证，见
[本次验证](../../../../docs/verification/byok-protocols-df6c-2026-09-07.md)。
这只接入现有模型适配器，不代表 creation v2、真实沙箱或社区闭环完成。
目录提交为 e08de60；后续 BYOK 与部署脚本在本轮交付，实际 Git 状态以提交日志为准，未上线。

## hubei 实机后续验证与部署工具

用户已明确授权 hubei 安装 gVisor、创建专用测试资源。`scripts/deploy/sandbox-smoke.py`
在实机运行通过；安装器重复执行通过。不会改变 Docker 默认 runtime，也不重启旧容器。
固定版本、镜像 digest、清理结果与未验收项见
[部署文档](../../../../docs/deployment/hubei-byok.md) 和
[实机验证](../../../../docs/verification/hubei-gvisor-deployment-2026-09-07.md)。

这是 L2 基础设施的实测进展，**不是生产 SandboxProvider 的应用接线**。archive 仍是本地测试文件，
不是对象存储。主站生产数据库、对象存储、预览域和 creation v2 社区闭环仍未交付；L2–L8 不关闭。
