'use client';
export async function api<T=any>(path:string,options:RequestInit={}):Promise<T>{
  const response=await fetch(`/api/arena/${path}`,{credentials:'same-origin',...options,headers:{'Content-Type':'application/json',...options.headers}});
  const data=await response.json();if(!response.ok)throw new Error(data.error||'Request failed.');return data as T;
}
export const post=<T=any>(path:string,body:unknown)=>api<T>(path,{method:'POST',body:JSON.stringify(body)});
export async function consumeRun(body:unknown,onEvent:(event:any)=>void,signal:AbortSignal){
  const response=await fetch('/api/arena/runs',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal});
  if(!response.ok){const data=await response.json();throw new Error(data.error||'Run failed.');}
  if(!response.body)throw new Error('No execution stream was returned.');
  const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';
  for(;;){const {done,value}=await reader.read();buffer+=decoder.decode(value,{stream:!done});let split;while((split=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,split);buffer=buffer.slice(split+1);if(line.trim())onEvent(JSON.parse(line));}if(done)break;}
  if(buffer.trim())onEvent(JSON.parse(buffer));
}
