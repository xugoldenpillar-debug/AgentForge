/** Native HTTP checks. No browser bridge and no external dependencies. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { request as rawRequest } from 'node:http';
import { once } from 'node:events';
import { starterWorkflow } from '../src/shared/catalog.ts';
import type { RunEvent } from '../src/shared/types.ts';

let child:ChildProcess, dir:string, base:string, port:number, cookie='', buildId='', runId='', credentialId='';
const email='http-test@example.invalid',password='NativeHttp!2026',fakeKey='sk-local-test-not-a-real-key-8251';
async function start(){
  child=spawn(process.execPath,['--experimental-strip-types','portable/server.ts'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),AGENTFORGE_DATA_DIR:dir},stdio:['ignore','ignore','pipe']});
  let diagnostic='';child.stderr?.on('data',chunk=>{diagnostic+=String(chunk);});
  for(let i=0;i<150;i++){try{if((await fetch(base+'/api/arena/boot')).ok)return;}catch{}if(child.exitCode!==null)throw new Error('Portable runtime exited: '+diagnostic.slice(-2000));await new Promise(r=>setTimeout(r,50));}
  throw new Error('Portable runtime failed to become ready.');
}
async function stop(){if(child?.exitCode===null){const exited=once(child,'exit');child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),3000);await exited;clearTimeout(timer);}}
async function request(path:string,body?:unknown,options:{method?:string;headers?:Record<string,string>;anonymous?:boolean}={}){
 return fetch(base+path,{method:options.method||(body===undefined?'GET':'POST'),headers:{...(cookie&&!options.anonymous?{Cookie:cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json',Origin:base}),...options.headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
}
async function json(path:string,body?:unknown){const response=await request(path,body);assert(response.ok,`${path}: HTTP ${response.status}`);return response.json();}
async function run(kind:'public'|'hidden'){
 const response=await request('/api/arena/runs',{buildId,kind});assert.equal(response.headers.get('content-type'),'application/x-ndjson');const reader=response.body!.getReader(),decoder=new TextDecoder();let buffer='',firstChunk='',count=0;const events:RunEvent[]=[];
 for(;;){const {done,value}=await reader.read();if(done)break;count++;const text=decoder.decode(value,{stream:true});if(count===1)firstChunk=text;buffer+=text;let nl:number;while((nl=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,nl);buffer=buffer.slice(nl+1);if(line)events.push(JSON.parse(line));}}
 assert(events.some(e=>e.type==='start'));assert(events.some(e=>e.type==='complete'));assert(!events.some(e=>e.type==='error'));
 return {events,firstChunk,count};
}
before(async()=>{dir=await mkdtemp(join(tmpdir(),'agentforge-http-'));const listener=createServer();listener.listen(0,'127.0.0.1');await once(listener,'listening');port=(listener.address() as {port:number}).port;await new Promise<void>(r=>listener.close(()=>r()));base=`http://127.0.0.1:${port}`;await start();});
after(async()=>{await stop();await rm(dir,{recursive:true,force:true});});

test('Native HTTP: signup issues an opaque HttpOnly SameSite session, passwords are hashed',async()=>{
 const response=await request('/api/auth/sign-up/email',{name:'HTTP Tester',email,password});assert.equal(response.status,200);const setCookie=response.headers.get('set-cookie')!;assert.match(setCookie,/HttpOnly/);assert.match(setCookie,/SameSite=Lax/);cookie=setCookie.split(';')[0];assert.match(cookie,/^af\.session=[A-Za-z0-9_-]+$/);const session=await json('/api/auth/get-session');assert.equal(session.user.name,'HTTP Tester');const auth=await readFile(join(dir,'auth.json'),'utf8');assert(!auth.includes(password));assert(!auth.includes(cookie.slice(cookie.indexOf('=')+1)));assert(JSON.parse(auth).accounts.some((a:{email:string;salt:string;hash:string})=>a.email===email&&a.salt.length===32&&a.hash.length===128));
});
test('Native HTTP: anonymous writes, cross-site auth and bad passwords are rejected',async()=>{
 assert.equal((await request('/api/arena/builds',{}, {anonymous:true})).status,401);
 assert.equal((await request('/api/auth/sign-in/email',{email,password},{headers:{Origin:'https://untrusted.invalid'}})).status,403);
 assert.equal((await request('/api/auth/sign-in/email',{email,password:'WrongPassword!123'})).status,401);
 assert.equal((await request('/api/arena/builds',{}, {headers:{'Sec-Fetch-Site':'cross-site'}})).status,403);
});
test('Native HTTP: actual response streaming delivers public traces and hidden aggregates',async()=>{
 const build=await json('/api/arena/builds',{problemId:'messy-json',title:'Native HTTP agent',visibility:'public',workflow:starterWorkflow('json')});buildId=build.id;
 const publicRun=await run('public');assert(publicRun.events.some(e=>e.type==='case'));assert(publicRun.events.some(e=>e.type==='trace'));assert.match(publicRun.firstChunk,/"type":"start"/);assert(!publicRun.firstChunk.includes('"type":"complete"'));assert(publicRun.count>1);
 const hidden=await run('hidden');const complete=hidden.events.find(e=>e.type==='complete')!;runId=(complete as Extract<RunEvent,{type:'complete'}>).runId;
 assert(hidden.events.every(e=>['start','progress','complete'].includes(e.type)));const body=JSON.stringify(hidden.events);for(const field of ['"input":','"expected":','"actual":','"trace":'])assert(!body.includes(field));assert(!body.includes('FLAG{'));
 const rows=await json('/api/arena/leaderboard?problemId=messy-json&tier=demo');assert(rows.some((r:{buildId:string})=>r.buildId===buildId));
 const fork=await json(`/api/arena/builds/${buildId}/fork`,{});assert.equal(fork.parentBuildId,buildId);assert(fork.workflow.nodes.filter((n:{kind:string})=>n.kind==='model').every((n:{config:{credentialId:string}})=>n.config.credentialId==='demo'));
});
test('Native HTTP: credentials are encrypted at rest and only masks leave the API',async()=>{
 const provider=await json('/api/arena/providers',{name:'HTTP test gateway',baseUrl:'https://api.openai.com/v1',apiKey:fakeKey,modelId:'unpriced-test-model'});credentialId=provider.id;assert.equal(provider.keyMask,'sk-****8251');assert(!JSON.stringify(provider).includes(fakeKey));
 const disk=await readFile(join(dir,'database.json'),'utf8');assert(!disk.includes(fakeKey));assert(disk.includes('ciphertext'));const all=await json('/api/arena/providers');assert(!JSON.stringify(all).includes('ciphertext'));
});
test('Native HTTP: the portable runtime never silently substitutes demo for a real model',async()=>{
 const workflow=starterWorkflow('json');workflow.nodes.find(n=>n.kind==='model')!.config={credentialId,modelId:'unpriced-test-model',maxTokens:512,temperature:0};const build=await json('/api/arena/builds',{problemId:'messy-json',title:'Real provider must fail closed',visibility:'private',workflow});
 const response=await request('/api/arena/runs',{buildId:build.id,kind:'public',consent:true});const body=await response.text();assert(body.includes('"type":"error"'));assert(!body.includes('"type":"complete"'));assert(!body.includes(fakeKey));
});
test('Native HTTP: source files, hidden fixtures and data files are not static assets',async()=>{
 for(const path of ['/.env','/src/server/fixtures.ts','/.data/portable/database.json','/portable/server.ts','/package.json'])assert.equal((await request(path)).status,404,path);
 const asset=await request('/portable-app.js');assert.equal(asset.status,200);assert.match(asset.headers.get('content-security-policy')||'',/default-src 'self'/);assert(!((await asset.text()).includes('FLAG{AGENT_FORGE}')));
 const rejected=await new Promise<number>((resolve,reject)=>{const req=rawRequest(base+'/api/arena/boot',{headers:{Host:'attacker.invalid'}},res=>{res.resume();resolve(res.statusCode!);});req.on('error',reject);req.end();});assert.equal(rejected,403);
});
test('Native HTTP: restart preserves accounts, sessions, builds, results and encrypted providers',async()=>{
 await stop();await start();assert.equal((await json('/api/auth/get-session')).user.name,'HTTP Tester');assert.equal((await json('/api/arena/builds/'+buildId)).id,buildId);assert.equal((await json('/api/arena/runs/'+runId)).id,runId);assert((await json('/api/arena/providers')).credentials.some((p:{id:string})=>p.id===credentialId));
});
test('Native HTTP: deleting credentials and signing out really revoke access',async()=>{
 assert.equal((await request('/api/arena/providers/'+credentialId,undefined,{method:'DELETE',headers:{Origin:base}})).status,200);assert(!(await json('/api/arena/providers')).credentials.some((p:{id:string})=>p.id===credentialId));const oldCookie=cookie;
 const out=await request('/api/auth/sign-out',{});assert.equal(out.status,200);assert.match(out.headers.get('set-cookie')||'',/Max-Age=0/);assert.equal(await (await request('/api/auth/get-session',undefined,{headers:{Cookie:oldCookie}})).json(),null);assert.equal((await request('/api/arena/providers')).status,401);
});
