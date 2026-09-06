#!/usr/bin/env node
/**
 * PI0 registry probe. Fetches npm metadata only — does not write node_modules or lockfile.
 * Expected: @earendil-works/pi-agent-core@0.85.1 MIT, engines.node >=22.19.0.
 * AgentForge engines stay >=22.16.0; Node mismatch is refuse-Pi, not a bump.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXPECTED_NAME = '@earendil-works/pi-agent-core';
const EXPECTED_VERSION = '0.85.1';
const EXPECTED_LICENSE = 'MIT';
const EXPECTED_TARBALL =
  'https://registry.npmjs.org/@earendil-works/pi-agent-core/-/pi-agent-core-0.85.1.tgz';
const EXPECTED_INTEGRITY =
  'sha512-hIXIP3eAWueAYiAl8aMvWCvvZ8Q5gT3Dip5bE5uJyIGh4+YlWRjtMLI4BaeoXoSs93zndjue61u1B/vhefLnuA==';
const FORBIDDEN_SCOPES = ['@mariozechner/'];
const APP_ENGINES_FLOOR = '>=22.16.0';
const PI_ENGINES = '>=22.19.0';
const REGISTRY_URL =
  'https://registry.npmjs.org/@earendil-works/pi-agent-core/0.85.1';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const appPkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
}

function parseNodeFloor(range) {
  const match = String(range ?? '').match(/>=\s*(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    return null;
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    raw: `>=${match[1]}.${match[2]}.${match[3]}`
  };
}

function isAtLeast(a, b) {
  if (a.major !== b.major) {
    return a.major > b.major;
  }
  if (a.minor !== b.minor) {
    return a.minor > b.minor;
  }
  return a.patch >= b.patch;
}

const allDeps = {
  ...appPkg.dependencies,
  ...appPkg.devDependencies,
  ...appPkg.optionalDependencies,
  ...appPkg.peerDependencies
};
if (Object.keys(allDeps).some((name) => name.includes('pi-agent') || name.startsWith('@earendil-works/') || name.startsWith('@mariozechner/'))) {
  fail('package.json must not declare a Pi / @earendil-works / @mariozechner dependency');
}

const appNode = appPkg.engines?.node;
if (appNode !== APP_ENGINES_FLOOR) {
  fail(`AgentForge engines.node must remain ${APP_ENGINES_FLOOR}, got ${JSON.stringify(appNode)}`);
}

let meta;
try {
  const response = await fetch(REGISTRY_URL, {
    headers: { accept: 'application/vnd.npm.install-v1+json, application/json' }
  });
  if (!response.ok) {
    fail(`registry fetch failed: HTTP ${response.status} ${response.statusText}`);
    process.exit(1);
  }
  meta = await response.json();
} catch (error) {
  fail(`registry fetch failed (network?): ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

const name = meta.name;
const version = meta.version;
const license = meta.license;
const engines = meta.engines ?? {};
const tarball = meta.dist?.tarball;
const integrity = meta.dist?.integrity;

console.log('name:', name);
console.log('version:', version);
console.log('license:', license);
console.log('engines:', JSON.stringify(engines));
console.log('dist.tarball:', tarball);
console.log('dist.integrity:', integrity ?? '(unavailable)');

if (name !== EXPECTED_NAME) {
  fail(`expected name ${EXPECTED_NAME}, got ${name}`);
}
if (FORBIDDEN_SCOPES.some((scope) => String(name).startsWith(scope))) {
  fail(`old npm scope is forbidden: ${name}`);
}
if (version !== EXPECTED_VERSION) {
  fail(`expected version ${EXPECTED_VERSION}, got ${version}`);
}
if (license !== EXPECTED_LICENSE) {
  fail(`expected license ${EXPECTED_LICENSE}, got ${license}`);
}
if (tarball !== EXPECTED_TARBALL) {
  fail(`unexpected tarball ${tarball}`);
}
if (integrity && integrity !== EXPECTED_INTEGRITY) {
  fail(`unexpected integrity ${integrity}`);
}

const piFloor = parseNodeFloor(engines.node);
if (!piFloor) {
  fail(`could not parse Pi engines.node: ${JSON.stringify(engines.node)}`);
} else if (piFloor.raw !== PI_ENGINES) {
  fail(`expected Pi engines.node ${PI_ENGINES}, got ${engines.node}`);
}

console.warn(
  `WARN: AgentForge engines.node is ${APP_ENGINES_FLOOR}; Pi requires ${PI_ENGINES}. ` +
    'Treat this as refuse-Pi on 22.16.x–22.18.x. Do not bump the app Node floor.'
);

const appFloor = parseNodeFloor(appNode);
if (appFloor && piFloor && !isAtLeast(appFloor, piFloor)) {
  console.log(
    'POLICY: engines mismatch is expected. Refuse Pi rather than raising AgentForge engines.node.'
  );
}

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log('OK: PI0 freeze identity matches; app engines unchanged; refuse-Pi policy for Node < 22.19.0.');
