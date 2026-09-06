import { generateText, stepCountIs, type LanguageModel } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createGateway } from '@ai-sdk/gateway';
import type { AIProvider, AIRequest, AIResult } from './types';
import type { Credential } from '../../shared/types';
import type { Pricing } from '../scoring';
import { calculateCost } from '../scoring';
import { AppError, ensure, ERROR_CODES } from '../../shared/errors';
import { safeProviderFetch } from './safe-fetch';
import { sdkTools } from './sdk-tools';
class SDKProvider implements AIProvider {
  id:string;pricing:Pricing;private model:(id:string)=>LanguageModel;private secret:string;
  constructor(id:string,model:(id:string)=>LanguageModel,pricing:Pricing,secret:string){this.id=id;this.model=model;this.pricing=pricing;this.secret=secret;}
  async execute(r:AIRequest):Promise<AIResult>{
    const start=performance.now();let calls=0;
    try{
      const tools=sdkTools(r.tools,()=>{ensure(calls<r.remainingToolCalls,'Tool-call budget exceeded.',400,ERROR_CODES.BUDGET_EXCEEDED);calls++;});
      const result=await generateText({
        model:this.model(r.model),system:r.systemPrompt,prompt:r.userPrompt,
        tools,maxOutputTokens:r.maxTokens,temperature:r.temperature,maxRetries:0,
        stopWhen:stepCountIs(Math.min(6,r.remainingToolCalls+1)),
        abortSignal:AbortSignal.any([AbortSignal.timeout(30000),...(r.signal?[r.signal]:[])]),
        experimental_telemetry:{isEnabled:false},
        prepareStep:async({steps,messages})=>{
          const used=steps.reduce((n,s)=>n+(s.usage.inputTokens||0)+(s.usage.outputTokens||0),0);
          const inputUpper=Buffer.byteLength(JSON.stringify(messages)+r.systemPrompt,'utf8')+(r.tools.length?1200:0);
          const maxOutputTokens=Math.min(r.maxTokens,r.remainingTokens-used-inputUpper);
          ensure(maxOutputTokens>=16,'Energy budget exceeded between model steps.',400,ERROR_CODES.BUDGET_EXCEEDED);
          const spent=steps.reduce((n,s)=>n+(calculateCost(s.usage.inputTokens||0,s.usage.outputTokens||0,this.pricing)||0),0);
          const reserve=calculateCost(inputUpper,maxOutputTokens,this.pricing);
          ensure(reserve===null||reserve+spent<=r.remainingCost,'Cost budget exceeded between model steps.',400,ERROR_CODES.BUDGET_EXCEEDED);
          return {maxOutputTokens,...(calls>=r.remainingToolCalls?{activeTools:[]}: {})};
        }
      });
      const usage=result.totalUsage as unknown as {inputTokens?:number;outputTokens?:number;reasoningTokens?:number;outputTokenDetails?:{reasoningTokens?:number}};
      const estimated=usage.inputTokens===undefined||usage.outputTokens===undefined;
      const inputTokens=usage.inputTokens??Math.ceil((r.systemPrompt.length+r.userPrompt.length)/4),outputTokens=usage.outputTokens??Math.ceil(result.text.length/4);
      const reasoningTokens=Math.min(outputTokens,usage.outputTokenDetails?.reasoningTokens??usage.reasoningTokens??0);
      const text=this.secret?result.text.replaceAll(this.secret,'[credential redacted]'):result.text;
      return {text,inputTokens,outputTokens,reasoningTokens,toolCalls:calls,latency:performance.now()-start,cost:estimated?null:calculateCost(inputTokens,outputTokens,this.pricing),estimated};
    }catch(error){if(error instanceof AppError)throw error;throw new AppError('Model request failed. Check the provider, model, network and account balance.',502,ERROR_CODES.PROVIDER_REQUEST_FAILED);}
  }
}
export function byokProvider(credential:Credential,key:string):AIProvider {
  const compatible=createOpenAICompatible({name:'byok',baseURL:credential.baseUrl,apiKey:key,fetch:safeProviderFetch(credential.baseUrl)});
  return new SDKProvider(credential.id,id=>compatible(id),{inputPrice:credential.inputPrice,outputPrice:credential.outputPrice},key);
}
export function gatewayProvider(key:string,pricing:Pricing):AIProvider {
  const gateway=createGateway({apiKey:key});return new SDKProvider('platform',id=>gateway(id),pricing,key);
}
