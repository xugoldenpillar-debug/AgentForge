# Artifact Arena 需求

状态：目标要求。实现完成必须有对应任务和验收证据，不能按本表直接打开功能开关。

## 用户旅程

- 挑战：Problem → Agent Build → Run → Artifact Preview → 作品参赛或隐藏 Submit → 相应评分/榜单 → 有权 Fork。
- 自由创作：私有问题/附件 → Agent Build → Creation Run → Artifact Preview → 可选发布。无需造隐藏用例或竞技成绩。
- 复用：选择固定 Skill/环境版本；作品公开与做法可 Fork 分开。无权引用的私有 Skill 不复制、不泄露、不静默替换。

| ID | 可验收要求 | 反例 / 限制 | 工作包 |
| --- | --- | --- | --- |
| AA1 | Agent/Workflow 模式、runtime、trust lane 分离 | 关闭 Pi 不得转 DAG；不自动取得 Verified | T1/T3 |
| AA2 | 复用 Build/不可变版本/CAS/Fork；引用固定版本与摘要 | 运行中保存不得改变当前 Attempt | T1 |
| AA3 | Skill 导入只产生私有声明式组件版本，复用许可/撤销政策 | `scripts/`、扩展或包安装不会自动执行 | T1 |
| AA4 | 单 Agent 使用平台批准环境和 broker；EF 统一准入、占用和记账 | Pi 专用内存锁、私有预算不得成为生产路径 | T2/T3 |
| AA5 | 冻结问题、输入、Skill、模型、环境、输出规则和同意版本 | 不能用 latest 或客户端摘要替代权威身份 | T1/T3 |
| AA6 | 文件列表/读取/预览/下载基于授权、配额和封存摘要 | 猜 artifact ID、路径替换、旧 Attempt 写回失败 | T4 |
| AA7 | HTML/MD/SVG/图片/JSON/CSV/TXT 安全预览；工作中/正式版本分开 | 主站不得执行生成脚本；隐藏文件名也不能展示 | T4/T5 |
| AA8 | 创建者可输入自由问题，使用独立 CreationRun 和 EF 用途 | 不伪装为 Author Self-Test，不放宽官方凭据自测政策 | T6 |
| AA9 | 发布记录绑定完整封存 bundle；公开前审核内容和公开权利 | 私有附件/Prompt 不因发布输出而一起公开 | T7 |
| AA10 | 作品参赛记录与隐藏竞技 Submission 分开 | 公开作品不能直接写旧 Submission、奖励或 rating | T7/T8 |
| AA11 | 同题同规则 A/B 盲选，平局/跳过、幂等、禁自投、限频、最低样本 | 暴露作者/模型/热度后收票，刷票或低曝光直接判低分 | T7 |
| AA12 | 合规结果、社区偏好、效率分开展示；分 trust lane/Profile/runtime | 社区票不能改历史 DAG 权重或把 BYOK 升 Verified | T7/T8 |
| AA13 | 环境画布只编译批准的声明式配置；运行中只读配置 | 任意 Dockerfile、host mount、shell 或实时提权不支持 | T9 |
| AA14 | 取消确认、事件游标/状态重连、不确定费用核查 | 刷新重跑、超时立即释放全部占用、故障自动再付费不支持 | T3 |
| AA15 | 实际 Next.js 桌面/窄屏、加载/空/错误/拒绝/撤下状态可用 | HTTP 测试或截图原型不能替代浏览器验收 | T5/T7/T9 |
| AA16 | 版本兼容、审计、保留/清理与生产退出策略明确 | 不改旧迁移 checksum，不清理既有数据 | T0/T10 |

## 首版范围与非目标

- 先固定环境模板，首选 Pi；不升级 core 依赖、不引入 coding-agent CLI 自动配置读取。
- 首版静态视觉作品和 Python 标准库任务；Python 执行仅批准脚本参数的沙箱能力，不暴露任意 shell。
- 首版可见文件格式见 security；交互 JavaScript、MDX、任意 npm/pip、常驻服务、外部网络、可执行 Skill、多 Agent、MCP 写操作、厂商 runtime 属独立后续 Gate。
- 不实现钱包、付费排名、自动 AI 审美总分或新的 Verified 链；不把投票当成科学模型评测。
- 允许以后选择同一安全预览架构的 JS 档位，但它不是本轮 MVP 交付条件，静态档位不为迁就 JS 放权。

## 已选政策与尚待冻结项

已选：作品和做法分离、隐藏数据不可发布、投票不得覆盖竞技、固定环境先行、声明式 Skill、环境修改只影响后续运行。

待 T0/T2/T7 产出：沙箱/对象存储提供商与地区、镜像 digest、生产资源上限与价格来源、文件保留与删除政策、审核责任人与值守、投票阈值的上线确认。可先完成纯契约和 UI；缺这些项阻止实际开放，不允许开发者自行采购或用猜测的配额/价格补齐。
