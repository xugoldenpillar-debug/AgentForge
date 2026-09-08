#!/usr/bin/env -S node --experimental-strip-types
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { RunscSandboxProvider, type RunscCommandRunner } from '../../src/server/sandbox/runsc.ts';
import type { FrozenEnvironment } from '../../src/server/sandbox/types.ts';

const ROOTFS = process.env.SANDBOX_ROOTFS ?? '/opt/agentforge/rootfs';
const TEMPLATE = process.env.SANDBOX_OCI_TEMPLATE ?? '/opt/agentforge/oci-template.json';
const RUNSC = process.env.SANDBOX_RUNSC_PATH ?? '/usr/local/bin/runsc';
const WORK_ROOT = process.env.SANDBOX_WORK_ROOT ?? '/var/lib/agentforge/provider-smoke';
const IMAGE_DIGEST = process.env.SANDBOX_IMAGE_DIGEST
  ?? 'sha256:9db7b59979c38555a39def84a31fb98b5296952f9e3afd4f6f11f05b07adfab0';

const diagnosticRunner: RunscCommandRunner = {
  run(args, options) {
    return new Promise((resolve, reject) => {
      const child = spawn(args[0], args.slice(1), { cwd: options.cwd, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`runsc command timed out: ${args.at(-2) ?? ''}`)); }, options.timeoutMs);
      child.stdout?.on('data', (chunk) => { stdout += String(chunk); });
      child.stderr?.on('data', (chunk) => { stderr += String(chunk); });
      child.once('error', (error) => { clearTimeout(timer); reject(error); });
      child.once('exit', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve({ stdout, stderr });
        else reject(new Error(`runsc command failed (${code ?? 'unknown'}): ${stderr.slice(-2000)}`));
      });
    });
  },
  spawn(args, options) {
    const child = spawn(args[0], args.slice(1), { cwd: options.cwd, stdio: ['ignore', 'ignore', 'pipe'], detached: true });
    child.stderr?.on('data', (chunk) => process.stderr.write(`[runsc] ${String(chunk)}`));
    return child;
  },
};

async function main(): Promise<void> {
  if (process.platform !== 'linux' || process.getuid?.() !== 0) {
    throw new Error('The real runsc provider smoke must run as root on Linux.');
  }
  await fs.mkdir(WORK_ROOT, { recursive: true, mode: 0o700 });
  const before = (await fs.readdir(WORK_ROOT)).filter((entry) => entry !== 'runsc');
  assert.deepEqual(before, [], `Smoke work root is not empty: ${before.join(', ')}`);

  const environment: FrozenEnvironment = {
    environmentId: 'artifact-animation-sandbox-v1',
    environmentDigest: `sha256:${'1'.repeat(64)}`,
    imageDigest: IMAGE_DIGEST,
    runtime: 'pi',
    policyVersion: 'artifact-animation-v1',
    networkPolicy: 'deny',
    limits: {
      maxEntries: 16,
      maxFileBytes: 4 * 1024 * 1024,
      maxOutputBytes: 16 * 1024 * 1024,
      maxInvocations: 64,
      maxInvocationArgsBytes: 1024 * 1024,
    },
  };
  const provider = new RunscSandboxProvider({
    runscPath: RUNSC,
    rootfsPath: ROOTFS,
    workRoot: WORK_ROOT,
    templatePath: TEMPLATE,
    commandRunner: diagnosticRunner,
  });
  let handle: string | undefined;
  try {
    handle = await provider.create(environment, {
      ownerId: 'provider-smoke-user',
      jobId: 'provider-smoke-job',
      attemptId: `provider-smoke-${Date.now()}`,
      fenceToken: 'provider-smoke-fence',
    });
    const html = '<!doctype html><html><body><svg><animate attributeName="opacity" values="0;1" dur="1s" repeatCount="indefinite"/></svg></body></html>';
    const invocation = await provider.invoke(handle, {
      toolId: 'artifact.write', versionId: 'artifact-write-v1', capability: 'write',
    }, { path: 'index.html', content: html }, 'provider-smoke-write');
    assert.equal(invocation.status, 'completed');
    assert.ok(invocation.outputBytes > 0);
    const stopped = await provider.stopAll(handle);
    assert.equal(stopped.state, 'stopped');
    assert.equal(stopped.verified, true);
    const snapshot = await provider.snapshot(handle);
    assert.deepEqual(snapshot.entries.map((entry) => entry.relativePath), ['index.html']);
    const file = await provider.readSnapshotFile(handle, snapshot, 'index.html', 1024 * 1024);
    assert.equal(new TextDecoder().decode(file.bytes), html);
    const disposed = await provider.dispose(handle);
    assert.equal(disposed.state, 'disposed');
    handle = undefined;
    const remaining = (await fs.readdir(WORK_ROOT)).filter((entry) => entry !== 'runsc');
    assert.deepEqual(remaining, []);
    const runtimeState = await diagnosticRunner.run([RUNSC, `--root=${path.join(WORK_ROOT, 'runsc')}`, '--platform=systrap', '--network=none', 'list', '--format=json'], { cwd: WORK_ROOT, timeoutMs: 5_000 });
    assert.ok(runtimeState.stdout.trim() === 'null' || runtimeState.stdout.trim() === '[]');
    process.stdout.write(`${JSON.stringify({ status: 'passed', checks: [
      'project-runsc-provider-created',
      'artifact-write-persisted',
      'stop-verified',
      'snapshot-digest-and-read-verified',
      'attempt-bundle-and-runsc-state-cleaned',
    ] }, null, 2)}\n`);
  } finally {
    if (handle) await provider.dispose(handle).catch(() => undefined);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Provider smoke failed.');
  process.exitCode = 1;
});
