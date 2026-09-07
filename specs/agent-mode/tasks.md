# Agent mode tasks / Gates

Date: 2026-09-07. B1 and the restricted B2 private-draft slice are delivered. The independent lane finding is fixed and closed. B3 Agent UI and C-F execution/sandbox work remain undelivered. Checked items apply only to their stated scope; distinguish worker-reported evidence from reviewer-run tests.

| 阶段 | 交付 | 当前状态与前置 |
| --- | --- | --- |
| A fixes | Pi 文档矛盾纠偏、首批 Agent 设计；Pi 缺陷修复另由代码工作包留证 | 本次仅文档；代码验收以另包实际记录为准 |
| B Build | Agent persistence / versioning / Fork | B1 and B2 private unconfigured drafts delivered; lane finding independently closed. B3 UI, reference authorization and public publishing remain unavailable. |
| C reliable execution | 复用 EF Job/Attempt/Outbox Worker/取消/容量/费用 | 公共 EF 有代码，Agent 接入未实现；对应 AA-T3/T6，不另建调度器 |
| D sandbox/artifacts | 固定环境隔离、collector、manifest、多格式静态预览、独立 judge | 未实现；供应商、镜像/限制、费用与数据边界验证后才可开放 |
| E competitive loop | Run → Submission → Score → Leaderboard → Fork | 未实现；C/D 与现有 Profile/lane/评分 Gate 联合通过 |
| F extensions | 批准的只读 MCP、可执行 Skill、厂商 SDK/更多语言或多 Agent | 后续独立准入；不因 B–E 通过自动授权 |

## A：首批设计与纠偏

- [x] 写入 README/requirements/design/tasks，提供五份候选契约及 Q1–Q25 对齐；证据为同目录文档，不是协议已冻结。
- [x] Pi design 区分已有 PoC 文件、历史样本与未验收发布 Gate；社区 T4 链接到精确状态，不沿用“PI3/PI4 全未做/全通过”的矛盾口径。
- [x] 记录代码工作包本次回报：`pnpm test` 155 passed；`pnpm test:pi-runtime` 20 passed / 1 skipped；typecheck/build passed。修正范围与证据归属见 [Pi 状态](../pi-runtime/design.md)。仅表示收到并记录结果，本次文档工作包未重跑，不代表迁移/浏览器/生产 Gate 通过。
- Gate：相对链接有效、变更仅 specs、无新增上线/付费/生产宣称。最终检查结果见交付说明。

## B：Build（AM1–AM4）

### B1：纯定义契约（2026-09-06 本次实际验证）

- [x] `src/shared/agent-build-contract.ts`：`AgentBuildDefinitionV1` / `parseAgentBuildDefinition`；支持未配置草稿、固定声明式 Skill/能力引用、严格字段与资源界限、脱离原对象的深冻结规范化结果。
- [x] `src/lib/agent-build/digest.ts`：`digestAgentBuildDefinition`；服务端原生、域分离的 SHA-256，Skill 顺序影响摘要；固定 v1 golden vector 防止无意改变序列化协议。
- [x] `tests/agent-build-contract.test.ts`：定向 **16 passed / 0 failed / 0 skipped**；随后顺序执行 `pnpm test` **175 passed / 0 failed / 0 skipped**、`pnpm typecheck`、`pnpm build` 均通过。Node 26.7.0、pnpm 10.15.1；证据只覆盖当前 worktree 的离线契约与应用构建，不是浏览器、数据库、真实模型或生产验收。
- 边界：语法引用不表示 ComponentVersion/Profile 已存在、digest 已核实或获得授权；128 KiB HTTP 上限仅导出为未来适配器约定，尚未接入路由。定义不承载凭据/Grant，不将不可变复制称为已授权 Fork。

### B2 private unconfigured drafts: accepted within restricted scope

- [x] 既有 BuildVersion additive 迁移（当前主序列 0009，原 Pi 0005 历史保留）、服务端摘要、固定 mode、不可变历史与 CAS。
- [x] fail-closed 草稿限制；owner-only Agent DTO、metadata history、精确来源版本 Fork、旧客户端 mode opt-in。
- [x] 拒绝 Agent DAG/Run/hunt；不构造 Agent 模型、不新增凭据/Grant/注册表。
- [x] Worker final rerun: related 41 passed, full 198 passed, Pi 23 passed / 1 skipped, typecheck/build and isolated Next/Auth smoke successful. Reviewer inspected `/tmp/b2-lane-*.log`, not independently rerun. Earlier real migration matrix and overlapping PostgreSQL CAS each passed 1 test; these were not rerun by reviewer.
- [x] 独立 reviewer 执行 `node --experimental-strip-types --test tests/agent-drafts.test.ts`：8 passed、0 failed；内存 probe 复现下述 lane 回归，未调用模型/共享服务。
- [x] Workflow hunt platform pricing lane regression fixed using a shared pure classifier. Reviewer ran `node --experimental-strip-types --test tests/provider-lane.test.ts tests/agent-drafts.test.ts`: 23 passed / 0 failed / 0 skipped (15 lane + 8 drafts), including historical Agent rejection before provider construction. Finding closed; provider authorization remains separate.
- [ ] B3：实际 Agent 编辑器、历史/冲突交互及完整桌面/窄屏验证。当前浏览器证据仅为主 worker 回报 1440/390 的既有安全错误状态，无截图或 Agent UI 通过声明。
- [ ] 权威组件/Profile 解析、真实 digest/许可/撤回/撤销、公开发布、凭据重新绑定与执行联合准入。

