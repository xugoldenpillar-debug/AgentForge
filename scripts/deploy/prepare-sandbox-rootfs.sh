#!/usr/bin/env bash
set -euo pipefail

IMAGE='docker.io/library/busybox@sha256:9db7b59979c38555a39def84a31fb98b5296952f9e3afd4f6f11f05b07adfab0'
IMAGE_DIGEST='sha256:9db7b59979c38555a39def84a31fb98b5296952f9e3afd4f6f11f05b07adfab0'
INSTALL_ROOT=${AGENTFORGE_SANDBOX_INSTALL_ROOT:-/opt/agentforge}
ROOTFS="$INSTALL_ROOT/rootfs"
TEMPLATE="$INSTALL_ROOT/oci-template.json"
METADATA="$INSTALL_ROOT/rootfs-metadata.json"
RUNSC=${SANDBOX_RUNSC_PATH:-/usr/local/bin/runsc}
APPLY=false
REPLACE=false

usage() {
  cat <<USAGE
Usage: sudo $0 --apply [--replace]

Prepare an immutable, digest-pinned BusyBox rootfs and OCI template for the
AgentForge gVisor provider. Existing matching installations are preserved.
Use --replace only for an explicit atomic replacement.
USAGE
}

for arg in "$@"; do
  case "$arg" in
    --apply) APPLY=true ;;
    --replace) REPLACE=true ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $arg" >&2; usage >&2; exit 2 ;;
  esac
done

$APPLY || { echo 'Refusing to change the host without --apply.' >&2; exit 2; }
[[ ${EUID:-$(id -u)} -eq 0 ]] || { echo 'Run as root.' >&2; exit 1; }
for command in docker tar python3; do
  command -v "$command" >/dev/null || { echo "Missing prerequisite: $command" >&2; exit 1; }
done
[[ -x "$RUNSC" ]] || { echo "runsc is not executable: $RUNSC" >&2; exit 1; }

if [[ -f "$METADATA" && -d "$ROOTFS" && -f "$TEMPLATE" && "$REPLACE" != true ]]; then
  installed_digest=$(python3 - "$METADATA" <<'PY'
import json, sys
try:
    print(json.load(open(sys.argv[1], encoding='utf-8')).get('imageDigest', ''))
except Exception:
    print('')
PY
)
  if [[ "$installed_digest" == "$IMAGE_DIGEST" ]]; then
    echo "Sandbox rootfs already prepared at $ROOTFS ($IMAGE_DIGEST)."
    exit 0
  fi
  echo "An existing sandbox rootfs does not match the pinned digest. Inspect it, then rerun with --replace." >&2
  exit 1
fi

if [[ ( -e "$ROOTFS" || -e "$TEMPLATE" || -e "$METADATA" ) && "$REPLACE" != true ]]; then
  echo "Incomplete or untracked sandbox installation exists under $INSTALL_ROOT; refusing to overwrite." >&2
  exit 1
fi

mkdir -p "$INSTALL_ROOT"
chmod 0755 "$INSTALL_ROOT"
stage=$(mktemp -d "$INSTALL_ROOT/.sandbox-rootfs.stage.XXXXXXXX")
container_id=''
cleanup() {
  if [[ -n "$container_id" ]]; then docker rm -f "$container_id" >/dev/null 2>&1 || true; fi
  rm -rf "$stage"
}
trap cleanup EXIT INT TERM

mkdir -p "$stage/rootfs" "$stage/spec/rootfs"
docker pull "$IMAGE" >/dev/null
container_id=$(docker create --label agentforge.sandbox-rootfs-stage=true "$IMAGE")
docker export "$container_id" | tar -xpf - -C "$stage/rootfs" --no-same-owner
docker rm "$container_id" >/dev/null
container_id=''

(
  cd "$stage/spec"
  "$RUNSC" spec
)
python3 - "$stage/spec/config.json" "$stage/oci-template.json" "$IMAGE" "$IMAGE_DIGEST" "$stage/rootfs-metadata.json" <<'PY'
import datetime, json, pathlib, sys
source, target, image, digest, metadata = sys.argv[1:]
spec = json.loads(pathlib.Path(source).read_text(encoding='utf-8'))
spec['root'] = {'path': 'rootfs', 'readonly': True}
process = spec.setdefault('process', {})
process.update({
    'terminal': False,
    'cwd': '/output',
    'args': ['/bin/sleep', '3600'],
    'env': ['PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'],
    'user': {'uid': 65534, 'gid': 65534},
    'noNewPrivileges': True,
    'capabilities': {name: [] for name in ('bounding', 'effective', 'inheritable', 'permitted', 'ambient')},
})
spec['mounts'] = [m for m in spec.get('mounts', []) if m.get('destination') not in ('/output', '/run', '/tmp')]
linux = spec.setdefault('linux', {})
linux.pop('resources', None)
linux.pop('cgroupsPath', None)
pathlib.Path(target).write_text(json.dumps(spec, separators=(',', ':')) + '\n', encoding='utf-8')
pathlib.Path(metadata).write_text(json.dumps({
    'schemaVersion': 1,
    'image': image,
    'imageDigest': digest,
    'preparedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'rootfsKind': 'docker-export-never-started-container',
    'ociTemplateGenerator': 'runsc spec',
}, indent=2) + '\n', encoding='utf-8')
PY

# Pre-create the bind-mount destination before hardening the shared rootfs.
# Otherwise runsc may create /output on the host during the first container
# start, which would mutate the supposedly immutable base tree.
mkdir -p "$stage/rootfs/output"

# Rootfs must be traversable/readable by the worker but not mutable. Preserve
# executable bits while removing all write bits. Symlink mode bits are not
# meaningful on Linux; their parent directories and targets are covered here.
find "$stage/rootfs" -type d -exec chmod a-w,u+rX,go+rX {} +
find "$stage/rootfs" -type f -exec chmod a-w,u+r,go+r {} +
chmod 0444 "$stage/oci-template.json" "$stage/rootfs-metadata.json"
chown -R root:root "$stage/rootfs" "$stage/oci-template.json" "$stage/rootfs-metadata.json"

backup=''
if [[ "$REPLACE" == true && ( -e "$ROOTFS" || -e "$TEMPLATE" || -e "$METADATA" ) ]]; then
  backup="$INSTALL_ROOT/.sandbox-rootfs.backup.$(date -u +%Y%m%dT%H%M%SZ)"
  mkdir "$backup"
  [[ ! -e "$ROOTFS" ]] || mv "$ROOTFS" "$backup/rootfs"
  [[ ! -e "$TEMPLATE" ]] || mv "$TEMPLATE" "$backup/oci-template.json"
  [[ ! -e "$METADATA" ]] || mv "$METADATA" "$backup/rootfs-metadata.json"
fi

mv "$stage/rootfs" "$ROOTFS"
mv "$stage/oci-template.json" "$TEMPLATE"
mv "$stage/rootfs-metadata.json" "$METADATA"
trap - EXIT INT TERM
rm -rf "$stage"

printf 'Prepared sandbox rootfs:\n  rootfs=%s\n  template=%s\n  digest=%s\n' "$ROOTFS" "$TEMPLATE" "$IMAGE_DIGEST"
if [[ -n "$backup" ]]; then
  echo "Previous installation preserved at $backup"
fi
