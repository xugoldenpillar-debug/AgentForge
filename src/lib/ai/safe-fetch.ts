import { lookup } from 'node:dns/promises';
import { Agent } from 'undici';
import { AppError, ERROR_CODES } from '../../shared/errors.ts';
import { isPublicAddress } from '../../server/url-policy.ts';
const agents=new Map<string,Agent>();
export function safeProviderFetch(baseUrl:string):typeof fetch {
  const base=new URL(baseUrl);
  let agent=agents.get(base.hostname);
  if(!agent){
    agent=new Agent({connections:8,connect:{lookup:(hostname:string,options:any,callback:any)=>{
      void lookup(hostname,{all:true,verbatim:true}).then(addresses=>{
        if(!addresses.length||addresses.some(a=>!isPublicAddress(a.address)))throw new Error('Non-public provider address.');
        if(options?.all)callback(null,addresses);else callback(null,addresses[0].address,addresses[0].family);
      }).catch(() => callback(new AppError('Provider network policy rejected the connection.', 502, ERROR_CODES.PROVIDER_NETWORK_REJECTED)));
    }}});agents.set(base.hostname,agent);
  }
  return (async(input:RequestInfo|URL,init?:RequestInit)=>{
    const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
    if(url.origin!==base.origin||!url.pathname.startsWith(base.pathname.replace(/\/$/,'')+'/'))throw new AppError('Provider network policy rejected the request.',400,ERROR_CODES.PROVIDER_NETWORK_REJECTED);
    const response=await fetch(input,{...init,redirect:'error',dispatcher:agent} as RequestInit);
    // Bound response size without exposing raw upstream failures.
    if(!response.body)return response;let size=0;
    const body=response.body.pipeThrough(new TransformStream<Uint8Array,Uint8Array>({transform(chunk,controller){size+=chunk.byteLength;if(size>2*1024*1024)throw new AppError('Provider response exceeds the size limit.',502,ERROR_CODES.PROVIDER_RESPONSE_INVALID);controller.enqueue(chunk);}}));
    return new Response(body,{status:response.status,statusText:response.statusText,headers:response.headers});
  }) as typeof fetch;
}
