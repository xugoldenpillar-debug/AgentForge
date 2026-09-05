import 'dotenv/config';
import { getAuth } from '../src/lib/auth.ts';
import { database } from '../src/db/index.ts';
import { DrizzleRepository } from '../src/db/repository.ts';
import { seedCore } from '../src/server/seed-core.ts';
export async function seed(){
  const repo=new DrizzleRepository();let demoUser;
  if(process.env.DEMO_MODE==='true'&&process.env.SEED_DEMO_ACCOUNT==='true'){
    const email=process.env.DEMO_EMAIL||'demo@agentforge.local';
    const old=(await repo.read('users',{email}))[0];
    if(!old)await getAuth().api.signUpEmail({body:{name:'You / Builder',email,password:process.env.DEMO_PASSWORD||'ForgeDemo!2026'}});
    demoUser=(await repo.read('users',{email}))[0];
  }
  await seedCore(repo,demoUser);console.log('Arena seeded: 3 challenges, 20 simulated builds, 6 skills and 5 tools.');
}
if(process.argv[1]?.endsWith('seed.ts')){try{await seed();}finally{await database().sql.end();}}
