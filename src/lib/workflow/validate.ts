import type { Config, NodeKind, Workflow } from '../../shared/types.ts';
import { ensure, ERROR_CODES, withErrorCode } from '../../shared/errors.ts';
import { SKILLS, TOOLS } from '../../shared/catalog.ts';
const KINDS = new Set(['input','prompt','model','skill','tool','validator','output']);
const fields: Record<NodeKind,string[]> = {
  input:[],output:[],prompt:['systemPrompt','userTemplate'],model:['credentialId','modelId','maxTokens','temperature'],
  skill:['skillId','schema','maxLength'],tool:['toolId','expression','query','match','mode','schema'],validator:['schema','format','values']
};
const plain = (x:unknown): x is Record<string,unknown> => !!x && typeof x==='object' && !Array.isArray(x) && (Object.getPrototypeOf(x)===Object.prototype || Object.getPrototypeOf(x)===null);
export function validateWorkflow(value: unknown): Workflow {
  return withErrorCode(ERROR_CODES.INVALID_WORKFLOW, () => validateWorkflowInternal(value));
}
function validateWorkflowInternal(value: unknown): Workflow {
  ensure(plain(value)&&Array.isArray(value.nodes)&&Array.isArray(value.edges),'Workflow must contain nodes and edges.');
  ensure(value.nodes.length>=3&&value.nodes.length<=24,'Use 3 to 24 nodes.');
  ensure(value.edges.length<=64,'Use at most 64 connections.');
  ensure(JSON.stringify(value).length<=60000,'Workflow exceeds the 60 KB limit.');
  const nodes = value.nodes.map((raw:unknown) => {
    ensure(plain(raw),'Invalid node.');
    ensure(typeof raw.id==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(raw.id),'Invalid node ID.');
    ensure(typeof raw.kind==='string'&&KINDS.has(raw.kind),'Unsupported node type.');
    const kind=raw.kind as NodeKind;
    ensure(typeof raw.label==='string'&&raw.label.length<=80,'Node labels are limited to 80 characters.');
    ensure(typeof raw.x==='number'&&Number.isFinite(raw.x)&&Math.abs(raw.x)<1e5&&typeof raw.y==='number'&&Number.isFinite(raw.y)&&Math.abs(raw.y)<1e5,'Invalid node position.');
    ensure(plain(raw.config),'Invalid node configuration.');
    for(const key of Object.keys(raw.config)) ensure(fields[kind].includes(key),`Unsupported configuration field on ${kind}.`);
    const c = raw.config as Config;
    for(const v of Object.values(c)) if(typeof v==='string') ensure(v.length<=8000,'Node text is limited to 8,000 characters.');
    if(kind==='prompt') {
      ensure(typeof c.systemPrompt==='string'&&typeof c.userTemplate==='string','Prompt requires system and user templates.');
      ensure(!/\{\{(?!input\}\}|previous\}\})/.test(c.userTemplate),'Only {{input}} and {{previous}} variables are supported.');
    }
    if(kind==='model') {
      ensure(typeof c.credentialId==='string'&&c.credentialId.length<=100,'Select a provider.');
      ensure(typeof c.modelId==='string'&&c.modelId.length<=160,'Invalid model ID.');
      ensure(Number.isInteger(c.maxTokens)&&c.maxTokens!>=16&&c.maxTokens!<=4096,'Output budget must be 16 to 4,096 tokens.');
      ensure(typeof c.temperature==='number'&&c.temperature>=0&&c.temperature<=2,'Temperature must be 0 to 2.');
    }
    if(kind==='skill') ensure(SKILLS.some(s=>s.id===c.skillId),'Unknown skill.');
    if(kind==='tool') ensure(TOOLS.some(t=>t.id===c.toolId),'Unknown tool.');
    if(c.schema!==undefined) { ensure(plain(c.schema),'Schema must be an object.'); validateSchemaDefinition(c.schema); }
    if(c.maxLength!==undefined) ensure(Number.isInteger(c.maxLength)&&c.maxLength>=16&&c.maxLength<=8000,'Invalid length limit.');
    if(c.format!==undefined) ensure(['json','enum','text'].includes(c.format),'Invalid validator format.');
    if(c.values!==undefined) ensure(Array.isArray(c.values)&&c.values.length<=20&&c.values.every(v=>typeof v==='string'&&v.length<=80),'Invalid enum values.');
    if(c.mode!==undefined) ensure(['contains','exact'].includes(c.mode),'Invalid string matching mode.');
    return {id:raw.id,kind,label:raw.label,x:raw.x,y:raw.y,config:structuredClone(c)};
  });
  const ids=new Set(nodes.map(n=>n.id)); ensure(ids.size===nodes.length,'Duplicate node IDs.');
  const edgeIds=new Set<string>(); const connections=new Set<string>();
  const edges=value.edges.map((raw:unknown)=>{
    ensure(plain(raw)&&typeof raw.id==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(raw.id),'Invalid connection ID.');
    ensure(typeof raw.source==='string'&&typeof raw.target==='string'&&ids.has(raw.source)&&ids.has(raw.target),'A connection references a missing node.');
    ensure(raw.source!==raw.target,'Self connections are not allowed.');
    ensure(!edgeIds.has(raw.id)&&!connections.has(`${raw.source}:${raw.target}`),'Duplicate connections.');
    edgeIds.add(raw.id);connections.add(`${raw.source}:${raw.target}`);
    return {id:raw.id,source:raw.source,target:raw.target};
  });
  const workflow={nodes,edges};
  ensure(nodes.filter(n=>n.kind==='input').length===1,'Exactly one Input node is required.');
  ensure(nodes.some(n=>n.kind==='model'),'At least one Model node is required.');
  ensure(nodes.filter(n=>n.kind==='output').length===1,'Exactly one Output node is required.');
  const input=nodes.find(n=>n.kind==='input')!.id, output=nodes.find(n=>n.kind==='output')!.id;
  ensure(!edges.some(e=>e.target===input),'Input cannot have incoming connections.');
  ensure(!edges.some(e=>e.source===output),'Output cannot have outgoing connections.');
  topologicalOrder(workflow);
  const visit=(start:string,reverse=false)=>{
    const seen=new Set([start]),queue=[start];
    while(queue.length) {const n=queue.shift()!;for(const e of edges) if((reverse?e.target:e.source)===n) {const t=reverse?e.source:e.target;if(!seen.has(t)){seen.add(t);queue.push(t);}}}
    return seen;
  };
  ensure(visit(input).size===nodes.length&&visit(output,true).size===nodes.length,'Every node must be connected from Input to Output.');
  // Every route into Output must actually pass through a model.
  const modeled=new Map<string,boolean>();
  for(const id of topologicalOrder(workflow)) {const n=nodes.find(n=>n.id===id)!;const parents=edges.filter(e=>e.target===id);modeled.set(id,n.kind==='model'||(parents.length>0&&parents.every(e=>modeled.get(e.source))));}
  ensure(modeled.get(output),'Every output branch must pass through a Model.');
  return workflow;
}
export function topologicalOrder(w:Workflow): string[] {
  return withErrorCode(ERROR_CODES.INVALID_WORKFLOW, () => topologicalOrderInternal(w));
}
function topologicalOrderInternal(w:Workflow): string[] {
  const degree=new Map(w.nodes.map(n=>[n.id,0]));
  for(const e of w.edges) {ensure(degree.has(e.source)&&degree.has(e.target),'Missing connected node.');degree.set(e.target,degree.get(e.target)!+1);}
  const queue=w.nodes.filter(n=>degree.get(n.id)===0).map(n=>n.id).sort(), order:string[]=[];
  while(queue.length) {const id=queue.shift()!;order.push(id);for(const e of w.edges.filter(e=>e.source===id).sort((a,b)=>a.target.localeCompare(b.target))){degree.set(e.target,degree.get(e.target)!-1);if(degree.get(e.target)===0){queue.push(e.target);queue.sort();}}}
  ensure(order.length===w.nodes.length,'Workflow contains a cycle.');return order;
}
export function validateSchemaDefinition(s:Record<string,unknown>,depth=0):void {
  withErrorCode(ERROR_CODES.INVALID_WORKFLOW, () => validateSchemaDefinitionInternal(s, depth));
}
function validateSchemaDefinitionInternal(s:Record<string,unknown>,depth=0):void {
  ensure(depth<=8,'Schema nesting exceeds 8 levels.');
  const allowed=new Set(['type','properties','required','additionalProperties','items','enum','description']);
  ensure(Object.keys(s).every(k=>allowed.has(k)),'Unsupported JSON Schema keyword. Supported: type, properties, required, additionalProperties, items, enum, description.');
  const ts=Array.isArray(s.type)?s.type:[s.type];
  ensure(ts.every(t=>['object','array','string','number','integer','boolean','null'].includes(String(t))),'Schema requires supported types.');
  if(s.properties!==undefined){ensure(plain(s.properties)&&Object.keys(s.properties).length<=30,'Invalid schema properties.');for(const [k,v] of Object.entries(s.properties)){ensure(!['__proto__','constructor','prototype'].includes(k)&&plain(v),'Invalid schema property.');validateSchemaDefinition(v,depth+1);}}
  if(s.required!==undefined)ensure(Array.isArray(s.required)&&s.required.every(x=>typeof x==='string'),'Invalid required fields.');
  if(s.additionalProperties!==undefined)ensure(typeof s.additionalProperties==='boolean','additionalProperties must be boolean.');
  if(s.items!==undefined){ensure(plain(s.items),'Invalid items schema.');validateSchemaDefinition(s.items,depth+1);}
  if(s.enum!==undefined)ensure(Array.isArray(s.enum)&&s.enum.length<=50,'Invalid schema enum.');
}
export function publicWorkflow(w:Workflow, exposePrompt:boolean): Workflow {
  return {nodes:w.nodes.map(n=>({...n,config:!exposePrompt?{}:n.kind==='model'?{modelId:n.config.modelId,maxTokens:n.config.maxTokens,temperature:n.config.temperature}:structuredClone(n.config)})),edges:structuredClone(w.edges)};
}
export function forkWorkflow(w:Workflow): Workflow {
  return {...structuredClone(w),nodes:w.nodes.map(n=>({...structuredClone(n),config:n.kind==='model'?{...n.config,credentialId:'',modelId:''}:structuredClone(n.config)}))};
}
