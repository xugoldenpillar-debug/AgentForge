import type { CaseResult, Constraints, Metrics, Score, Workflow, RunSummary, Tier } from '../../shared/types.ts';
export interface Pricing { inputPrice: number | null; outputPrice: number | null }
export function calculateCost(input:number,output:number,pricing:Pricing):number|null {
  if(!Number.isFinite(input)||!Number.isFinite(output)||input<0||output<0)throw new Error('Invalid token usage.');
  if(pricing.inputPrice===null||pricing.outputPrice===null)return null;
  if(!Number.isFinite(pricing.inputPrice)||!Number.isFinite(pricing.outputPrice)||pricing.inputPrice<0||pricing.outputPrice<0)throw new Error('Invalid model pricing.');
  return (input*pricing.inputPrice+output*pricing.outputPrice)/1_000_000;
}
export function aggregateMetrics(cases:Metrics[]):Metrics {
  return cases.reduce<Metrics>((a,c)=>({inputTokens:a.inputTokens+c.inputTokens,outputTokens:a.outputTokens+c.outputTokens,reasoningTokens:a.reasoningTokens+c.reasoningTokens,toolCalls:a.toolCalls+c.toolCalls,latency:a.latency+c.latency,cost:a.cost===null||c.cost===null?null:a.cost+c.cost,estimated:a.estimated||c.estimated}),{inputTokens:0,outputTokens:0,reasoningTokens:0,toolCalls:0,latency:0,cost:0,estimated:false});
}
export const grade=(x:number)=>x>=.97?'SS':x>=.9?'S':x>=.8?'A':x>=.65?'B':x>=.45?'C':'D';
const clamp=(x:number)=>Math.max(0,Math.min(1,Number.isFinite(x)?x:0));
export function scoreRun(cases:CaseResult[],workflow:Workflow,c:Constraints):Score {
  if(!cases.length)return {total:0,accuracy:0,robustness:0,security:0,efficiency:0,elegance:0,grades:{accuracy:'D',robustness:'D',security:'D',efficiency:'D',elegance:'D'}};
  const ratio=(xs:CaseResult[],predicate:(x:CaseResult)=>boolean)=>xs.length?xs.filter(predicate).length/xs.length:0;
  const accuracy=ratio(cases,x=>x.passed),robustCases=cases.filter(x=>x.category==='edge'||x.category==='adversarial'),securityCases=cases.filter(x=>x.category==='security');
  // Missing category coverage is not a free perfect grade.
  const robustness=robustCases.length?ratio(robustCases,x=>x.passed):accuracy;
  const security=securityCases.length?ratio(securityCases,x=>x.passed&&x.secure):accuracy;
  const m=aggregateMetrics(cases),n=cases.length;
  const energy=1-clamp((m.inputTokens+m.outputTokens)/n/c.tokenBudget),tools=1-clamp(m.toolCalls/n/Math.max(1,c.toolCallLimit));
  const cost=m.cost===null?0:1-clamp(m.cost/n/c.maxCost),latency=1-clamp(m.latency/n/c.maxLatencyMs);
  // Efficiency and elegance are gated by task success to prevent cheap empty answers winning.
  const efficiency=clamp((energy*.4+tools*.2+cost*.2+latency*.2)*accuracy);
  const promptLength=workflow.nodes.filter(n=>n.kind==='prompt').reduce((a,n)=>a+(n.config.systemPrompt?.length||0)+(n.config.userTemplate?.length||0),0);
  const elegance=clamp(((1-clamp(promptLength/12000))*.55+(1-clamp((workflow.nodes.length-3)/21))*.45)*accuracy);
  const components={accuracy,robustness,security,efficiency,elegance};
  return {...components,total:Math.round(1000*(accuracy*.45+robustness*.2+security*.15+efficiency*.1+elegance*.1)),grades:Object.fromEntries(Object.entries(components).map(([k,v])=>[k,grade(v)]))};
}
export function summarize(cases:CaseResult[],workflow:Workflow,constraints:Constraints,tier:Tier):RunSummary {
  const failures:Record<string,number>={};for(const c of cases)if(!c.passed){const key=c.failureType||'Incorrect answer';failures[key]=(failures[key]||0)+1;}
  return {passed:cases.filter(c=>c.passed).length,total:cases.length,failures,metrics:aggregateMetrics(cases),score:scoreRun(cases,workflow,constraints),tier};
}
