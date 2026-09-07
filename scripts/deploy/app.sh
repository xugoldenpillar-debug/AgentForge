#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
usage() {
  echo 'Usage / 用法: app.sh check|release|rollback ABS_ENV_FILE IMAGE_TAG [--backup-confirmed]'
}
[[ $# -ge 3 ]] || { usage; exit 2; }
mode=$1
case "$mode" in check|release|rollback) ;; *) usage; exit 2;; esac
[[ $2 == /* && -f $2 ]] || { usage; exit 2; }
# Secrets must not accidentally enter the Docker build context.
node --input-type=module - "$root" "$2" <<'JS'
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
[[ $AGENTFORGE_IMAGE =~ ^agentforge:[a-zA-Z0-9][a-zA-Z0-9_.-]+$ && $AGENTFORGE_IMAGE != agentforge:latest ]] || {
  echo 'Use agentforge:<release-id>, not latest / 请使用明确发布版本' >&2; exit 2;
}
node "$root/scripts/deploy/preflight.mjs" "$AGENTFORGE_ENV_FILE"
compose=(docker compose --project-name agentforge-production --env-file "$AGENTFORGE_ENV_FILE" -f "$root/deploy/compose.production.yml")
"${compose[@]}" config --quiet
if [[ $mode == check ]]; then
  echo 'No changes made / 未执行部署'; exit 0
fi
if [[ $mode == release ]]; then
  [[ ${4:-} == --backup-confirmed ]] || {
    echo 'Back up PostgreSQL first, then pass --backup-confirmed / 先备份数据库并确认' >&2; exit 2;
  }
  if docker image inspect "$AGENTFORGE_IMAGE" >/dev/null 2>&1; then
    echo 'Release image already exists; choose a new tag / 禁止覆盖已有发布镜像' >&2; exit 1
  fi
  "${compose[@]}" build app
  # Explicit one-off migration, not on every application restart.
  "${compose[@]}" run --rm --no-deps app pnpm db
else
  docker image inspect "$AGENTFORGE_IMAGE" >/dev/null
fi
"${compose[@]}" up -d --no-build --wait --wait-timeout 120 app
echo 'Application healthy. Verify public HTTPS login separately / 应用健康，请另验公网 HTTPS 登录'
echo 'Animation creation remains disabled / 动画创作运行仍关闭'
