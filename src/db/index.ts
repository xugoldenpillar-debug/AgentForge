import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema.ts';
let connection:ReturnType<typeof connect>|undefined;
function connect(){const url=process.env.DATABASE_URL;if(!url)throw new Error('DATABASE_URL is required. Run pnpm setup.');const sql=postgres(url,{max:10,prepare:false,connect_timeout:10});return {sql,db:drizzle(sql,{schema,logger:false})};}
export function database(){return connection??=connect();}
