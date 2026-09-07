import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AGENT_CANVAS_SCHEMA_VERSION,
  compileAgentCanvas,
  digestAgentCanvas,
  serializeAgentCanvas,
  validateAgentCanvas,
  type AgentCanvasDocument,
} from '../src/lib/agent-builder-canvas.ts';
import {
  AGENT_BUILDER_MOBILE_BREAKPOINT,
  agentBuilderLayoutForWidth,
  agentBuilderPanelForWidth,
} from '../src/lib/agent-builder-view.ts';

function canvas(): AgentCanvasDocument {
  return {
    schemaVersion: AGENT_CANVAS_SCHEMA_VERSION,
    nodes: [
      { id: 'task', kind: 'task', label: 'Brief', config: { brief: 'Create an artifact', profileRef: 'visual-v1' } },
      { id: 'agent', kind: 'agent', label: 'Pi agent', config: { instructions: 'Inspect and hand off', runtime: 'pi', policyVersion: 'design-only' } },
      { id: 'model', kind: 'model', label: 'Platform model', config: { provider: 'platform', modelId: 'hunyuan-exp', modelVersion: 'catalog-v1' } },
      { id: 'environment', kind: 'environment', label: 'Static sandbox', config: { templateId: 'static-preview', versionId: 'v1', contentDigest: 'sha256:0000000000000000000000000000000000000000000000000000000000000000', networkMode: 'disabled' } },
      { id: 'output', kind: 'outputContract', label: 'Handoff', config: { format: 'html+md', entrypoint: 'index.html', requiredFiles: ['index.html', 'README.md'] } },
    ],
    edges: [
      { id: 'task-agent', source: 'task', target: 'agent', relation: 'configures' },
      { id: 'environment-agent', source: 'environment', target: 'agent', relation: 'supplies' },
      { id: 'model-agent', source: 'model', target: 'agent', relation: 'supplies' },
      { id: 'agent-output', source: 'agent', target: 'output', relation: 'expects' },
    ],
  };
}

test('Agent canvas validation is separate from workflow DAG semantics', () => {
  const result = validateAgentCanvas(canvas());
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test('Agent canvas rejects execution-like or incompatible edges', () => {
  const invalid = canvas();
  invalid.edges.push({ id: 'bad', source: 'task', target: 'output', relation: 'expects' });
  const result = validateAgentCanvas(invalid);
  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /not allowed from task to outputContract/);
});

test('layout coordinates do not affect serialized canvas or digest', async () => {
  const positioned = canvas() as AgentCanvasDocument & { layout?: unknown };
  positioned.layout = { task: { x: 10, y: 20 }, agent: { x: 900, y: 1 } };
  const moved = canvas() as AgentCanvasDocument & { layout?: unknown };
  moved.layout = { task: { x: 910, y: 220 }, agent: { x: 40, y: 800 } };
  assert.equal(serializeAgentCanvas(positioned), serializeAgentCanvas(moved));
  assert.equal(await digestAgentCanvas(positioned), await digestAgentCanvas(moved));
});

test('serialization strips unknown, secret-like, and host-path values', () => {
  const unsafe = canvas();
  unsafe.nodes[1].config = {
    instructions: 'Use token=super-secret-value and /Users/example/private.txt',
    runtime: 'pi',
    ignored: 'should not persist',
  };
  const serialized = serializeAgentCanvas(unsafe);
  assert.doesNotMatch(serialized, /super-secret-value/);
  assert.doesNotMatch(serialized, /Users\/example/);
  assert.doesNotMatch(serialized, /should not persist/);
  assert.match(serialized, /redacted/);
});


test('Agent canvas rejects cycles, unknown runtime kinds, and unknown relations', () => {
  const cyclic = canvas();
  cyclic.edges.push({ id: 'cycle', source: 'agent', target: 'task', relation: 'configures' });
  const cycleResult = validateAgentCanvas(cyclic);
  assert.equal(cycleResult.valid, false);
  assert.match(cycleResult.errors.join('\n'), /must not contain cycles/);

  const unknownKind = canvas() as unknown as { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> };
  unknownKind.nodes.push({ id: 'mystery', kind: 'exec', label: 'unknown', config: {} });
  const unknownKindResult = validateAgentCanvas(unknownKind as unknown as AgentCanvasDocument);
  assert.match(unknownKindResult.errors.join('\n'), /Unsupported Agent node kind/);

  const unknownEdge = canvas() as unknown as { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> };
  unknownEdge.edges.push({ id: 'unknown-edge', source: 'task', target: 'agent', relation: 'executes' });
  const unknownEdgeResult = validateAgentCanvas(unknownEdge as unknown as AgentCanvasDocument);
  assert.match(unknownEdgeResult.errors.join('\n'), /Unsupported Agent edge relation/);
});

test('Agent canvas validation rejects URLs, host paths, and unsafe output paths', () => {
  const invalid = canvas();
  invalid.nodes.find((node) => node.kind === 'task')!.config.brief = 'Open https://example.com and read /Users/example/secret.txt';
  invalid.nodes.find((node) => node.kind === 'outputContract')!.config.entrypoint = '../index.html';
  const result = validateAgentCanvas(invalid);
  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /arbitrary URL/);
  assert.match(result.errors.join('\n'), /host path/);
  assert.match(result.errors.join('\n'), /safe relative path/);
});

