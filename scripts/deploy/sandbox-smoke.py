#!/usr/bin/env python3
"""Operator-run gVisor probe, NOT a production SandboxProvider or user-code API.
运行固定的非用户测试代码；不修改 Docker 配置、不暴露远程执行入口。
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time

IMAGE = 'docker.io/library/busybox@sha256:9db7b59979c38555a39def84a31fb98b5296952f9e3afd4f6f11f05b07adfab0'
RUNSC = '/usr/local/bin/runsc'


def command(args, **kwargs):
    return subprocess.run(args, check=True, text=True, timeout=90, **kwargs)


def write_config(base, args):
    spec_path = base / 'config.json'
    spec = json.loads(spec_path.read_text())
    spec['root'] = {'path': 'rootfs', 'readonly': True}
    spec['process'].update(
        terminal=False, cwd='/output', user={'uid': 65534, 'gid': 65534},
        noNewPrivileges=True, args=args,
        capabilities={k: [] for k in ('bounding', 'effective', 'inheritable', 'permitted', 'ambient')},
    )
    spec['mounts'] = [m for m in spec['mounts'] if m['destination'] != '/output']
    spec['mounts'].append({
        'destination': '/output', 'type': 'bind', 'source': str(base / 'output'),
        'options': ['rbind', 'rw', 'nosuid', 'nodev', 'noexec'],
    })
    spec['linux']['cgroupsPath'] = '/' + base.name
    spec['linux']['resources'] = {
        'memory': {'limit': 268435456},
        'cpu': {'quota': 50000, 'period': 100000},
        'pids': {'limit': 64},
    }
    spec_path.write_text(json.dumps(spec))


def sandbox_state(runsc, name):
    result = subprocess.run(runsc + ['state', name], capture_output=True, text=True, timeout=10)
    if result.returncode:
        return None
    return json.loads(result.stdout)


def cleanup_runtime(base, runsc, names):
    # Never delete an arbitrary user path, global Docker resources or lazy-unmount.
    for name in names:
        if sandbox_state(runsc, name) is not None:
            command(runsc + ['delete', '-force', name], capture_output=True)
    remaining = json.loads(command(runsc + ['list', '--format=json'], capture_output=True).stdout)
    if remaining:
        raise RuntimeError('Sandbox processes remain / 沙箱仍有剩余状态')
    mounts = []
    for line in Path('/proc/self/mountinfo').read_text().splitlines():
        mount = line.split()[4]
        if mount.startswith(str(base) + '/'):
            mounts.append(mount)
    for mount in sorted(mounts, key=len, reverse=True):
        command(['umount', mount], capture_output=True)
    for name in ('rootfs', 'output', 'runtime'):
        path = base / name
        if path.exists():
            shutil.rmtree(path)
    if Path('/sys/fs/cgroup', base.name).exists():
        raise RuntimeError('Task cgroup remains / 任务 cgroup 未回收')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true', help='Create and clean isolated test resources / 创建并回收测试资源')
    parser.add_argument('--simulate-failure', action='store_true', help='Exercise cleanup after a fixed failed task / 验证失败任务清理')
    options = parser.parse_args()
    if not options.apply:
        parser.error('--apply required / 必须显式确认')
    if os.geteuid() != 0 or not Path(RUNSC).is_file():
        parser.error('Linux root and installed runsc required / 需要 root 和 runsc')
    for binary in ('docker', 'tar', 'umount'):
        if not shutil.which(binary):
            parser.error('Missing prerequisite / 缺少依赖: ' + binary)
    before = command(['docker', 'ps', '-q'], capture_output=True).stdout.split()
    # Inspect only IDs/start times, never container environment secrets.
    def starts(ids):
        if not ids:
            return ''
        return command(['docker', 'inspect', '--format', '{{.Id}} {{.State.StartedAt}}', *ids], capture_output=True).stdout
    before_starts = starts(before)
    command(['docker', 'pull', IMAGE])
    base = Path(tempfile.mkdtemp(prefix='agentforge-gvisor-probe.', dir='/tmp'))
    base.chmod(0o755)
    for name in ('rootfs', 'output', 'runtime', 'archive'):
        (base / name).mkdir()
    os.chown(base / 'output', 65534, 65534)
    (base / 'output').chmod(0o700)
    runsc = [RUNSC, '--root=' + str(base / 'runtime'), '--platform=systrap', '--network=none']
    container_id = None
    proc = None
    report = {'status': 'failed', 'testRoot': str(base), 'checks': [], 'scope': 'Infrastructure probe only; no Pi, model, object storage or production acceptance'}
    print('Evidence / 验证目录:', base, flush=True)
    try:
        container_id = command(['docker', 'create', '--label', 'agentforge.probe=' + base.name, IMAGE], capture_output=True).stdout.strip()
        with (base / 'rootfs.tar').open('wb') as exported:
            subprocess.run(['docker', 'export', container_id], stdout=exported, check=True, timeout=90)
        command(['tar', '-xf', str(base / 'rootfs.tar'), '-C', str(base / 'rootfs')])
        (base / 'rootfs.tar').unlink()
        command(['docker', 'rm', container_id], capture_output=True)
        container_id = None
        command([RUNSC, 'spec'], cwd=base, capture_output=True)
        # Fixed probe only. No user strings are inserted into shell commands.
        script = '''id; uname -r
set -eu
test "$(id -u)" = 65534
test ! -e /var/run/docker.sock
if touch /forbidden 2>/dev/null; then exit 21; fi
if wget -T 2 -q -O /dev/null http://1.1.1.1; then exit 22; fi
printf '<!doctype html><html><body><svg xmlns="http://www.w3.org/2000/svg"><circle cx="30" cy="30" r="20"/></svg></body></html>' > /output/index.html
echo PROBE_PASSED'''
        if options.simulate_failure:
            script += '\nexit 23'
        write_config(base, ['/bin/sh', '-ec', script])
        success = command(runsc + ['run', 'success'], cwd=base, capture_output=True)
        (base / 'success.log').write_text(success.stdout + success.stderr)
        if 'PROBE_PASSED' not in success.stdout:
            raise RuntimeError('Probe did not finish / 测试未完成')
        report['checks'] += ['non-root', 'read-only-root', 'no-docker-socket', 'outbound-request-denied']
        content = (base / 'output/index.html').read_bytes()
        archive = base / 'archive/index.html'
        with archive.open('xb') as f:
            f.write(content)
            f.flush()
            os.fsync(f.fileno())
        if archive.read_bytes() != content:
            raise RuntimeError('Artifact copy mismatch / 文件保存不一致')
        report['artifactSha256'] = hashlib.sha256(content).hexdigest()
        report['checks'].append('local-artifact-copy-verified')
        write_config(base, ['/bin/sh', '-ec', 'sleep 300'])
        with (base / 'cancel.log').open('w') as log:
            proc = subprocess.Popen(runsc + ['run', 'cancelled'], cwd=base, stdout=log, stderr=log)
            deadline = time.monotonic() + 20
            while True:
                state = sandbox_state(runsc, 'cancelled')
                if state and state['status'] == 'running':
                    break
                if proc.poll() is not None or time.monotonic() > deadline:
                    raise RuntimeError('Cancellation probe did not start / 取消测试启动失败')
                time.sleep(0.2)
            cgroup = Path('/sys/fs/cgroup', base.name)
            for filename, expected in [('memory.max', '268435456'), ('cpu.max', '50000 100000'), ('pids.max', '64')]:
                actual = (cgroup / filename).read_text().strip()
                if actual != expected:
                    raise RuntimeError('Resource configuration mismatch / 资源配置不一致: ' + filename)
            report['checks'].append('host-cgroup-limits-confirmed-not-stress-tested')
            command(runsc + ['kill', 'cancelled', 'KILL'], capture_output=True)
            code = proc.wait(timeout=15)
            if code == 0:
                raise RuntimeError('Cancelled sleep unexpectedly succeeded / 取消任务意外正常结束')
            proc = None
        report['checks'].append('cancelled-process-exited')
        report['status'] = 'passed'
    finally:
        try:
            cleanup_runtime(base, runsc, ['success', 'cancelled'])
            if proc is not None:
                proc.wait(timeout=15)
            if container_id is not None:
                command(['docker', 'rm', container_id], capture_output=True)
            if (base / 'rootfs.tar').exists():
                (base / 'rootfs.tar').unlink()
            report['checks'].append('workspace-runtime-mounts-cgroup-cleaned')
            if starts(before) != before_starts:
                raise RuntimeError('Existing containers changed during test / 原有容器状态发生变化')
            report['checks'].append('existing-container-start-times-unchanged')
        except Exception:
            report['status'] = 'cleanup-or-existing-service-check-failed'
            raise
        finally:
            (base / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
            print(json.dumps(report, indent=2), flush=True)


if __name__ == '__main__':
    main()
