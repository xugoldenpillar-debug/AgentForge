import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError, ERROR_CODES } from '../src/shared/errors.ts';
import {
  InMemorySandboxProvider,
  UnavailableSandboxProvider,
  assertUniqueRelativePaths,
  type FrozenEnvironment,
  validateRelativePath
} from '../src/server/sandbox/index.ts';

const environment: FrozenEnvironment = {
  environmentId: 'env-test',
  environmentDigest: 'sha256:env',
  imageDigest: 'sha256:image',
  runtime: 'pi',
  policyVersion: 'policy-v1',
  networkPolicy: 'deny',
  limits: {
    maxEntries: 8,
    maxFileBytes: 1024,
    maxOutputBytes: 4096,
    maxInvocations: 4,
    maxInvocationArgsBytes: 256
  }
};

const fence = {
  ownerId: 'user-test',
  jobId: 'job-test',
  attemptId: 'attempt-test',
  fenceToken: 'fence-test'
};

function isCoded(error: unknown, code: string): boolean {
  return error instanceof AppError && error.code === code;
}

test('unavailable sandbox fails closed instead of pretending to execute', async () => {
  const provider = new UnavailableSandboxProvider();
  await assert.rejects(() => provider.create(environment, fence), (error: unknown) => isCoded(error, ERROR_CODES.RUNTIME_UNAVAILABLE));
  await assert.rejects(
    () => provider.invoke('unknown', { toolId: 'tool', versionId: 'v1', capability: 'compute' }, {}, 'invocation'),
    (error: unknown) => isCoded(error, ERROR_CODES.RUNTIME_UNAVAILABLE)
  );
});

test('relative path validation rejects traversal, absolute paths, separators, and normalization collisions', () => {
  for (const unsafe of ['/tmp/output.html', 'C:/output.html', '\\\\server\\share', '../output.html', 'nested/../../output.html', 'nested\\output.html', 'a/%2e%2e/b', 'a/%252e%252e/b', 'a/%00/b', 'foo:bar', 'file.', 'file ', 'CON.txt', `a\u202E.txt`, 'a//b', 'a/./b', `e\u0301.txt`]) {
    assert.throws(() => validateRelativePath(unsafe));
  }
  assert.equal(validateRelativePath('artifacts/index.html'), 'artifacts/index.html');
  assert.throws(() => assertUniqueRelativePaths(['Readme.md', 'readme.MD']));
});

test('in-memory provider only models the contract and becomes unusable after stopAll', async () => {
  const provider = new InMemorySandboxProvider();
  const sandbox = await provider.create(environment, fence);
  await provider.mountApprovedInputs(sandbox, [{
    handleId: 'input-1',
    relativePath: 'input/data.csv',
    bytes: 5,
    mediaType: 'text/csv',
    classification: 'private-creation'
  }]);
  const invocation = await provider.invoke(sandbox, { toolId: 'calculator', versionId: 'tool-v1', capability: 'compute' }, { expression: '1 + 1' }, 'invoke-1');
  assert.equal(invocation.status, 'completed');
  const stopped = await provider.stopAll(sandbox);
  assert.deepEqual(stopped, { sandboxId: sandbox, state: 'stopped', verified: true, stoppedProcessCount: 0 });
  await assert.rejects(
    () => provider.invoke(sandbox, { toolId: 'calculator', versionId: 'tool-v1', capability: 'compute' }, {}, 'invoke-2'),
    (error: unknown) => isCoded(error, ERROR_CODES.RUNTIME_POLICY_DENIED)
  );
  const disposed = await provider.dispose(sandbox);
  assert.equal(disposed.state, 'disposed');
  assert.equal(disposed.verified, true);
});

test('in-memory snapshot reads are fenced and bounded', async () => {
  const provider = new InMemorySandboxProvider();
  const sandbox = await provider.create(environment, fence);
  provider.seedFiles(sandbox, [{
    entry: { relativePath: 'out.txt', kind: 'file', bytes: 4, mediaType: 'text/plain', classification: 'public-feedback' },
    bytes: new TextEncoder().encode('seed')
  }]);
  const snapshot = await provider.snapshot(sandbox);
  await assert.rejects(
    () => provider.readSnapshotFile(sandbox, snapshot, 'out.txt', 3),
    (error: unknown) => isCoded(error, ERROR_CODES.REQUEST_BODY_TOO_LARGE)
  );
  provider.seedFiles(sandbox, [{
    entry: { relativePath: 'out.txt', kind: 'file', bytes: 7, mediaType: 'text/plain', classification: 'public-feedback' },
    bytes: new TextEncoder().encode('changed')
  }]);
  await assert.rejects(
    () => provider.readSnapshotFile(sandbox, snapshot, 'out.txt', 1024),
    (error: unknown) => isCoded(error, ERROR_CODES.RUNTIME_POLICY_DENIED)
  );
});

test('in-memory provider enforces bounded fixture sizes and rejects special files', async () => {
  const provider = new InMemorySandboxProvider();
  const sandbox = await provider.create(environment, fence);
  assert.throws(() => provider.seedFiles(sandbox, [{
      entry: { relativePath: 'out.txt', kind: 'file', bytes: 1025, mediaType: 'text/plain', classification: 'public-feedback' },
      bytes: new Uint8Array(1025)
    }]),
    (error: unknown) => isCoded(error, ERROR_CODES.REQUEST_VALIDATION_FAILED)
  );
  assert.throws(() => provider.seedFiles(sandbox, [{
      entry: { relativePath: 'pipe', kind: 'fifo', bytes: 0, mediaType: 'application/octet-stream', classification: 'public-feedback' },
      bytes: new Uint8Array()
    }]),
    (error: unknown) => isCoded(error, ERROR_CODES.REQUEST_VALIDATION_FAILED)
  );
});
