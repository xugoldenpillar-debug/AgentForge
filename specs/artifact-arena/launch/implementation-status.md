# 两题公开版实现状态与发布边界

日期：2026-09-08。分支：`codex/two-challenge-launch`。

本文件区分 **已实现的代码能力**、**已执行的离线/基础设施验证** 与 **仍需目标部署或真实 BYOK 才能关闭的验收**。配置文件、单元测试或固定沙箱 smoke 不能单独证明生产上线。

## 已实现的产品闭环

当前分支已实现：

```text
选题 → 配置 Pi / 模型 / Skill → 保存不可变 Build
→ CreationRun v2 / EF outbox → Pi 工具循环 → runsc 沙箱
→ 封存安全动画 → owner 明确确认发布 → 点赞/盲选
→ 社区分/分榜 → Fork
```

### L0–L1：契约、题目与配置

- 两个正式不可变题目版本：
  - `animation-pelican-bike-v1`
  - `animation-qin-polar-bear-v1`
- 保留原始中文题面及独立 English 文案；固定必交 `index.html`、内联 SVG、可选 `README.md`。
- 动画策略允许受限 CSS keyframes 与 SVG 声明式动画，拒绝任意 JavaScript、事件处理器和外链主动内容。
- Agent Build/BuildVersion 绑定题目版本；保存、CAS、owner、Fork 清凭据引用沿用现有不可变 Build 边界。
- BYOK 协议由用户显式选择，不按 Key 前缀猜测：
  - `openai-chat`
  - `openai-responses`
  - `anthropic-messages`
  - `google-generative-ai`
- Key 加密、owner 隔离、HTTPS/公网 DNS/IP/重定向防护保留；可配置开放自定义公网 Provider Host 或严格 allowlist；Key 只在可信 Worker 解密。
- API Key 按不透明字符串处理，不依据前缀、长度形状或字符格式推断 Provider；前后端统一允许 trim 后 1–2048 字符，自定义模型 ID 不走平台模型白名单。

### L2–L3：真实沙箱、持久存储和 Creation 执行

- `RunscSandboxProvider` 每个 attempt 创建独立 OCI/gVisor 实例，固定只读 rootfs、`--network=none`、受限 cgroup 与唯一可写 output mount。
- Sandbox 只实现平台批准的有界 artifact tools，不执行模型生成的 shell/JavaScript。
- `FileSystemArtifactStorageAdapter` 提供 VPS 私有不可变对象键；生产以 `2750` 目录、`0640` 文件和专用共享 GID 让宿主 Worker 写、Web 容器只读。
- Creation v2 复用 EF jobs/attempts/invocations/usage/outbox、BullMQ、lease/fence、取消、重试与 reconciliation，不另造请求内队列。
- `CreationEvaluationExecutor` 接通真实 Pi provider tool loop、BYOK provider、artifact collector/sealer 与 `CreationRun.artifactBundleId`。
- 成功、失败、取消及 unknown provider result 均进入 sandbox dispose；明确 HTTP/Provider 响应失败直接进入 failed 并释放活跃槽，只有无法确认上游结果的 transport/finalization 情况进入 unknown。
- unknown 不自动重放；用户明确确认潜在费用后，状态转为 incomplete、释放活跃槽，再由用户决定重新开始或重试。
- API Key 只传给 trusted provider factory，不进入 prompt、tool args、sandbox、artifact、repository projection 或执行结果。

### L4–L6：安全预览、完整 UI 和社区闭环

- 作品封存时验证 required file、内联 SVG、大小/数量、路径、digest 与 attempt fence；数据库与 bundle 关联采用原子完成路径。
- Preview sanitizer 支持受限动画并移除脚本、事件属性、外链和危险 CSS；UI 提供播放/暂停/重播与 reduced-motion 行为。
- Artifact Arena 创作页面使用真实保存、运行、恢复、取消、重试、bundle/preview/download、发布、展示、投票、排行榜、点赞和 Fork API；产品路径不再使用 `FIXTURE_FILES` / `PREVIEW_FILES` 静态结果。
- WorkLike 持久化：每用户每作品一票、可取消、禁自赞，和社区分分开显示。
- A/B ballot 使用匿名公开投影、过期/唯一票/禁自投；社区分转换百分制并显示有效票数。
- 正式榜门槛为 20 accepted votes、10 独立选民；不足显示样本不足。
- 排名 partition 固定为题目版本 + `season-2026-launch` + `byok`，不与 Verified 或旧 DAG 混榜。
- 正常注册用户无需 Pi 邀请即可进入；匿名访客仅可读公开作品/榜单，不能创建、点赞或投票。

