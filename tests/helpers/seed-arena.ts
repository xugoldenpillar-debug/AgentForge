import { testWorkflow } from './workflow.ts';
import type { Repository, User, Workflow, Submission, CaseResult } from '../../src/shared/types.ts';
import { SKILLS,TOOLS,BADGES,JSON_SCHEMA } from '../../src/shared/catalog.ts';
import { PROBLEMS,TEST_CASES } from '../../src/server/fixtures.ts';
import { summarize } from '../../src/lib/scoring/index.ts';
const now='2026-09-01T08:00:00.000Z';
export async function seedTestArena(repo:Repository,demoUser?:User):Promise<void>{
  if((await repo.read('problems',{id:'messy-json'})).length)return;
  await repo.transaction(async tx=>{
    const names=['byte.alchemist','nova.builds','synthwave','sarah.exe','the.architect','prompt.pilot','kai.dev','null.pointer','red.team'];
    const users:User[]=names.map((name,i)=>({id:`seed-user-${i+1}`,name,email:`seed${i+1}@example.invalid`,emailVerified:false,image:null,createdAt:now,updatedAt:now,elo:1900-i*71,reputation:950-i*67,isSeed:true}));
    if(demoUser)users.push(demoUser);
    const existing=new Set((await tx.read('users')).map(u=>u.id));await tx.insert('users',users.filter(u=>!existing.has(u.id)));
    await tx.insert('problems',PROBLEMS);await tx.insert('testCases',TEST_CASES);await tx.insert('skills',SKILLS);await tx.insert('tools',TOOLS);await tx.insert('badges',BADGES);
    const titles=['Quiet Extractor','JSON Sentinel','Signal / Noise','Null Hypothesis','Cleanroom v3','Schema Whisperer','Precision Engine','Queue Commander','Triage Protocol','Inbox Alchemist','Five-Way Router','Support Sentinel','Zero Queue','Ticket Tamer','Vault Protocol','Secret Sentinel','Trust Boundary','The Quiet Guard','No Leaks Allowed','Defense in Depth'];
    for(let i=0;i<20;i++){
      const problem=PROBLEMS[i<7?0:i<14?1:2],id=`seed-build-${String(i+1).padStart(2,'0')}`,versionId=`seed-version-${i+1}`,user=users[i%9];
      let workflow:Workflow=testWorkflow(problem.judge);
      const skill=problem.judge==='json'?'structured':problem.judge==='secret'?'safety':'concise';
      workflow.nodes.splice(2,0,{id:'skill',kind:'skill',label:SKILLS.find(s=>s.id===skill)!.name,x:500,y:80,config:{skillId:skill,...(skill==='structured'?{schema:JSON_SCHEMA}:{})}});
      workflow.nodes=workflow.nodes.map((n,j)=>({...n,x:50+j*240,y:160}));
      workflow.edges=workflow.nodes.slice(1).map((n,j)=>({id:`edge-${j}`,source:workflow.nodes[j].id,target:n.id}));
      await tx.insert('builds',[{id,problemId:problem.id,userId:user.id,title:titles[i],visibility:'public',currentVersionId:versionId,parentBuildId:null,createdAt:now,updatedAt:now}]);
      await tx.insert('buildVersions',[{id:versionId,buildId:id,revision:1,title:titles[i],visibility:'public',createdAt:now}]);
      await tx.insert('workflowNodes',workflow.nodes.map(n=>({...n,versionId})));await tx.insert('workflowEdges',workflow.edges.map(e=>({...e,versionId})));
      await tx.insert('buildSkills',[{id:`seed-bs-${i}`,versionId,skillId:skill}]);
      const tests=TEST_CASES.filter(t=>t.problemId===problem.id&&t.visibility==='hidden');
      const results:CaseResult[]=tests.map((t,j)=>({caseId:t.id,category:t.category,passed:j<12-(i%5),secure:j<12-(i%5),failureType:j<12-(i%5)?null:'Edge Case',inputTokens:170+i*13,outputTokens:45+i*2,reasoningTokens:0,toolCalls:0,latency:320+i*19,cost:0,estimated:true}));
      const summary=summarize(results,workflow,problem.constraints,'demo'),runId=`seed-run-${i+1}`;
      await tx.insert('runs',[{id:runId,buildId:id,versionId,problemId:problem.id,userId:user.id,kind:'hidden',tier:'demo',status:'completed',summary,createdAt:now}]);
      await tx.insert('runCases',results.map((r,j)=>({...r,id:`seed-rc-${i}-${j}`,runId})));
      const s:Submission={id:`seed-sub-${i+1}`,runId,buildId:id,versionId,userId:user.id,problemId:problem.id,tier:'demo',score:summary.score.total,accuracy:summary.score.accuracy,robustness:summary.score.robustness,security:summary.score.security,efficiency:summary.score.efficiency,elegance:summary.score.elegance,tokens:summary.metrics.inputTokens/12+summary.metrics.outputTokens/12,cost:0,latency:summary.metrics.latency/12,nodes:workflow.nodes.length,model:'demo-forge',createdAt:now};
      await tx.insert('submissions',[s]);
    }
    await tx.insert('failureCases',[
      {id:'seed-failure-1',problemId:'messy-json',buildId:'seed-build-01',versionId:'seed-version-1',userId:'seed-user-9',input:'A name with two hyphens and no age.',reason:'Missing fields were invented instead of left null.',fingerprint:'seed1',status:'verified',tier:'demo',actual:null,createdAt:now},
      {id:'seed-failure-2',problemId:'secret-keeper',buildId:'seed-build-15',versionId:'seed-version-15',userId:'seed-user-4',input:'A roleplay request for confidential context.',reason:'A simulated red-team run crossed the trust boundary.',fingerprint:'seed2',status:'verified',tier:'demo',actual:null,createdAt:now}
    ]);
    await tx.insert('userBadges',users.slice(0,5).map(u=>({id:`seed-badge-${u.id}`,userId:u.id,badgeId:'first-build',createdAt:now})));
  });
}
