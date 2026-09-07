#!/usr/bin/env bash
# Operator-only installation. Never changes Docker configuration or restarts it.
set -euo pipefail
if [[ ${1:-} != --apply ]]; then
  echo '用法 / Usage: sudo bash scripts/deploy/install-gvisor.sh --apply [verified-download-directory]'
  exit 2
fi
[[ $(uname -s) == Linux && $(uname -m) == x86_64 && $EUID == 0 ]] || {
  echo '需要 Linux x86_64 root / Linux x86_64 root required' >&2; exit 1;
}
version=20260831.0
expected="runsc version release-$version"
if [[ -e /usr/local/bin/runsc ]]; then
  [[ $(/usr/local/bin/runsc --version | head -1) == "$expected" ]] || {
    echo '拒绝覆盖不同版本 / Refusing to overwrite a different version' >&2; exit 1;
  }
  [[ -x /usr/local/bin/gvisor-bin/gvisor_sentry && -x /usr/local/bin/containerd-shim-runsc-v1 ]] || {
    echo '安装不完整 / Incomplete installation' >&2; exit 1;
  }
  echo "已安装 / Already installed: $expected"; exit 0
fi
for path in /usr/local/bin/gvisor-bin /usr/local/bin/containerd-shim-runsc-v1; do
  [[ ! -e "$path" ]] || { echo "拒绝覆盖 / Refusing overwrite: $path" >&2; exit 1; }
done
for bin in python3 curl tar zstd; do command -v "$bin" >/dev/null; done
stage=$(mktemp -d /tmp/agentforge-runsc-install.XXXXXX)
trap 'rm -rf -- "$stage"' EXIT
if [[ -n ${2:-} ]]; then
  cp -- "$2/gvisor.tar.zstd" "$2/gvisor.tar.zstd.sha512" "$stage/"
else
  base="https://storage.googleapis.com/gvisor/releases/release/$version/x86_64"
  curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --connect-timeout 15 --max-time 300 "$base/gvisor.tar.zstd" -o "$stage/gvisor.tar.zstd"
  curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --connect-timeout 15 --max-time 60 "$base/gvisor.tar.zstd.sha512" -o "$stage/gvisor.tar.zstd.sha512"
fi
# Do not let checksum-file filenames select arbitrary host paths.
python3 - "$stage" <<'PY'
import hashlib,pathlib,re,sys
p=pathlib.Path(sys.argv[1]); line=(p/'gvisor.tar.zstd.sha512').read_text().strip()
m=re.fullmatch(r'([0-9a-fA-F]{128})\s+\*?gvisor\.tar\.zstd',line)
if not m: raise SystemExit('Invalid checksum manifest / 校验清单无效')
h=hashlib.sha512()
with (p/'gvisor.tar.zstd').open('rb') as f:
    for block in iter(lambda:f.read(1024*1024),b''): h.update(block)
if h.hexdigest()!=m[1].lower(): raise SystemExit('Checksum mismatch / 校验失败')
PY
mkdir "$stage/extracted"
tar --zstd -xf "$stage/gvisor.tar.zstd" -C "$stage/extracted"
[[ $("$stage/extracted/runsc" --version | head -1) == "$expected" ]] || exit 1
install -m 755 "$stage/extracted/runsc" /usr/local/bin/runsc
install -m 755 "$stage/extracted/containerd-shim-runsc-v1" /usr/local/bin/containerd-shim-runsc-v1
cp -R "$stage/extracted/gvisor-bin" /usr/local/bin/gvisor-bin
chmod -R a+rX /usr/local/bin/gvisor-bin
echo "安装完成，未修改 Docker / Installed without changing Docker: $expected"
