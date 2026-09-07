'use client';

import { create } from 'zustand';
import { applyEdgeChanges, applyNodeChanges, type Connection, type Edge, type EdgeChange, type Node, type NodeChange } from '@xyflow/react';
import {
  AGENT_CANVAS_SCHEMA_VERSION,
  type AgentCanvasDocument,
  type AgentCanvasEdge,
  type AgentCanvasNode,
  type AgentConfigValue,
  type AgentEdgeRelation,
  type AgentNodeConfig,
  type AgentNodeKind,
  validateAgentCanvas,
} from '@/lib/agent-builder-canvas';

export type AgentFlowData = {
  kind: AgentNodeKind;
  label: string;
  config: AgentNodeConfig;
};

export type AgentFlowNode = Node<AgentFlowData, 'agent'>;
export type AgentFlowEdge = Edge<{ relation: AgentEdgeRelation }>;

export const DEFAULT_AGENT_CANVAS: AgentCanvasDocument = {
  schemaVersion: AGENT_CANVAS_SCHEMA_VERSION,
  nodes: [
    { id: 'task-1', kind: 'task', label: 'Pelican bicycle brief', config: { brief: 'Create a self-contained visual artifact.', profileRef: 'artifact-visual-v1' } },
    { id: 'input-1', kind: 'inputMount', label: 'Reference input', config: { mountId: 'brief-input', sourceKind: 'problem', readOnly: true } },
    { id: 'agent-1', kind: 'agent', label: 'Pi visual agent', config: { instructions: 'Build the artifact, inspect the output, and leave a readable handoff.', runtime: 'pi', policyVersion: 'design-only' } },
    { id: 'model-1', kind: 'model', label: 'Platform model', config: { provider: 'platform', modelId: 'hunyuan-exp', modelVersion: 'catalog-v1' } },
    { id: 'skill-1', kind: 'skill', label: 'Visual composition', config: { kind: 'declarative', skillId: 'visual-composition', versionId: 'v1', contentDigest: 'sha256:0000000000000000000000000000000000000000000000000000000000000000' } },
    { id: 'environment-1', kind: 'environment', label: 'Static preview sandbox', config: { templateId: 'static-preview', versionId: 'v1', contentDigest: 'sha256:0000000000000000000000000000000000000000000000000000000000000000', networkMode: 'disabled', runtime: 'approved-static' } },
    { id: 'capability-1', kind: 'capability', label: 'Write artifact files', config: { capabilityId: 'artifact.write', permission: 'scoped-output-only' } },
    { id: 'output-1', kind: 'outputContract', label: 'HTML + Markdown handoff', config: { format: 'html+md', entrypoint: 'index.html', requiredFiles: ['index.html', 'README.md'] } },
  ],
  edges: [
    { id: 'edge-task-agent', source: 'task-1', target: 'agent-1', relation: 'configures' },
    { id: 'edge-input-agent', source: 'input-1', target: 'agent-1', relation: 'supplies' },
    { id: 'edge-model-agent', source: 'model-1', target: 'agent-1', relation: 'supplies' },
    { id: 'edge-skill-agent', source: 'skill-1', target: 'agent-1', relation: 'supplies' },
    { id: 'edge-environment-agent', source: 'environment-1', target: 'agent-1', relation: 'supplies' },
    { id: 'edge-agent-capability', source: 'agent-1', target: 'capability-1', relation: 'grants-request' },
    { id: 'edge-agent-output', source: 'agent-1', target: 'output-1', relation: 'expects' },
  ],
};

