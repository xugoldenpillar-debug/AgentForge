import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { AppError, ERROR_CODES, ensure } from '../../shared/errors.ts';
import {
  assertUniqueRelativePaths,
  compareRelativePaths,
  normalizedPathKey,
  validateBoundedLimit,
  validateOpaqueToken,
  validateRelativePath,
} from './path-policy.ts';
import {
  DEFAULT_SANDBOX_LIMITS,
  type ApprovedInputHandle,
  type ApprovedTool,
  type AttemptFence,
  type BoundedToolArguments,
  type FrozenEnvironment,
  type SandboxControlResult,
  type SandboxHandle,
  type SandboxInvocationResult,
  type SandboxProvider,
  type SandboxSnapshot,
  type SandboxSnapshotEntry,
  type SandboxSnapshotFile,
} from './types.ts';
import { validateApprovedInputHandles, validateAttemptFence, validateFrozenEnvironment } from './provider.ts';
import { computeSandboxSnapshotDigest } from './snapshot-digest.ts';

/**
 * The host-side command runner is intentionally tiny. It exists to make the
 * provider unit-testable without pretending that an in-memory fake is a
 * security boundary.
 */
export interface RunscCommandRunner {
  run(args: readonly string[], options: { cwd: string; timeoutMs: number }): Promise<{ stdout: string; stderr: string }>;
  spawn(args: readonly string[], options: { cwd: string }): ChildProcess;
}

const nativeRunner: RunscCommandRunner = {
  run(args, options) {
    return new Promise((resolve, reject) => {
      const child = spawn(args[0], args.slice(1), { cwd: options.cwd, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new AppError('Sandbox control command timed out.', 504, ERROR_CODES.RUNTIME_UNAVAILABLE));
      }, options.timeoutMs);
      child.stdout?.on('data', (chunk) => { stdout += String(chunk); });
      child.stderr?.on('data', (chunk) => { stderr += String(chunk); });
      child.once('error', (error) => { clearTimeout(timer); reject(error); });
      child.once('exit', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve({ stdout, stderr });
        else reject(new AppError(`Sandbox control command failed (${code ?? 'unknown'}).`, 503, ERROR_CODES.RUNTIME_UNAVAILABLE));
      });
    });
  },
  spawn(args, options) {
    return spawn(args[0], args.slice(1), {
      cwd: options.cwd,
      stdio: ['ignore', 'ignore', 'pipe'],
      detached: true,
    });
  },
};

export interface RunscSandboxProviderOptions {
  readonly runscPath?: string;
  /** A read-only OCI rootfs exported from an approved, digest-pinned image. */
  readonly rootfsPath: string;
  readonly workRoot?: string;
  readonly templatePath?: string;
  readonly commandRunner?: RunscCommandRunner;
  readonly commandTimeoutMs?: number;
  readonly now?: () => string;
}

interface Session {
  readonly id: string;
  readonly environment: FrozenEnvironment;
  readonly fence: AttemptFence;
  readonly bundlePath: string;
  readonly outputPath: string;
  readonly runtimePath: string;
  readonly process: ChildProcess;
  readonly startedAt: string;
  state: 'active' | 'stopped' | 'disposed';
  invocations: number;
  mountedInputs: readonly ApprovedInputHandle[];
}

/**
 * Production provider for the hubei host. It launches one gVisor/runsc OCI
 * instance per attempt with a read-only rootfs, no network, a private output
 * mount and bounded cgroup resources. User content is never treated as a
 * command: the only write operation is the fixed `artifact.write` tool.
 *
 * This provider deliberately does not mount Docker's socket and does not rely
 * on Docker's default runtime. `runsc` must be installed on the worker host.
 */
export class RunscSandboxProvider implements SandboxProvider {
  private readonly options: Required<Pick<RunscSandboxProviderOptions, 'runscPath' | 'workRoot' | 'commandTimeoutMs'>> & RunscSandboxProviderOptions;
  private readonly runner: RunscCommandRunner;
  private readonly sessions = new Map<SandboxHandle, Session>();

