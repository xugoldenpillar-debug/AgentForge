# 可执行任务 L0–L8

> 首发范围调整：以 [BYOK 首发方案](byok-first.md) 为准；以下平台模型首发和美元上限要求由该调整覆盖，安全/资源限制与工程验收仍须完成。

状态均为 **未完成**。2026-09-07 已落地 L0/L1 目录切片；见 [实现状态](implementation-status.md) 与 [本次验证](../../../../docs/verification/animation-launch-df6c-2026-09-07.md)。父 AA 任务仍是能力总图；本表是两题产品的必交子集。只完成接口、fixture 或单测不能关闭任务。

依赖：L0 → L1/L2；L1+L2 → L3 → L4；L1可先做L5页面，L4后验收；L4 → L6；L5+L6 → L7 → L8。

| ID | 工作包 / 主要落点 | 必交产物与完成 Gate |
| --- | --- | --- |
| L0 | 发布契约冻结；specs、shared contracts、现有 schema/API 审计 | 固定题目/输出/动画/配额/评分版本；列出现有→新增实体/API映射、消息兼容；批准 provider/地区/预算/域名/审核负责人，未决项显式阻塞发布。不新建另一套 EF。 |
| L1 | 两题目录与配置保存；db、seed-core、agent-drafts、catalog-agent-build-resolver | 两题原文/顺序/不可变版本、平台环境/模型目录真实引用；配置保存/CAS/Fork/撤销/跨owner测试；幂等 seed 与迁移四项 Gate。无零 digest 或虚构平台模型。 |
| L2 | 真实沙箱与对象存储；server/sandbox、artifacts/durable、部署配置 | approved provider 真实 create/读写/停止/快照/清理、私有不可变对象适配器；实际隔离实例验证网络/资源/跨任务/停止/快照，非内存替身。 |
| L3 | EF creation v2 + Pi executor；evaluation、runtime/pi、worker、factory | 真实 Pi SDK 工具循环、模型Invocation、额度/预算、幂等入队、lease/fence、取消、核查、崩溃恢复；真实PG/Redis/沙箱集成；生产 API不再无条件503，也不降级。 |
| L4 | 封存与动画预览；artifacts、artifact-preview、独立预览入口 | 安全转换、CSS/SVG动画、授权资源、暂停/重播/减少动态效果；immutable snapshot→对象→manifest原子登记；真实浏览器安全和动画Gate。 |
| L5 | 两题完整创作界面；arena-app、agent-builder、client-api、i18n | 首发专区/详情/题目参数、模型Skill配置、保存运行、事件恢复/取消、真实文件与预览/下载；删除产品路径fixture。桌面/窄屏、中英文、异常状态可用。 |
| L6 | 发布/点赞/盲选/评分/榜单；showcase、voting、db、http、页面 | durable repository接线；审核/举报/撤下；点赞唯一约束与幂等；服务端comparator、最低样本、重算审计、榜单缓存失效；多用户真实DB并发验证与浏览器闭环。 |
| L7 | 产品验收；tests、scripts、docs/verification | 按verification.md逐项记录。两道原题各至少一次授权真实模型运行，真实SVG动画、持久预览、发布/点赞/票/榜单/Fork证据；安全恶意用例与旧DAG回归，不以历史模型样本替代。 |
| L8 | 全用户开放；availability、认证准入、运维文档/发布配置 | 产品入口取消Pi邀请限制但保留认证/封禁/额度；全局预算/并发、审核值守、kill-switch、回滚/告警/备份验证；先验证目标部署再全用户开放。记录部署SHA、迁移、域名、开启范围、日期、负责人。 |

## 实施切分与停止条件

- L0/L1 可作为第一原子提交；L2/L3 是执行核心；L4/L5 是可用创作；L6 是社区；L7/L8 是发布，不把其拆分误解为只交前半段。
- L1/L5 完成后可显示“即将开放”题面，不能标 active run；题目上架可见与真实运行可用是不同状态。
- 拒绝通过设置开关、删除 gate、伪造作品/票、自动给旧用户写 invited 或复用本机文件目录来完成任务。
- 任一安全/持久化/费用Gate失败：停止新运行或发布；保留取消、核查、审核和合法历史读取。不得绕过CI。
- 自由问题UI、任意环境画布组合、Python、hidden Judge、JS单独进入后续任务；本次不以“先做通用平台”为理由推迟两题闭环。
