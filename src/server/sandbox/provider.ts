import { AppError, ERROR_CODES, ensure } from '../../shared/errors.ts';
import { assertUniqueRelativePaths, validateBoundedLimit, validateOpaqueToken, validateRelativePath } from './path-policy.ts';
import type {
  ApprovedInputHandle,
  ApprovedTool,
  AttemptFence,
  BoundedToolArguments,
  FrozenEnvironment,
  SandboxControlResult,
  SandboxHandle,
  SandboxInvocationResult,
  SandboxLimits,
  SandboxProvider,
  SandboxSnapshot,
  SandboxSnapshotFile
} from './types.ts';
import { DEFAULT_SANDBOX_LIMITS } from './types.ts';

export { DEFAULT_SANDBOX_LIMITS } from './types.ts';
export type { SandboxProvider } from './types.ts';

const UNAVAILABLE_MESSAGE = 'No approved sandbox provider is configured.';

export class UnavailableSandboxProvider implements SandboxProvider {
  async create(_environment: FrozenEnvironment, _attemptFence: AttemptFence): Promise<SandboxHandle> {
    throw new AppError(UNAVAILABLE_MESSAGE, 503, ERROR_CODES.RUNTIME_UNAVAILABLE);
  }

  async mountApprovedInputs(_sandbox: SandboxHandle, _handles: readonly ApprovedInputHandle[]): Promise<void> {
    throw new AppError(UNAVAILABLE_MESSAGE, 503, ERROR_CODES.RUNTIME_UNAVAILABLE);
  }

  async invoke(
    _sandbox: SandboxHandle,
    _approvedTool: ApprovedTool,
    _boundedArgs: BoundedToolArguments,
    _invocationId: string
  ): Promise<SandboxInvocationResult> {
    throw new AppError(UNAVAILABLE_MESSAGE, 503, ERROR_CODES.RUNTIME_UNAVAILABLE);
  }

  async stopAll(_sandbox: SandboxHandle): Promise<SandboxControlResult> {
    throw new AppError(UNAVAILABLE_MESSAGE, 503, ERROR_CODES.RUNTIME_UNAVAILABLE);
  }

  async snapshot(_sandbox: SandboxHandle): Promise<SandboxSnapshot> {
    throw new AppError(UNAVAILABLE_MESSAGE, 503, ERROR_CODES.RUNTIME_UNAVAILABLE);
  }

  async readSnapshotFile(
    _sandbox: SandboxHandle,
    _snapshot: SandboxSnapshot,
    _relativePath: string,
    _limit: number
  ): Promise<SandboxSnapshotFile> {
    throw new AppError(UNAVAILABLE_MESSAGE, 503, ERROR_CODES.RUNTIME_UNAVAILABLE);
  }

  async dispose(_sandbox: SandboxHandle): Promise<SandboxControlResult> {
    throw new AppError(UNAVAILABLE_MESSAGE, 503, ERROR_CODES.RUNTIME_UNAVAILABLE);
  }
}

export function validateSandboxLimits(limits: SandboxLimits): SandboxLimits {
  ensure(Number.isSafeInteger(limits.maxEntries) && limits.maxEntries > 0 && limits.maxEntries <= 4096, 'Sandbox entry limit is invalid.', 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
  ensure(Number.isSafeInteger(limits.maxFileBytes) && limits.maxFileBytes > 0 && limits.maxFileBytes <= 64 * 1024 * 1024, 'Sandbox file limit is invalid.', 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
  ensure(Number.isSafeInteger(limits.maxOutputBytes) && limits.maxOutputBytes > 0 && limits.maxOutputBytes <= 256 * 1024 * 1024, 'Sandbox output limit is invalid.', 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
  ensure(Number.isSafeInteger(limits.maxInvocations) && limits.maxInvocations > 0 && limits.maxInvocations <= 1024, 'Sandbox invocation limit is invalid.', 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
  ensure(Number.isSafeInteger(limits.maxInvocationArgsBytes) && limits.maxInvocationArgsBytes > 0 && limits.maxInvocationArgsBytes <= 1024 * 1024, 'Sandbox invocation argument limit is invalid.', 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
  return limits;
}

export function validateFrozenEnvironment(environment: FrozenEnvironment): FrozenEnvironment {
  validateOpaqueToken(environment.environmentId, 'environmentId');
  validateOpaqueToken(environment.environmentDigest, 'environmentDigest');
  validateOpaqueToken(environment.imageDigest, 'imageDigest');
  ensure(environment.runtime === 'pi', 'Only the approved Pi runtime is supported by this provider contract.', 400, ERROR_CODES.RUNTIME_POLICY_DENIED);
  validateOpaqueToken(environment.policyVersion, 'policyVersion');
  ensure(environment.networkPolicy === 'deny', 'Sandbox networking must be denied by default.', 400, ERROR_CODES.RUNTIME_POLICY_DENIED);
  validateSandboxLimits(environment.limits);
  return environment;
}

export function validateAttemptFence(attemptFence: AttemptFence): AttemptFence {
  validateOpaqueToken(attemptFence.ownerId, 'ownerId');
  validateOpaqueToken(attemptFence.jobId, 'jobId');
  validateOpaqueToken(attemptFence.attemptId, 'attemptId');
  validateOpaqueToken(attemptFence.fenceToken, 'fenceToken');
  return attemptFence;
}

export function validateApprovedInputHandles(handles: readonly ApprovedInputHandle[], limits: SandboxLimits = DEFAULT_SANDBOX_LIMITS): void {
  ensure(handles.length <= Math.min(limits.maxEntries, 256), 'Too many approved inputs.', 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
  assertUniqueRelativePaths(handles.map((handle) => handle.relativePath), 'approved input path');
  let totalBytes = 0;
  for (const handle of handles) {
    validateOpaqueToken(handle.handleId, 'input handle');
    validateRelativePath(handle.relativePath, 'approved input path');
    validateBoundedLimit(handle.bytes, limits.maxFileBytes, 'approved input size');
    ensure(typeof handle.mediaType === 'string' && /^[\x20-\x7e]{1,128}$/.test(handle.mediaType), 'Approved input media type is invalid.', 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
    totalBytes += handle.bytes;
    ensure(totalBytes <= limits.maxOutputBytes, 'Approved input output budget exceeded.', 400, ERROR_CODES.BUDGET_EXCEEDED);
  }
}
