# 实现设计：复用现有机制，补齐真实接线

> 首发范围调整：以 [BYOK 首发方案](byok-first.md) 为准；以下平台模型首发和美元上限要求由该调整覆盖，安全/资源限制与工程验收仍须完成。

## I1. 数据与权威目录

复用 Build/BuildVersion、CreationBrief/Version、CreationRun、EnvironmentTemplate/Version、ArtifactBundle/manifest、WorkPublication、ShowcaseEntry 和 Voting 领域服务。不把作品写成旧 Submission，不改旧 DAG JudgeId/评分。

拟新增（L0 必须先映射现有 schema，等价实体已存在则复用）：

| 对象/扩展 | 约束 |
| --- | --- |
| ArtifactChallenge / Version | 稳定 slug、顺序、draft/published/retired；版本固定原题、输出政策、环境/brief 引用和 digest；公开只读目录 |
| CreationRun v2 challengeVersionId | 可空关联，固定两题时必填；服务端解析 brief/环境，禁止客户端伪造 |
| Showcase season/comparator 持久政策 | 服务端拥有政策版本、预算档、信任分区、活动窗口，不能用客户端 comparator 字符串授权 |
| WorkLike | publicationId + userId 唯一；外键、时间，幂等删除；统计按有效作品计算 |
| 审核/举报/限流记录 | 沿用现有社区角色与审计机制，必要时 additive 扩展，不由客户端传管理员身份 |

保持 `schema.ts` / `schema.sql` / repository / seed 同步；使用现有迁移台账新增下一个未占用编号，不编辑 0010/0011 checksum。初始化只写两题和平台目录版本，不制造用户、作品、票数。全新库、旧库升级、重复执行、旧数据保留都要验收。

## I2. 真实 Pi 运行链

Next.js API → 身份/配额/版本解析 → EF durable job/outbox + 预算预留 → BullMQ worker → 真实 Pi core + 既有模型适配器 → 受限工具 broker → approved SandboxProvider → 停止确认/稳定 snapshot → Artifact 对象存储 → sealed manifest → CreationRun completed。

- 扩展现有 EF purpose/snapshot/message 为 creation v2，不伪造 TestSuite，不调用旧 request-bound Pi self-test；旧消息继续可消费，先发布兼容 worker 再启用生产者。
- Pi 控制循环在可信 worker，生成内容与 Skill 始终不获得宿主文件/shell 权限；文件工具只在独立沙箱工作区作用。调用模型使用现有 Invocation 记账/receipt 边界，密钥不传沙箱或作品。
- 工具首版仅受限 list/read/write 输出文件和结构检查；逐次检查 lease、attempt fence、权限交集、字节和工具预算。不得默认注册 Pi coding CLI、shell、exec 或自动配置发现。
- create → execute → stop/kill确认 → snapshot → collect → persist；取消、超时、worker 崩溃、租约失效均拒绝旧 fence 写回。不能确认停止时不封存、不释放为可重跑状态；交给清理/核查任务。
- collector 失败允许针对同一不可变快照幂等重试，不重新调用模型；对象写成功/DB 失败进入孤儿审计。事件沿用 NDJSON，不改成 SSE。

## I3. 沙箱与存储部署选择

产品要求真实 provider，不允许内存 provider 或用户宿主目录回退。L0/L2 在批准基础设施中选择一个隔离 provider，冻结地区、镜像 digest、能力、价格/容量与退出方案；未决阻塞部署，不阻塞其余实现。

候选最小配置：每 attempt 独立非 root 工作区、只读根文件系统、无主机目录/Docker socket、无特权、capabilities drop、进程256 MiB内存、0.5 CPU、64 MiB临时盘、32进程、120秒墙钟。网络默认 deny，包括内网、metadata、DNS外传和跨任务通信；模型访问在可信 broker，不从沙箱联网。真实平台无法实施这些限制就不准开放。

普通进程或共享目录不是沙箱；容器本身也不等于通过隔离验收。provider 必须提供可验证的全进程停止、稳定快照、重启清理和跨租户边界。采购或系统级变更仍需明确授权。

对象存储使用私有不可变对象，DB 封存原子关联对象版本和 digest；预览由授权代理读取，不能把签名长期直链或内部 object key暴露给客户端。独立预览站点与主站不共享 Cookie 域。

## I4. 动画预览安全

旧 static-no-script 的执行限制保留，但扩展为 `svg-animation-v1` renderer，不能仅栅格化后声称动画已支持。

- HTML 中内联 SVG 仅存在于隔离预览文档，绝不注入主站 React DOM；无 allow-scripts / allow-same-origin 的 iframe，CSP 从 default-src none 起，仅放必要本地样式/图片。
- 用结构化 HTML/SVG/CSS 解析器白名单，不以正则作为唯一净化边界。若需新增依赖，先记录必要性、版本及锁文件影响。
- SVG 只允许绘图/局部引用和安全动画属性；animate/animateTransform 仅修改绘图数值/transform/opacity/颜色。拒绝对 href、style、事件等活跃属性动画，拒绝 script、foreignObject、事件处理器、外链/外部 use、远程 url、导航、表单、meta refresh。
- CSS 拒绝 import/远程 font/url，资源只从同 bundle 受限解析；动画数量、结构、尺寸上限来自产品规则。被拒作品显示问题位置和源码，不将净化后语义变化当作用户原作。
- 原始 artifact 与预览派生件分别记 digest/rendererVersion；技术合规检查验证文件结构/安全规则，浏览器探针验证可渲染/会动，但不声称自动识别鹈鹕或秦始皇。

## I5. API 与接线

以下是拟定 API，不是当前已实现端点；L0 与现有 `src/server/http.ts` 的 /api/arena 路由核对，已有等价端点复用并固定最终表，禁止同功能双实现。

| 资源 | 操作与边界 |
| --- | --- |
| /api/arena/challenges[/:slug] | GET 公开已发布目录与不可变题目规则 |
| Agent Build API | 复用配置版保存/CAS/读取/Fork；challenge version 绑定由服务端验证 |
| /api/arena/creation-runs | POST 带 buildVersionId、challengeVersionId、idempotencyKey、consent；owner 从 session 取 |
| /api/arena/creation-runs/:id | GET owner 状态；/events NDJSON 游标；/cancel POST 幂等确认 |
| Artifact API | owner 文件/下载/预览；公开按 publication 和审核状态再次核权 |
| /api/arena/publications | POST 申请发布；撤下、详情、审核、举报复用/补齐领域服务 |
| /api/arena/publications/:id/like | PUT/DELETE 登录幂等点赞；GET 详情只返回计数和本人状态 |
| /api/arena/ballots | 创建配对、提交选择，服务端 token/过期/身份/comparator 校验 |
| /api/arena/leaderboard | 按题目版本/赛季/lane 分页，返回政策、样本、revision/asOf |

所有写入口遵循现有认证/CSRF边界、大小限制和共享限流；测试 owner 跨租户、匿名、封禁、撤销、重复请求及并发。生产 factory 必须注入真实 resolver、EF、sandbox、对象存储与 repository；缺任何必需依赖则 unavailable。feature flag 只是发布控制，不是依赖验证。
