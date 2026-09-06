#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INVENTORY_PATH = 'specs/community-component-library/source-export-inventory.md';
const MAX_SCANNABLE_BYTES = 2 * 1024 * 1024;

const PUBLIC_CONTRACT_FILES = [
  'src/lib/community/index.ts',
  'src/lib/community/contracts.ts'
];

const PRIVATE_MODULE_PREFIXES = [
  'src/app/',
  'src/db/',
  'src/server/',
  'src/lib/ai/',
  'src/lib/auth.ts',
  'src/lib/auth-client.ts',
  'src/lib/crypto/',
  'src/lib/judge/',
  'src/lib/scoring/',
  'src/lib/workflow/',
  'src/shared/catalog.ts',
  'src/shared/errors.ts',
  'src/shared/i18n/',
  'src/shared/types.ts'
];

const PATH_RULES = [
  { id: 'environment-file', pattern: /(^|\/)\.env(?:$|\.)/i },
  { id: 'runtime-directory', pattern: /(^|\/)(?:\.next|node_modules|out|dist|build|coverage|runtime|tmp)(?:\/|$)/i },
  { id: 'local-data-directory', pattern: /(^|\/)(?:\.data|backups?)(?:\/|$)/i },
  { id: 'fixture-or-hidden-data', pattern: /(^|\/)(?:fixtures?|__fixtures__|hidden)(?:\/|\.|$)/i },
  { id: 'secret-or-credential-path', pattern: /(^|\/)(?:secrets?|credentials?)(?:\/|\.|$)/i },
  { id: 'private-key-or-dump', pattern: /\.(?:pem|key|p12|pfx|dump|backup|sqlite|db|log)$/i },
  { id: 'build-metadata', pattern: /(?:^|\/)tsconfig[^/]*\.tsbuildinfo$/i }
];

const ALLOWED_TEMPLATE_PATHS = new Set(['.env.example']);
const SECRET_PATTERNS = [
  { id: 'private-key-material', pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/g },
  { id: 'cloud-access-token', pattern: /\b(?:AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|sk-[A-Za-z0-9][A-Za-z0-9-]{19,})\b/g },
  { id: 'credentialed-connection-url', pattern: /\b(?:postgres(?:ql)?|mysql|redis):\/\/[^\s/:@]+:[^\s@]+@[^\s/]+/gi },
  { id: 'secret-assignment', pattern: /\b(?:api[_-]?key|secret(?:[_-]?key)?|password|token)\b\s*[:=]\s*["'][^"']{12,}["']/gi }
];

const PLACEHOLDER_MARKERS = /(?:test|tests|example|dummy|fake|fixture|local|localhost|replace|placeholder|changeme|your|do-not|not-a-real|private|supersecret)/i;

function isPlaceholderSecretMatch(value) {
  if (PLACEHOLDER_MARKERS.test(value)) return true;
  if (/^\w+\.\w+$/.test(value.replace(/^[^"']*["']|["']$/g, ''))) return true;
  return false;
}

function hasPotentialSecret(text, rule) {
  rule.pattern.lastIndex = 0;
  for (const match of text.matchAll(rule.pattern)) {
    if (!isPlaceholderSecretMatch(match[0])) return true;
  }
  rule.pattern.lastIndex = 0;
  return false;
}

function git(args, options = {}) {
  return execFileSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...options
  });
}