精确 API、资源及证据限制见 [integration](integration.md)。历史 B1 测试数不是当前 B2 验证结果。

## C：可靠执行（AM3、AM9）

- [ ] 接 EF 作业/Attempt/Outbox、幂等摘要、fencing、状态查询和确认取消；独立 SelfTestRun，不强塞竞技 Run。
- [ ] 验证双 API、重复投递、Redis 故障/补投、Worker 失联/旧写回、排队撤销、取消完成竞态。
- [ ] 验证跨用途每用户一名额、共享供应商限额、用途预算、已知/未知用量核查；不自动重调已发生调用的中断评测。
- [ ] 验证 Q21 邮箱过渡、Q22 自测清理后的缺失证据、Q25 权威权限读取，分别复用对应基础工作包。
- Gate：仅离线无付费注入先验证；真实调用另行授权。无可靠基础不得用长 HTTP 请求作为临时生产替代。

## D：沙箱和 artifacts（AM5–AM8、AM10、AM12）

- [ ] 选型与验证外部隔离提供商，冻结静态作品/Python 工程轨的镜像/digest、标准库、CPU/内存/磁盘/时间/进程/文件/日志/网络限额及成本来源；默认禁网，无 host shell。
- [ ] 验证逃逸/宿主文件/跨任务访问拒绝、子进程超时与终止确认、无隐式安装、broker 不暴露密钥。
- [ ] 验证路径穿越、编码/大小写冲突、symlink/hardlink/特殊文件、超额输出与解析资源限制。
- [ ] 竞态测试在检查与读取间替换文件、并发改写、旧 Attempt 封存；确认停止写入/快照/no-follow/hash-copy/不可变对象及摘要绑定，否则不通过 Gate。
- [ ] 验证 CSV+JSON+report 的正确/缺失/无效产物；独立 judge 不信 Agent 自评，基础设施故障与选手失败分开。
- [ ] 验证越权下载、过期授权、隐藏 artifacts/输入/输出/文件名不泄露、HTML/Markdown/XSS/CSV 公式/远程资源安全预览。
- Gate：真实隔离环境证据不可由模拟文件系统代替；不需要付费模型的验证优先，购买/付费/生产动作仍需另批。

## E：竞技闭环（AM10–AM12）

- [ ] 在既有 Benchmark Profile/Season/Suite/Scoring 中冻结 Agent 输出合同、评分、资源归责及 comparator 兼容政策；不复制 DAG Elegance。
- [ ] 完整隐藏 Run 至多一次 Submission；中断/未知状态不提交；持久化结果幂等收尾不发新调用。
- [ ] 验证 Demo/BYOK/Verified 与 Profile 隔离，授权公开测试可看结果，隐藏测试只看汇总；自测和平台复测不产竞技成绩。
- [ ] 实际 Next.js 桌面/窄屏跑 Problem → Agent Build → Run → Submit → Score → Leaderboard → Fork，涵盖错误/取消/重连/下载。
- Gate：运行安全、迁移兼容、浏览器及按授权取得的真实模型证据分别列出；PoC 样例不代表生产安全或 Verified。

## F：后续扩展

- [ ] 只读 MCP 首批：服务身份、工具版本/漂移复审、SSRF、用户数据同意、最小能力和独立超时/配额。
- [ ] 可执行社区 Skill/依赖：独立许可、供应链与沙箱准入；声明式首版不自动升级。安装仅经明确批准的构建流程，不由 Agent 临时决定。
- [ ] 其他语言/厂商 SDK/多 Agent 另起范围和资源政策评审；沿用 EF 与 Profile，不继承当前授权。

## 尚待冻结的实施决策

1. 沙箱提供商能否证明隔离、全进程停写/不可变快照和取消，地区/数据留存/价格是否可接受。
2. 静态作品/Python 工程轨镜像与数值配额、输出 schema、报告判据、Agent 评分权重及资源限制归责；跨 runtime/mode 比较需 Profile 明确兼容后再开放。
3. 五契约具体字段、外键/唯一约束、API 版本、对象存储封存/下载方案，以及与 EF/社区 PR 的兼容发布顺序。
4. 隐藏产物保留/删除与审计策略；不能拿 Q22 自测 30 天替代。许可名单、MCP 身份与数据边界沿原准入 Gate。

这些是技术调查/后续范围决策，不撤销 Q1–Q25，也不要求凭空选限额或立即购买服务。遇到新的产品取舍再请用户确认。

## 当前实施拆分入口

执行 [AA-T0–T10](../artifact-arena/tasks.md)，其映射表覆盖 B3/C/D/E，保留已完成 B1/B2 与上文历史证据。AA-T7 的社区榜不是 E 的隐藏竞技；AA-T9 的环境图不是 Workflow DAG。此链接不勾选任何待执行 Gate。