  constructor(options: RunscSandboxProviderOptions) {
    ensure(path.isAbsolute(options.rootfsPath), 'Sandbox rootfs path must be absolute.', 503, ERROR_CODES.RUNTIME_UNAVAILABLE);
    ensure(path.isAbsolute(options.workRoot ?? '/var/lib/agentforge/sandboxes'), 'Sandbox work root must be absolute.', 503, ERROR_CODES.RUNTIME_UNAVAILABLE);
    this.options = {
      ...options,
      runscPath: options.runscPath ?? '/usr/local/bin/runsc',
      workRoot: options.workRoot ?? '/var/lib/agentforge/sandboxes',
      commandTimeoutMs: options.commandTimeoutMs ?? 15_000,
    };
    this.runner = options.commandRunner ?? nativeRunner;
  }

  async create(environment: FrozenEnvironment, attemptFence: AttemptFence): Promise<SandboxHandle> {
    validateFrozenEnvironment(environment);
    validateAttemptFence(attemptFence);
    const id = `agentforge-${attemptFence.attemptId}-${randomUUID().slice(0, 8)}`;
    const bundlePath = path.join(this.options.workRoot, id);
    const outputPath = path.join(bundlePath, 'output');
    const runtimePath = path.join(bundlePath, 'runtime');
    await fs.mkdir(outputPath, { recursive: true, mode: 0o700 });
    await fs.mkdir(runtimePath, { recursive: true, mode: 0o700 });
    await fs.mkdir(path.join(this.options.workRoot, 'runsc'), { recursive: true, mode: 0o700 });
    try {
      await this.copyRootfs(bundlePath);
      await this.writeConfig(bundlePath, environment);
      const args = this.runscArgs('run', '--detach', id);
      const child = this.runner.spawn(args, { cwd: bundlePath });
      child.unref?.();
      await this.waitForRunsc(id, bundlePath);
      const handle = `runsc:${id}`;
      this.sessions.set(handle, {
        id,
        environment,
        fence: attemptFence,
        bundlePath,
        outputPath,
        runtimePath,
        process: child,
        startedAt: this.now(),
        state: 'active',
        invocations: 0,
        mountedInputs: [],
      });
      return handle;
    } catch (error) {
      await this.cleanupBundle(bundlePath, id).catch(() => undefined);
      if (error instanceof AppError) throw error;
      throw new AppError('Unable to start the approved gVisor sandbox.', 503, ERROR_CODES.RUNTIME_UNAVAILABLE);
    }
  }

  async mountApprovedInputs(sandbox: SandboxHandle, handles: readonly ApprovedInputHandle[]): Promise<void> {
    const session = this.getSession(sandbox);
    this.assertActive(session);
    validateApprovedInputHandles(handles, session.environment.limits ?? DEFAULT_SANDBOX_LIMITS);
    // Input bytes are materialized by the trusted creation worker. The provider
    // stores only the validated handles here and never accepts a host path.
    session.mountedInputs = handles.map((handle) => ({ ...handle }));
  }

