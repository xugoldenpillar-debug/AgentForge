# 文档冲突裁决与兼容台账

日期：2026-09-07。本表只修改目标描述或纠正当前代码事实，不重新解释历史测试。源码与本次实际验收决定“已实现”；产品 spec 决定“拟新增”；原安全/预算/隐私约束保留。

| 冲突 | 裁决 | 同步位置 |
| --- | --- | --- |
| Agent 原 AM12“唯一 Python CSV MVP” vs 视觉作品需求 | 静态 HTML/SVG + MD 是首个用户样板；Python CSV/JSON/MD 留作确定性工程/隐藏评测轨，各自固定模板 | agent-mode README/requirements/tasks |
| 原预览“所有 HTML/SVG 仅文本” vs 多格式观赏 | 允许经过 S3/S4 Gate 的独立域静态预览；主站不执行，JS/MDX 仍不在 MVP | agent-mode design、security |
| 旧 Submission 仅完整隐藏 vs 公开作品投票 | 保留 Submission 原义；新增 WorkPublication/ShowcaseEntry，投票不写竞技记录/rating/Verified | design、SCORING、CONTEXT |
| AA-T8 Agent judge vs 旧 Judge/Score | 先建立独立 `agent-showcase-score-v1` admission/normalization seam；不复用 `Judge.evaluate(expected, actual, context)`、`src/lib/scoring` 或 DAG 45/20/15/10/10，不生成旧 Submission | `src/server/evaluation/adapters/agent-showcase.ts`、design、SCORING |
| hidden evidence vs public/answer-shaped input | adapter 只接收 sealed hidden evidence 的 opaque ref + digest；禁止 public bundle、`expected`、`actual`、答案、trace 和原始文件进入 boundary；缺 server-owned resolver/approved judge 统一 503 fail closed | `src/server/evaluation/adapters/agent-showcase.ts`、verification |
| 自由问题 vs EF 仅三用途、snapshot 强制 Suite、Build 必须 problemId | T6 显式版本化 creation purpose/association/输入与构建上下文；不伪造 Suite，不冒充 Author Self-Test | design、EF README |
| Q23 只提竞技/自测 vs 新用途 | creation 加入同一用户执行名额与供应商总额度，单独用途预算；Q15 自测仍仅作者官方凭据 | design、EF README |
| “Worker/Outbox 未实现” vs 当前 EF/迁移/脚本已存在 | 改为已有公共代码、各场景按证据验收；Agent/Pi 可靠接入尚未实现，邮件/生产 Gate 不因此完成 | README、ARCHITECTURE、SCORING、EF README、agent-mode/pi-runtime |
| “Contributors do not install Pi” vs package.json 钉住 Pi core | 普通 pnpm 安装包含钉住 core，默认不启用；Node Pi gate 不变，不新增 coding-agent 包 | README |
| “没有锁文件” vs 已跟踪 pnpm-lock.yaml | 文档纠正；不改锁文件/依赖，lint/format 缺口保留 | README |
| Pi 分支原 0003/0004/0005 vs 主序列 0007/0008/0009 | 当前说明使用主序列；标注旧号为 immutable 历史，不改旧 SQL/checksum 或历史执行记录 | pi-runtime design、agent-mode design/tasks |
| AM2 expectedVersionId vs 实际 B2 currentVersionId | currentVersionId 是现有 HTTP CAS 字段；不新增别名 | agent-mode requirements |
| Pi 目标“永不竞技” vs 验收后 Agent 竞技 | 当前不可竞技；未来仅 T8 + 原 Profile/trust/Gateway Gate 允许，默认不与 DAG 同榜 | ARCHITECTURE、pi-runtime design |
| 自由环境画布 vs DAG 数据依赖/必经 Model | 两种图 schema/compiler/validator；复用 UI，不放宽 DAG 规则 | design、ARCHITECTURE |
| “实时搭建” vs 不可变证据 | 实时编辑/校验/观察；生效于新运行，当前 Attempt 权限不能热变更 | requirements/design |
| 根规范禁止新增用户代码 vs 批准沙箱能力 | 宿主执行/任意 shell 仍禁止；仅本 spec Gate 下的平台批准隔离能力可作为后续实现，本文不立即启用或授权付费 | AGENTS.md |
| 旧 B1/B2/Pi 样本 vs 本次文档 | 原报告日期/数量/归属不改为“本次通过”；新增文档验证记录，运行 Gate 保持未验收 | VERIFICATION、verification.md |

## 不覆盖的规则

- Q1–Q25 的权威状态、取消确认、不确定付费停止、组件撤销、邮件过渡、缓存/自测保留规则。
- Verified 的独立网关/Receipt/Ticket/Profile/Season；沙箱、官方模型或投票不能取代。
- 隐藏输入/答案/输出/路径/日志不公开；作品投票仅公开反馈或自由创作的合资格 bundle。
- 历史 DAG 评分和版本；不可变迁移 checksum、Portable 历史保留、生产与真实费用另授权。

AA-T8 的当前状态是“契约切片，未开放”：fake judge 只为契约测试注入，不能把测试分数、内存
resolver 或本地 score record 当作生产 hidden evaluation 证据。真实 Profile/Season/Suite、批准
judge、Pi/EF/approved sandbox 执行链、durable persistence、失败分类与排行榜仍须通过后续 Gate。

## 历史文档处理

带明确历史日期/分支/执行记录的文档（包括 upstream-evidence、pi0-freeze、verification、ADR）保留原证据，不批量替换过去的迁移号、测试数或未安装状态。现行索引/目标入口指向本表；新增状态说明不能冒充重新运行历史测试。后续实现若改变本表决定，同一变更更新双方文档与 Gate，不只追加一份互相矛盾的新 spec。

## 关联入口补充校正

组件 README 的“整个组件库未实现”和“公共基础尚未实现”改为已有切片/待场景 Gate，EF integration 标题收窄为组件联合目标。source-export-inventory 保留 2026-09-06 原审计，但加当前状态注，不再让其“没有锁文件”成为现行安装指令；这不撤销 REVIEW_REQUIRED 或批准公开导出。