function createId(prefix: string): string {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID().slice(0, 8)}`;
  return `${prefix}-${Date.now().toString(36)}`;
}

function configFor(kind: AgentNodeKind): AgentNodeConfig {
  switch (kind) {
    case 'task': return { brief: 'Describe the artifact to create.', profileRef: 'artifact-visual-v1' };
    case 'agent': return { instructions: 'Build, inspect, and explain the artifact.', runtime: 'pi', policyVersion: 'design-only' };
    case 'model': return { provider: 'platform', modelId: 'unconfigured', modelVersion: 'catalog-v1' };
    case 'skill': return { kind: 'declarative', skillId: 'choose-a-skill', versionId: 'unconfigured', contentDigest: 'sha256:0000000000000000000000000000000000000000000000000000000000000000' };
    case 'environment': return { templateId: 'static-preview', versionId: 'v1', contentDigest: 'sha256:0000000000000000000000000000000000000000000000000000000000000000', networkMode: 'disabled', runtime: 'approved-static' };
    case 'inputMount': return { mountId: 'new-input', sourceKind: 'problem', readOnly: true };
    case 'capability': return { capabilityId: 'artifact.write', permission: 'scoped-output-only' };
    case 'outputContract': return { format: 'html+md', entrypoint: 'index.html', requiredFiles: ['index.html', 'README.md'] };
  }
}

function labelFor(kind: AgentNodeKind): string {
  return {
    task: 'Task',
    agent: 'Agent',
    model: 'Model',
    skill: 'Skill',
    environment: 'Environment',
    inputMount: 'Input mount',
    capability: 'Capability',
    outputContract: 'Output contract',
  }[kind];
}

function toFlowNodes(canvas: AgentCanvasDocument): AgentFlowNode[] {
  const positions: Record<AgentNodeKind, { x: number; y: number }> = {
    task: { x: 30, y: 70 },
    inputMount: { x: 30, y: 245 },
    agent: { x: 315, y: 160 },
    model: { x: 650, y: 20 },
    skill: { x: 650, y: 145 },
    environment: { x: 650, y: 270 },
    capability: { x: 315, y: 425 },
    outputContract: { x: 650, y: 425 },
  };
  return canvas.nodes.map((node) => ({
    id: node.id,
    type: 'agent',
    position: positions[node.kind],
    data: { kind: node.kind, label: node.label, config: node.config },
  }));
}

function toFlowEdges(canvas: AgentCanvasDocument): AgentFlowEdge[] {
  return canvas.edges.map((edge): AgentFlowEdge => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: 'smoothstep',
    label: edge.relation,
    data: { relation: edge.relation },
  }));
}

function toCanvas(nodes: AgentFlowNode[], edges: AgentFlowEdge[]): AgentCanvasDocument {
  return {
    schemaVersion: AGENT_CANVAS_SCHEMA_VERSION,
    nodes: nodes.map((node) => ({ id: node.id, kind: node.data.kind, label: node.data.label, config: node.data.config })),
    edges: edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target, relation: edge.data?.relation || 'supplies' })),
  };
}

function relationFor(source: AgentFlowNode, target: AgentFlowNode): AgentEdgeRelation | null {
  if (source.data.kind === 'task' && target.data.kind === 'agent') return 'configures';
  if (target.data.kind === 'agent' && ['inputMount', 'model', 'skill', 'environment'].includes(source.data.kind)) return 'supplies';
  if (source.data.kind === 'agent' && target.data.kind === 'capability') return 'grants-request';
  if (source.data.kind === 'agent' && target.data.kind === 'outputContract') return 'expects';
  return null;
}

interface AgentBuilderStore {
  nodes: AgentFlowNode[];
  edges: AgentFlowEdge[];
  selectedId: string | null;
  notice: string;
  load: (canvas: AgentCanvasDocument) => void;
  exportCanvas: () => AgentCanvasDocument;
  onNodesChange: (changes: NodeChange<AgentFlowNode>[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  tryConnect: (connection: Connection) => boolean;
  select: (id: string | null) => void;
  setNotice: (notice: string) => void;
  update: (id: string, config: Record<string, AgentConfigValue | undefined>, label?: string) => void;
  add: (kind: AgentNodeKind) => void;
  remove: (id: string) => void;
}

export const useAgentBuilderStore = create<AgentBuilderStore>((set, get) => ({
  nodes: [],
  edges: [],
  selectedId: null,
  notice: '',
  load: (canvas) => set({ nodes: toFlowNodes(canvas), edges: toFlowEdges(canvas), selectedId: canvas.nodes.find((node) => node.kind === 'agent')?.id || null, notice: '' }),
  exportCanvas: () => toCanvas(get().nodes, get().edges),
  onNodesChange: (changes) => set((state) => ({ nodes: applyNodeChanges(changes, state.nodes) })),
  onEdgesChange: (changes) => set((state) => ({ edges: applyEdgeChanges(changes, state.edges) as AgentFlowEdge[] })),
  tryConnect: (connection) => {
    let accepted = false;
    set((state) => {
      const source = state.nodes.find((node) => node.id === connection.source);
      const target = state.nodes.find((node) => node.id === connection.target);
      if (!source || !target || !connection.source || !connection.target) return { notice: 'Both ends of an Agent connection must be nodes.' };
      const relation = relationFor(source, target);
      if (!relation) return { notice: `That connection is not valid for the Agent canvas. Use configuration edges, not execution order.` };
      const nextEdge: AgentFlowEdge = {
        ...connection,
        id: createId('edge'),
        type: 'smoothstep',
        data: { relation },
        source: connection.source,
        target: connection.target,
      };
      const candidate = toCanvas(state.nodes, [...state.edges, nextEdge]);
      const validation = validateAgentCanvas(candidate);
      if (validation.errors.some((error) => error.includes('Relation') || error.includes('missing node'))) return { notice: validation.errors[0] };
      accepted = true;
      return { edges: toFlowEdges(candidate), notice: `Added ${relation} edge.` };
    });
    return accepted;
  },
  select: (id) => set({ selectedId: id }),
  setNotice: (notice) => set({ notice }),
  update: (id, config, label) => set((state) => ({
    nodes: state.nodes.map((node) => {
      if (node.id !== id) return node;
      const nextConfig: AgentNodeConfig = { ...node.data.config };
      for (const [key, value] of Object.entries(config)) {
        if (value !== undefined) nextConfig[key] = value;
      }
      return { ...node, data: { ...node.data, config: nextConfig, ...(label === undefined ? {} : { label }) } };
    }),
  })),
  add: (kind) => set((state) => {
    const id = createId(kind);
    const next: AgentFlowNode = {
      id,
      type: 'agent',
      position: { x: 240 + (state.nodes.length % 2) * 190, y: 90 + state.nodes.length * 22 },
      data: { kind, label: labelFor(kind), config: configFor(kind) },
    };
    return { nodes: [...state.nodes, next], selectedId: id, notice: `${labelFor(kind)} added to the local draft.` };
  }),
  remove: (id) => set((state) => ({
    nodes: state.nodes.filter((node) => node.id !== id),
    edges: state.edges.filter((edge) => edge.source !== id && edge.target !== id),
    selectedId: state.selectedId === id ? null : state.selectedId,
    notice: 'Node removed from the local draft. Backend save is unavailable.',
  })),
}));

export function agentCanvasForFlow(nodes: AgentFlowNode[], edges: AgentFlowEdge[]): AgentCanvasDocument {
  return toCanvas(nodes, edges);
}

export function flowNodesForAgentCanvas(canvas: AgentCanvasDocument): AgentFlowNode[] {
  return toFlowNodes(canvas);
}

export function flowEdgesForAgentCanvas(canvas: AgentCanvasDocument): AgentFlowEdge[] {
  return toFlowEdges(canvas);
}

export function agentConfigValue(value: AgentConfigValue | undefined): string {
  if (Array.isArray(value)) return value.join(', ');
  if (value === null || value === undefined) return '';
  return String(value);
}
