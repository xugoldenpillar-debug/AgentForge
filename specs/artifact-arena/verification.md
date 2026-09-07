# 验收矩阵与证据模板

状态：验收矩阵与证据模板，不是“已通过”清单。本 worktree 的当前状态和已记录命令见 [文档验证记录](../../docs/verification/artifact-arena-spec-2026-09-07.md)；未列为已执行的命令不得推断为通过。

| Gate | 必须执行的检查 | 必须保留的证据 |
| --- | --- | --- |
| AA-V1 文档/契约 | 相对路径与锚点、引用源、迁移序列/API/枚举、旧目标裁决、diff/秘密检查 | 命令和实际结果；不伪造实现完成 |
| AA-V2 纯类型/领域 | 编译/解析/规范化/digest、旧版本兼容、Skill 顺序/能力集合、布局不改语义、伪字段/权限引用 | 真实 Node 测试结果；错误不反射秘密 |
| AA-V3 PostgreSQL/HTTP | 空库、升级、重复/并发迁移、旧数据、登录/注册、CAS/FK、owner/Fork、发布/票唯一约束 | 隔离资源名/端口、命令、实测结果，无密码 |
| AA-V4 真实沙箱 | 创建/资源超额/停止所有子进程/快照、跨任务/宿主/网络拒绝、工具结构化输入 | provider/镜像 digest/限额/时间、拒绝证据与未覆盖逃逸面；不声称证明绝无逃逸 |
| AA-V5 EF/Pi | 重投/幂等/并发/取消完成竞态、旧 fence、Redis 断连、Worker 失联、调用不确定停止、新旧消息、总名额与预算 | 真实 SDK 离线 + 独立 DB/Redis 集成；fake 与真实来源分别标注 |
| AA-V6 文件/预览安全 | 路径/编码/链接/TOCTOU、存储失败/孤儿、同 bundle 资源、MIME/巨图/CSV 公式、HTML/MD/SVG XSS、导航/外网/跨 origin、hidden/越权/撤销 | 恶意 fixtures、真实浏览器网络和 DOM 断言、原件与派生件 digest |
| AA-V7 UI 闭环 | 实际 Next.js 1440×900 与 390×844：配置/保存冲突/运行/取消/刷新/文件切换/下载/Fork、加载/空/错误/拒绝 | 浏览器步骤/截图/断言；生成 HTML 在 iframe 而非主站，焦点/键盘/窄屏可用 |
| AA-V8 社区 | A/B/tie/skip、防自投/重复/过期/限频、pending/撤下、换作品、低样本、分区、票剔除与重算一致 | 事务并发测试 + 多角色浏览器；展示统计 revision；无反作弊完备声明 |
| AA-V9 竞技 | 输出合规/不合规/基础设施失败、隐藏路径含错误不泄露、至多一 Submission、评分版本、lane/runtime/env 不混榜 | 先验证 AA-T8 独立 admission/score contract：无 resolver/judge 返回 503、拒绝 public bundle/expected/actual/trace、不得写旧 Submission、DAG 历史公式未变；后续仍需 deterministic judge 回归与实际 Next.js 闭环 |
| AA-V10 运维/开放 | kill switch、停止/核查、容量、存储留存/撤销、隔离预览站点、审核、授权真实样本、回退 | 部署/费用需明确授权；实际版本/用量/局限，生产结论单独记录 |

## 证据分层

- 纯类型、领域、内存 provider、adapter、HTTP fail-closed、迁移解析和构建测试，只证明对应代码路径的确定性行为或拒绝边界。它们不能证明真实隔离、网络拒绝、对象存储不可变性、TOCTOU、恶意输入在真实浏览器中的安全性、真实 Pi/模型质量、生产持久化或运营能力。
- 本矩阵中的“通过”必须绑定实际命令、隔离资源、版本和结果；没有真实资源或浏览器证据时，应记录为未执行/未完成，而不是用契约测试替代。
- 关闭开关、503、Unavailable provider 和未注入 durable service 是当前预期的安全行为，不是对应产品能力已经完成。

## 按变更执行命令

本仓库目前命令可直接使用，未来新增 suite 命令须同包更新 package.json/CI/CONTRIBUTING，不在 spec 假装它已存在：

```sh
git diff --check
node --experimental-strip-types --test tests/*.test.ts
pnpm test
pnpm test:pi-runtime
pnpm typecheck
pnpm build
# 以下只对本任务专属可丢弃资源；值由实施者实际创建后填写：
MIGRATION_TEST_DATABASE_URL='<isolated disposable database>' pnpm test:migrations
# tests/evaluation-postgres.integration.ts 强制显式本地 DB/Redis：
MIGRATION_TEST_DATABASE_URL='<isolated disposable database>' \
REDIS_URL='<this task isolated Redis>' pnpm test:evaluation-db
# 初始化本任务测试库，并单独启动当前 worktree Next.js 后：
SMOKE_BASE_URL='<this worktree isolated origin>' pnpm test:smoke
```

Node >=22.16 为项目下限；Pi 需 >=22.19。pnpm 10.15.1 冻结安装匹配锁文件。测试 Next.js 使用 APP_ENV=test、DEMO_MODE=true、匹配 BETTER_AUTH_URL，不配置真实 key。构建和 dev 不并发写同一 `.next`，不复用其他 worktree 依赖/服务/数据库；纯文档不要求装环境或运行应用测试。

`pnpm test:pi-runtime:live` 仅在明确费用授权后按现有脚本要求执行；旧 Flash 小样本不是新工具/沙箱能力证据。新沙箱端到端样本需新增实际测试，不把已有无工具样本当其替代。默认自动测试无付费调用。

## 每包交付记录

- 日期、commit/worktree、相关 spec ID、修改范围与依赖/锁文件状态。
- 命令、退出状态、实际 pass/fail/skip；纯测试、HTTP、真实 DB、真实 SDK、浏览器、真实模型分别列明。
- 失败/未执行项目、实际尝试与最小阻塞；缺必要 Gate 则标未完成，不用 Demo 替代。
- 迁移兼容/恢复窗口、保留的数据、资源名称/端口/保留状态；不含秘密或带密码连接串。
- Git 提交/推送/部署状态。检查项只在实际完成后勾选；引用历史结果标日期与来源。
