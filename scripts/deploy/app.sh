#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
node_bin=${AGENTFORGE_DEPLOY_NODE:-$(command -v node || true)}
if [[ -z $node_bin && -x /opt/agentforge/node-v22.19.0-linux-x64/bin/node ]]; then
  node_bin=/opt/agentforge/node-v22.19.0-linux-x64/bin/node
fi
[[ -n $node_bin && -x $node_bin ]] || {
  echo 'Deployment Node.js is missing; set AGENTFORGE_DEPLOY_NODE / 缺少部署 Node.js' >&2
  exit 1
}
usage() {
  echo 'Usage / 用法: app.sh check|release|code-release|rollback ABS_ENV_FILE IMAGE_TAG [--backup-confirmed] [--restart-worker]'
}
[[ $# -ge 3 ]] || { usage; exit 2; }
mode=$1
case "$mode" in check|release|code-release|rollback) ;; *) usage; exit 2;; esac
[[ $2 == /* && -f $2 ]] || { usage; exit 2; }
# Secrets must not accidentally enter the Docker build context.
"$node_bin" --input-type=module - "$root" "$2" <<'JS'
import fs from 'node:fs';
import path from 'node:path';
const root = fs.realpathSync(process.argv[2]);
const file = fs.realpathSync(process.argv[3]);
if (file === root || file.startsWith(root + path.sep) || (fs.statSync(file).mode & 0o077)) {
  console.error('Env file must be outside checkout and mode 0600 / 配置文件须在仓库外且权限为 0600');
  process.exit(1);
}
JS
export AGENTFORGE_ENV_FILE=$2 AGENTFORGE_IMAGE=$3
backup_confirmed=false
restart_worker=false
for option in "${@:4}"; do
  case "$option" in
    --backup-confirmed) backup_confirmed=true ;;
    --restart-worker) restart_worker=true ;;
    *) usage; exit 2 ;;
  esac
done
[[ $AGENTFORGE_IMAGE =~ ^agentforge:[a-zA-Z0-9][a-zA-Z0-9_.-]+$ && $AGENTFORGE_IMAGE != agentforge:latest ]] || {
  echo 'Use agentforge:<release-id>, not latest / 请使用明确发布版本' >&2; exit 2;
}
if [[ $mode == code-release && $backup_confirmed == true ]]; then
  echo 'code-release must not use --backup-confirmed; use release for schema/data changes / 纯代码发布不得使用备份确认；数据结构变更请使用 release' >&2
  exit 2
fi
if [[ $mode == rollback && $restart_worker == true ]]; then
  echo 'Rollback worker requires the previous release directory; run worker.sh explicitly / 回滚 Worker 时请显式指定旧发布目录' >&2
  exit 2
fi
if [[ $restart_worker == true ]]; then
  release_id=${AGENTFORGE_IMAGE#agentforge:}
  release_dir=$(realpath "$root")
  [[ $(basename "$release_dir") == "$release_id" ]] || {
    echo 'Image tag must match the current immutable release directory before Worker cutover / 同步 Worker 前镜像标签必须匹配当前不可变发布目录' >&2
    exit 2
  }
fi
"$node_bin" "$root/scripts/deploy/preflight.mjs" "$AGENTFORGE_ENV_FILE"
compose=(docker compose --project-name agentforge-production --env-file "$AGENTFORGE_ENV_FILE" -f "$root/deploy/compose.production.yml")
"${compose[@]}" config --quiet
if [[ $mode == check ]]; then
  echo 'No changes made / 未执行部署'; exit 0
fi
if [[ $mode == release || $mode == code-release ]]; then
  if [[ $mode == release && $backup_confirmed != true ]]; then
    echo 'Back up PostgreSQL first, then pass --backup-confirmed / 先备份数据库并确认' >&2; exit 2
  fi
  if docker image inspect "$AGENTFORGE_IMAGE" >/dev/null 2>&1; then
    echo 'Release image already exists; choose a new tag / 禁止覆盖已有发布镜像' >&2; exit 1
  fi
  "${compose[@]}" build app
  if [[ $mode == release ]]; then
    # Schema/data releases keep the explicit migration and backup gate.
    "${compose[@]}" run --rm --no-deps app pnpm db
  else
    echo 'Code-only release: database backup and migration skipped / 纯代码发布：已跳过数据库备份与迁移'
  fi
else
  docker image inspect "$AGENTFORGE_IMAGE" >/dev/null
fi
"${compose[@]}" up -d --no-build --wait --wait-timeout 120 app

if [[ $restart_worker == true ]]; then
  AGENTFORGE_WORKER_NODE=${AGENTFORGE_WORKER_NODE:-/opt/agentforge/node-v22.19.0-linux-x64/bin/node} \
    "$root/scripts/deploy/worker.sh" restart "$AGENTFORGE_ENV_FILE" "$root"
  expected_worker_dir=$(realpath "$root")
  actual_worker_dir=$(systemctl show agentforge-evaluation-worker.service -p WorkingDirectory --value)
  [[ $actual_worker_dir == "$expected_worker_dir" ]] || {
    echo 'Web is healthy but Worker release does not match / Web 已健康，但 Worker 发布版本不一致' >&2
    exit 1
  }
  echo 'Web and Worker now use the same release / Web 与 Worker 已切换到同一发布版本'
else
  echo 'Web release is active. Pass --restart-worker to align the trusted Worker in this cutover / Web 已发布；传 --restart-worker 可在本次切换中同步 Worker'
fi
echo 'Application healthy. Verify public HTTPS login separately / 应用健康，请另验公网 HTTPS 登录'