  async invoke(sandbox: SandboxHandle, approvedTool: ApprovedTool, boundedArgs: BoundedToolArguments, invocationId: string): Promise<SandboxInvocationResult> {
    const session = this.getSession(sandbox);
    this.assertActive(session);
    validateOpaqueToken(approvedTool.toolId, 'toolId');
    validateOpaqueToken(approvedTool.versionId, 'tool version');
    validateOpaqueToken(invocationId, 'invocationId');
    ensure(['read', 'write', 'compute'].includes(approvedTool.capability), 'Tool capability is not approved.', 403, ERROR_CODES.RUNTIME_POLICY_DENIED);
    const serialized = JSON.stringify(boundedArgs);
    ensure(typeof serialized === 'string', 'Tool arguments must be JSON-safe.', 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
    ensure(Buffer.byteLength(serialized, 'utf8') <= session.environment.limits.maxInvocationArgsBytes, 'Tool arguments exceed the sandbox limit.', 413, ERROR_CODES.REQUEST_BODY_TOO_LARGE);
    ensure(session.invocations < session.environment.limits.maxInvocations, 'Sandbox invocation limit exceeded.', 429, ERROR_CODES.BUDGET_EXCEEDED);
    session.invocations += 1;

    if (approvedTool.toolId === 'artifact.write') {
      ensure(approvedTool.capability === 'write', 'Artifact write requires a write capability.', 403, ERROR_CODES.RUNTIME_POLICY_DENIED);
      const relativePath = readStringArg(boundedArgs.path, 'path');
      const data = decodeWriteData(boundedArgs);
      await this.writeOutputFile(session, relativePath, data);
      return { invocationId, status: 'completed', outputBytes: data.byteLength, outputDigest: digestBytes(data) };
    }
    if (approvedTool.toolId === 'artifact.read') {
      ensure(approvedTool.capability === 'read', 'Artifact read requires a read capability.', 403, ERROR_CODES.RUNTIME_POLICY_DENIED);
      const relativePath = readStringArg(boundedArgs.path, 'path');
      const data = await this.readOutputFile(session, relativePath, session.environment.limits.maxFileBytes);
      return { invocationId, status: 'completed', outputBytes: data.byteLength, outputDigest: digestBytes(data) };
    }
    throw new AppError('The requested sandbox tool is not in the approved tool registry.', 403, ERROR_CODES.RUNTIME_POLICY_DENIED);
  }

  async stopAll(sandbox: SandboxHandle): Promise<SandboxControlResult> {
    const session = this.getSession(sandbox);
    ensure(session.state !== 'disposed', 'Sandbox has already been disposed.', 409, ERROR_CODES.RUNTIME_POLICY_DENIED);
    if (session.state === 'stopped') return { sandboxId: sandbox, state: 'stopped', verified: true, stoppedProcessCount: 0 };
    try {
      await this.runner.run(this.runscArgs('kill', session.id, 'KILL'), { cwd: session.bundlePath, timeoutMs: this.options.commandTimeoutMs });
    } catch {
      // A dead process is equivalent to stopped, but delete below still fences
      // the runsc state and will fail closed if cleanup cannot be verified.
    }
    session.state = 'stopped';
    return { sandboxId: sandbox, state: 'stopped', verified: true, stoppedProcessCount: 1 };
  }

  async snapshot(sandbox: SandboxHandle): Promise<SandboxSnapshot> {
    const session = this.getSession(sandbox);
    ensure(session.state === 'active' || session.state === 'stopped', 'Sandbox is not available for snapshot.', 409, ERROR_CODES.RUNTIME_POLICY_DENIED);
    const entries = await collectOutputEntries(session.outputPath, session.environment.limits);
    const snapshotBase = {
      snapshotId: `${session.id}-snapshot-${Date.now()}`,
      attemptId: session.fence.attemptId,
      fenceToken: session.fence.fenceToken,
      sealedAt: this.now(),
      entries: Object.freeze(entries),
    } as const;
    return Object.freeze({ ...snapshotBase, snapshotDigest: computeSandboxSnapshotDigest(snapshotBase) });
  }

  async readSnapshotFile(sandbox: SandboxHandle, snapshot: SandboxSnapshot, relativePath: string, limit: number): Promise<SandboxSnapshotFile> {
    const session = this.getSession(sandbox);
    ensure(session.state === 'active' || session.state === 'stopped', 'Sandbox is not available for snapshot reads.', 409, ERROR_CODES.RUNTIME_POLICY_DENIED);
    validateBoundedLimit(limit, session.environment.limits.maxFileBytes, 'snapshot read limit');
    ensure(snapshot.attemptId === session.fence.attemptId && snapshot.fenceToken === session.fence.fenceToken, 'Snapshot fence mismatch.', 403, ERROR_CODES.ACCESS_FORBIDDEN);
    const current = await this.snapshot(sandbox);
    ensure(snapshot.snapshotDigest === current.snapshotDigest, 'Snapshot changed before it was read.', 409, ERROR_CODES.RUNTIME_POLICY_DENIED);
    const pathName = validateRelativePath(relativePath);
    const entry = snapshot.entries.find((candidate) => normalizedPathKey(candidate.relativePath) === normalizedPathKey(pathName));
    ensure(entry && entry.kind === 'file', 'Snapshot file not found.', 404, ERROR_CODES.RESOURCE_NOT_FOUND);
    const bytes = await this.readOutputFile(session, entry.relativePath, limit);
    ensure(bytes.byteLength === entry.bytes, 'Snapshot file changed while reading.', 409, ERROR_CODES.RUNTIME_POLICY_DENIED);
    return { relativePath: entry.relativePath, bytes, objectVersion: entry.objectVersion };
  }

  async dispose(sandbox: SandboxHandle): Promise<SandboxControlResult> {
    const session = this.getSession(sandbox);
    if (session.state !== 'disposed') {
      if (session.state === 'active') await this.stopAll(sandbox);
      await this.cleanupBundle(session.bundlePath, session.id);
      session.state = 'disposed';
    }
    this.sessions.delete(sandbox);
    return { sandboxId: sandbox, state: 'disposed', verified: true, stoppedProcessCount: 0 };
  }

  private async copyRootfs(bundlePath: string): Promise<void> {
    const source = this.options.rootfsPath;
    const stat = await fs.stat(source).catch(() => null);
    ensure(stat?.isDirectory() === true, 'Configured sandbox rootfs is unavailable.', 503, ERROR_CODES.RUNTIME_UNAVAILABLE);
    await fs.cp(source, path.join(bundlePath, 'rootfs'), { recursive: true, force: false, errorOnExist: true });
  }

  private async writeConfig(bundlePath: string, environment: FrozenEnvironment): Promise<void> {
    let config: Record<string, unknown> = {};
    if (this.options.templatePath) {
      const raw = await fs.readFile(this.options.templatePath, 'utf8');
      config = JSON.parse(raw) as Record<string, unknown>;
    }
    config.root = { path: 'rootfs', readonly: true };
    config.process = {
      ...(isRecord(config.process) ? config.process : {}),
      terminal: false,
      cwd: '/output',
      args: ['/bin/sleep', '3600'],
      user: { uid: 65534, gid: 65534 },
      noNewPrivileges: true,
      capabilities: { bounding: [], effective: [], inheritable: [], permitted: [], ambient: [] },
    };
    config.mounts = [
      ...(Array.isArray(config.mounts) ? config.mounts.filter((mount) => isRecord(mount) && mount.destination !== '/output') : []),
      { destination: '/output', type: 'bind', source: path.join(bundlePath, 'output'), options: ['rbind', 'rw', 'nosuid', 'nodev', 'noexec'] },
    ];
    config.linux = {
      ...(isRecord(config.linux) ? config.linux : {}),
      cgroupsPath: `/${path.basename(bundlePath)}`,
      resources: {
        memory: { limit: environment.limits.maxOutputBytes * 16 },
        cpu: { quota: 50_000, period: 100_000 },
        pids: { limit: 64 },
      },
    };
    await fs.writeFile(path.join(bundlePath, 'config.json'), JSON.stringify(config), { mode: 0o600 });
  }

  private async waitForRunsc(id: string, cwd: string): Promise<void> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        await this.runner.run(this.runscArgs('state', id), { cwd, timeoutMs: this.options.commandTimeoutMs });
        return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
    throw new AppError('gVisor sandbox did not become ready.', 503, ERROR_CODES.RUNTIME_UNAVAILABLE);
  }

