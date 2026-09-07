# 执行、文件与预览安全规格

状态：Gate 要求，不是隔离安全认证。执行沙箱、预览隔离、授权层是三道不同边界，任一道未通过则不开放相应能力。

## S1. SandboxProvider 与能力 broker

目标接口：`create(frozenEnvironment, attemptFence)`、`mountApprovedInputs(handles)`、`invoke(approvedTool, boundedArgs, invocationId)`、`stopAll()`、`snapshot()`、`readSnapshotFile(handle, limit)`、`dispose()`。输入均为平台解析的对象/能力句柄；不接用户提供的主机路径、URL、shell 字符串或任意镜像。stopAll/snapshot 必须返回可核验状态而非仅“请求已发送”。

- 每 Attempt 独立实例/工作区；只读输入、可写 workspace、受控 outputs。Next.js 与 Worker 不执行用户 Python/JS，不导入上传扩展。Pi core 只在受信执行器中运行受控循环，不自动发现用户配置、插件、凭据或任意工具。
- 模型由 Model Broker 调用，沙箱无 provider API key、数据库、Redis、会话或平台加密密钥。资源句柄绑定 owner/job/attempt，短生命周期且限制操作，不能换 ID 访问其他任务。
- 网络默认拒绝；不能靠“不提供网络工具”实现禁网。执行环境和预览均实测 DNS、IPv4/IPv6、重定向、metadata/内网出站；未来联网能力需独立策略，不能放宽现有 `safeProviderFetch`。
- 文件读写/列举仅批准目录；Python 标准库能力用固定解释器和结构化 argv，不提供 shell 字符串。镜像预置依赖，禁隐式 pip/npm、特权、宿主挂载、Docker socket。
- 沙箱/浏览器检测进程也受 CPU、内存、磁盘、进程数、文件数、输出大小、日志、单步及总时间限制。工具并发由 broker 原子预占并约束，不能只在 Pi 事件结束后扣额度。
- Worker 失联、取消、安全撤销必须停止所有子进程并拒绝后续模型/工具；不能确认时进入核查，既不报告取消完成，也不冒充无费用。计量工具/模型/沙箱分别归账。

T2 必须提交提供商决策表：隔离机制、镜像 digest、Node/Python 版本、地区/留存、创建/停机/快照保证、网络封锁、凭据注入面、CPU/内存/磁盘/进程/时间/日志数值、并发/账号限额、价格来源与有效日期、销毁失败处置。未冻结不能创建生产模板。无供应商条件时先用 fake 做契约测试，但不能以 fake 通过 S1。

## S2. 文件封存

1. 仅接受批准 input/output slot，分类为 public-feedback/private-creation/hidden；用户不能降级 hidden。工作目录其他内容不自动发布。
2. 停止全部写入或获得不可变快照。禁止扫描仍运行的工作区后按同一普通路径重新读取。
3. 有界枚举，拒绝绝对路径、`..`、编码/大小写/Unicode 规范化冲突、symlink/hardlink、设备/管道/socket、越界递归及超额输出。压缩包首版不自动展开，Skill 导入若支持压缩须独立有界解包检查。
4. 以安全句柄/no-follow 读取稳定字节，hash + copy + 校验大小，存储为平台控制的不可变对象版本。检查/读取间替换或不确定一致性必须拒绝。
5. 按 Attempt fence 原子登记 manifest 沿用 Agent 五契约字段：manifestVersion、businessRef、attemptId/fence、snapshotDigest、outputContractVersion、entries[{artifactId, relativePath, mediaType, bytes, sha256, objectVersion, classification}]、manifestDigest、sealedAt；扩展 environmentDigest。仅内部记录存储位置；用户投影不暴露对象系统信息。
6. judge 读取独立只读副本，不与 Agent 共享可写挂载。collector/存储失败为 incomplete，不当作选手失败；缺必需文件等有充分证据的输出失败按 Profile 判断。

对象写成功但 DB 失败可成为孤儿对象，进入审计清单；重试仅针对同一稳定快照，不重跑模型。清理必须按冻结生命周期、引用与保留规则执行；本 spec 不授权删除既有对象/数据库。封存原件不被截图、净化或 CSV 安全导出修改，派生件另记源 digest 与 rendererVersion。

