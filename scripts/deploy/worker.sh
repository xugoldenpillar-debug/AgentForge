#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "$0")/../.." && pwd)
service_name=agentforge-evaluation-worker.service
service_template="$root/deploy/$service_name"
service_target="/etc/systemd/system/$service_name"
artifact_group=agentforge-artifacts
node_bin=${AGENTFORGE_WORKER_NODE:-/opt/agentforge/node-v22.19.0-linux-x64/bin/node}

usage() {
  cat <<'USAGE'
Usage / 用法:
  worker.sh check|install|start|stop|restart|status ABS_ENV_FILE ABS_RELEASE_DIR

The trusted worker runs directly on the sandbox host. `install` creates only the
AgentForge artifact/sandbox directories and its own systemd unit; it never
changes Docker's runtime, prunes containers, or starts unrelated services.
USAGE
}

[[ $# -eq 3 ]] || { usage; exit 2; }
mode=$1
env_file=$2
release_dir=$3
case "$mode" in check|install|start|stop|restart|status) ;; *) usage; exit 2 ;; esac
[[ $env_file == /* && -f $env_file && $release_dir == /* && -d $release_dir ]] || { usage; exit 2; }
[[ -f "$release_dir/package.json" && -f "$release_dir/scripts/evaluation-worker-production.ts" ]] || {
  echo 'Release directory is not an AgentForge checkout / 发布目录不是 AgentForge 代码目录' >&2
  exit 2
}
[[ -x $node_bin ]] || { echo 'Pinned worker Node.js is missing or not executable / Worker Node.js 不可执行' >&2; exit 1; }
[[ -f $service_template ]] || { echo 'Worker service template is missing / Worker unit 模板缺失' >&2; exit 1; }

# Prevent secrets from living in the source checkout or being readable by other users.
"$node_bin" --input-type=module - "$root" "$env_file" "$release_dir" <<'JS'
import fs from 'node:fs';
import path from 'node:path';
const root = fs.realpathSync(process.argv[2]);
const envFile = fs.realpathSync(process.argv[3]);
const release = fs.realpathSync(process.argv[4]);
const invalid = (value) => /[\u0000-\u001f\u007f\s]/u.test(value);
if (envFile === root || envFile.startsWith(root + path.sep) || (fs.statSync(envFile).mode & 0o077)) {
  console.error('Env file must be outside checkout and mode 0600 / 配置文件须在仓库外且权限为 0600');
  process.exit(1);
}
if (!path.isAbsolute(release) || invalid(release) || invalid(envFile)) {
  console.error('Deployment paths must be absolute and contain no whitespace / 部署路径须为无空白绝对路径');
  process.exit(1);
}
JS

"$node_bin" "$root/scripts/deploy/preflight.mjs" "$env_file"

[[ -d $release_dir/node_modules ]] || {
  echo 'Host dependencies are missing; run frozen pnpm install in the release directory / 宿主发布目录缺少依赖' >&2
  exit 1
}

mapfile -t deployment_values < <("$node_bin" --input-type=module - "$env_file" "$release_dir" <<'JS'
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const release = fs.realpathSync(process.argv[3]);
const requireFromRelease = createRequire(path.join(release, 'package.json'));
const { parse } = requireFromRelease('dotenv');
const env = parse(fs.readFileSync(process.argv[2], 'utf8'));
for (const name of ['ARTIFACT_STORAGE_ROOT', 'ARTIFACT_STORAGE_GID', 'SANDBOX_WORK_ROOT', 'SANDBOX_RUNSC_PATH', 'SANDBOX_ROOTFS', 'SANDBOX_OCI_TEMPLATE', 'SANDBOX_IMAGE_DIGEST']) {
  console.log(env[name] ?? '');
}
JS
)
artifact_root=${deployment_values[0]}
artifact_gid=${deployment_values[1]}
sandbox_root=${deployment_values[2]}
runsc_path=${deployment_values[3]}
rootfs_path=${deployment_values[4]}
template_path=${deployment_values[5]}
image_digest=${deployment_values[6]}
metadata_path=$(dirname "$rootfs_path")/rootfs-metadata.json

check_group() {
  local existing_by_name existing_by_gid
  existing_by_name=$(getent group "$artifact_group" 2>/dev/null || true)
  existing_by_gid=$(getent group "$artifact_gid" 2>/dev/null || true)
  if [[ -n $existing_by_name ]]; then
    [[ $(cut -d: -f3 <<<"$existing_by_name") == "$artifact_gid" ]] || {
      echo 'ARTIFACT_STORAGE_GID does not match agentforge-artifacts / 共享组 GID 不匹配' >&2
      exit 1
    }
  elif [[ -n $existing_by_gid ]]; then
    echo 'ARTIFACT_STORAGE_GID is already owned by another group / GID 已被其他组占用' >&2
    exit 1
  elif [[ $mode != install ]]; then
    echo 'agentforge-artifacts group is not installed / 尚未安装共享组' >&2
    exit 1
  fi
}

check_runtime() {
  [[ -x $runsc_path ]] || { echo 'Configured runsc is not executable / 配置的 runsc 不可执行' >&2; exit 1; }
  [[ -d $rootfs_path && ! -L $rootfs_path ]] || { echo 'Configured rootfs is not a real directory / rootfs 不可用' >&2; exit 1; }
  [[ -r $template_path && ! -L $template_path ]] || { echo 'Configured OCI template is not readable / OCI 模板不可读' >&2; exit 1; }
  [[ -r $metadata_path && ! -L $metadata_path ]] || { echo 'Sandbox rootfs metadata is missing / rootfs 元数据缺失' >&2; exit 1; }
  "$node_bin" --input-type=module - "$metadata_path" "$image_digest" <<'JS'
import fs from 'node:fs';
const metadata = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (metadata.imageDigest !== process.argv[3]) {
  console.error('Sandbox image digest does not match rootfs metadata / 沙箱镜像摘要与 rootfs 元数据不一致');
  process.exit(1);
}
JS
  if find "$rootfs_path" -xdev \( -type f -o -type d \) -perm /0222 -print -quit | grep -q .; then
    echo 'Sandbox rootfs contains writable regular files or directories / 沙箱 rootfs 存在可写文件或目录' >&2
    exit 1
  fi
}


render_service_unit() {
  escaped_release=$(printf '%s' "$release_dir" | sed 's/[&|]/\\&/g')
  escaped_env=$(printf '%s' "$env_file" | sed 's/[&|]/\\&/g')
  escaped_node=$(printf '%s' "$node_bin" | sed 's/[&|]/\\&/g')
  sed -e "s|@RELEASE_DIR@|$escaped_release|g" \
    -e "s|@ENV_FILE@|$escaped_env|g" \
    -e "s|@NODE_BIN@|$escaped_node|g" \
    "$service_template" > "$service_target.tmp"
  chmod 0644 "$service_target.tmp"
  mv "$service_target.tmp" "$service_target"
  systemctl daemon-reload
}


case "$mode" in
  check)
    check_group
    check_runtime
    [[ -d $artifact_root && -d $sandbox_root ]] || {
      echo 'Worker data directories are not initialized / Worker 数据目录未初始化' >&2
      exit 1
    }
    echo 'Trusted worker host preflight passed; no changes made / 可信 Worker 宿主预检通过，未修改系统'
    ;;
  install)
    [[ ${EUID:-$(id -u)} -eq 0 ]] || { echo 'install must run as root / install 必须由 root 执行' >&2; exit 1; }
    check_group
    if ! getent group "$artifact_group" >/dev/null 2>&1; then
      groupadd --system --gid "$artifact_gid" "$artifact_group"
    fi
    install -d -o root -g "$artifact_group" -m 2750 "$artifact_root"
    install -d -o root -g root -m 0700 "$sandbox_root"
    # Normalize only the dedicated immutable-object tree so existing sealed files
    # become readable by the web container's supplemental group, never writable.
    find "$artifact_root" -type d -exec chown root:"$artifact_group" {} + -exec chmod 2750 {} +
    find "$artifact_root" -type f -exec chown root:"$artifact_group" {} + -exec chmod 0640 {} +
    render_service_unit
    systemctl enable "$service_name"
    echo 'Trusted worker installed but not started / 可信 Worker 已安装但尚未启动'
    ;;
  start|restart)
    [[ ${EUID:-$(id -u)} -eq 0 ]] || { echo "$mode must run as root / 必须由 root 执行" >&2; exit 1; }
    check_group
    check_runtime
    # Refresh the unit from the supplied immutable release before every
    # activation; otherwise restart can silently keep an older WorkingDirectory.
    render_service_unit
    systemctl "$mode" "$service_name"
    systemctl --no-pager --full status "$service_name"
    ;;
  stop)
    [[ ${EUID:-$(id -u)} -eq 0 ]] || { echo 'stop must run as root / stop 必须由 root 执行' >&2; exit 1; }
    systemctl stop "$service_name"
    ;;
  status)
    check_group
    systemctl --no-pager --full status "$service_name"
    ;;
esac
