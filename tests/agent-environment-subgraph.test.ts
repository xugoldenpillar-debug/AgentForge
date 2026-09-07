import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compileApprovedEnvironmentSubgraph,
  createAgentRuntimePermissionBoundary,
  validateApprovedEnvironmentSubgraph,
} from '../src/server/agent-builder-environment.ts';
import {
  digestEnvironmentTemplateVersion,
  type EnvironmentTemplateVersionV1,
} from '../src/shared/environment-contract.ts';
import {
  AGENT_CANVAS_SCHEMA_VERSION,
  type AgentCanvasDocument,
} from '../src/lib/agent-builder-canvas.ts';
import type { AgentRuntimePermissionSnapshotV1 } from '../src/shared/agent-runtime-contract.ts';

const ZERO_DIGEST = `sha256:${'0'.repeat(64)}`;
const BUILD_IDENTITY = {
  ownerId: 'owner-test',
  buildId: 'build-test',
  buildVersionId: 'build-v1',
  definitionDigest: ZERO_DIGEST,
} as const;

function template(): EnvironmentTemplateVersionV1 {
  return {
    schemaVersion: 1,
    templateId: 'static-preview',
    versionId: 'v1',
    versionNumber: 1,
    name: 'Static preview',
    description: 'Approved static artifact handoff.',
    runtime: {
      kind: 'pi',
      adapterVersion: 'pi-adapter-v1',
      policyVersion: 'design-only',
    },
    capabilities: [
      { kind: 'system', capabilityId: 'workspace.read', versionId: 'cap-v1', contentDigest: ZERO_DIGEST },
      { kind: 'system', capabilityId: 'artifact.write', versionId: 'cap-v1', contentDigest: ZERO_DIGEST },
      { kind: 'system', capabilityId: 'network.none', versionId: 'cap-v1', contentDigest: ZERO_DIGEST },
    ],
    limits: {
      maxExecutionMs: 60_000,
      maxMemoryMiB: 512,
      maxDiskBytes: 2 * 1024 * 1024,
      maxProcesses: 1,
    },
    artifactPolicy: {
      allowedMediaTypes: ['text/html', 'text/markdown'],
      maxArtifacts: 8,
      maxArtifactBytes: 256 * 1024,
      maxTotalBytes: 1024 * 1024,
    },
  };
}

function canvas(environment: EnvironmentTemplateVersionV1 = template()): AgentCanvasDocument {
  return {
    schemaVersion: AGENT_CANVAS_SCHEMA_VERSION,
    nodes: [
      { id: 'task', kind: 'task', label: 'Brief', config: { brief: 'Create an artifact', profileRef: null } },
      { id: 'agent', kind: 'agent', label: 'Pi agent', config: { instructions: 'Create a static handoff', runtime: 'pi', policyVersion: 'design-only' } },
      { id: 'model', kind: 'model', label: 'Platform model', config: { provider: 'platform', modelId: 'model-v1', modelVersion: 'catalog-v1' } },
      {
        id: 'environment',
        kind: 'environment',
        label: 'Static sandbox',
        config: {
          templateId: environment.templateId,
          versionId: environment.versionId,
          contentDigest: digestEnvironmentTemplateVersion(environment),
          networkMode: 'disabled',
        },
      },
      {
        id: 'workspace-read',
        kind: 'capability',
        label: 'Workspace read',
        config: { capabilityId: 'workspace.read', permission: 'read-only' },
      },
      {
        id: 'artifact-write',
        kind: 'capability',
        label: 'Artifact write',
        config: { capabilityId: 'artifact.write', permission: 'scoped-output-only' },
      },
      { id: 'output', kind: 'outputContract', label: 'Handoff', config: { format: 'html', entrypoint: 'index.html', requiredFiles: ['index.html'] } },
    ],
    edges: [
      { id: 'task-agent', source: 'task', target: 'agent', relation: 'configures' },
      { id: 'environment-agent', source: 'environment', target: 'agent', relation: 'supplies' },
      { id: 'model-agent', source: 'model', target: 'agent', relation: 'supplies' },
      { id: 'workspace-agent', source: 'agent', target: 'workspace-read', relation: 'grants-request' },
      { id: 'artifact-agent', source: 'agent', target: 'artifact-write', relation: 'grants-request' },
      { id: 'agent-output', source: 'agent', target: 'output', relation: 'expects' },
    ],
  };
}

