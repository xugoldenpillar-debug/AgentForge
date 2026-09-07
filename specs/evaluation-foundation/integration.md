# 评测基础与组件库：跨分支交付边界

日期：2026-09-06；当前 EF 代码状态补充见 [`docs/PI-MAIN-INTEGRATION-REVIEW.md`](../../docs/PI-MAIN-INTEGRATION-REVIEW.md)。本文件保留跨分支设计边界；已落地的 EF 基础代码不等于社区/Verified 联合接入完成，也不代表其他分支已同步。

| 归属 | 负责内容 |
| --- | --- |
| evaluation-foundation | EvaluationJob／Attempt／Invocation、Outbox、Worker、幂等、取消／中断／超时收敛；共享容量／预算服务；现有竞技 Run 接入 |
| community | Component／ComponentVersion／Attachment／TestSuite、SelfTestRun 业务记录、导入导出、审核发布、引用和撤销政策；保存与唯一 EvaluationJob 的业务关联 |
| 联合 T5 | 冻结执行输入、以一个原子边界创建 SelfTestRun + EvaluationJob + Outbox 关联、组件授权／撤销回调、安全结果投影、自测 UI 和联合故障测试 |
| 后续独立工作包 | 邮箱流程、公开查询缓存；不混入首个基础 PR，但相关能力开放须满足对应 Gate |

## 顺序

- 组件 T1 和不依赖作业表的 T2/T3 可先开发。
- 在写 T5 代码前共同冻结：业务关联约束、创建幂等作用域/摘要、状态/错误、查询/取消投影、用量归属、撤销回调、API/Worker 消息版本。
- 基础层不预先创建整个组件库，也不宣称测试适配器等于真实社区自测。
- 组件层不直接依赖 BullMQ、不另设 Provider 限流/预算账本，不自行调用当前长请求 run 作为临时生产路径。
- T5 开放真实调用前，基础执行、容量/费用、Official 凭据准入、组件版本权限必须共同验收。T6 另需审核身份、禁自审、审计及许可 Gate。

## 并行开发保护

- schema.ts/schema.sql、共享类型、package.json/锁文件由各 PR 按范围协调；接口未冻结时不各自发明同名契约。
- SQL 迁移在集成前协调顺序、名称和 checksum；已经应用的迁移不改写，为新增兼容调整另写迁移。
- 不同本地服务使用独立端口、测试数据库和队列前缀，避免跨 worktree 消费或迁移。
- 跨分支设计更新须在用户授权后，通过 merge/cherry-pick 显式集成包含这些文档的提交；以各 worktree 的实际 HEAD 和工作区状态确认同步，不直接覆盖其未提交文件。

## 联合接口约束（设计边界，联合接入未完成）

社区侧提交冻结的 ComponentVersion、TestSuiteVersion、运行时／策略身份、作者凭据准入结果、同意版本和稳定幂等键；evaluation-foundation 校验并创建唯一 EvaluationJob，负责排队、Attempt／Invocation、Outbox 投递、Worker 执行、容量／预算预占与结算、取消和不确定上游状态收敛。社区侧只记录 SelfTestRun 与 Job 的关联，并消费安全状态／汇总投影。

创建必须是可重试而不重复付费的联合操作：请求摘要与幂等键绑定，内容变化必须拒绝；页面断线不等于取消；取消由基础层推进，组件撤销检查在 Worker 开始前及后续受控步骤执行。组件版本或凭据在排队期间失效时，基础层不得继续实际调用。部分样例失败可以形成完成报告，基础设施中断不得伪造完整报告。

## 联合验收

自测不生成竞技成绩／奖励；跨入口用户并发为一；同上游额度不被队列数放大；草稿变化不影响排队快照；排队期间撤销能生效；中断不重复付费；重置后旧会话失效；明细清理后证据正确标记。所有项需要实现后的实际证据，不提前打勾。
