export const SANDBOX_NETWORK_POLICIES = ['deny'] as const;
export type SandboxNetworkPolicy = (typeof SANDBOX_NETWORK_POLICIES)[number];

export interface SandboxLimits {
  readonly maxEntries: number;
  readonly maxFileBytes: number;
  readonly maxOutputBytes: number;
  readonly maxInvocations: number;
  readonly maxInvocationArgsBytes: number;
}

export const DEFAULT_SANDBOX_LIMITS: SandboxLimits = Object.freeze({
  maxEntries: 256,
  maxFileBytes: 4 * 1024 * 1024,
  maxOutputBytes: 16 * 1024 * 1024,
  maxInvocations: 64,
  maxInvocationArgsBytes: 16 * 1024
});

/** A platform-created environment identity. It contains no host path or executable command. */
export interface FrozenEnvironment {
  readonly environmentId: string;
  readonly environmentDigest: string;
  readonly imageDigest: string;
  readonly runtime: 'pi';
  readonly policyVersion: string;
  readonly networkPolicy: SandboxNetworkPolicy;
  readonly limits: SandboxLimits;
}

/** A server-created fence binding a sandbox to one owner and one attempt. */
export interface AttemptFence {
  readonly ownerId: string;
  readonly jobId: string;
  readonly attemptId: string;
  readonly fenceToken: string;
}

export type SandboxHandle = string;

export interface ApprovedInputHandle {
  readonly handleId: string;
  readonly relativePath: string;
  readonly bytes: number;
  readonly mediaType: string;
  readonly classification: 'public-feedback' | 'private-creation' | 'hidden';
}

export interface ApprovedTool {
  readonly toolId: string;
  readonly versionId: string;
  readonly capability: 'read' | 'write' | 'compute';
}

export type BoundedArgumentValue = string | number | boolean | null | readonly string[];
export type BoundedToolArguments = Readonly<Record<string, BoundedArgumentValue>>;

export interface SandboxInvocationResult {
  readonly invocationId: string;
  readonly status: 'completed';
  readonly outputBytes: number;
  readonly outputDigest: string;
}

export interface SandboxControlResult {
  readonly sandboxId: SandboxHandle;
  readonly state: 'stopped' | 'disposed';
  readonly verified: true;
  readonly stoppedProcessCount: number;
}

export type SandboxEntryKind = 'file' | 'directory' | 'symlink' | 'hardlink' | 'block-device' | 'character-device' | 'fifo' | 'socket';

export interface SandboxSnapshotEntry {
  readonly relativePath: string;
  readonly kind: SandboxEntryKind;
  readonly bytes: number;
  readonly mediaType: string;
  readonly classification: 'public-feedback' | 'private-creation' | 'hidden';
  readonly objectVersion?: string;
  readonly sha256?: string;
}

export interface SandboxSnapshot {
  readonly snapshotId: string;
  readonly snapshotDigest: string;
  readonly attemptId: string;
  readonly fenceToken: string;
  readonly sealedAt: string;
  readonly entries: readonly SandboxSnapshotEntry[];
}

export interface SandboxSnapshotFile {
  readonly relativePath: string;
  readonly bytes: Uint8Array;
  readonly objectVersion?: string;
}

export interface SandboxProvider {
  create(environment: FrozenEnvironment, attemptFence: AttemptFence): Promise<SandboxHandle>;
  mountApprovedInputs(sandbox: SandboxHandle, handles: readonly ApprovedInputHandle[]): Promise<void>;
  invoke(
    sandbox: SandboxHandle,
    approvedTool: ApprovedTool,
    boundedArgs: BoundedToolArguments,
    invocationId: string
  ): Promise<SandboxInvocationResult>;
  stopAll(sandbox: SandboxHandle): Promise<SandboxControlResult>;
  snapshot(sandbox: SandboxHandle): Promise<SandboxSnapshot>;
  readSnapshotFile(sandbox: SandboxHandle, snapshot: SandboxSnapshot, relativePath: string, limit: number): Promise<SandboxSnapshotFile>;
  dispose(sandbox: SandboxHandle): Promise<SandboxControlResult>;
}
