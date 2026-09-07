# Agent mode requirements（提案）

本页所有 AM 要求均为未来验收要求，不是当前能力；实施授权见 [README](README.md)。

| ID | 要求 | 必须覆盖的反例 |
| --- | --- | --- |
| AM1 | 复用 Problem → Build → Run → Submit → Score → Leaderboard → Fork；Agent 定义与 Workflow 定义互斥，禁止隐式转换/回退 | 将 DAG 直接交给 Pi，或关闭 Pi 后静默换引擎 |
| AM2 | 复用 Build/不可变 BuildVersion/竞技 Run/Submission；固定不可变 ComponentVersion；保存沿实际 HTTP currentVersionId 做 CAS 并发校验 | 保存冲突、运行中改草稿、组件发布新版本均不得替换执行快照 |
| AM3 | 服务端冻结输入、版本、能力和现有 Benchmark Profile/Season/Suite/Scoring 身份 | 客户端提供 judge 答案、可变 latest 引用、重放同键不同内容 |
| AM4 | 保存、读取、下载、导出和 Fork 均检查所有权/许可/私有引用；Fork 选定版本并清除全部凭据引用 | 禁止通过公开 Agent Build 复制他人私有 Prompt/Skill；无合法引用时拒绝，不静默公开或替换 |
| AM5 | 声明式 Skills 优先，能力最小授权；未来 MCP 先批准的只读服务/工具版本 | 私用也不得越过准入；Skill 文本/MCP 描述不是授权，不隐式安装或加载远程资源 |
| AM6 | 不可信代码（首期仅批准 Python 能力）仅在 Next.js/Worker 宿主之外的隔离沙箱；无宿主 shell、宿主目录或生产网络/秘密 | 独立 Worker 本身不等于沙箱；拒绝挂载 Docker socket、宿主凭据和任意出站 |
| AM7 | collector 控制路径、文件类型、symlink/hardlink、配额、封存与竞态；judge 只读独立副本 | 穿越、链接替换、检查后改文件、压缩炸弹、无限输出不能进入可信 manifest |
| AM8 | 隐藏测试的输入、逐条输出、artifact、文件名与错误细节不可通过事件、下载或预览泄露 | 即使 Run 所有者也不能下载隐藏产物；不能仅隐藏 UI 按钮 |
| AM9 | 复用持久化 Job/Attempt/Invocation/Outbox Worker、容量与预算；故障不自动续跑已发生调用的评测 | 重复投递、旧租约写回、断线刷新、取消竞态不能重复付费或拼成绩 |
| AM10 | 独立 judge + 确定性 Scoring；产物不合格与基础设施未完成分开；仅完整合资格隐藏 Run 可提交 | 不能把存储/沙箱故障记为选手零分；不能用 Agent 自报通过或 DAG 节点 Elegance |
| AM11 | comparator 限定 Profile version/Season/Suite/Scoring、mode/runtime 兼容政策和 trust lane | 无明确兼容协议不跨 Agent/Workflow 比较，不用 BYOK 自报成本争夺 Verified 榜 |
| AM12 | 首个用户样板为单 Agent 静态 HTML/SVG+MD，Python CSV+JSON+报告保留为工程轨；静态预览与执行分别过 Gate | 文档、Pi 单次样本、离线测试不能代替真实沙箱/浏览器/竞技验收 |

## Q1–Q25 对齐（不重开已确认政策）

- Q1–Q4：竞技 Run 与作者 SelfTestRun 共用基础、业务记录/权限/证据分离；异步查询，取消须执行者确认；自测有限额。自测不写竞技 Run/Submission，不发竞技奖励。
- Q5–Q7、Q11、Q19：PostgreSQL 权威状态、Redis/BullMQ、事务 Outbox、独立 Node Worker；Job 仅关联一种业务记录，可以有多个 Attempt。Redis 故障拒绝新真实调用，不以 Next.js 内存任务替代。
- Q8–Q10、Q12–Q13：首版声明式 Skill、固定组件/样例版本；普通撤回阻止新引用，合法旧引用保留；安全撤销在入口与受控步骤检查；平台复测另行批准，不混同人工审核。
- Q14–Q15、Q20：共用预算预占/用量账本而非钱包；自测仅作者 Official 凭据且显式费用/数据同意，不自动探测；未知用量保留核查状态，预占不是实际支出，不盲目释放全部预占。
- Q16–Q18、Q22：自测明细默认 30 天/可提前删除，最小审计和缺失标记保留；不套用到隐藏数据或 Receipt，不授权现时删数据。邮件独立消费者；本地 Redis/生产 HA 仍须各自验证。
- Q21：邮件功能验收后才启用新真实评测/自测/投稿门槛；未验证者仍可登录、读历史、编辑草稿，老用户提前告知，已接收作业不追溯取消，重置密码撤销旧会话。
- Q23：跨竞技/自测每用户一个执行名额，排队总上限待测；预算按用途隔离、供应商真实额度全局共享，平台复测独立主体，邮件不占名额。
- Q24：未发模型调用可安全恢复；发生调用后中断不自动重调或跨故障续跑。允许的部分结果保留但整体未完成，无 Submission。全部结果已持久化仅可幂等收尾，用户重跑须新评测、新同意。
- Q25：公开列表约 30 秒目标滞后/事件失效/TTL；完成页和状态查权威源。权限、凭据、预算与撤销不可用缓存作准；故障不承诺无条件刷新时限。

## 作品 spec 增量

[AA1–AA16](../artifact-arena/requirements.md) 补充发布/自由问题/盲选/环境画布；具体任务见 [AA-T0–T10](../artifact-arena/tasks.md)。AM10 的 Submission 仍仅隐藏竞技，社区投票使用独立 ShowcaseEntry；creation 新用途共享 Q23 名额，不把自由问题当 Q15 Author Self-Test。以上是新增目标，不改变当前 B2 private/unconfigured 限制。
