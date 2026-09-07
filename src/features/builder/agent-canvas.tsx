'use client';

import { memo, useCallback, useMemo } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  ArrowDownToLine,
  Braces,
  Box,
  Cpu,
  FileCheck2,
  FileInput,
  KeyRound,
  Network,
  ShieldCheck,
  Sparkles,
  SquareDashedMousePointer,
  Workflow,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { systemLabel } from '@/shared/i18n/system-content';
import { useLocale } from '@/lib/i18n';
import styles from './agent-builder.module.css';
import {
  AGENT_NODE_KINDS,
  type AgentNodeKind,
} from '@/lib/agent-builder-canvas';
import {
  useAgentBuilderStore,
  type AgentFlowNode,
} from './agent-store';

const icons: Record<AgentNodeKind, typeof Workflow> = {
  task: FileInput,
  agent: Workflow,
  model: Cpu,
  skill: Sparkles,
  environment: Box,
  inputMount: ArrowDownToLine,
  capability: KeyRound,
  outputContract: FileCheck2,
};

const paletteLabels: Record<AgentNodeKind, string> = {
  task: 'Task',
  agent: 'Agent',
  model: 'Model',
  skill: 'Skill',
  environment: 'Environment',
  inputMount: 'Input mount',
  capability: 'Capability',
  outputContract: 'Output contract',
};

function nodeMeta(kind: AgentNodeKind, config: AgentFlowNode['data']['config']): string {
  switch (kind) {
    case 'task': return String(config.profileRef || 'brief required');
    case 'agent': return `${String(config.runtime || 'pi')} · ${String(config.policyVersion || 'policy pending')}`;
    case 'model': return `${String(config.provider || 'unconfigured')} / ${String(config.modelId || 'model pending')}`;
    case 'skill': return `${String(config.kind || 'declarative')} / ${String(config.skillId || 'skill pending')}`;
    case 'environment': return `${String(config.templateId || 'template pending')} / ${String(config.versionId || 'version pending')}`;
    case 'inputMount': return `${String(config.sourceKind || 'input')} · ${config.readOnly === false ? 'writable' : 'read-only'}`;
    case 'capability': return `${String(config.capabilityId || 'capability pending')} · ${String(config.permission || 'scoped')}`;
    case 'outputContract': return `${String(config.format || 'format pending')} · ${String(config.entrypoint || 'entrypoint pending')}`;
  }
}

const AgentNodeView = memo(({ data, selected }: NodeProps<AgentFlowNode>) => {
  const { language } = useLocale();
  const NodeIcon = icons[data.kind];
  const label = systemLabel('node', data.kind, paletteLabels[data.kind], language);
  return (
    <div className={cn('agent-flow-node', `agent-flow-node-${data.kind}`, selected && 'agent-flow-node-selected')}>
      <Handle type="target" position={Position.Left} />
      <div className="agent-flow-node-top">
        <NodeIcon size={13} />
        <span>{label}</span>
        {data.kind === 'environment' && <span className="agent-flow-node-lock"><ShieldCheck size={11} /></span>}
      </div>
      <strong>{data.label}</strong>
      <span className="agent-flow-node-meta">{nodeMeta(data.kind, data.config)}</span>
      <Handle type="source" position={Position.Right} />
    </div>
  );
});
AgentNodeView.displayName = 'AgentNodeView';

const nodeTypes = { agent: AgentNodeView };

function AgentCanvasSurface() {
  const {
    nodes,
    edges,
    selectedId,
    onNodesChange,
    onEdgesChange,
    select,
    tryConnect,
    setNotice,
    add,
  } = useAgentBuilderStore();
  const { screenToFlowPosition } = useReactFlow();

  const renderedNodes = useMemo(() => nodes.map((node) => ({
    ...node,
    selected: node.id === selectedId,
  })), [nodes, selectedId]);

  const onDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    const kind = event.dataTransfer.getData('application/agentforge-agent-node') as AgentNodeKind;
    if (!AGENT_NODE_KINDS.includes(kind)) return;
    const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    add(kind);
    const nextId = useAgentBuilderStore.getState().selectedId;
    if (nextId) {
      useAgentBuilderStore.setState((state) => ({
        nodes: state.nodes.map((node) => node.id === nextId ? { ...node, position } : node),
      }));
    }
  }, [add, screenToFlowPosition]);

  return (
    <ReactFlow
      nodes={renderedNodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={(connection) => {
        if (!tryConnect(connection)) setNotice('Only configuration edges are allowed here: configures, supplies, grants-request, and expects.');
      }}
      onNodeClick={(_, node) => select(node.id)}
      onPaneClick={() => select(null)}
      onDrop={onDrop}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
      }}
      fitView
      fitViewOptions={{ padding: 0.2, maxZoom: 0.88 }}
      minZoom={0.25}
      maxZoom={1.6}
      colorMode="dark"
      deleteKeyCode={['Backspace', 'Delete']}
      snapToGrid
      snapGrid={[10, 10]}
      connectionRadius={30}
      defaultEdgeOptions={{ type: 'smoothstep' }}
    >
      <Background color="#303940" gap={20} size={1} variant={BackgroundVariant.Dots} />
      <Controls showInteractive={false} />
      <MiniMap
        nodeColor={(node) => node.data.kind === 'environment' ? '#b9df75' : node.data.kind === 'agent' ? '#a992f6' : '#566875'}
        maskColor="#080d11aa"
        style={{ width: 125, height: 75 }}
        pannable
        zoomable
      />
    </ReactFlow>
  );
}

export function AgentCanvas() {
  return (
    <ReactFlowProvider>
      <AgentCanvasSurface />
    </ReactFlowProvider>
  );
}

export function AgentNodePalette() {
  const add = useAgentBuilderStore((state) => state.add);
  return (
    <div className={styles.paletteList}>
      {AGENT_NODE_KINDS.map((kind) => {
        const NodeIcon = icons[kind];
        return (
          <button
            className={styles.paletteItem}
            key={kind}
            type="button"
            draggable
            onDragStart={(event) => event.dataTransfer.setData('application/agentforge-agent-node', kind)}
            onClick={() => add(kind)}
          >
            <NodeIcon size={14} />
            <span>{paletteLabels[kind]}</span>
            <span className={styles.palettePlus}>+</span>
          </button>
        );
      })}
    </div>
  );
}
