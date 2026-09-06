import { getAuth } from '@/lib/auth';
import { getService } from '@/server/factory';
import { handleArena } from '@/server/http';
import { validateBody } from '@/server/validation';
import { safeError } from '@/shared/errors';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=300;
async function handler(request:Request){
  try{const session=await getAuth().api.getSession({headers:request.headers});return handleArena(request,{service:getService(),userId:session?.user.id,origin:new URL(process.env.BETTER_AUTH_URL||'http://localhost:3000').origin,validateBody});}
  catch(error){const safe=safeError(error);return Response.json({error:{code:safe.code,message:safe.message}},{status:safe.status});}
}
export const GET=handler;export const POST=handler;export const DELETE=handler;