function normalizePath(value) {
  return value.replaceAll('\\', '/').replace(/^\.\//, '');
}

function unique(values) {
  return [...new Set(values)].sort();
}

function isAllowedTemplate(filePath) {
  return ALLOWED_TEMPLATE_PATHS.has(filePath) || /\.env\.[^.]+\.example$/i.test(filePath);
}

function pathFindings(filePath) {
  const normalized = normalizePath(filePath);
  if (isAllowedTemplate(normalized)) return [];
  return PATH_RULES.filter((rule) => rule.pattern.test(normalized)).map((rule) => ({
    rule: rule.id,
    path: normalized
  }));
}

function parseNulList(value) {
  return value.split('\0').map(normalizePath).filter(Boolean);
}

function currentFiles() {
  const tracked = parseNulList(git(['ls-files', '-z']));
  const untracked = parseNulList(git(['ls-files', '--others', '--exclude-standard', '-z']));
  return unique([...tracked, ...untracked]);
}

function ignoredArtifacts() {
  const candidates = [
    '.next',
    'node_modules',
    '.data',
    'coverage',
    'out',
    'dist',
    'build',
    'tsconfig.tsbuildinfo',
    '.env',
    '.env.local',
    '.env.production'
  ];
  return candidates.filter((candidate) => fs.existsSync(path.join(ROOT, candidate)));
}

function readTextBuffer(filePath, source, findings) {
  const absolute = path.join(ROOT, filePath);
  let stat;
  try {
    stat = fs.statSync(absolute);
  } catch {
    findings.reviewRequired.push({
      kind: 'file-read-failed',
      source,
      path: filePath,
      reason: 'The file disappeared or could not be stat-ed during the audit.'
    });
    return null;
  }
  if (!stat.isFile()) return null;
  if (stat.size > MAX_SCANNABLE_BYTES) {
    findings.reviewRequired.push({
      kind: 'large-file-not-scanned',
      source,
      path: filePath,
      reason: `File exceeds the ${MAX_SCANNABLE_BYTES} byte content-scan bound.`
    });
    return null;
  }
  try {
    const buffer = fs.readFileSync(absolute);
    if (buffer.includes(0)) {
      findings.reviewRequired.push({
        kind: 'binary-file-not-scanned',
        source,
        path: filePath,
        reason: 'Binary content is not inspected for secret text; review the file before export.'
      });
      return null;
    }
    return buffer;
  } catch {
    findings.reviewRequired.push({
      kind: 'file-read-failed',
      source,
      path: filePath,
      reason: 'The file could not be read during the audit.'
    });
    return null;
  }
}

function isTestOrFixturePath(filePath) {
  return /(^|\/)(?:tests?|fixtures?)(?:\/|\.|$)/i.test(filePath);
}

function scanSecretContent(buffer, source, filePath, findings) {
  if (!buffer) return;
  const text = buffer.toString('utf8');
  for (const secret of SECRET_PATTERNS) {
    if (hasPotentialSecret(text, secret)) {
      const target = isTestOrFixturePath(filePath) ? findings.reviewRequired : findings.blockers;
      target.push({
        kind: isTestOrFixturePath(filePath) ? 'secret-pattern-review' : 'secret-pattern',
        source,
        path: filePath,
        pattern: secret.id,
        reason: isTestOrFixturePath(filePath)
          ? 'A secret-like test/fixture value was detected; review the fixture without exposing its contents.'
          : 'Potential secret material was detected; content is intentionally not printed.'
      });
    }
  }
}

function scanCurrentTree(files, findings) {
  for (const filePath of files) {
    for (const finding of pathFindings(filePath)) {
      const isEnvTemplate = finding.rule === 'environment-file' && isAllowedTemplate(filePath);
      if (isEnvTemplate) continue;
      findings.reviewRequired.push({
        kind: 'prohibited-path',
        source: 'working-tree',
        path: filePath,
        pattern: finding.rule,
        reason: 'The path is not eligible for the public community export and must remain excluded.'
      });
    }
    const buffer = readTextBuffer(filePath, 'working-tree', findings);
    scanSecretContent(buffer, 'working-tree', filePath, findings);
  }
}

function historicalPaths() {
  const names = git(['log', '--all', '--format=', '--name-only'])
    .split('\n')
    .map(normalizePath)
    .filter(Boolean);
  return unique(names);
}

function historicalBlobs() {
  const lines = git(['rev-list', '--objects', '--all']).split('\n').filter(Boolean);
  const pathsByObject = new Map();
  for (const line of lines) {
    const separator = line.indexOf(' ');
    const objectId = separator === -1 ? line : line.slice(0, separator);
    const objectPath = separator === -1 ? '' : normalizePath(line.slice(separator + 1));
    const paths = pathsByObject.get(objectId) ?? [];
    if (objectPath) paths.push(objectPath);
    pathsByObject.set(objectId, paths);
  }
  const objectIds = [...pathsByObject.keys()];
  if (objectIds.length === 0) return;

  const typeResult = spawnSync('git', ['cat-file', '--batch-check'], {
    cwd: ROOT,
    input: `${objectIds.join('\n')}\n`,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024
  });
  if (typeResult.error || typeResult.status !== 0 || !typeResult.stdout) {
    return { error: 'Git could not identify historical blobs for content scanning.' };
  }

  const typeLines = typeResult.stdout.split('\n').filter(Boolean);
  if (typeLines.length !== objectIds.length) {
    return { error: 'Malformed git cat-file type response.' };
  }

  const blobObjectIds = [];
  for (let index = 0; index < objectIds.length; index += 1) {
    const [reportedObjectId, type] = typeLines[index].split(' ');
    if (reportedObjectId !== objectIds[index]) {
      return { error: 'Malformed git cat-file type response.' };
    }
    if (type === 'blob') blobObjectIds.push(objectIds[index]);
  }
  if (blobObjectIds.length === 0) return [];

  const result = spawnSync('git', ['cat-file', '--batch'], {
    cwd: ROOT,
    input: `${blobObjectIds.join('\n')}\n`,
    encoding: null,
    maxBuffer: 128 * 1024 * 1024
  });
  if (result.error || result.status !== 0 || !result.stdout) {
    return { error: 'Git could not provide historical blobs for content scanning.' };
  }

  const output = result.stdout;
  const findings = [];
  let offset = 0;
  for (const objectId of blobObjectIds) {
    const headerEnd = output.indexOf(10, offset);
    if (headerEnd === -1) {
      findings.push({ objectId, error: 'Malformed git cat-file response.' });
      break;
    }
    const header = output.subarray(offset, headerEnd).toString('utf8').split(' ');
    offset = headerEnd + 1;
    const type = header[1];
    const size = Number(header[2]);
    if (type !== 'blob' || !Number.isFinite(size)) {
      if (Number.isFinite(size)) offset += size + 1;
      continue;
    }
    const content = output.subarray(offset, offset + size);
    offset += size + 1;
    findings.push({ objectId, paths: unique(pathsByObject.get(objectId) ?? []), content });
  }
  return findings;
}

function scanHistory(findings) {
  for (const filePath of historicalPaths()) {
    for (const finding of pathFindings(filePath)) {
      if (finding.rule === 'environment-file' && isAllowedTemplate(filePath)) continue;
      findings.reviewRequired.push({
        kind: 'historical-prohibited-path',
        source: 'git-history',
        path: filePath,
        pattern: finding.rule,
        reason: 'The path exists in reachable Git history and needs explicit export-history review.'
      });
    }
  }

  const blobs = historicalBlobs();
  if (!blobs) return;
  if ('error' in blobs) {
    findings.reviewRequired.push({
      kind: 'history-scan-failed',
      source: 'git-history',
      reason: blobs.error
    });
    return;
  }
  for (const blob of blobs) {
    if (!blob.content) {
      findings.reviewRequired.push({
        kind: 'history-scan-failed',
        source: 'git-history',
        objectId: blob.objectId,
        reason: blob.error ?? 'Historical blob content was unavailable.'
      });
      continue;
    }
    const paths = blob.paths.length > 0 ? blob.paths : ['<path unavailable>'];
    const buffer = blob.content;
    if (buffer.length > MAX_SCANNABLE_BYTES) {
      for (const filePath of paths) {
        findings.reviewRequired.push({
          kind: 'historical-large-file-not-scanned',
          source: 'git-history',
          path: filePath,
          reason: `Historical blob exceeds the ${MAX_SCANNABLE_BYTES} byte content-scan bound.`
        });
      }
      continue;
    }
    if (buffer.includes(0)) {
      for (const filePath of paths) {
        findings.reviewRequired.push({
          kind: 'historical-binary-file-not-scanned',
          source: 'git-history',
          path: filePath,
          reason: 'Binary historical content is not inspected for secret text; review the file before export.'
        });
      }
      continue;
    }
    const text = buffer.toString('utf8');
    for (const secret of SECRET_PATTERNS) {
      if (hasPotentialSecret(text, secret)) {
        for (const filePath of paths) {
          const isTestFixture = isTestOrFixturePath(filePath);
          const target = isTestFixture ? findings.reviewRequired : findings.blockers;
          target.push({
            kind: isTestFixture ? 'historical-secret-pattern-review' : 'historical-secret-pattern',
            source: 'git-history',
            path: filePath,
            pattern: secret.id,
            reason: isTestFixture
              ? 'A secret-like test/fixture value was detected in reachable history; review the fixture without exposing its contents.'
              : 'Potential secret material was detected in reachable history; content is intentionally not printed.'
          });
        }
      }
    }
  }
}

function resolveInternalImport(fromFile, specifier) {
  let base;
  if (specifier.startsWith('@/')) {
    base = path.join(ROOT, 'src', specifier.slice(2));
  } else if (specifier.startsWith('.')) {
    base = path.resolve(ROOT, path.dirname(fromFile), specifier);
  } else {
    return null;
  }
  const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}.mjs`, path.join(base, 'index.ts')];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return normalizePath(path.relative(ROOT, candidate));
    }
  }
  return null;
}

function importSpecifiers(text) {
  const values = [];
  const pattern = /(?:import\s+(?:[\s\S]*?\s+from\s+|type\s+)?|export\s+(?:[\s\S]*?\s+from\s+)|import\s*\(\s*)["']([^"']+)["']/g;
  let match;
  while ((match = pattern.exec(text)) !== null) values.push(match[1]);
  return unique(values);
}

function isPrivateModule(filePath) {
  return PRIVATE_MODULE_PREFIXES.some((prefix) => filePath === prefix || filePath.startsWith(prefix));
}

function scanPublicImports(findings) {
  const visited = new Set();
  const queue = [...PUBLIC_CONTRACT_FILES];
  while (queue.length > 0) {
    const fromFile = queue.shift();
    if (visited.has(fromFile)) continue;
    visited.add(fromFile);
    const buffer = readTextBuffer(fromFile, 'working-tree', findings);
    if (!buffer) continue;
    const text = buffer.toString('utf8');
    for (const specifier of importSpecifiers(text)) {
      const resolved = resolveInternalImport(fromFile, specifier);
      if (!resolved) {
        if (specifier.startsWith('.') || specifier.startsWith('@/')) {
          findings.reviewRequired.push({
            kind: 'unresolved-public-import',
            source: 'working-tree',
            path: fromFile,
            import: specifier,
            reason: 'A public-contract import could not be resolved without guessing.'
          });
        }
        continue;
      }
      if (isPrivateModule(resolved)) {
        findings.blockers.push({
          kind: 'public-imports-private-module',
          source: 'working-tree',
          path: fromFile,
          import: resolved,
          reason: 'The intended public contract transitively depends on private platform source.'
        });
      }
      if (resolved.startsWith('src/')) queue.push(resolved);
    }
  }
}

function packageEvidence(findings) {
  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const dependencies = {
    ...(packageJson.dependencies ?? {}),
    ...(packageJson.devDependencies ?? {})
  };
  const evidence = [];
  for (const [name, requestedRange] of Object.entries(dependencies)) {
    const packageJsonPath = path.join(ROOT, 'node_modules', name, 'package.json');
    let metadata = null;
    try {
      metadata = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    } catch {
      findings.reviewRequired.push({
        kind: 'dependency-license-metadata-missing',
        source: 'working-tree',
        package: name,
        path: `node_modules/${name}/package.json`,
        reason: 'Direct dependency metadata is unavailable; license and source evidence need human review.'
      });
    }
    if (!/^(?:\d+)(?:\.\d+){2}$/.test(requestedRange)) {
      findings.reviewRequired.push({
        kind: 'dependency-range-not-pinned',
        source: 'package.json',
        package: name,
        requestedRange,
        reason: 'No lockfile is committed, so the observed package version is not a reproducible export evidence point.'
      });
    }
    evidence.push({
      name,
      requestedRange,
      observedVersion: metadata?.version ?? null,
      license: metadata?.license ?? null,
      repository: typeof metadata?.repository === 'string'
        ? metadata.repository
        : metadata?.repository?.url ?? null
    });
  }
  return evidence;
}

function inventoryChecks(findings, dependencyEvidence) {
  const absolute = path.join(ROOT, INVENTORY_PATH);
  let text;
  try {
    text = fs.readFileSync(absolute, 'utf8');
  } catch {
    findings.blockers.push({
      kind: 'inventory-missing',
      path: INVENTORY_PATH,
      reason: 'The auditable source/export inventory is missing.'
    });
    return;
  }
  for (const filePath of PUBLIC_CONTRACT_FILES) {
    if (!text.includes(`\`${filePath}\``)) {
      findings.blockers.push({
        kind: 'inventory-public-surface-missing',
        path: INVENTORY_PATH,
        expected: filePath,
        reason: 'The inventory must enumerate every intended public-contract file.'
      });
    }
  }
  for (const privatePath of ['src/db/', 'src/server/', 'src/lib/ai/', 'src/lib/crypto/', 'src/lib/judge/', 'src/lib/scoring/', 'src/lib/workflow/', 'tests/fixtures/', '.env*', '.data/', 'node_modules/', '.next/']) {
    if (!text.includes(`\`${privatePath}\``) && !text.includes(privatePath)) {
      findings.reviewRequired.push({
        kind: 'inventory-private-surface-missing',
        path: INVENTORY_PATH,
        expected: privatePath,
        reason: 'The inventory must explicitly identify private or non-exportable areas.'
      });
    }
  }
  for (const dependency of dependencyEvidence) {
    if (!text.includes(`| \`${dependency.name}\` |`)) {
      findings.reviewRequired.push({
        kind: 'inventory-dependency-missing',
        path: INVENTORY_PATH,
        package: dependency.name,
        reason: 'The inventory must record source and declared license evidence for every direct dependency.'
      });
    }
  }
  if (!fs.existsSync(path.join(ROOT, 'LICENSE')) && !fs.existsSync(path.join(ROOT, 'LICENSE.md'))) {
    findings.reviewRequired.push({
      kind: 'repository-license-not-found',
      path: INVENTORY_PATH,
      reason: 'No repository-level LICENSE file was found; first-party reuse terms require legal review.'
    });
  }
}