## S3. 权限与预览投影

- 列表、manifest、读取、下载、Range 请求、缩略图、预览资源请求都按 owner/分类/发布状态/撤销核权；知道 ID 不是权限。隐藏输入/产物/路径/文件名/错误始终不发给用户（包括 owner）。
- 正式预览只读 sealed bundle；工作中预览只给 owner，限频/有界快照、同等浏览器隔离，明显标注“未封存”，不能投票或冒充最终得分。
- 正式公开投影只包含作者选定且审核通过的文件与安全来源信息；不得把整个目录、Skill 附件、内部日志公开。
- 主站与预览采用不同站点域，主站凭据不共享；不只是共享 Cookie 父域下的另一个子域。每次预览仅授予特定 release/bundle 的短期只读访问；无平台通用 bearer token，不将访问密钥放在可泄露的 URL/query/referrer。
- 预览资源由授权代理按 manifest 的相对路径解析；不透传任意外部 URL，不代理本地开发端口。使用 CSP/iframe/资源重写的组合，不依赖文件扩展名或净化器单一防线。
- 撤下后代理立即拒绝新读取；不发长期直链。若实现短期能力 URL，必须记录最长撤销延迟并在 T10 验证，不能声称已经下载/缓存的字节可收回。

## S4. 格式与执行档位

| 格式 | MVP 策略 | 禁止/错误回退 |
| --- | --- | --- |
| HTML/CSS | 独立 origin + 无脚本 iframe；资源仅本 bundle；文档/资源均 nosniff | 禁脚本、表单、导航/跳转、弹窗、外链和跨 bundle 资源；不满足安全转换则转源码 |
| MD | 原始 HTML 禁用的 Markdown parser；链接协议/图片引用白名单；本地资源授权解析 | MDX、嵌入 HTML/iframe、远程图片跟踪、javascript/data 活跃 URL 不支持 |
| SVG | 沙箱 renderer 栅格缩略图或受限图片加载；支持查看转义源码 | 不向主站注入内联 SVG，不作为可执行顶层文档 |
| PNG/JPEG/WebP | 解码类型核验，字节/尺寸/像素上限 | 解码炸弹/伪装 MIME 拒绝 |
| JSON | 有界结构树/转义文本 | 递归深度/字节数超限时摘要，不执行内容 |
| CSV | 有界分页纯文本表格 | 不计算公式；原件下载提示风险，另提供明确标注的安全派生导出 |
| TXT/源代码 | 有界转义高亮 | 不作为 HTML 执行 |
| PDF/音视频/未知 | MVP 仅经权限检查下载或提示暂不支持 | 不自动装插件/启动转换器；新增 renderer 另 Gate |

静态档位基线：`sandbox` 不授脚本/同源/表单/弹窗/顶层导航；CSP 从 `default-src 'none'` 出发，仅允许必要的本地样式/图片（inline CSS 限于预览域），明确 `script-src 'none'`、`connect-src 'none'`、`object-src 'none'`、`base-uri 'none'`、`form-action 'none'`；同时剥离跳转、外链与危险标签/属性。浏览器可能不把所有导航受控于同一 CSP 指令，必须验证点击、meta refresh、下载和资源请求，不以 CSP 字符串替代实际 Gate。

未来 JS 档位是独立 Environment/PreviewPolicy：可考虑 `allow-scripts` 但不授同源，与主站无 Cookie；另验跨作品存储/Service Worker、postMessage、网络、导航、CPU 占用、原型污染和依赖供应链。消息须校验 source、会话能力与有界 schema；不因 origin 为 opaque/null 而宽泛信任。它不属于本轮静态 MVP。

## S5. 审核和生命周期

公开上传/作品视作用户生成内容：发布前 pending 审核、举报入口、管理员撤下、频率和总存储配额、授权审计。检查私有数据/版权/恶意内容，但不声称能自动证明无敏感泄露或无刷票。

T10 分别冻结工作临时文件、私有创作、公开封存作品、隐藏证据、投票审计、费用审计、备份的保留策略；Q22 的自测 30 天不移用。生命周期任务只清理符合政策且没有保留引用的对象；不得删历史 Portable 或其他任务资源。对象不可变保存与合法删除通过版本生命周期协调，不把不可变理解为永不删除。
