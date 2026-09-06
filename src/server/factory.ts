import 'server-only';
import { testModelsEnabled } from './environment';
import { ArenaService } from './service';
import { DrizzleRepository } from '../db/repository';
import { byokProvider, gatewayProvider } from '../lib/ai/sdk-provider';
let service:ArenaService|undefined;
function price(value:string|undefined):number|null {if(!value?.trim())return null;const n=Number(value);return Number.isFinite(n)&&n>=0?n:null;}
export function getService(){
  if(service)return service;
  const platform=process.env.AI_GATEWAY_API_KEY&&process.env.PLATFORM_MODEL?{model:process.env.PLATFORM_MODEL,inputPrice:price(process.env.PLATFORM_INPUT_PRICE_PER_MILLION),outputPrice:price(process.env.PLATFORM_OUTPUT_PRICE_PER_MILLION)}:undefined;
  return service=new ArenaService(new DrizzleRepository(),{
    demoMode:testModelsEnabled(process.env),encryptionKey:process.env.CREDENTIAL_ENCRYPTION_KEY||'',
    allowedHosts:(process.env.PROVIDER_ALLOWED_HOSTS||'api.openai.com,openrouter.ai').split(',').map(s=>s.trim()).filter(Boolean),
    githubEnabled:!!(process.env.GITHUB_CLIENT_ID&&process.env.GITHUB_CLIENT_SECRET),platform,
    createRealProvider:byokProvider,createPlatformProvider:platform?()=>gatewayProvider(process.env.AI_GATEWAY_API_KEY!,platform):undefined,
    maxRunCost:Number(process.env.RUN_MAX_TOTAL_COST||2.5),maxCases:Number(process.env.RUN_MAX_CASES||50)
  });
}