function dedupeFindings(findings) {
  for (const key of ['blockers', 'reviewRequired']) {
    const seen = new Set();
    findings[key] = findings[key].filter((finding) => {
      const identity = JSON.stringify(finding);
      if (seen.has(identity)) return false;
      seen.add(identity);
      return true;
    });
  }
}

function runAudit() {
  const findings = { blockers: [], reviewRequired: [], informational: [] };
  const files = currentFiles();
  scanCurrentTree(files, findings);
  scanHistory(findings);
  scanPublicImports(findings);
  const dependencyEvidence = packageEvidence(findings);
  inventoryChecks(findings, dependencyEvidence);
  const ignored = ignoredArtifacts();
  if (ignored.length > 0) {
    findings.informational.push({
      kind: 'ignored-local-artifacts',
      paths: ignored,
      reason: 'Ignored local build/dependency/config artifacts are not export candidates; they remain explicitly excluded.'
    });
  }
  dedupeFindings(findings);
  return {
    generatedAt: new Date().toISOString(),
    root: ROOT,
    publicContractFiles: PUBLIC_CONTRACT_FILES,
    currentFileCount: files.length,
    dependencyEvidence,
    findings,
    status: findings.blockers.length === 0 && findings.reviewRequired.length === 0 ? 'PASS' : 'REVIEW_REQUIRED'
  };
}

