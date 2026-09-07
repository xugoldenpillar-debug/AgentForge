import type { CaseResult, Credential, Run, RunCase, User } from '../shared/types.ts';
import { maskKey } from '../lib/crypto/credentials.ts';
export const publicUser=(u:User)=>({id:u.id,name:u.name,image:u.image,elo:u.elo,reputation:u.reputation,isSeed:u.isSeed});
export const publicCredential=(c:Credential)=>({id:c.id,name:c.name,baseUrl:c.baseUrl,modelId:c.modelId,keyMask:maskKey(c.lastFour),inputPrice:c.inputPrice,outputPrice:c.outputPrice,createdAt:c.createdAt});
export function publicCase(c:CaseResult):CaseResult {return {caseId:c.caseId,category:c.category,passed:c.passed,secure:c.secure,failureType:c.failureType,input:c.input,expected:c.expected,actual:c.actual,inputTokens:c.inputTokens,outputTokens:c.outputTokens,reasoningTokens:c.reasoningTokens,latency:c.latency,cost:c.cost,toolCalls:c.toolCalls,estimated:c.estimated,trace:c.trace};}
export function serializeRun(run:Run,cases:RunCase[]=[]){
  const base={id:run.id,buildId:run.buildId,versionId:run.versionId,kind:run.kind,tier:run.tier,status:run.status,createdAt:run.createdAt,summary:run.summary,runtimeKind:run.runtimeKind??null,adapterVersion:run.adapterVersion??null,policyVersion:run.policyVersion??null};
  // Explicit branch is a security boundary. Hidden/failure records never expose case data.
  return run.kind==='public'?{...base,cases:cases.map(publicCase)}:base;
}
