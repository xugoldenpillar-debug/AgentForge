import { createHash } from 'node:crypto';
import { AppError, ERROR_CODES, ensure } from '../../shared/errors.ts';
import { assertUniqueRelativePaths, compareRelativePaths, normalizedPathKey, validateBoundedLimit, validateOpaqueToken, validateRelativePath } from './path-policy.ts';
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
  type SandboxSnapshotFile
} from './types.ts';
import { validateApprovedInputHandles, validateAttemptFence, validateFrozenEnvironment } from './provider.ts';
import { computeSandboxSnapshotDigest } from './snapshot-digest.ts';

interface StoredFile {
  readonly entry: SandboxSnapshotEntry;
  readonly bytes: Uint8Array;
}

interface Session {
  readonly environment: FrozenEnvironment;
  readonly fence: AttemptFence;
  readonly createdAt: string;
  state: 'active' | 'stopped' | 'disposed';
  invocations: number;
  files: Map<string, StoredFile>;
  mountedInputs: readonly ApprovedInputHandle[];
}

/**
 * Contract-test provider only. It performs no process execution and does not model isolation.
 * Production code must use an approved provider or the fail-closed implementation.
 */
export class InMemorySandboxProvider implements SandboxProvider {
  private readonly sessions = new Map<SandboxHandle, Session>();
  private sequence = 0;
  private readonly defaultLimits;

  constructor(defaultLimits = DEFAULT_SANDBOX_LIMITS) {
    this.defaultLimits = defaultLimits;
  }

  async create(environment: FrozenEnvironment, attemptFence: AttemptFence): Promise<SandboxHandle> {
    validateFrozenEnvironment(environment);
    validateAttemptFence(attemptFence);
    const sandboxId = `test-sandbox-${++this.sequence}`;
    this.sessions.set(sandboxId, {
      environment,
      fence: attemptFence,
      createdAt: new Date(0).toISOString(),
      state: 'active',
      invocations: 0,
      files: new Map(),
      mountedInputs: []
    });
    return sandboxId;
  }

  async mountApprovedInputs(sandbox: SandboxHandle, handles: readonly ApprovedInputHandle[]): Promise<void> {
    const session = this.getSession(sandbox);
    this.assertActive(session);
    validateApprovedInputHandles(handles, session.environment.limits ?? this.defaultLimits);
    session.mountedInputs = handles.map((handle) => ({ ...handle }));
  }

