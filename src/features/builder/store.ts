'use client';
import { create } from 'zustand';
import { applyNodeChanges, applyEdgeChanges, addEdge, type Node, type Edge, type NodeChange, type EdgeChange, type Connection } from '@xyflow/react';
import type { Config, NodeKind, Workflow } from '@/shared/types';
import { JSON_SCHEMA, NODE_LABELS } from '@/shared/catalog';
export type ForgeData={kind:NodeKind;label:string;config:Config;state?:string;tokens?:number;[key:string]:unknown};
export type ForgeNode=Node<ForgeData,'forge'>;
interface Store {
  nodes:ForgeNode[];edges:Edge[];selectedId:string|null;dirty:boolean;
  load:(w:Workflow)=>void;exportWorkflow:()=>Workflow;
  onNodesChange:(c:NodeChange<ForgeNode>[])=>void;onEdgesChange:(c:EdgeChange[])=>void;connect:(c:Connection)=>void;
  select:(id:string|null)=>void;update:(id:string,config:Partial<Config>,label?:string)=>void;
  add:(kind:NodeKind,position?:{x:number;y:number},skillId?:Config['skillId'],autoConnect?:boolean)=>void;
  remove:(id:string)=>void;duplicate:(id:string)=>void;trace:(id:string,state:string,tokens?:number)=>void;clearTrace:()=>void;
}
export const useBuilderStore=create<Store>((set,get)=>({
  nodes:[],edges:[],selectedId:null,dirty:false,
  load:w=>set({nodes:w.nodes.map(n=>({id:n.id,type:'forge',position:{x:n.x,y:n.y},data:{kind:n.kind,label:n.label,config:n.config}})),edges:w.edges.map(e=>({...e,type:'smoothstep'})),selectedId:w.nodes.find(n=>n.kind==='prompt')?.id||null,dirty:false}),
  exportWorkflow:()=>({nodes:get().nodes.map(n=>({id:n.id,kind:n.data.kind,label:n.data.label,x:n.position.x,y:n.position.y,config:n.data.config})),edges:get().edges.map(e=>({id:e.id,source:e.source,target:e.target}))}),
  onNodesChange:c=>set(s=>({nodes:applyNodeChanges(c,s.nodes),dirty:s.dirty||c.some(x=>x.type!=='select'&&x.type!=='dimensions')})),
  onEdgesChange:c=>set(s=>({edges:applyEdgeChanges(c,s.edges),dirty:s.dirty||c.some(x=>x.type!=='select')})),
  connect:c=>set(s=>({edges:addEdge({...c,id:crypto.randomUUID(),type:'smoothstep'},s.edges),dirty:true})),
  select:id=>set({selectedId:id}),
  update:(id,config,label)=>set(s=>({nodes:s.nodes.map(n=>n.id===id?{...n,data:{...n.data,config:{...n.data.config,...config},...(label!==undefined?{label}:{})}}:n),dirty:true})),
  add:(kind,position,skillId,autoConnect=false)=>set(s=>{
    const id=crypto.randomUUID(),config:Config=kind==='prompt'?{systemPrompt:'Transform the provided input. Return only the final answer.',userTemplate:'{{previous}}'}:kind==='model'?{modelId:'demo-forge',credentialId:'demo',maxTokens:512,temperature:0}:kind==='skill'?{skillId:skillId||'structured',...(skillId==='structured'||!skillId?{schema:JSON_SCHEMA}:{})}:kind==='tool'?{toolId:'json-validator'}:kind==='validator'?{format:'json',schema:JSON_SCHEMA}:{};
    const target=s.nodes.find(n=>n.data.kind==='model'),incoming=target?s.edges.find(e=>e.target===target.id):undefined;
    let nodes=[...s.nodes,{id,type:'forge' as const,position:position||{x:350,y:340},data:{kind,label:kind==='skill'?(skillId||'Structured Output'):NODE_LABELS[kind],config}}],edges=s.edges;
    if(autoConnect&&target&&incoming){nodes=nodes.map(n=>n.id===id?{...n,position:{x:target.position.x,y:target.position.y}}:n.position.x>=target.position.x?{...n,position:{...n.position,x:n.position.x+235}}:n);edges=[...s.edges.filter(e=>e.id!==incoming.id),{id:crypto.randomUUID(),source:incoming.source,target:id,type:'smoothstep'},{id:crypto.randomUUID(),source:id,target:target.id,type:'smoothstep'}];}
    return {nodes,edges,selectedId:id,dirty:true};
  }),
  remove:id=>set(s=>({nodes:s.nodes.filter(n=>n.id!==id),edges:s.edges.filter(e=>e.source!==id&&e.target!==id),selectedId:null,dirty:true})),
  duplicate:id=>set(s=>{const node=s.nodes.find(n=>n.id===id);if(!node)return {};const copy={...structuredClone(node),id:crypto.randomUUID(),position:{x:node.position.x+35,y:node.position.y+140}};return {nodes:[...s.nodes,copy],selectedId:copy.id,dirty:true};}),
  trace:(id,state,tokens)=>set(s=>({nodes:s.nodes.map(n=>n.id===id?{...n,data:{...n.data,state,tokens}}:n)})),
  clearTrace:()=>set(s=>({nodes:s.nodes.map(n=>({...n,data:{...n.data,state:undefined,tokens:undefined}}))}))
}));