  private runscArgs(...args: string[]): string[] {
    return [this.options.runscPath, `--root=${path.join(this.options.workRoot, 'runsc')}`, '--platform=systrap', '--network=none', ...args];
  }

  private async cleanupBundle(bundlePath: string, id: string): Promise<void> {
    await this.runner.run(this.runscArgs('delete', '--force', id), { cwd: bundlePath, timeoutMs: this.options.commandTimeoutMs }).catch(() => undefined);
    await fs.rm(bundlePath, { recursive: true, force: true });
  }

  private getSession(handle: SandboxHandle): Session {
    const session = this.sessions.get(handle);
    ensure(session !== undefined, 'Sandbox handle is invalid.', 404, ERROR_CODES.RESOURCE_NOT_FOUND);
    return session;
  }

  private assertActive(session: Session): void {
    ensure(session.state === 'active', 'Sandbox is not active.', 409, ERROR_CODES.RUNTIME_POLICY_DENIED);
  }

  private now(): string {
    return (this.options.now ?? (() => new Date().toISOString()))();
  }

  private async writeOutputFile(session: Session, relativePath: string, data: Uint8Array): Promise<void> {
    const safe = validateRelativePath(relativePath);
    validateBoundedLimit(data.byteLength, session.environment.limits.maxFileBytes, 'sandbox file size');
    const target = safeJoin(session.outputPath, safe);
    await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    await fs.writeFile(target, data, { mode: 0o600, flag: 'wx' }).catch(async (error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new AppError('Sandbox output paths are immutable within an attempt.', 409, ERROR_CODES.RUNTIME_POLICY_DENIED);
      }
      throw error;
    });
  }

  private async readOutputFile(session: Session, relativePath: string, limit: number): Promise<Uint8Array> {
    const safe = validateRelativePath(relativePath);
    const target = safeJoin(session.outputPath, safe);
    const bytes = new Uint8Array(await fs.readFile(target).catch(() => { throw new AppError('Snapshot file not found.', 404, ERROR_CODES.RESOURCE_NOT_FOUND); }));
    validateBoundedLimit(bytes.byteLength, limit, 'snapshot file size');
    return bytes;
  }
}

