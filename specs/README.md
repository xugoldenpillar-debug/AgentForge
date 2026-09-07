# AgentForge 全项目设计地图

更新：2026-09-07。设计已确认不等于实现，历史测试通过不等于当前生产验收；各子目录需以自身状态说明和当前交付评审为准。

## 文档职责

- [当前架构](../docs/ARCHITECTURE.md)：描述现有代码与缺口，目标另列。
- [术语](../CONTEXT.md)：只定义领域概念；[ADR](../docs/adr/) 记录选择与演进，不抹除历史理由。
- [评测基础](evaluation-foundation/README.md)：Q1–Q25；已有公共任务/Outbox/Worker 代码，各用途与容量/费用/缓存/邮件 Gate 分别验收，不一概视为已完成。
- [社区组件](community-component-library/README.md)：创作、版本、自测、审核发布、使用与撤销。
- [可信网关](deepseek-verified-gateway/design.md)：Official/Custom/Verified、Registry、Profile/Season、Ticket、Receipt、独立私有网关。
- [Agent Build 模式](agent-mode/README.md)：B1/B2 私有未配置草稿已实现，B3/执行/沙箱未交付；五契约与 A–F Gate 保留。模式/runtime/trust 分开。
- [Pi](pi-runtime/design.md)：可选执行适配器，默认关闭、离线 PoC，不能旁路公共控制。
- [作品挑战赛](artifact-arena/README.md)：可执行 AA-T0–T10 spec，静态作品/多格式预览/自由问题/投票/环境画布；当前为部分契约、迁移、领域 seam 和基础 UI，生产能力尚未开放。旧目标冲突见其 reconciliation。
- [厂商 SDK](vendor-agent-sdk/roadmap.md)：未来候选协议，不在本轮实现，也不自动取得 Verified。

## 统一目标与所有权

| 层 | 负责 | 禁止重复建设/混淆 |
| --- | --- | --- |
| Next.js API + 独立 Worker | 唯一 Web 应用与服务端执行进程 | Worker 不是恢复 Portable，也不是微服务拆分承诺 |
| evaluation-foundation | Job/Attempt、Outbox、幂等、执行占用、调用/用量、预算服务 | 不另建 verified_jobs 或 Pi 自己的付费队列 |
| 竞技与 Verified | Run/Submission、Profile/Season、Receipt、Ticket 政策 | 自测与平台组件效果评测不生成竞技认证 |
| community | Component/Version/样例、SelfTestRun、投稿/审核/发布/依赖资格 | 审核不是付费效果评测，草稿不是冻结证据 |
| 作品领域 | ArtifactBundle/发布/ShowcaseEntry/投票；creation 扩展公共 EF | 不伪造隐藏 Submission，不新建 Pi/Agent 队列 |
| Runtime adapter | DAG；Pi 验收后可选 | 运行时不得拥有独立绕过预算/授权/出站的能力 |
| 独立私有 Gateway | 受控模型出口、Receipt、供应商费用与紧急限额 | 保留 ADR-0006 隔离；不读取整个 Suite、不写榜单 |

Verified 属于竞技隐藏评测中的信任政策，不是可绕过用户总并发的另一个任务类别。共享预算基础与 Gateway 紧急熔断是不同防线；Benchmark Cost、Actual Platform Spend、Ticket 与执行预算不可混为余额。

## 依赖与交付

```text
EF 公共契约 → 可靠执行 → 容量/费用 Gate → 现有竞技迁移
    ├─ community T2/T3 → T5 联合接入 → 投稿/发布/撤销 Gate
    ├─ Gateway Phase 5 接入 + 原 Registry/Ticket/Receipt/Gateway Gate → Verified
    └─ Pi 离线 PoC → PI0–PI4 + 公共执行 Gate → 受邀启用
邮件工作包 → 邮件验收/告知 → 新评测与投稿验证门槛
查询优化 → 公开缓存工作包（非权限事实来源）
平台精选复测/脚本/MCP/厂商 SDK：后续独立准入和费用批准
```

这不是要求 community 等 Verified 全部完成：作者自测需要自己的 Official 凭据准入和公共执行保护，不要求平台认证链先上线。T1 展示与独立 T2/T3 可先推进；跨分支接口/迁移须协调，见 [交付边界](evaluation-foundation/integration.md)。

## 发布与保留边界

- 首版每用户跨竞技/自测一个执行名额；作品 spec 的 creation 也加入该总名额，不扩大 Q23 上限；共享供应商账号的实际额度不可因队列分组倍增。
- 不确定调用停止自动执行，不把预占当实际花费。已完整持久化结果的幂等收尾不等于付费重跑。
- 自测明细 30 天是 Q22 政策；Gateway Receipt/审计依原 R17 保留，不能套用自测清理任务。
- 排队时间不计入模型效率评分；不完整竞技执行无 Submission，测试用例判错不等于基础设施失败。
- 邮件/缓存是独立交付包；政策已确认，代码未实现。生产托管 Redis 目标不等于已选择厂商/购买服务。
- 核心私有、组件/SDK 分层公开按 D4；未授权修改仓库可见性/许可或公开历史。

## 对齐仍不等于实施就绪

具体表字段、外键、状态转移、消息/API 版本、数值容量、幂等事务、迁移兼容和联合测试仍须技术设计冻结。许可名单、Pi 依赖验证、生产服务商等原门禁不被覆盖。新出现的产品取舍再讨论；不以措辞一致代替实际验收。
