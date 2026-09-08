import assert from 'node:assert/strict';
import type { ChildProcess } from 'node:child_process';
import test from 'node:test';
import { AppError, ERROR_CODES } from '../src/shared/errors.ts';
import {
  RunscSandboxProvider,
  type RunscCleanupFileSystem,
  type RunscCommandRunner,
} from '../src/server/sandbox/runsc.ts';

type CleanupSession = {
  readonly id: string;
  readonly bundlePath: string;
  state: 'active' | 'stopped' | 'disposed';
};

type InjectableProvider = {
  readonly sessions: Map<string, CleanupSession>;
};

interface CleanupFixtureOptions {
  readonly deleteFails?: boolean;
  readonly listFails?: boolean;
  readonly listOutput?: string;
  readonly removeFails?: boolean;
  readonly bundleExists?: boolean;
}

function cleanupFixture(options: CleanupFixtureOptions = {}) {
  const calls: string[] = [];
  const runner: RunscCommandRunner = {
    async run(args) {
      const command = args.includes('delete') ? 'delete' : args.includes('list') ? 'list' : 'other';
      calls.push(command);
      if (command === 'delete' && options.deleteFails) throw new Error('delete failed');
      if (command === 'list') {
        if (options.listFails) throw new Error('list failed');
        return { stdout: options.listOutput ?? '[]', stderr: '' };
      }
      return { stdout: '', stderr: '' };
    },
    spawn() {
      throw new Error('spawn is not used by cleanup tests');
    },
  };
  const fileSystem: RunscCleanupFileSystem = {
    async removeBundle() {
      calls.push('remove');
      if (options.removeFails) throw new Error('remove failed');
    },
    async bundleExists() {
      calls.push('exists');
      return options.bundleExists ?? false;
    },
  };
  const provider = new RunscSandboxProvider({
    rootfsPath: '/approved/rootfs',
    workRoot: '/private/agentforge-sandboxes',
    commandRunner: runner,
    cleanupFileSystem: fileSystem,
  });
  const sandboxId = 'runsc:agentforge-cleanup-test';
  const internal = provider as unknown as InjectableProvider;
  internal.sessions.set(sandboxId, {
    id: 'agentforge-cleanup-test',
    bundlePath: '/private/agentforge-sandboxes/agentforge-cleanup-test',
    state: 'stopped',
  });
  return { provider, sandboxId, internal, calls };
}

function isRuntimeCleanupFailure(error: unknown): boolean {
  return error instanceof AppError && error.code === ERROR_CODES.RUNTIME_UNAVAILABLE;
}

test('runsc cleanup verifies absent runtime state and attempt directory before reporting disposed', async () => {
  const fixture = cleanupFixture({ deleteFails: true, listOutput: 'null' });
  const result = await fixture.provider.dispose(fixture.sandboxId);
  assert.deepEqual(result, {
    sandboxId: fixture.sandboxId,
    state: 'disposed',
    verified: true,
    stoppedProcessCount: 0,
  });
  assert.deepEqual(fixture.calls, ['delete', 'list', 'remove', 'exists']);
  assert.equal(fixture.internal.sessions.has(fixture.sandboxId), false);
});

test('runsc cleanup retains diagnostic bundle and session when delete cannot be independently verified', async () => {
  const fixture = cleanupFixture({ deleteFails: true, listFails: true });
  await assert.rejects(() => fixture.provider.dispose(fixture.sandboxId), isRuntimeCleanupFailure);
  assert.deepEqual(fixture.calls, ['delete', 'list']);
  assert.equal(fixture.internal.sessions.has(fixture.sandboxId), true);
});

test('runsc cleanup fails closed when runtime state remains after delete', async () => {
  const fixture = cleanupFixture({ listOutput: '[{"id":"agentforge-cleanup-test","status":"stopped"}]' });
  await assert.rejects(() => fixture.provider.dispose(fixture.sandboxId), isRuntimeCleanupFailure);
  assert.deepEqual(fixture.calls, ['delete', 'list']);
  assert.equal(fixture.internal.sessions.has(fixture.sandboxId), true);
});

