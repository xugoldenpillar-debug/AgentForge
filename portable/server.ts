/**
 * Offline, localhost-only demo runtime. Uses the SAME workflow engine, judge,
 * scoring, serializers and ArenaService as Next.js. Persistence/auth/UI here
 * are intentionally lightweight substitutes, not a production deployment.
 */
import { createServer } from 'node:http';
import { readFileSync,writeFileSync,existsSync,mkdirSync,renameSync } from 'node:fs';
import { resolve,join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes,randomUUID,scrypt as scryptCallback,timingSafeEqual,createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { MemoryRepository } from '../src/server/memory-repository.ts';
import { ArenaService } from '../src/server/service.ts';
import { seedCore } from '../src/server/seed-core.ts';
import { handleArena,readJson } from '../src/server/http.ts';
import { publicUser } from '../src/server/serializers.ts';
import { messages, literalMap } from '../src/shared/i18n/messages.ts';
import { ERROR_MESSAGE_KEYS } from '../src/shared/i18n/error-messages.ts';
import { localizeSystemContent } from '../src/shared/i18n/system-content.ts';
import { SKILLS, TOOLS, BADGES } from '../src/shared/catalog.ts';
import { PROBLEMS } from '../src/server/fixtures.ts';
import { AppError,ensure,safeError,ERROR_CODES } from '../src/shared/errors.ts';
import type { User } from '../src/shared/types.ts';
const scrypt=promisify(scryptCallback),root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const dataDir=resolve(process.env.AGENTFORGE_DATA_DIR||join(root,'.data','portable'));mkdirSync(dataDir,{recursive:true,mode:0o700});
const port=Number(process.env.PORT||3000);if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('PORT must be between 1024 and 65535.');
const dataPath=join(dataDir,'database.json'),authPath=join(dataDir,'auth.json'),keyPath=join(dataDir,'credential.key');
function atomicWrite(path:string,data:string){const temporary=`${path}.${randomUUID()}.tmp`;writeFileSync(temporary,data,{mode:0o600});renameSync(temporary,path);}
if(!existsSync(keyPath))atomicWrite(keyPath,randomBytes(32).toString('base64'));
const encryptionKey=readFileSync(keyPath,'utf8').trim();
const repo=new MemoryRepository(existsSync(dataPath)?JSON.parse(readFileSync(dataPath,'utf8')):undefined);
repo.onCommit=state=>atomicWrite(dataPath,JSON.stringify(state));
const createdAt=new Date().toISOString();
const demo:User={id:'demo-user',name:'you.forge',email:'demo@agentforge.local',emailVerified:false,image:null,createdAt,updatedAt:createdAt,elo:1000,reputation:0,isSeed:false};
await seedCore(repo,demo);
interface Account {userId:string;email:string;salt:string;hash:string}
interface LocalSession {userId:string;digest:string;expires:number}
const auth:{accounts:Account[];sessions:LocalSession[]}=existsSync(authPath)?JSON.parse(readFileSync(authPath,'utf8')):{accounts:[],sessions:[]};
function saveAuth(){auth.sessions=auth.sessions.filter(s=>s.expires>Date.now());atomicWrite(authPath,JSON.stringify(auth));}
async function passwordHash(password:string,salt:string){return (await scrypt(password,salt,64)) as Buffer;}
if(!auth.accounts.some(a=>a.userId===demo.id)){const salt=randomBytes(16).toString('hex');auth.accounts.push({userId:demo.id,email:demo.email,salt,hash:(await passwordHash('ForgeDemo!2026',salt)).toString('hex')});saveAuth();}
const dummySalt=randomBytes(16).toString('hex'),dummyHash=await passwordHash('invalid-password-never-authenticates',dummySalt);
const digest=(token:string)=>createHash('sha256').update(token).digest('hex');
async function sessionUser(request:Request){const cookie=request.headers.get('cookie')||'';const token=cookie.match(/(?:^|;\s*)af\.session=([A-Za-z0-9_-]{32,100})(?:;|$)/)?.[1];if(!token)return undefined;const session=auth.sessions.find(s=>s.digest===digest(token)&&s.expires>Date.now());return session?(await repo.read('users',{id:session.userId}))[0]:undefined;}
const json=(body:unknown,status=200,headers:Record<string,string>={})=>Response.json(body,{status,headers:{'Cache-Control':'no-store',...headers}});
async function newSession(user:User){const token=randomBytes(32).toString('base64url');auth.sessions.push({userId:user.id,digest:digest(token),expires:Date.now()+86400000});saveAuth();return json({user:publicUser(user)},200,{'Set-Cookie':`af.session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400`});}
async function handleAuth(request:Request,origin:string,clientIp:string){
 const path=new URL(request.url).pathname;
 if(request.method==='GET'&&path==='/api/auth/get-session'){const u=await sessionUser(request);return json(u?{user:publicUser(u),session:{expiresAt:new Date(Date.now()+86400000).toISOString()}}:null);}
 ensure(request.method==='POST','Method not allowed.',405,ERROR_CODES.REQUEST_VALIDATION_FAILED);
 ensure(!request.headers.get('origin')||request.headers.get('origin')===origin,'Cross-origin authentication is not allowed.',403,ERROR_CODES.ACCESS_FORBIDDEN);
 ensure(request.headers.get('sec-fetch-site')!=='cross-site','Cross-site authentication is not allowed.',403,ERROR_CODES.ACCESS_FORBIDDEN);
 ensure(await repo.rateLimit(`auth:${clientIp}`,30,60000),'Too many authentication attempts. Try again later.',429,ERROR_CODES.RATE_LIMITED);
 const body=await readJson(request);
 if(path==='/api/auth/sign-out'){
   const token=(request.headers.get('cookie')||'').match(/(?:^|;\s*)af\.session=([A-Za-z0-9_-]+)(?:;|$)/)?.[1];if(token)auth.sessions=auth.sessions.filter(s=>s.digest!==digest(token));saveAuth();return json({success:true},200,{'Set-Cookie':'af.session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'});
 }
 ensure(path==='/api/auth/sign-up/email'||path==='/api/auth/sign-in/email','Authentication endpoint not available in the offline runtime.',404,ERROR_CODES.ENDPOINT_NOT_FOUND);
 ensure(typeof body.email==='string'&&body.email.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email),'Enter a valid email address.',400,ERROR_CODES.REQUEST_VALIDATION_FAILED);
 ensure(typeof body.password==='string'&&body.password.length>=10&&body.password.length<=128,'Password must contain 10 to 128 characters.',400,ERROR_CODES.REQUEST_VALIDATION_FAILED);
 const email=body.email.trim().toLowerCase(),password=body.password;
 if(path==='/api/auth/sign-up/email'){
   ensure(typeof body.name==='string'&&body.name.trim().length>=2&&body.name.length<=60,'Name must contain 2 to 60 characters.',400,ERROR_CODES.REQUEST_VALIDATION_FAILED);
   const salt=randomBytes(16).toString('hex'),hash=(await passwordHash(password,salt)).toString('hex');
   const now=new Date().toISOString(),user:User={...demo,id:randomUUID(),name:body.name.trim(),email,createdAt:now,updatedAt:now};
   await repo.transaction(async tx=>{ensure(!(await tx.read('users',{email})).length,'An account with this email already exists.',409,ERROR_CODES.REQUEST_VALIDATION_FAILED);await tx.insert('users',[user]);});
   auth.accounts.push({userId:user.id,email,salt,hash});saveAuth();return newSession(user);
 }
 const account=auth.accounts.find(a=>a.email===email),candidate=await passwordHash(password,account?.salt||dummySalt),stored=account?Buffer.from(account.hash,'hex'):dummyHash;
 ensure(timingSafeEqual(candidate,stored)&&account,'Invalid email or password.',401,ERROR_CODES.AUTH_REQUIRED);
 const user=(await repo.read('users',{id:account.userId}))[0];ensure(user,'Invalid email or password.',401,ERROR_CODES.AUTH_REQUIRED);return newSession(user);
}
const service=new ArenaService(repo,{runtime:'portable',demoMode:true,encryptionKey,allowedHosts:['api.openai.com','openrouter.ai'],maxCases:50,maxRunCost:2.5});
const localizedFields=['name','title','description','effect','mission','goal','why','category','difficulty'] as const;
function publicSystemContent(){
 const result:Record<string,Record<string,{en:string;'zh-CN':string}>>={};
 const add=(kind:string,id:string,value:Record<string,unknown>,localized:Record<string,unknown>)=>{
  const fields:Record<string,{en:string;'zh-CN':string}>={};
  for(const field of localizedFields){if(typeof value[field]==='string'&&typeof localized[field]==='string')fields[field]={en:value[field] as string,'zh-CN':localized[field] as string};}
  if(Object.keys(fields).length)result[`${kind}:${id}`]=fields;
 };
 for(const item of SKILLS)add('skill',item.id,item as unknown as Record<string,unknown>,localizeSystemContent('skill',item,'zh-CN') as unknown as Record<string,unknown>);
 for(const item of TOOLS)add('tool',item.id,item as unknown as Record<string,unknown>,localizeSystemContent('tool',item,'zh-CN') as unknown as Record<string,unknown>);
 for(const item of BADGES)add('badge',item.id,item as unknown as Record<string,unknown>,localizeSystemContent('badge',item,'zh-CN') as unknown as Record<string,unknown>);
 for(const item of PROBLEMS)add('problem',item.id,item as unknown as Record<string,unknown>,localizeSystemContent('problem',item,'zh-CN') as unknown as Record<string,unknown>);
 return result;
}
const localeMessagesPayload=JSON.stringify({messages, literalMap, systemContent:publicSystemContent(), errorMessageKeys:ERROR_MESSAGE_KEYS}).replace(/</g,'\\u003c').replace(/>/g,'\\u003e').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
const localeMessagesScript=`window.AgentForgeSharedMessages=${localeMessagesPayload};`;
const assets:Record<string,{file:string;type:string}>={'/arena.css':{file:'arena.css',type:'text/css; charset=utf-8'},'/portable-app.js':{file:'portable-app.js',type:'text/javascript; charset=utf-8'},'/favicon.svg':{file:'favicon.svg',type:'image/svg+xml'},'/locale-bootstrap.js':{file:'locale-bootstrap.js',type:'text/javascript; charset=utf-8'}};
const html='<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#0b0f13"><title>AgentForge</title><meta name="description" content="Build agents. Challenge real problems. An offline-playable AI arena."><link rel="icon" href="/favicon.svg"><link rel="stylesheet" href="/arena.css"><script src="/locale-messages.js"></script><script src="/locale-bootstrap.js"></script></head><body><div id="app"><main class="container page"><div class="loading-state" aria-label="AgentForge loading"><span class="spinner"></span><span class="sr-only">Loading</span></div></main></div><div class="toast-container" id="toasts" aria-live="polite"></div><script src="/portable-app.js" defer></script></body></html>';
const securityHeaders={'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'same-origin','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",'Permissions-Policy':'camera=(), microphone=(), geolocation=()'};
const server=createServer(async(req,res)=>{
 const abort=new AbortController();res.on('close',()=>{if(!res.writableEnded)abort.abort();});
 try{
   const host=req.headers.host||'';ensure(host===`localhost:${port}`||host===`127.0.0.1:${port}`,'Invalid Host. This demo accepts localhost only.',403,ERROR_CODES.ACCESS_FORBIDDEN);
   const origin=`http://${host}`,url=new URL(req.url||'/',origin);let body:Buffer|undefined;
   if(!['GET','HEAD'].includes(req.method||'GET')){let size=0;const chunks:Buffer[]=[];for await(const chunk of req){size+=chunk.length;ensure(size<=128*1024,'Request body exceeds 128 KB.',413,ERROR_CODES.REQUEST_BODY_TOO_LARGE);chunks.push(chunk);}body=Buffer.concat(chunks);}
   const headers=new Headers();for(const [key,value]of Object.entries(req.headers))if(value)headers.set(key,Array.isArray(value)?value.join(', '):value);
   const request=new Request(url,{method:req.method,headers,...(body?{body}:{}),signal:abort.signal});
   let response:Response;
   if(url.pathname.startsWith('/api/auth/'))response=await handleAuth(request,origin,req.socket.remoteAddress||'local');
   else if(url.pathname.startsWith('/api/arena/'))response=await handleArena(request,{service,userId:(await sessionUser(request))?.id,origin});
   else if(url.pathname==='/locale-messages.js')response=new Response(localeMessagesScript,{headers:{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-cache'}});
   else if(assets[url.pathname]){const asset=assets[url.pathname];response=new Response(readFileSync(join(root,'public',asset.file)),{headers:{'Content-Type':asset.type,'Cache-Control':'no-cache'}});}
   else if((req.method==='GET'||req.method==='HEAD')&&/^\/(?:|challenges(?:\/[A-Za-z0-9_-]+)?|builder|builds\/[A-Za-z0-9_-]+|leaderboard|workshop|providers|profile(?:\/[A-Za-z0-9_-]+)?|problems\/new|login)$/.test(url.pathname))response=new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-cache'}});
   else response=json({error:{code:ERROR_CODES.ENDPOINT_NOT_FOUND,message:'Not found.'}},404);
   res.writeHead(response.status,{...securityHeaders,...Object.fromEntries(response.headers)});
   if(req.method==='HEAD'||!response.body){res.end();return;}
   const reader=response.body.getReader();try{while(!abort.signal.aborted){const {value,done}=await reader.read();if(done)break;if(!res.write(Buffer.from(value)))await new Promise<void>(resolve=>{res.once('drain',resolve);res.once('close',resolve);});}}finally{if(abort.signal.aborted)await reader.cancel();res.end();}
 }catch(e){const safe=safeError(e);if(!res.headersSent)res.writeHead(safe.status,{...securityHeaders,'Content-Type':'application/json','Cache-Control':'no-store'});if(!res.writableEnded)res.end(JSON.stringify({error:{code:safe.code,message:safe.message}}));}
});
server.requestTimeout=190000;server.headersTimeout=15000;server.maxHeadersCount=60;
server.listen(port,'127.0.0.1',()=>{console.log(`AgentForge portable demo: http://localhost:${port}`);console.log('Local simulation only. Use the Next.js runtime for real AI providers, Better Auth and PostgreSQL.');});
process.on('SIGINT',()=>server.close(()=>process.exit(0)));process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