### L8 运维实现

- 动态 availability 与 `ARTIFACT_ARENA_KILL_SWITCH`：停止新变更和执行时，保留合法历史 artifact 读取。
- Web Docker 容器只绑定 `127.0.0.1`，不挂 Docker socket、无 privileged、移除 Linux capabilities；Artifact 存储只读挂载。
- Trusted Worker 直接在 Hubei 宿主 systemd 运行，使用固定 Node 22、专用 artifact GID、180 秒 graceful stop、独立启停和匹配版本回滚。
- `scripts/deploy/preflight.mjs` 对 production/outbox/Redis/runsc/rootfs/digest/storage/GID/provider hosts 和公开开关做 fail-closed 检查。
- `scripts/deploy/worker.sh` 只创建 AgentForge 专用组/目录/unit，不修改 Docker runtime，不 prune，不触碰其他容器。
- 部署和回滚见 `docs/deployment/hubei-byok.md`。

## 数据库迁移

新增迁移：

```text
0015_showcase_likes_and_creation_bundle.sql
0016_animation_build_binding.sql
0017_drop_legacy_creation_job_check.sql
```

`src/db/schema.ts`、`src/db/schema.sql`、repository、seed 与测试同步。旧 migration bytes/checksum 未修改；fresh schema 比较会显式剥离新增结构后验证历史目标。

## 已有验证证据

- 四协议离线 SDK wire/auth/usage/cancel：`docs/verification/byok-protocols-df6c-2026-09-07.md`。
- Hubei runsc 安装、固定 rootfs 与 provider smoke：`docs/verification/hubei-gvisor-deployment-2026-09-07.md`。
- 2026-09-08 最终验证：`docs/verification/animation-launch-df6c-2026-09-08.md`。
- Creation executor 集成测试验证 sealing、usage、unknown、cancel/dispose 与 key 不泄漏。
- Creation UI 回归测试阻止 fixture 重新进入产品路径。
- 部署测试验证公开开关、fail-closed preflight、只读 artifact mount、专用 GID、发布/回滚顺序及无 Docker prune/socket/privileged。
- 本地 production Next.js 浏览器验证覆盖桌面/390px、中英文、正式榜/样本不足，以及点赞 `PUT`、取消点赞 `DELETE` 和 `0 → 1 → 0` 计数。
- Hubei 以当前代码执行真实 `RunscSandboxProvider` smoke：封存对象可读、stop 可验证、snapshot digest 可读、attempt 与 runsc state 均清理；Worker production preflight 通过。

未实际执行的命令不得在此标为通过；固定 QA 票只用于渲染/协议验收，不作为自然社区票。

## 仍需目标部署关闭的 Gate

以下属于环境/运营验收，不能由代码自动伪造：

1. **两题真实模型 L7**：每题至少一次用户明确授权的 BYOK 调用，记录 run/attempt、协议/模型、Pi 版本、环境 digest、用量、artifact digest；当前没有可借用的用户 Key。
2. **目标域名真实浏览器 G4/G7**：本地 production Next.js 的桌面/窄屏、中英文、点赞和榜单已验证；仍需在最终 Cloudflare HTTPS 域名完成真实 BYOK 的选题到 Fork，并用间隔截图或录屏证明两题 SVG 动画实际变化。
3. **自然多账号社区 G6**：服务与 PostgreSQL 集成测试已覆盖 owner 确认发布、管理员撤下、禁自赞、like/unlike、盲选、门槛、撤下重算和并发唯一约束；仍需目标环境的自然用户票，固定 QA 票不得冒充自然社区票。
4. **生产运维 G8**：确定实际数据库/Redis/域名/Cloudflare Tunnel、备份恢复、监控告警和审核值守负责人；记录部署 SHA、迁移结果、开启范围与回滚演练。
5. **最终部署身份复核**：Hubei 已验证等价只读 bind 的 Worker 写/Web 读不可写模型，当前代码 provider smoke 也确认 `runsc list` 为空且 attempt 目录清理；正式上线后仍须以最终 Web 容器 UID/GID 和每个真实终态运行复核。

在这些证据完成前，可以称代码闭环和部署方案已实现，不能称 L7–L8 生产验收或线上开放已经完成。
