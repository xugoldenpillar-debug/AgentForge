# hubei gVisor 与部署工具验证 / Infrastructure verification

2026-09-07。只记录真实执行结果，不代表完整动画上线。
Records actual execution, not complete animation product acceptance.

## 实机 / Host

用户明确授权 SSH `hubei` 安装 gVisor 和创建专用测试资源。
Ubuntu 22.04 x86_64，root，Docker 29.7.2，cgroup v2；`/dev/kvm` 不存在。
通过官方包下载/传输、服务器 SHA-512 校验后安装 `runsc release-20260831.0` 与配套 binaries。
未修改 daemon.json/default runtime，未重启 Docker，未开放端口。

Authorized host: hubei. Installed checksum-verified official binaries; Docker configuration,
existing services and public ports were not modified.

## 仓库脚本实跑 / Checked-in probe execution

```sh
bash /tmp/install-gvisor.sh --apply
python3 /tmp/sandbox-smoke.py --apply
```

安装器返回 already installed。同版本重复运行成功；全新安装分支依据之前手工安装流程编写，
**没有卸载实机 runtime 来重测全新安装脚本**。
Installer idempotency passed. Fresh installer branch was not re-run by uninstalling the working runtime.

测试镜像 / Image:
`docker.io/library/busybox@sha256:9db7b59979c38555a39def84a31fb98b5296952f9e3afd4f6f11f05b07adfab0`

结果目录 / Evidence: `/tmp/agentforge-gvisor-probe.jjlc2zpi`
`report.json.status=passed`:

- non-root
- read-only-root
- no-docker-socket
- outbound-request-denied
- local-artifact-copy-verified
- host-cgroup-limits-confirmed-not-stress-tested
- cancelled-process-exited
- workspace-runtime-mounts-cgroup-cleaned
- existing-container-start-times-unchanged

作品 SHA-256 / Artifact digest:
`22a2bcb7a6b701e561fef9516f9df1026bb2a049b3409f0dde6bcccf9de9dbaf`

原 5 个容器启动时间未变化。新建未启动的 rootfs 导出容器已删除，runsc 实例、临时 rootfs/output、
network namespace 挂载和 cgroup 已清理。保留 runtime 安装、镜像缓存及测试归档/日志/配置。

Existing five containers retained their start times. Temporary containers, mounts, workspaces and cgroup
were removed. Runtime binaries, image cache and evidence remain.

## 清理修正 / Cleanup corrections

早期手工测试发现正常 run 自动删除状态，重复 delete 会报不存在；共享 null-netns 挂载会阻止删除 runtime。
正式测试脚本先检查状态、删除活动实例、确认列表空、卸载专属挂载，再删除目录。
异常采用 finally，清理失败明确报错。SIGKILL/断电后的恢复、周期回收仍未实现。

The reproducible probe handles already-deleted state and task-specific namespace mounts. Finally cleanup
is not a substitute for a production crash-recovery supervisor.

## 本次本地验证 / Local verification

- `pnpm test:deploy`: 4 passed；Shell 语法与 Python AST 检查通过。
- `app.sh check`：使用无效离线配置验证 Compose schema/预检，无部署、无数据库连接。
- `pnpm test:provider-sdk`: 33 passed，全部离线。
- `pnpm test`: 425 tests, 424 passed, 1 skipped, 0 failed。
- `pnpm typecheck`、`pnpm build`: passed。
- `pnpm install --frozen-lockfile`: passed。
- `pnpm test:migrations`: 4 passed，显式使用本任务 127.0.0.1:32769 的可丢弃测试数据库，未使用生产连接。

最终 Docker 构建、数据库迁移和 smoke 结果见下方后补记录。
Docker image/migration/smoke results are recorded below after completion.

## 未完成 / Not verified

无真实 Pi/模型调用，无对象存储上传，无两题浏览器动画/完整社区验收。
未配置 hubei 的生产应用/DB/Tunnel，未执行生产数据库迁移或生产 rollout/rollback。
未做越狱安全审计、OOM/PID/CPU 压力测试、多租户并发、磁盘配额、宿主重启/断电恢复。
尚无应用可调用的生产 sandbox API/provider；不能因此开启用户 creationRuns。

No real model, object-store integration, full animation/community acceptance, production deployment,
security certification, resource stress or crash recovery has been performed.
