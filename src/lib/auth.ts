import { betterAuth } from 'better-auth';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { database } from '../db';
import { user, session, account, verification } from '../db/schema';
let instance:ReturnType<typeof createAuth>|undefined;
function createAuth(){
  const secret=process.env.BETTER_AUTH_SECRET;
  if(!secret||secret.length<32||secret.startsWith('replace-'))throw new Error('Configure BETTER_AUTH_SECRET using pnpm run setup.');
  const baseURL=process.env.BETTER_AUTH_URL||'http://localhost:3000';
  return betterAuth({
    database:drizzleAdapter(database().db,{provider:'pg',schema:{user,session,account,verification}}),
    baseURL,secret,trustedOrigins:[baseURL],
    emailAndPassword:{enabled:true,minPasswordLength:10,maxPasswordLength:128},
    socialProviders:process.env.GITHUB_CLIENT_ID&&process.env.GITHUB_CLIENT_SECRET?{github:{clientId:process.env.GITHUB_CLIENT_ID,clientSecret:process.env.GITHUB_CLIENT_SECRET}}:{},
    rateLimit:{enabled:true,window:60,max:30},
    session:{expiresIn:60*60*24*7,updateAge:60*60*24},
    logger:{disabled:true}
  });
}
export function getAuth(){return instance??=createAuth();}