  async invoke(
    sandbox: SandboxHandle,
    approvedTool: ApprovedTool,
    boundedArgs: BoundedToolArguments,
    invocationId: string
  ): Promise<SandboxInvocationResult> {
    const session = this.getSession(sandbox);
    this.assertActive(session);
    validateOpaqueToken(approvedTool.toolId, 'toolId');
    validateOpaqueToken(approvedTool.versionId, 'tool version');
    ensure(['read', 'write', 'compute'].includes(approvedTool.capability), 'Tool capability is not approved.', 403, ERROR_CODES.RUNTIME_POLICY_DENIED);
    validateOpaqueToken(invocationId, 'invocationId');
    let serializedArgs: string;
    try {
      serializedArgs = JSON.stringify(boundedArgs);
    } catch {
      throw new AppError('Tool arguments must be JSON-safe.', 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
    }
    ensure(typeof serializedArgs === 'string', 'Tool arguments must be JSON-safe.', 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
    const serializedArgsBytes = new TextEncoder().encode(serializedArgs).byteLength;
    ensure(serializedArgsBytes <= session.environment.limits.maxInvocationArgsBytes, 'Tool arguments exceed the sandbox limit.', 400, ERROR_CODES.REQUEST_BODY_TOO_LARGE);
    ensure(session.invocations < session.environment.limits.maxInvocations, 'Sandbox invocation limit exceeded.', 429, ERROR_CODES.BUDGET_EXCEEDED);
    session.invocations += 1;
    if (approvedTool.toolId === 'artifact.write') {
      ensure(typeof boundedArgs.path === 'string' && typeof boundedArgs.content === 'string', 'Invalid artifact.write arguments.', 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
      const relativePath = validateRelativePath(boundedArgs.path);
      const key = normalizedPathKey(relativePath);
      ensure(!session.files.has(key), 'Sandbox output paths are immutable within an attempt.', 409, ERROR_CODES.RUNTIME_POLICY_DENIED);
      const bytes = new TextEncoder().encode(boundedArgs.content);
      validateBoundedLimit(bytes.byteLength, session.environment.limits.maxFileBytes, 'sandbox file size');
      const total = [...session.files.values()].reduce((sum, file) => sum + file.bytes.byteLength, 0) + bytes.byteLength;
      validateBoundedLimit(total, session.environment.limits.maxOutputBytes, 'sandbox output size');
      ensure(session.files.size < session.environment.limits.maxEntries, 'Sandbox entry limit exceeded.', 413, ERROR_CODES.REQUEST_BODY_TOO_LARGE);
      const sha256 = digestBytes(bytes);
      session.files.set(key, {
        bytes,
        entry: {
          relativePath,
          kind: 'file',
          bytes: bytes.byteLength,
          mediaType: mediaTypeFor(relativePath),
          classification: 'public-feedback',
          objectVersion: `memory-v1-${sha256.slice('sha256:'.length, 24)}`,
          sha256,
        },
      });
      return { invocationId, status: 'completed', outputBytes: bytes.byteLength, outputDigest: sha256 };
    }
    return {
      invocationId,
      status: 'completed',
      outputBytes: 0,
      outputDigest: digestBytes(new Uint8Array())
    };
  }

  async stopAll(sandbox: SandboxHandle): Promise<SandboxControlResult> {
    const session = this.getSession(sandbox);
    ensure(session.state !== 'disposed', 'Sandbox has already been disposed.', 409, ERROR_CODES.RUNTIME_POLICY_DENIED);
    session.state = 'stopped';
    return { sandboxId: sandbox, state: 'stopped', verified: true, stoppedProcessCount: 0 };
  }

  async snapshot(sandbox: SandboxHandle): Promise<SandboxSnapshot> {
    const session = this.getSession(sandbox);
    ensure(session.state === 'active' || session.state === 'stopped', 'Sandbox is not available for snapshot.', 409, ERROR_CODES.RUNTIME_POLICY_DENIED);
    const entries = [...session.files.values()]
      .map(({ entry }) => Object.freeze({ ...entry }))
      .sort((a, b) => compareRelativePaths(a.relativePath, b.relativePath));
    ensure(entries.length <= session.environment.limits.maxEntries, 'Sandbox entry limit exceeded.', 413, ERROR_CODES.REQUEST_BODY_TOO_LARGE);
    const snapshotId = `${sandbox}-snapshot-1`;
    const snapshotBase = {
      snapshotId,
      attemptId: session.fence.attemptId,
      fenceToken: session.fence.fenceToken,
      sealedAt: session.createdAt,
      entries: Object.freeze(entries)
    } as const;
    return Object.freeze({
      ...snapshotBase,
      snapshotDigest: computeSandboxSnapshotDigest(snapshotBase)
    });
  }

  async readSnapshotFile(sandbox: SandboxHandle, snapshot: SandboxSnapshot, relativePath: string, limit: number): Promise<SandboxSnapshotFile> {
    const session = this.getSession(sandbox);
    ensure(session.state === 'active' || session.state === 'stopped', 'Sandbox is not available for snapshot reads.', 409, ERROR_CODES.RUNTIME_POLICY_DENIED);
    validateBoundedLimit(limit, session.environment.limits.maxFileBytes, 'snapshot read limit');
    ensure(snapshot.attemptId === session.fence.attemptId && snapshot.fenceToken === session.fence.fenceToken, 'Snapshot fence mismatch.', 403, ERROR_CODES.ACCESS_FORBIDDEN);
    const currentSnapshot = await this.snapshot(sandbox);
    ensure(snapshot.snapshotId === currentSnapshot.snapshotId && snapshot.snapshotDigest === currentSnapshot.snapshotDigest, 'Snapshot changed before it was read.', 409, ERROR_CODES.RUNTIME_POLICY_DENIED);
    const path = validateRelativePath(relativePath);
    const stored = session.files.get(normalizedPathKey(path));
    ensure(stored !== undefined, 'Snapshot file not found.', 404, ERROR_CODES.RESOURCE_NOT_FOUND);
    ensure(stored.entry.relativePath === path, 'Snapshot path is not canonical.', 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
    ensure(stored.bytes.byteLength <= limit, 'Snapshot file exceeds the read limit.', 413, ERROR_CODES.REQUEST_BODY_TOO_LARGE);
    return { relativePath: stored.entry.relativePath, bytes: new Uint8Array(stored.bytes), objectVersion: stored.entry.objectVersion };
  }

  async dispose(sandbox: SandboxHandle): Promise<SandboxControlResult> {
    const session = this.getSession(sandbox);
    session.state = 'disposed';
    session.files.clear();
    return { sandboxId: sandbox, state: 'disposed', verified: true, stoppedProcessCount: 0 };
  }

  /** Test-only fixture helper. It accepts regular files only and never executes them. */
  seedFiles(sandbox: SandboxHandle, files: readonly { entry: SandboxSnapshotEntry; bytes: Uint8Array }[]): void {
    const session = this.getSession(sandbox);
    this.assertActive(session);
    ensure(files.length <= session.environment.limits.maxEntries, 'Sandbox entry limit exceeded.', 413, ERROR_CODES.REQUEST_BODY_TOO_LARGE);
    assertUniqueRelativePaths(files.map(({ entry }) => entry.relativePath));
    let total = 0;
    const next = new Map<string, StoredFile>();
    for (const file of files) {
      ensure(file.entry.kind === 'file', 'Contract provider only accepts regular files.', 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
      const path = validateRelativePath(file.entry.relativePath);
      validateBoundedLimit(file.entry.bytes, session.environment.limits.maxFileBytes, 'sandbox file size');
      ensure(file.bytes.byteLength === file.entry.bytes, 'Sandbox fixture size does not match metadata.', 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
      total += file.bytes.byteLength;
      ensure(total <= session.environment.limits.maxOutputBytes, 'Sandbox output limit exceeded.', 413, ERROR_CODES.REQUEST_BODY_TOO_LARGE);
      const bytes = new Uint8Array(file.bytes);
      const sha256 = digestBytes(bytes);
      ensure(file.entry.sha256 === undefined || file.entry.sha256 === sha256, 'Sandbox fixture digest does not match metadata.', 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
      const objectVersion = file.entry.objectVersion ?? `memory-v1-${sha256.slice('sha256:'.length, 24)}`;
      const entry = Object.freeze({ ...file.entry, relativePath: path, sha256, objectVersion });
      next.set(normalizedPathKey(path), { entry, bytes });
    }
    session.files = next;
  }

  private getSession(sandbox: SandboxHandle): Session {
    const session = this.sessions.get(sandbox);
    ensure(session !== undefined, 'Sandbox handle is invalid.', 404, ERROR_CODES.RESOURCE_NOT_FOUND);
    return session;
  }

  private assertActive(session: Session): void {
    ensure(session.state === 'active', 'Sandbox is not active.', 409, ERROR_CODES.RUNTIME_POLICY_DENIED);
  }
}

function digestBytes(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function digestText(value: string): string {
  return digestBytes(new TextEncoder().encode(value));
}


function mediaTypeFor(relativePath: string): string {
  const extension = relativePath.slice(relativePath.lastIndexOf('.')).toLowerCase();
  return ({
    '.html': 'text/html', '.htm': 'text/html', '.svg': 'image/svg+xml', '.css': 'text/css',
    '.md': 'text/markdown', '.txt': 'text/plain', '.json': 'application/json',
  } as Record<string, string>)[extension] ?? 'text/plain';
}
