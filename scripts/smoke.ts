/** Run against an isolated Next.js test server. Never calls paid models. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { starterWorkflow } from '../src/shared/catalog.ts';
import type { RunEvent } from '../src/shared/types.ts';
function testWorkflow(judge: Parameters<typeof starterWorkflow>[0]) {
  const workflow = starterWorkflow(judge);
  for (const node of workflow.nodes.filter(node => node.kind === 'model')) {
    node.config.credentialId = 'demo';
    node.config.modelId = 'demo-forge';
  }
  return workflow;
}
const base=(process.env.SMOKE_BASE_URL||'http://localhost:3000').replace(/\/$/,'');
const parsed=new URL(base);
if(!['localhost','127.0.0.1'].includes(parsed.hostname)&&process.env.SMOKE_ALLOW_REMOTE!=='true')throw new Error('Smoke tests create accounts/builds. Use a local server or explicitly set SMOKE_ALLOW_REMOTE=true.');
let cookie='';
async function request(path:string,body?:unknown){const res=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{...(cookie?{Cookie:cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json',Origin:base})},...(body===undefined?{}:{body:JSON.stringify(body)})});assert(res.ok,`${path}: HTTP ${res.status}`);const cookies=res.headers.getSetCookie();if(cookies.length)cookie=cookies.map(x=>x.split(';')[0]).join('; ');return res;}
const boot = await (await request('/api/arena/boot')).json();
const testMode = process.env.SMOKE_EXPECT_TEST_MODE !== 'false';
assert.equal(boot.demoMode, testMode, 'Server model mode does not match explicit smoke expectation.');
assert.equal(boot.runtime, 'next');
const unique=randomUUID().slice(0,8);
const email = `smoke-${unique}@example.invalid`;
const password = `SmokeLocalOnly!${randomUUID()}`;
const signup = await (await request('/api/auth/sign-up/email', {
  name: 'Smoke Builder', email, password,
})).json();
assert.equal(typeof signup?.user?.id, 'string');
assert(cookie,'Authentication did not create a session.');
const signupSession = await (await request('/api/auth/get-session')).json();
assert.equal(signupSession?.user?.id, signup.user.id);
const revokedCookie = cookie;
await request('/api/auth/sign-out', {});
assert.equal(await (await request('/api/auth/get-session')).json(), null);
// Replay the actual old credential, not just the browser's cleared cookie.
cookie = revokedCookie;
assert.equal(await (await request('/api/auth/get-session')).json(), null);
cookie = '';
const denied = await fetch(`${base}/api/auth/sign-in/email`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: base },
  body: JSON.stringify({ email, password: `${password}-wrong` }),
});
assert.equal(denied.status, 401, 'Incorrect password must be rejected.');
await request('/api/auth/sign-in/email', { email, password });
const signinSession = await (await request('/api/auth/get-session')).json();
assert.equal(signinSession?.user?.id, signupSession.user.id);

if (testMode) for(const [problemId,judge]of [['messy-json','json'],['support-router','enum'],['secret-keeper','secret']] as const){
 const build=await (await request('/api/arena/builds',{problemId,title:`Smoke ${problemId}`,visibility:'public',workflow:testWorkflow(judge)})).json();
 for(const kind of ['public','hidden']){
  const response = await request('/api/arena/runs',{buildId:build.id,kind});
  assert(response.headers.get('content-type')?.includes('application/x-ndjson'));
  const lines=(await response.text()).trim().split('\n').map(line=>JSON.parse(line)) as RunEvent[];
  const completed=lines.find((e):e is Extract<RunEvent,{type:'complete'}>=>e.type==='complete');assert(completed,`No completed ${kind} run for ${problemId}`);assert(!lines.some(e=>e.type==='error'));assert.equal(completed.summary.total,kind==='public'?4:48);
  if(kind==='hidden'){assert(lines.every(e=>['start','progress','complete'].includes(e.type)));console.log(`${problemId}: ${completed.summary.passed}/${completed.summary.total}, ${completed.summary.score.total}/1000 (DEMO)`);}
 }
 const board=await (await request(`/api/arena/leaderboard?problemId=${problemId}&tier=demo`)).json();assert(board.some((row:{buildId:string})=>row.buildId===build.id));
 const fork=await (await request(`/api/arena/builds/${build.id}/fork`,{})).json();assert.equal(fork.parentBuildId,build.id);
}
console.log(testMode ? 'Offline Next.js test-mode loop passed for all three challenges.' : 'Normal application mode passed; no model calls made.');

// These guards apply to the real Next.js HTTP/auth boundary in both modes.
const draft = await (await request('/api/arena/builds', {
  problemId: 'messy-json', title: 'Unconfigured private smoke draft', visibility: 'private',
  workflow: starterWorkflow('json'),
})).json();
const rejectedRun = await request('/api/arena/runs', { buildId: draft.id, kind: 'public' });
const rejectedEvents = (await rejectedRun.text()).trim().split('\n').map(line => JSON.parse(line)) as RunEvent[];
assert(rejectedEvents.some(event => event.type === 'error'));
assert(!rejectedEvents.some(event => event.type === 'complete'));

const mutation = { problemId: 'messy-json', title: 'Forbidden draft', workflow: starterWorkflow('json') };
const mutationHeaders: Record<string, string>[] = [
  { 'Content-Type': 'application/json', Origin: base },
  { 'Content-Type': 'application/json', Origin: 'https://attacker.example', Cookie: cookie },
];
for (const headers of mutationHeaders) {
  const response = await fetch(base + '/api/arena/builds', {
    method: 'POST', headers, body: JSON.stringify(mutation),
  });
  assert([401, 403].includes(response.status));
}

const providers = await (await request('/api/arena/providers')).json();
const fakeKey = 'sk-offline-smoke-not-a-real-provider-key';
const credential = await (await request('/api/arena/providers', {
  name: 'Offline smoke credential', baseUrl: `https://${providers.allowedHosts[0]}`,
  apiKey: fakeKey, modelId: 'offline-smoke-model',
})).json();
assert(!JSON.stringify(credential).includes(fakeKey));
assert(!('ciphertext' in credential));
const ownerCookie = cookie;
cookie = '';
await request('/api/auth/sign-up/email', {
  name: 'Other smoke account', email: `other-${unique}@example.invalid`, password,
});
const privateBuild = await (await request(`/api/arena/builds/${draft.id}`)).json();
assert(privateBuild.workflow.nodes.every((node: { config: object }) => Object.keys(node.config).length === 0));
const forbiddenFork = await fetch(`${base}/api/arena/builds/${draft.id}/fork`, {
  method: 'POST', headers: { Cookie: cookie, Origin: base, 'Content-Type': 'application/json' }, body: '{}',
});
assert.equal(forbiddenFork.status, 403);
const otherProviders = await (await request('/api/arena/providers')).json();
assert(!otherProviders.credentials.some((row: { id: string }) => row.id === credential.id));
await fetch(`${base}/api/arena/providers/${credential.id}`, {
  method: 'DELETE', headers: { Cookie: cookie, Origin: base },
});
cookie = ownerCookie;
assert((await (await request('/api/arena/providers')).json()).credentials.some((row: { id: string }) => row.id === credential.id));
const deleted = await fetch(`${base}/api/arena/providers/${credential.id}`, {
  method: 'DELETE', headers: { Cookie: cookie, Origin: base },
});
assert(deleted.ok);
assert(!(await (await request('/api/arena/providers')).json()).credentials.some((row: { id: string }) => row.id === credential.id));
for (const path of ['/portable/server.ts', '/.env', '/.data/portable/state.json']) {
  const response = await fetch(base + path);
  const body = await response.text();
  assert(!body.includes('DATABASE_URL=') && !body.includes(fakeKey));
}
console.log('Next.js boundary guards passed: draft rejection, cross-origin/auth, private prompts, credential ownership and deletion.');

// Agent B2 is persistence-only. The legacy client must not receive an empty DAG.
const agentPayload = {
  mode: 'agent', problemId: 'messy-json', title: 'Private Agent smoke draft', visibility: 'private',
  agentDefinition: {mode: 'agent', definitionSchemaVersion: 1, instructions: 'Original private Agent smoke instructions'},
};
const agent = await (await request('/api/arena/builds', agentPayload)).json();
assert.equal(agent.mode, 'agent');
assert.equal(Object.hasOwn(agent, 'workflow'), false);
assert.match(agent.version.definitionDigest, /^sha256:[a-f0-9]{64}$/);
const agentV2 = await (await request('/api/arena/builds', {
  ...agentPayload, buildId: agent.id, currentVersionId: agent.version.id,
  agentDefinition: {...agentPayload.agentDefinition, instructions: 'Revised private Agent smoke instructions'},
})).json();
assert.equal(agentV2.version.revision, 2);
assert(!JSON.stringify(agentV2.history).includes('instructions'));
const selectedAgent = await (await request(`/api/arena/builds/${agent.id}?mode=agent&version=${agent.version.id}`)).json();
assert.equal(selectedAgent.version.agentDefinition.instructions, agentPayload.agentDefinition.instructions);
const agentFork = await (await request(`/api/arena/builds/${agent.id}/fork`, {mode: 'agent', versionId: agent.version.id})).json();
assert.equal(agentFork.visibility, 'private');
assert.equal(agentFork.version.revision, 1);
assert.equal(agentFork.version.agentDefinition.instructions, agentPayload.agentDefinition.instructions);
const unaware = await fetch(`${base}/api/arena/builds/${agent.id}`, {headers: {Cookie: cookie}});
assert.equal(unaware.status, 409);
for (const kind of ['public', 'hidden']) {
  const response = await request('/api/arena/runs', {buildId: agent.id, kind});
  const events = (await response.text()).trim().split('\n').map(line => JSON.parse(line)) as RunEvent[];
  assert(events.some(event => event.type === 'error' && event.code === 'RUNTIME_POLICY_DENIED'));
  assert(!events.some(event => event.type === 'complete' || event.type === 'start'));
}
for (const { payload, status } of [
  { payload: {...agentPayload, visibility: 'public'}, status: 400 },
  { payload: {...agentPayload, workflow: starterWorkflow('json')}, status: 400 },
  { payload: {...agentPayload, credentialId: 'forbidden-binding'}, status: 400 },
  { payload: {...agentPayload, agentDefinition: {...agentPayload.agentDefinition, modelSelection: {
    id: 'model', versionId: 'v1', contentDigest: `sha256:${'a'.repeat(64)}`,
  }}}, status: 409 },
]) {
  const rejected = await fetch(`${base}/api/arena/builds`, {
    method: 'POST', headers: {'Content-Type': 'application/json', Origin: base, Cookie: cookie}, body: JSON.stringify(payload),
  });
  assert.equal(rejected.status, status, `unexpected rejection for fields: ${Object.keys(payload).join(',')}`);
}
const stale = await fetch(`${base}/api/arena/builds`, {
  method: 'POST', headers: {'Content-Type': 'application/json', Origin: base, Cookie: cookie},
  body: JSON.stringify({...agentPayload, buildId: agent.id, currentVersionId: agent.version.id}),
});
assert.equal(stale.status, 409);
const agentOwnerCookie = cookie;
cookie = '';
await request('/api/auth/sign-up/email', {name: 'Other Agent Reader', email: `b2-other-${unique}@example.invalid`, password});
const privateRead = await fetch(`${base}/api/arena/builds/${agent.id}?mode=agent&version=${agent.version.id}`, {headers: {Cookie: cookie}});
assert.equal(privateRead.status, 403);
const otherFork = await fetch(`${base}/api/arena/builds/${agent.id}/fork`, {
  method: 'POST', headers: {'Content-Type': 'application/json', Origin: base, Cookie: cookie},
  body: JSON.stringify({mode: 'agent', versionId: agent.version.id}),
});
assert.equal(otherFork.status, 403);
cookie = agentOwnerCookie;
assert.equal((await (await request(`/api/arena/builds/${agent.id}?mode=agent`)).json()).history.length, 2);
console.log('Agent private draft save/history/CAS/Fork, legacy-client refusal and execution/auth denial passed; no Agent model calls.');
