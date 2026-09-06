/** Run against either a local Next server or the portable server. Uses Node only. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { starterWorkflow } from '../src/shared/catalog.ts';
import type { RunEvent } from '../src/shared/types.ts';
const base=(process.env.SMOKE_BASE_URL||'http://localhost:3000').replace(/\/$/,'');
const parsed=new URL(base);
if(!['localhost','127.0.0.1'].includes(parsed.hostname)&&process.env.SMOKE_ALLOW_REMOTE!=='true')throw new Error('Smoke tests create accounts/builds. Use a local server or explicitly set SMOKE_ALLOW_REMOTE=true.');
let cookie='';
async function request(path:string,body?:unknown){const res=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{...(cookie?{Cookie:cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json',Origin:base})},...(body===undefined?{}:{body:JSON.stringify(body)})});assert(res.ok,`${path}: HTTP ${res.status}`);const cookies=res.headers.getSetCookie();if(cookies.length)cookie=cookies.map(x=>x.split(';')[0]).join('; ');return res;}
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

for(const [problemId,judge]of [['messy-json','json'],['support-router','enum'],['secret-keeper','secret']] as const){
 const build=await (await request('/api/arena/builds',{problemId,title:`Smoke ${problemId}`,visibility:'public',workflow:starterWorkflow(judge)})).json();
 for(const kind of ['public','hidden']){
  const lines=(await (await request('/api/arena/runs',{buildId:build.id,kind})).text()).trim().split('\n').map(line=>JSON.parse(line)) as RunEvent[];
  const completed=lines.find((e):e is Extract<RunEvent,{type:'complete'}>=>e.type==='complete');assert(completed,`No completed ${kind} run for ${problemId}`);assert(!lines.some(e=>e.type==='error'));assert.equal(completed.summary.total,kind==='public'?4:12);
  if(kind==='hidden'){assert(lines.every(e=>['start','progress','complete'].includes(e.type)));console.log(`${problemId}: ${completed.summary.passed}/${completed.summary.total}, ${completed.summary.score.total}/1000 (DEMO)`);}
 }
 const board=await (await request(`/api/arena/leaderboard?problemId=${problemId}&tier=demo`)).json();assert(board.some((row:{buildId:string})=>row.buildId===build.id));
 const fork=await (await request(`/api/arena/builds/${build.id}/fork`,{})).json();assert.equal(fork.parentBuildId,build.id);
}
console.log('Smoke passed: signup, session revocation, password rejection, sign-in, all 3 challenges, public runs, hidden submissions, leaderboards and forks.');
