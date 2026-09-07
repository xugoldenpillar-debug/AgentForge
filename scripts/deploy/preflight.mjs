import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parse } from 'dotenv';

// Return field names, never supplied values: URLs and keys can contain secrets.
export function validateProductionEnvironment(env) {
  const errors = [];
  for (const key of ['DATABASE_URL', 'BETTER_AUTH_URL', 'BETTER_AUTH_SECRET', 'CREDENTIAL_ENCRYPTION_KEY']) {
    if (!env[key]?.trim()) errors.push(`${key}: required / 必填`);
  }
  try {
    const url = new URL(env.BETTER_AUTH_URL);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error();
  } catch {
    errors.push('BETTER_AUTH_URL: HTTPS origin required / 必须是 HTTPS 来源');
  }
  try {
    const url = new URL(env.DATABASE_URL);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || url.pathname.length < 2) throw new Error();
  } catch {
    errors.push('DATABASE_URL: PostgreSQL database URL required / 必须是 PostgreSQL 数据库地址');
  }
  const key = Buffer.from(env.CREDENTIAL_ENCRYPTION_KEY ?? '', 'base64');
  if (key.length !== 32 || key.toString('base64') !== env.CREDENTIAL_ENCRYPTION_KEY) errors.push('CREDENTIAL_ENCRYPTION_KEY: canonical 32-byte base64 required / 必须是 32 字节规范 base64');
  if ((env.BETTER_AUTH_SECRET?.length ?? 0) < 32) errors.push('BETTER_AUTH_SECRET: minimum 32 characters / 至少 32 字符');
  if (env.APP_ENV !== 'production' || env.DEMO_MODE !== 'false') errors.push('Require APP_ENV=production, DEMO_MODE=false / 禁止测试配置');
  for (const key of ['PI_RUNTIME_ENABLED', 'ARTIFACT_ARENA_ENABLED']) {
    if (env[key] !== 'false') errors.push(`${key}: must remain false until integration passes / 接线验收前保持关闭`);
  }
  return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const errors = validateProductionEnvironment(parse(readFileSync(process.argv[2], 'utf8')));
    if (errors.length) {
      console.error(errors.join('\n'));
      process.exitCode = 1;
    } else console.log('Environment shape passed; connectivity not checked / 配置格式通过，尚未检查连通性');
  } catch {
    console.error('Cannot read production env file / 无法读取生产配置文件');
    process.exitCode = 1;
  }
}