function resolveApproved(approved: EnvironmentTemplateVersionV1): (templateId: string, versionId: string) => EnvironmentTemplateVersionV1 | null {
  return (templateId, versionId) => templateId === approved.templateId && versionId === approved.versionId ? approved : null;
}

function compiledSnapshot(): AgentRuntimePermissionSnapshotV1 {
  const result = compileApprovedEnvironmentSubgraph(canvas(), resolveApproved(template()), BUILD_IDENTITY);
  assert.equal(result.valid, true);
  if (!result.valid) throw new Error(result.errors.join('; '));
  return result.runtimeSnapshot;
}

test('approved environment subgraph resolves a server-owned version and intersects capabilities', () => {
  const approved = template();
  const result = compileApprovedEnvironmentSubgraph(canvas(approved), resolveApproved(approved), BUILD_IDENTITY);

  assert.equal(result.valid, true);
  if (!result.valid) return;
  assert.equal(result.plan.environmentTemplate.versionId, 'v1');
  assert.deepEqual(
    result.runtimeSnapshot.effectiveCapabilities.map((capability) => capability.capabilityId),
    ['artifact.write', 'workspace.read'],
  );
  assert.equal(result.runtimeSnapshot.environment.contentDigest, digestEnvironmentTemplateVersion(approved));
  assert.equal(result.runtimeSnapshot.environment.networkMode, 'disabled');
  assert.equal('instructions' in result.runtimeSnapshot, false);
  assert.equal('bytes' in result.runtimeSnapshot, false);
});

test('approved environment validator rejects an unapproved version and a client digest mismatch', () => {
  const approved = template();
  const unapproved = canvas(approved);
  const environment = unapproved.nodes.find((node) => node.kind === 'environment');
  assert.ok(environment);
  environment.config.versionId = 'v2';
  const unavailable = validateApprovedEnvironmentSubgraph(unapproved, resolveApproved(approved));
  assert.equal(unavailable.valid, false);
  if (!unavailable.valid) assert.match(unavailable.errors.join('\n'), /not approved or is unavailable/);

  const mismatched = canvas(approved);
  const mismatchedEnvironment = mismatched.nodes.find((node) => node.kind === 'environment');
  assert.ok(mismatchedEnvironment);
  mismatchedEnvironment.config.contentDigest = ZERO_DIGEST;
  const digestResult = validateApprovedEnvironmentSubgraph(mismatched, resolveApproved(approved));
  assert.equal(digestResult.valid, false);
  if (!digestResult.valid) assert.match(digestResult.errors.join('\n'), /content digest does not match/);
});

test('private environment templates require matching server-owned Agent ownership', () => {
  const privateTemplate: EnvironmentTemplateVersionV1 = {
    ...template(),
    scope: 'private',
    ownerId: BUILD_IDENTITY.ownerId,
  };
  const privateCanvas = canvas(privateTemplate);
  const resolver = (templateId: string, versionId: string, context?: { ownerId: string }) => {
    assert.equal(templateId, privateTemplate.templateId);
    assert.equal(versionId, privateTemplate.versionId);
    return context?.ownerId === privateTemplate.ownerId ? privateTemplate : null;
  };

  const sameOwner = compileApprovedEnvironmentSubgraph(privateCanvas, resolver, BUILD_IDENTITY);
  assert.equal(sameOwner.valid, true);

  const foreignOwner = compileApprovedEnvironmentSubgraph(privateCanvas, resolver, {
    ...BUILD_IDENTITY,
    ownerId: 'other-owner',
  });
  assert.equal(foreignOwner.valid, false);
  if (!foreignOwner.valid) assert.match(foreignOwner.errors.join('\n'), /not approved or is unavailable/);

  const missingOwnerContext = validateApprovedEnvironmentSubgraph(privateCanvas, () => privateTemplate);
  assert.equal(missingOwnerContext.valid, false);
  if (!missingOwnerContext.valid) assert.match(missingOwnerContext.errors.join('\n'), /private environment template/);
});