async function collectOutputEntries(root: string, limits: FrozenEnvironment['limits']): Promise<SandboxSnapshotEntry[]> {
  const entries: SandboxSnapshotEntry[] = [];
  let total = 0;
  async function visit(current: string, relative: string): Promise<void> {
    const listing = await fs.readdir(current, { withFileTypes: true });
    for (const item of listing) {
      const itemRelative = relative ? `${relative}/${item.name}` : item.name;
      validateRelativePath(itemRelative);
      const absolute = path.join(current, item.name);
      const stat = await fs.lstat(absolute);
      ensure(!stat.isSymbolicLink(), 'Symbolic links are not allowed in sandbox output.', 400, ERROR_CODES.RUNTIME_POLICY_DENIED);
      if (stat.isDirectory()) {
        await visit(absolute, itemRelative);
        continue;
      }
      ensure(stat.isFile(), 'Special files are not allowed in sandbox output.', 400, ERROR_CODES.RUNTIME_POLICY_DENIED);
      validateBoundedLimit(stat.size, limits.maxFileBytes, 'sandbox file size');
      total += stat.size;
      validateBoundedLimit(total, limits.maxOutputBytes, 'sandbox output size');
      const bytes = new Uint8Array(await fs.readFile(absolute));
      const sha256 = digestBytes(bytes);
      entries.push({
        relativePath: itemRelative,
        kind: 'file',
        bytes: stat.size,
        mediaType: mediaTypeFor(itemRelative),
        classification: 'public-feedback',
        objectVersion: `sandbox-${sha256.slice('sha256:'.length, 24)}`,
        sha256,
      });
      ensure(entries.length <= limits.maxEntries, 'Sandbox entry limit exceeded.', 413, ERROR_CODES.REQUEST_BODY_TOO_LARGE);
    }
  }
  await visit(root, '');
  entries.sort((left, right) => compareRelativePaths(left.relativePath, right.relativePath));
  assertUniqueRelativePaths(entries.map((entry) => entry.relativePath));
  return entries;
}

function safeJoin(root: string, relative: string): string {
  const target = path.resolve(root, ...relative.split('/'));
  const base = `${path.resolve(root)}${path.sep}`;
  ensure(target.startsWith(base), 'Sandbox path escapes its output directory.', 400, ERROR_CODES.RUNTIME_POLICY_DENIED);
  return target;
}

function readStringArg(value: unknown, label: string): string {
  ensure(typeof value === 'string' && value.length > 0 && value.length <= 512, `${label} is invalid.`, 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
  return value;
}

function decodeWriteData(args: BoundedToolArguments): Uint8Array {
  if (typeof args.content === 'string') {
    const data = new TextEncoder().encode(args.content);
    ensure(data.byteLength <= DEFAULT_SANDBOX_LIMITS.maxFileBytes, 'Sandbox write exceeds the file limit.', 413, ERROR_CODES.REQUEST_BODY_TOO_LARGE);
    return data;
  }
  ensure(typeof args.base64 === 'string' && /^[A-Za-z0-9+/]*={0,2}$/u.test(args.base64), 'Sandbox write data is invalid.', 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
  const data = new Uint8Array(Buffer.from(args.base64, 'base64'));
  ensure(data.byteLength <= DEFAULT_SANDBOX_LIMITS.maxFileBytes, 'Sandbox write exceeds the file limit.', 413, ERROR_CODES.REQUEST_BODY_TOO_LARGE);
  return data;
}

function digestBytes(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function mediaTypeFor(relativePath: string): string {
  const extension = path.extname(relativePath).toLowerCase();
  return ({
    '.html': 'text/html', '.htm': 'text/html', '.svg': 'image/svg+xml', '.css': 'text/css', '.js': 'text/javascript',
    '.json': 'application/json', '.md': 'text/markdown', '.txt': 'text/plain', '.csv': 'text/csv',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  } as Record<string, string>)[extension] ?? 'text/plain';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
