#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

function du(path) {
  const result = spawnSync('du', ['-sk', '-L', path], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || 'du failed');
  return Number(result.stdout.trim().split(/\s+/)[0]);
}

const pkg = new URL('../node_modules/@earendil-works/pi-agent-core', import.meta.url);
const kb = du(pkg.pathname);
const started = Date.now();
await import('@earendil-works/pi-agent-core');
const importMs = Date.now() - started;
const rss = Math.round(process.memoryUsage().rss / 1024 / 1024);

const report = [
  '# PI4 measurement — optional Pi core import',
  '',
  `- Date: ${new Date().toISOString()}`,
  '- Package: @earendil-works/pi-agent-core@0.85.1',
  `- On-disk size (package dir): ${kb} KiB`,
  `- Dynamic import elapsed: ${importMs} ms`,
  `- Process RSS after import: ${rss} MiB`,
  '',
  'These numbers are a single local sample, not an SLA or production capacity claim.',
  'Closing `PI_RUNTIME_ENABLED` does not delete DAG history.',
  ''
].join('\n');

writeFileSync('specs/pi-runtime/pi4-measurement.md', report);
console.log(report);
