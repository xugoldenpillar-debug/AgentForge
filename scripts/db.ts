import { migrate } from './migrate.ts';
import { seed } from './seed.ts';
import { database } from '../src/db/index.ts';
try{await migrate();await seed();}finally{await database().sql.end();}
