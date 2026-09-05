import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { database } from '../src/db/index.ts';
export async function migrate(){const ddl=await readFile(new URL('../src/db/schema.sql',import.meta.url),'utf8');await database().sql.unsafe(ddl);console.log('Database schema is ready.');}
if(process.argv[1]?.endsWith('migrate.ts')){try{await migrate();}finally{await database().sql.end();}}
