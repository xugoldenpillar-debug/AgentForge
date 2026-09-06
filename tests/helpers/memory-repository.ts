import { randomUUID } from 'node:crypto';
import type { Repository, TableName, Tables } from '../../src/shared/types.ts';
export type DatabaseState={ [K in TableName]: Tables[K][] };
export const TABLE_NAMES:TableName[]=['users','problems','testCases','builds','buildVersions','workflowNodes','workflowEdges','skills','tools','buildSkills','buildTools','runs','runCases','submissions','credentials','failureCases','reputations','badges','userBadges','forkRelations'];
export const emptyState=():DatabaseState=>Object.fromEntries(TABLE_NAMES.map(k=>[k,[]])) as unknown as DatabaseState;
const matches=<T,>(row:T,where:Partial<T>)=>Object.entries(where).every(([k,v])=>(row as Record<string,unknown>)[k]===v);
export class MemoryRepository implements Repository {
  state:DatabaseState; private queue:Promise<unknown>=Promise.resolve();private inside=false;
  private rates=new Map<string,{count:number;expires:number}>();private leases=new Map<string,{token:string;expires:number}>();
  constructor(state:DatabaseState=emptyState()){this.state=state;}
  async read<K extends TableName>(table:K,where:Partial<Tables[K]>={}):Promise<Tables[K][]> {return structuredClone((this.state[table] as Tables[K][]).filter(r=>matches(r,where)));}
  async insert<K extends TableName>(table:K,rows:Tables[K][]):Promise<void>{(this.state[table] as Tables[K][]).push(...structuredClone(rows));}
  async update<K extends TableName>(table:K,where:Partial<Tables[K]>,values:Partial<Tables[K]>):Promise<Tables[K][]> {const updated:Tables[K][]=[];for(const r of this.state[table] as Tables[K][])if(matches(r,where)){Object.assign(r,structuredClone(values));updated.push(structuredClone(r));}return updated;}
  async remove<K extends TableName>(table:K,where:Partial<Tables[K]>):Promise<void>{this.state[table]=(this.state[table] as Tables[K][]).filter(r=>!matches(r,where)) as DatabaseState[K];}
  async transaction<T>(fn:(tx:Repository)=>Promise<T>):Promise<T>{
    if(this.inside)return fn(this);
    const task=this.queue.then(async()=>{const tx=new MemoryRepository(structuredClone(this.state));tx.inside=true;const result=await fn(tx);this.state=tx.state;return result;});
    this.queue=task.catch(()=>undefined);return task;
  }
  async rateLimit(key:string,limit:number,windowMs:number):Promise<boolean>{const now=Date.now();for(const [k,v]of this.rates)if(v.expires<=now)this.rates.delete(k);let r=this.rates.get(key);if(!r||r.expires<=now){r={count:0,expires:now+windowMs};this.rates.set(key,r);}return ++r.count<=limit;}
  async lease(key:string,ttlMs:number):Promise<string|null>{const existing=this.leases.get(key);if(existing&&existing.expires>Date.now())return null;const token=randomUUID();this.leases.set(key,{token,expires:Date.now()+ttlMs});return token;}
  async release(key:string,token:string):Promise<void>{if(this.leases.get(key)?.token===token)this.leases.delete(key);}
}