function formatFinding(finding) {
  const location = [finding.source, finding.path, finding.import ? `imports ${finding.import}` : null, finding.package ? `package ${finding.package}` : null]
    .filter(Boolean)
    .join(' | ');
  return `- ${finding.kind}${location ? ` — ${location}` : ''}${finding.pattern ? ` [${finding.pattern}]` : ''}: ${finding.reason}`;
}

function printReport(report) {
  console.log(`Community component public-export audit: ${report.status}`);
  console.log(`Scanned ${report.currentFileCount} current files and ${report.dependencyEvidence.length} direct dependencies.`);
  console.log(`Public contract surface: ${report.publicContractFiles.join(', ')}`);
  console.log(`Blockers: ${report.findings.blockers.length}; review-required: ${report.findings.reviewRequired.length}; informational: ${report.findings.informational.length}`);
  if (report.findings.blockers.length > 0) {
    console.log('\nBlockers (export must remain closed):');
    for (const finding of report.findings.blockers) console.log(formatFinding(finding));
  }
  if (report.findings.reviewRequired.length > 0) {
    console.log('\nReview-required findings (T0 remains open):');
    for (const finding of report.findings.reviewRequired) console.log(formatFinding(finding));
  }
  if (report.findings.informational.length > 0) {
    console.log('\nInformational exclusions:');
    for (const finding of report.findings.informational) console.log(`- ${finding.kind}: ${finding.paths?.join(', ') ?? finding.reason}`);
  }
}

const report = runAudit();
if (process.argv.includes('--json')) {
  console.log(JSON.stringify(report, null, 2));
} else {
  printReport(report);
}
process.exitCode = report.status === 'PASS' ? 0 : 1;
