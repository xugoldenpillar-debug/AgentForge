import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { Repository, TableName, Tables } from '../shared/types.ts';
import { tableRegistry } from './schema.ts';
import { database } from './index.ts';
const dates=new Set([
  'createdAt','updatedAt','expiresAt','accessTokenExpiresAt','refreshTokenExpiresAt',
  'frozenAt','startedAt','completedAt','decidedAt','releasedAt','occurredAt',
  'acceptedAt','cancellationRequestedAt','leaseExpiresAt','heartbeatAt','finishedAt',
  'recordedAt','availableAt','lastErrorAt','publishedAt',
]);
function toDatabase(value:Record<string,unknown>){return Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined).map(([k,v])=>[k,dates.has(k)&&typeof v==='string'?new Date(v):v]));}
function fromDatabase<T>(value:unknown):T {return JSON.parse(JSON.stringify(value)) as T;}
// The only intentionally dynamic query builder: domain services stay strongly typed.
export class DrizzleRepository implements Repository {
  private orm:any;private sql:ReturnType<typeof database>['sql'];private nested:boolean;
  constructor(orm:any=database().db,sql=database().sql,nested=false){this.orm=orm;this.sql=sql;this.nested=nested;}
  private condition(table:any,where:Record<string,unknown>){const entries=Object.entries(where).map(([k,v])=>eq(table[k],v));return entries.length?and(...entries):undefined;}
  async read<K extends TableName>(name:K,where:Partial<Tables[K]>={}):Promise<Tables[K][]> {const t=tableRegistry[name];return fromDatabase(await this.orm.select().from(t).where(this.condition(t,where)));}
  async insert<K extends TableName>(name:K,rows:Tables[K][]):Promise<void>{if(rows.length)await this.orm.insert(tableRegistry[name]).values(rows.map(r=>toDatabase(r as unknown as Record<string,unknown>)));}
  async update<K extends TableName>(name:K,where:Partial<Tables[K]>,values:Partial<Tables[K]>):Promise<Tables[K][]> {const t=tableRegistry[name];return fromDatabase(await this.orm.update(t).set(toDatabase(values as Record<string,unknown>)).where(this.condition(t,where)).returning());}
  async remove<K extends TableName>(name:K,where:Partial<Tables[K]>):Promise<void>{const t=tableRegistry[name];await this.orm.delete(t).where(this.condition(t,where));}
  async transaction<T>(fn: (tx: Repository) => Promise<T>): Promise<T> {
    if (this.nested) return fn(this);
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.orm.transaction(
          (tx: typeof this.orm) => fn(new DrizzleRepository(tx, this.sql, true)),
          {isolationLevel: 'serializable'}
        );
      } catch (error) {
        // Drizzle wraps postgres.js errors. Retry the whole transaction so CAS is rechecked.
        const databaseError = error as {code?: string; cause?: {code?: string}};
        const code = databaseError.code ?? databaseError.cause?.code;
        if (attempt < 2 && (code === '40001' || code === '40P01')) continue;
        throw error;
      }
    }
  }
  async rateLimit(key:string,limit:number,windowMs:number):Promise<boolean>{
    const rows=await this.sql`INSERT INTO rate_limits(key,hits,expires_at) VALUES(${key},1,now()+${windowMs}*interval '1 millisecond') ON CONFLICT(key) DO UPDATE SET hits=CASE WHEN rate_limits.expires_at<=now() THEN 1 ELSE rate_limits.hits+1 END, expires_at=CASE WHEN rate_limits.expires_at<=now() THEN now()+${windowMs}*interval '1 millisecond' ELSE rate_limits.expires_at END RETURNING hits`;
    return Number(rows[0].hits)<=limit;
  }
  async lease(key:string,ttlMs:number):Promise<string|null>{const token=randomUUID();const rows=await this.sql`INSERT INTO execution_locks(key,token,expires_at) VALUES(${key},${token},now()+${ttlMs}*interval '1 millisecond') ON CONFLICT(key) DO UPDATE SET token=EXCLUDED.token,expires_at=EXCLUDED.expires_at WHERE execution_locks.expires_at<=now() RETURNING token`;return rows.length?String(rows[0].token):null;}
  async release(key:string,token:string):Promise<void>{await this.sql`DELETE FROM execution_locks WHERE key=${key} AND token=${token}`;}
}