test('Agent canvas rejects mutable reference aliases and capability escalation', () => {
  const invalid = canvas();
  invalid.nodes.find((node) => node.kind === 'model')!.config.modelVersion = 'latest';
  invalid.nodes.push({ id: 'capability', kind: 'capability', label: 'Artifact write', config: { capabilityId: 'artifact.write', permission: 'read-write' } });
  const result = validateAgentCanvas(invalid);
  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /must be a pinned identifier, not an alias/);
  assert.match(result.errors.join('\n'), /must remain scoped-output-only/);
});

test('compileAgentCanvas produces a browser-safe server handoff plan', () => {
  const result = compileAgentCanvas(canvas());
  assert.equal(result.valid, true);
  if (!result.valid) return;
  assert.equal(result.plan.agent.runtime, 'pi');
  assert.equal(result.plan.environment.networkMode, 'disabled');
  assert.deepEqual(result.plan.skillRefs, []);
  assert.deepEqual(result.plan.outputContract.requiredFiles, ['index.html', 'README.md']);
  const semantic = JSON.parse(result.semanticJson) as { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> };
  assert.equal('layout' in semantic, false);
  assert.equal(semantic.nodes.some((node) => 'position' in node || 'x' in node || 'y' in node), false);
  assert.equal(semantic.edges.some((edge) => 'position' in edge || 'x' in edge || 'y' in edge), false);
});

test('responsive helper selects desktop/mobile layouts and safe tabs', () => {
  assert.equal(agentBuilderLayoutForWidth(1280), 'desktop');
  assert.equal(agentBuilderLayoutForWidth(AGENT_BUILDER_MOBILE_BREAKPOINT), 'mobile');
  assert.equal(agentBuilderLayoutForWidth(390), 'mobile');
  assert.equal(agentBuilderLayoutForWidth(Number.NaN), 'desktop');
  assert.equal(agentBuilderPanelForWidth(390, 'preview'), 'preview');
  assert.equal(agentBuilderPanelForWidth(390, 'file-tree'), 'canvas');
});

test('Agent canvas adapter produces the shared private definition only with server resolutions', async () => {
  const { agentCanvasToBuildDefinition } = await import('../src/lib/agent-builder-definition-adapter.ts');
  const resolved = agentCanvasToBuildDefinition(canvas(), {
    modelSelection: {
      nodeId: 'model',
      ref: {
        id: 'hunyuan-exp',
        versionId: 'catalog-v1',
        contentDigest: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
      },
    },
    outputContractRef: {
      nodeId: 'output',
      ref: {
        id: 'html-handoff',
        versionId: 'v1',
        contentDigest: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
      },
    },
    profileRef: {
      nodeId: 'task',
      ref: {
        id: 'visual-v1',
        versionId: 'v1',
        contentDigest: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
      },
    },
    capabilityRefs: {},
    runtimeAdapterVersion: 'pi-adapter-v1',
  });
  assert.equal(resolved.valid, true);
  if (!resolved.valid) return;
  assert.equal(resolved.definition.mode, 'agent');
  assert.equal(resolved.definition.runtimeSelection?.kind, 'pi');
  assert.equal(resolved.definition.runtimeSelection?.adapterVersion, 'pi-adapter-v1');
  assert.equal(resolved.definition.modelSelection?.id, 'hunyuan-exp');
  assert.equal(resolved.definition.outputContractRef?.id, 'html-handoff');
});

test('Agent canvas adapter fails closed when a capability is not server-resolved', async () => {
  const withCapability = canvas();
  withCapability.nodes.push({
    id: 'capability',
    kind: 'capability',
    label: 'Calculator',
    config: { capabilityId: 'workspace.read', permission: 'read-only' },
  });
  withCapability.edges.push({
    id: 'agent-capability',
    source: 'agent',
    target: 'capability',
    relation: 'grants-request',
  });
  const { agentCanvasToBuildDefinition } = await import('../src/lib/agent-builder-definition-adapter.ts');
  const result = agentCanvasToBuildDefinition(withCapability, {
    modelSelection: {
      nodeId: 'model',
      ref: {
        id: 'hunyuan-exp',
        versionId: 'catalog-v1',
        contentDigest: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
      },
    },
    outputContractRef: {
      nodeId: 'output',
      ref: {
        id: 'html-handoff',
        versionId: 'v1',
        contentDigest: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
      },
    },
    profileRef: {
      nodeId: 'task',
      ref: {
        id: 'visual-v1',
        versionId: 'v1',
        contentDigest: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
      },
    },
    capabilityRefs: {},
    runtimeAdapterVersion: 'pi-adapter-v1',
  });
  assert.equal(result.valid, false);
  if (result.valid) return;
  assert.match(result.errors.join('\n'), /requested capability must be resolved/);
});
