import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';

const REQUIRED = [
  'DATABASE_URL',
  'REDIS_URL',
  'AGENTFORGE_WEB_DATABASE_URL',
  'AGENTFORGE_WEB_REDIS_URL',
  'BETTER_AUTH_URL',
  'BETTER_AUTH_SECRET',
  'CREDENTIAL_ENCRYPTION_KEY',
  'EVALUATION_QUEUE_NAME',
  'EVALUATION_QUEUE_PREFIX',
  'EVALUATION_WORKER_ID',
  'SANDBOX_RUNSC_PATH',
  'SANDBOX_ROOTFS',
  'SANDBOX_WORK_ROOT',
  'SANDBOX_OCI_TEMPLATE',
  'SANDBOX_IMAGE_DIGEST',
  'ARTIFACT_STORAGE_ROOT',
  'ARTIFACT_STORAGE_GID',
  'PROVIDER_ALLOWED_HOSTS',
];
const ABSOLUTE_PATHS = [
  'SANDBOX_RUNSC_PATH',
  'SANDBOX_ROOTFS',
  'SANDBOX_WORK_ROOT',
  'SANDBOX_OCI_TEMPLATE',
  'ARTIFACT_STORAGE_ROOT',
];
const NAME = /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/u;
const HOST = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;

function validUrl(value, protocols, options = {}) {
  const { requireOrigin = false, allowCredentials = false } = options;
  try {
    const url = new URL(value);
    return protocols.includes(url.protocol)
      && Boolean(url.hostname)
      && (allowCredentials || (!url.username && !url.password))
      && (!requireOrigin || (url.pathname === '/' && !url.search && !url.hash));
  } catch {
    return false;
  }
}

function validAbsolutePath(value) {
  return path.isAbsolute(value) && !/[\u0000-\u001f\u007f\s]/u.test(value);
}