test('approved environment validator rejects capability escalation and shell-like canvas config', () => {
  const approved = template();
  const escalated = canvas(approved);
  escalated.nodes.push({
    id: 'workspace-write',
    kind: 'capability',
    label: 'Workspace write',
    config: { capabilityId: 'workspace.write', permission: 'scoped-workspace-only' },
  });
  escalated.edges.push({ id: 'workspace-write-agent', source: 'agent', target: 'workspace-write', relation: 'grants-request' });
  const capabilityResult = validateApprovedEnvironmentSubgraph(escalated, resolveApproved(approved));
  assert.equal(capabilityResult.valid, false);
  if (!capabilityResult.valid) assert.match(capabilityResult.errors.join('\n'), /outside the approved environment ceiling/);

  const shellLike = canvas(approved) as AgentCanvasDocument & { nodes: AgentCanvasDocument['nodes'] };
  const shellEnvironment = shellLike.nodes.find((node) => node.kind === 'environment');
  assert.ok(shellEnvironment);
  (shellEnvironment.config as Record<string, unknown>).shell = 'sh -c whoami';
  const shellResult = validateApprovedEnvironmentSubgraph(shellLike, resolveApproved(approved));
  assert.equal(shellResult.valid, false);
  if (!shellResult.valid) assert.match(shellResult.errors.join('\n'), /unsupported config field shell/);
});

test('server-owned malformed environment payloads fail closed without exposing payload content', () => {
  const approved = template();
  const malformed = { ...approved, shell: 'docker run --privileged secret-token' } as unknown as EnvironmentTemplateVersionV1;
  const result = validateApprovedEnvironmentSubgraph(canvas(approved), resolveApproved(malformed));
  assert.equal(result.valid, false);
  if (!result.valid) {
    assert.match(result.errors.join('\n'), /failed server validation/);
    assert.doesNotMatch(result.errors.join('\n'), /secret-token|docker/);
  }
});

test('runtime permission snapshot is immutable and cannot be elevated by a caller', () => {
  const original = canvas();
  const approved = template();
  const result = compileApprovedEnvironmentSubgraph(original, resolveApproved(approved), BUILD_IDENTITY);
  assert.equal(result.valid, true);
  if (!result.valid) return;

  const snapshot = result.runtimeSnapshot;
  const environmentNode = original.nodes.find((node) => node.kind === 'environment');
  assert.ok(environmentNode);
  environmentNode.config.versionId = 'v2';
  environmentNode.config.contentDigest = ZERO_DIGEST;

  assert.equal(snapshot.environment.versionId, 'v1');
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.environment), true);
  assert.equal(Object.isFrozen(snapshot.effectiveCapabilities), true);
  assert.throws(() => {
    (snapshot.environment as { versionId: string }).versionId = 'v2';
  }, TypeError);

  const boundary = createAgentRuntimePermissionBoundary(snapshot);
  assert.equal(boundary.hasCapability('workspace.read', 'read-only'), true);
  assert.equal(boundary.hasCapability('workspace.read', 'scoped-workspace-only'), false);
  assert.equal(boundary.hasCapability('workspace.write', 'scoped-workspace-only'), false);
  assert.equal(Object.isFrozen(boundary), true);
});

test('runtime boundary rejects a stale or tampered snapshot digest', () => {
  const snapshot = compiledSnapshot();
  const tampered = { ...snapshot, snapshotDigest: ZERO_DIGEST };
  assert.throws(() => createAgentRuntimePermissionBoundary(tampered), /Invalid Agent runtime permission snapshot/);
});