test('runsc cleanup fails closed when filesystem removal fails or leaves the bundle behind', async () => {
  const removalFailure = cleanupFixture({ removeFails: true });
  await assert.rejects(() => removalFailure.provider.dispose(removalFailure.sandboxId), isRuntimeCleanupFailure);
  assert.deepEqual(removalFailure.calls, ['delete', 'list', 'remove']);
  assert.equal(removalFailure.internal.sessions.has(removalFailure.sandboxId), true);

  const leftover = cleanupFixture({ bundleExists: true });
  await assert.rejects(() => leftover.provider.dispose(leftover.sandboxId), isRuntimeCleanupFailure);
  assert.deepEqual(leftover.calls, ['delete', 'list', 'remove', 'exists']);
  assert.equal(leftover.internal.sessions.has(leftover.sandboxId), true);
});


interface StopFixtureOptions {
  readonly killFails?: boolean;
  readonly stateFails?: boolean;
  readonly stateOutput?: string;
  readonly listOutput?: string;
  readonly listFails?: boolean;
}

function stopFixture(options: StopFixtureOptions = {}) {
  const calls: string[] = [];
  const runner: RunscCommandRunner = {
    async run(args) {
      const command = args.includes('kill') ? 'kill' : args.includes('state') ? 'state' : args.includes('list') ? 'list' : 'other';
      calls.push(command);
      if (command === 'kill' && options.killFails) throw new Error('kill failed');
      if (command === 'state') {
        if (options.stateFails) throw new Error('state failed');
        return { stdout: options.stateOutput ?? '{"id":"agentforge-stop-test","status":"stopped"}', stderr: '' };
      }
      if (command === 'list') {
        if (options.listFails) throw new Error('list failed');
        return { stdout: options.listOutput ?? '[]', stderr: '' };
      }
      return { stdout: '', stderr: '' };
    },
    spawn() {
      throw new Error('spawn is not used by stop tests');
    },
  };
  const provider = new RunscSandboxProvider({
    rootfsPath: '/approved/rootfs',
    workRoot: '/private/agentforge-sandboxes',
    commandRunner: runner,
  });
  const sandboxId = 'runsc:agentforge-stop-test';
  const internal = provider as unknown as InjectableProvider;
  internal.sessions.set(sandboxId, {
    id: 'agentforge-stop-test',
    bundlePath: '/private/agentforge-sandboxes/agentforge-stop-test',
    state: 'active',
  });
  return { provider, sandboxId, internal, calls };
}

test('runsc stop reports verified only after runtime state is stopped', async () => {
  const fixture = stopFixture();
  const result = await fixture.provider.stopAll(fixture.sandboxId);
  assert.deepEqual(result, {
    sandboxId: fixture.sandboxId,
    state: 'stopped',
    verified: true,
    stoppedProcessCount: 1,
  });
  assert.deepEqual(fixture.calls, ['kill', 'state']);
  assert.equal(fixture.internal.sessions.get(fixture.sandboxId)?.state, 'stopped');
});

test('runsc stop accepts an already-absent instance only after independent list verification', async () => {
  const fixture = stopFixture({ killFails: true, stateFails: true, listOutput: '[]' });
  const result = await fixture.provider.stopAll(fixture.sandboxId);
  assert.equal(result.verified, true);
  assert.equal(result.stoppedProcessCount, 0);
  assert.deepEqual(fixture.calls, ['kill', 'state', 'list']);
});

test('runsc stop fails closed while runtime state remains active or cannot be listed', async () => {
  const active = stopFixture({ stateOutput: '{"id":"agentforge-stop-test","status":"running"}', listOutput: '[{"id":"agentforge-stop-test","status":"running"}]' });
  await assert.rejects(() => active.provider.stopAll(active.sandboxId), isRuntimeCleanupFailure);
  assert.deepEqual(active.calls, ['kill', 'state', 'list']);
  assert.equal(active.internal.sessions.get(active.sandboxId)?.state, 'active');

  const unknown = stopFixture({ stateFails: true, listFails: true });
  await assert.rejects(() => unknown.provider.stopAll(unknown.sandboxId), isRuntimeCleanupFailure);
  assert.deepEqual(unknown.calls, ['kill', 'state', 'list']);
  assert.equal(unknown.internal.sessions.get(unknown.sandboxId)?.state, 'active');
});