// Return field names and policy errors only; never echo supplied values.
export function validateProductionEnvironment(env) {
  const errors = [];
  for (const key of REQUIRED) {
    if (!env[key]?.trim()) errors.push(`${key}: required / 必填`);
  }
  if (!validUrl(env.BETTER_AUTH_URL, ['https:'], { requireOrigin: true })) {
    errors.push('BETTER_AUTH_URL: HTTPS origin required / 必须是 HTTPS 来源');
  }
  if (!validUrl(env.DATABASE_URL, ['postgres:', 'postgresql:'], { allowCredentials: true })) {
    errors.push('DATABASE_URL: PostgreSQL database URL required / 必须是 PostgreSQL 数据库地址');
  }
  if (!validUrl(env.REDIS_URL, ['redis:', 'rediss:'], { allowCredentials: true })) {
    errors.push('REDIS_URL: Redis URL required / 必须是 Redis 地址');
  }
  if (!validUrl(env.AGENTFORGE_WEB_DATABASE_URL, ['postgres:', 'postgresql:'], { allowCredentials: true })) {
    errors.push('AGENTFORGE_WEB_DATABASE_URL: web PostgreSQL URL required / Web 容器 PostgreSQL 地址必填');
  }
  if (!validUrl(env.AGENTFORGE_WEB_REDIS_URL, ['redis:', 'rediss:'], { allowCredentials: true })) {
    errors.push('AGENTFORGE_WEB_REDIS_URL: web Redis URL required / Web 容器 Redis 地址必填');
  }
  try {
    const hostDatabase = new URL(env.DATABASE_URL);
    const webDatabase = new URL(env.AGENTFORGE_WEB_DATABASE_URL);
    if (hostDatabase.protocol !== webDatabase.protocol
      || hostDatabase.username !== webDatabase.username
      || hostDatabase.password !== webDatabase.password
      || hostDatabase.pathname !== webDatabase.pathname
      || hostDatabase.search !== webDatabase.search) {
      errors.push('Database host/web URLs must share protocol, credentials, database and options / 数据库双地址配置不一致');
    }
  } catch {
    // The URL-specific errors above are sufficient and never echo values.
  }
  try {
    const hostRedis = new URL(env.REDIS_URL);
    const webRedis = new URL(env.AGENTFORGE_WEB_REDIS_URL);
    if (hostRedis.protocol !== webRedis.protocol
      || hostRedis.username !== webRedis.username
      || hostRedis.password !== webRedis.password
      || hostRedis.pathname !== webRedis.pathname) {
      errors.push('Redis host/web URLs must share protocol, credentials and database / Redis 双地址配置不一致');
    }
  } catch {
    // The URL-specific errors above are sufficient and never echo values.
  }
  const key = Buffer.from(env.CREDENTIAL_ENCRYPTION_KEY ?? '', 'base64');
  if (key.length !== 32 || key.toString('base64') !== env.CREDENTIAL_ENCRYPTION_KEY) {
    errors.push('CREDENTIAL_ENCRYPTION_KEY: canonical 32-byte base64 required / 必须是 32 字节规范 base64');
  }
  if ((env.BETTER_AUTH_SECRET?.length ?? 0) < 32) {
    errors.push('BETTER_AUTH_SECRET: minimum 32 characters / 至少 32 字符');
  }
  if (env.APP_ENV !== 'production' || env.DEMO_MODE !== 'false') {
    errors.push('Require APP_ENV=production, DEMO_MODE=false / 禁止测试配置');
  }
  if (env.EVALUATION_SCHEDULER_MODE !== 'outbox') {
    errors.push('EVALUATION_SCHEDULER_MODE: must be outbox / 必须使用持久化 outbox');
  }
  if (env.ARTIFACT_ARENA_ENABLED !== 'true' || env.ARTIFACT_ARENA_KILL_SWITCH !== 'false' || env.PI_RUNTIME_ENABLED !== 'true') {
    errors.push('Artifact Arena launch requires enabled=true, kill-switch=false and Pi=true / 公开版开关配置不完整');
  }
  for (const name of ['EVALUATION_QUEUE_NAME', 'EVALUATION_QUEUE_PREFIX', 'EVALUATION_WORKER_ID']) {
    if (!NAME.test(env[name] ?? '')) errors.push(`${name}: invalid durable queue identity / 非法队列标识`);
  }
  for (const name of ABSOLUTE_PATHS) {
    if (!validAbsolutePath(env[name] ?? '')) errors.push(`${name}: absolute path without whitespace required / 必须是无空白绝对路径`);
  }
  if (!/^sha256:[a-f0-9]{64}$/u.test(env.SANDBOX_IMAGE_DIGEST ?? '')) {
    errors.push('SANDBOX_IMAGE_DIGEST: pinned sha256 required / 必须固定 sha256');
  }
  if (!/^[1-9][0-9]{0,9}$/u.test(env.ARTIFACT_STORAGE_GID ?? '')) {
    errors.push('ARTIFACT_STORAGE_GID: positive numeric shared group id required / 必须是共享组数字 GID');
  }
  const hosts = (env.PROVIDER_ALLOWED_HOSTS ?? '').split(',').map((host) => host.trim().toLowerCase()).filter(Boolean);
  if (hosts.length === 0 || new Set(hosts).size !== hosts.length || hosts.some((host) => !HOST.test(host) || host === 'localhost')) {
    errors.push('PROVIDER_ALLOWED_HOSTS: unique public DNS hosts required / 必须是唯一公网 DNS 主机');
  }
  return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const errors = validateProductionEnvironment(parseEnv(readFileSync(process.argv[2], 'utf8')));
    if (errors.length) {
      console.error(errors.join('\n'));
      process.exitCode = 1;
    } else {
      console.log('Production web + trusted worker environment shape passed; connectivity not checked / Web 与可信 Worker 配置格式通过，尚未检查连通性');
    }
  } catch {
    console.error('Cannot read production env file / 无法读取生产配置文件');
    process.exitCode = 1;
  }
}
