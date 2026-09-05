# AgentForge 快速启动

## 1. 先玩起来（不用安装 npm 依赖）

需要 Node.js 22.16 或更新版本。解压后进入 agentforge 目录，在终端执行：

```sh
node --experimental-strip-types portable/server.ts
```

浏览器打开 `http://localhost:3000`。

演示账号：`demo@agentforge.local`  
密码：`ForgeDemo!2026`

也可以自己注册。选择挑战，点 Build agent，编辑 Prompt、拖动节点或装备 Skill，保存后运行 Run Public Tests，再 Submit。成绩会进入模拟排行榜，可以打开 Build 详情执行 Fork / Remix。

这个入口共用真实的工作流引擎、评测和评分服务，但模型输出是模拟的，不会消耗 API 费用。本地账号和游戏数据保存在 `.data/portable/`，重启后保留。请不要分享该数据目录。

## 2. 运行 Next.js 完整技术栈

需要 Docker、pnpm 和可以访问 npm 的网络。

```sh
corepack enable
pnpm install
pnpm run setup
docker compose up -d postgres
pnpm db
pnpm dev
```

或者用 Docker 运行全部服务：

```sh
node scripts/setup.mjs
docker compose up --build
```

Next.js 版使用 React Flow、PostgreSQL / Drizzle、Better Auth 和 Vercel AI SDK。真实模型请在此版本的 Providers 页配置，再在 Model 节点选择对应凭据。GitHub 登录需要自己配置 OAuth 凭据。

## 3. 已验证范围

53 项自动化测试通过；14 项免安装版浏览器检查通过；三个挑战的公开测试、隐藏提交、排行榜和 Fork 已跑通。

当前制作环境无法联网安装 npm 依赖，也没有 PostgreSQL / Docker。因此 Next.js 全量构建、数据库集成、GitHub OAuth 和真实付费模型调用尚未在此环境验证。浏览器界面测试通过 HTTP 桥接连接真实后端；原生 HTTP 测试另外验证了流式输出、会话和持久化。

完整说明见 `README.md`，验收记录见 `docs/VERIFICATION.md`。截图在 `docs/screenshots/`。本项目是本地 MVP，不代表已通过生产安全认证。
