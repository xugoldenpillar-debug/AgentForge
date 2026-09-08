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
  cat <<'USAGE'
Usage / 用法:
  data.sh check|up|status ABS_ENV_FILE
  data.sh backup ABS_ENV_FILE ABS_BACKUP_DIR
  data.sh restore-check ABS_ENV_FILE ABS_BACKUP_FILE

Creates or operates only the agentforge-data Docker Compose project. It never
destroys volumes or touches another project's containers, and requires pinned images.
USAGE
}

[[ $# -ge 2 ]] || { usage; exit 2; }
mode=$1
env_file=$2
case "$mode" in check|up|status|backup|restore-check) ;; *) usage; exit 2 ;; esac
[[ $env_file == /* && -f $env_file ]] || { usage; exit 2; }
"$node_bin" --input-type=module - "$root" "$env_file" <<'JS'
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const root = fs.realpathSync(process.argv[2]);
const file = fs.realpathSync(process.argv[3]);
const requireFromRelease = createRequire(path.join(root, 'package.json'));
const { parse } = requireFromRelease('dotenv');
const mode = fs.statSync(file).mode & 0o777;
if (file === root || file.startsWith(`${root}${path.sep}`) || mode !== 0o600) {
  console.error('Env file must be outside checkout and mode 0600 / 配置文件须在仓库外且权限为 0600');
  process.exit(1);
}
const env = parse(fs.readFileSync(file, 'utf8'));
const required = [
  'AGENTFORGE_POSTGRES_IMAGE', 'AGENTFORGE_REDIS_IMAGE',
  'AGENTFORGE_POSTGRES_USER', 'AGENTFORGE_POSTGRES_PASSWORD',
  'AGENTFORGE_POSTGRES_DB', 'AGENTFORGE_REDIS_PASSWORD',
];
const errors = required.filter((key) => !env[key]?.trim()).map((key) => `${key}: required`);
for (const key of ['AGENTFORGE_POSTGRES_IMAGE', 'AGENTFORGE_REDIS_IMAGE']) {
  if (env[key] && !/@sha256:[a-f0-9]{64}$/u.test(env[key])) errors.push(`${key}: immutable digest required`);
}
for (const key of ['AGENTFORGE_POSTGRES_PASSWORD', 'AGENTFORGE_REDIS_PASSWORD']) {
  if (env[key] && env[key].length < 32) errors.push(`${key}: minimum 32 characters`);
}
for (const key of ['AGENTFORGE_POSTGRES_PORT', 'AGENTFORGE_REDIS_PORT']) {
  const value = env[key];
  if (value && (!/^\d+$/u.test(value) || Number(value) < 1024 || Number(value) > 65535)) errors.push(`${key}: invalid high port`);
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
JS
export AGENTFORGE_ENV_FILE=$env_file
compose=(docker compose --project-name agentforge-data --env-file "$env_file" -f "$root/deploy/compose.dependencies.yml")
"${compose[@]}" config --quiet

case "$mode" in
  check)
    echo 'AgentForge dependency configuration passed; no changes made / 依赖配置通过，未修改系统'
    ;;
  up)
    "${compose[@]}" pull
    "${compose[@]}" up -d --no-build --wait --wait-timeout 120
    ;;
  status)
    "${compose[@]}" ps
    ;;
  backup)
    [[ $# -eq 3 && $3 == /* ]] || { usage; exit 2; }
    backup_dir=$3
    install -d -m 0700 "$backup_dir"
    stamp=$(date -u +%Y%m%dT%H%M%SZ)
    final="$backup_dir/agentforge-$stamp.sql.gz"
    tmp="$final.tmp"
    trap 'rm -f "$tmp"' EXIT
    umask 077
    "${compose[@]}" exec -T postgres sh -ec 'exec pg_dump --format=plain --no-owner --no-privileges -U "$POSTGRES_USER" "$POSTGRES_DB"' | gzip -9 > "$tmp"
    gzip -t "$tmp"
    mv "$tmp" "$final"
    sha256sum "$final" > "$final.sha256"
    chmod 0600 "$final" "$final.sha256"
    printf '%s\n' "$final"
    ;;
  restore-check)
    [[ $# -eq 3 && $3 == /* && -f $3 ]] || { usage; exit 2; }
    backup_file=$3
    gzip -t "$backup_file"
    check_db="agentforge_restore_check_$(date -u +%Y%m%d%H%M%S)_$$"
    cleanup() {
      "${compose[@]}" exec -T postgres sh -ec 'dropdb --if-exists --force -U "$POSTGRES_USER" "$1"' sh "$check_db" >/dev/null 2>&1 || true
    }
    trap cleanup EXIT
    "${compose[@]}" exec -T postgres sh -ec 'createdb -U "$POSTGRES_USER" "$1"' sh "$check_db"
    gzip -dc "$backup_file" | "${compose[@]}" exec -T postgres sh -ec 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$1" >/dev/null' sh "$check_db"
    "${compose[@]}" exec -T postgres sh -ec 'psql -v ON_ERROR_STOP=1 -At -U "$POSTGRES_USER" -d "$1" -c "SELECT count(*) FROM schema_migrations"' sh "$check_db" | grep -Eq '^[1-9][0-9]*$'
    cleanup
    trap - EXIT
    echo 'Backup restore check passed / 备份恢复校验通过'
    ;;
esac
