# AgentForge 快速开始

> 当前应用只有 Next.js 运行时。Portable 已退役；历史截图和旧验证结果不属于当前启动或验收入口。

## 启动本地应用

需要 Node.js 22.16 或更新版本、Corepack/pnpm、Docker Compose，以及安装依赖所需的网络：

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm run setup
docker compose up -d postgres
pnpm db
pnpm dev
```

在终端显示的本地应用地址打开浏览器。完整说明见 `README.md` 和 `docs/AgentForge-Quickstart.md`。

## 测试和真实模型边界

- 离线 Demo 只在显式 `APP_ENV=test` + `DEMO_MODE=true` 且使用隔离测试数据库时启用；没有固定演示账号。
- 真实模型需要在 Providers 中配置用户自己的 BYOK 凭据，并在 Builder 的 Model 节点显式选择；失败不会静默回退到 Demo。
- Pi 默认关闭，是受控离线 PoC，不是沙箱、普通用户运行时或竞争性排行榜通道。
- 当前合并的完成项、未完成项和历史验证证据见 `docs/PI-MAIN-INTEGRATION-REVIEW.md`。
