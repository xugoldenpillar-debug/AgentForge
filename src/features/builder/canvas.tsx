'use client';
import { memo, useCallback, useMemo } from 'react';
import { ReactFlow,ReactFlowProvider,Handle,Position,Controls,MiniMap,Background,BackgroundVariant,useReactFlow,type NodeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ArrowDownToLine,Braces,Cpu,Sparkles,Wrench,ShieldCheck,ArrowUpFromLine,Check,LoaderCircle,Workflow as WorkflowIcon } from 'lucide-react';
import { useBuilderStore, type ForgeNode } from './store';
import type { NodeKind,Workflow } from '@/shared/types';
import { cn } from '@/lib/utils';
const icons={input:ArrowDownToLine,prompt:Braces,model:Cpu,skill:Sparkles,tool:Wrench,validator:ShieldCheck,output:ArrowUpFromLine};
const ForgeNodeView=memo(({data,selected}:NodeProps<ForgeNode>)=>{const Icon=icons[data.kind];return <div className={cn('forge-node',data.kind,selected&&'selected',data.state)}>
  {data.kind!=='input'&&<Handle type="target" position={Position.Left}/>}
  <div className="node-top"><Icon/>{data.kind}<span className="node-state">{data.state==='done'?<Check size={10}/>:data.state==='running'?<LoaderCircle className="animate-spin" size={10}/>:null}</span></div>
  <div className="node-content"><div className="node-title">{data.label}</div><div className="node-meta">{data.kind==='model'?data.config.modelId:data.kind==='prompt'?`${Math.ceil((data.config.systemPrompt?.length||0)/4)} tokens (est.)`:data.kind==='skill'?data.config.skillId:data.kind==='tool'?data.config.toolId:data.kind==='validator'?'Output contract':data.kind==='input'?'{{input}}':'Final response'}</div>{data.tokens!==undefined&&<div className="node-meta accent">+{data.tokens} tokens</div>}</div>
  {data.kind!=='output'&&<Handle type="source" position={Position.Right}/>}
</div>});
ForgeNodeView.displayName='ForgeNode';const nodeTypes={forge:ForgeNodeView};
function InteractiveCanvas(){
  const {nodes,edges,selectedId,onNodesChange,onEdgesChange,connect,select,add}=useBuilderStore();const {screenToFlowPosition}=useReactFlow();
  const drop=useCallback((event:React.DragEvent)=>{event.preventDefault();const kind=event.dataTransfer.getData('application/agentforge') as NodeKind;if(!icons[kind])return;add(kind,screenToFlowPosition({x:event.clientX,y:event.clientY}));},[add,screenToFlowPosition]);
  const rendered=useMemo(()=>nodes.map(n=>({...n,selected:n.id===selectedId})),[nodes,selectedId]);
  return <ReactFlow nodes={rendered} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={connect} onNodeClick={(_,n)=>select(n.id)} onPaneClick={()=>select(null)} onDrop={drop} onDragOver={e=>{e.preventDefault();e.dataTransfer.dropEffect='move';}} fitView fitViewOptions={{padding:.18,maxZoom:1}} minZoom={.25} maxZoom={1.7} colorMode="dark" deleteKeyCode={['Backspace','Delete']} snapToGrid snapGrid={[10,10]} connectionRadius={28}>
    <Background color="#303940" gap={20} size={1} variant={BackgroundVariant.Dots}/><Controls showInteractive={false}/><MiniMap nodeColor={n=>n.data.kind==='model'?'#9b83ca':'#759457'} maskColor="#080d11aa" style={{width:110,height:65}} pannable zoomable/>
  </ReactFlow>;
}
export function WorkflowCanvas(){return <ReactFlowProvider><InteractiveCanvas/></ReactFlowProvider>;}
export function WorkflowPreview({workflow}:{workflow:Workflow}){const nodes=useMemo(()=>workflow.nodes.map(n=>({id:n.id,type:'forge',position:{x:n.x,y:n.y},data:{kind:n.kind,label:n.label,config:n.config}})),[workflow]);return <ReactFlowProvider><ReactFlow nodes={nodes} edges={workflow.edges.map(e=>({...e,type:'smoothstep'}))} nodeTypes={nodeTypes} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} fitView fitViewOptions={{padding:.2,maxZoom:.85}} colorMode="dark"><Background color="#303940" gap={20} size={1}/><Controls showInteractive={false}/></ReactFlow></ReactFlowProvider>;}
