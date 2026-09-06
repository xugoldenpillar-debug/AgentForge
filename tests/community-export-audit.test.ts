import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const auditScript = new URL('../scripts/audit-community-export.mjs', import.meta.url);

test('community export audit stays review-required without tree pseudo-files', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(auditScript), '--json'], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });

  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout) as {
    status: string;
    findings: {
      blockers: Array<{ kind?: string; import?: string }>;
      reviewRequired: Array<{ kind?: string; path?: string }>;
    };
  };

  assert.equal(report.status, 'REVIEW_REQUIRED');
  assert.equal(report.findings.blockers.length, 0);
  assert(report.findings.reviewRequired.some((finding) => finding.kind === 'repository-license-not-found'));
  assert(report.findings.reviewRequired.some((finding) => (
    finding.kind === 'prohibited-path'
    && finding.path === 'src/lib/crypto/credentials.ts'
  )));
  assert(report.findings.reviewRequired.some((finding) => (
    finding.kind === 'historical-prohibited-path'
    && finding.path === 'src/lib/crypto/credentials.ts'
  )));
  assert(report.findings.reviewRequired.some((finding) => (
    finding.kind === 'historical-secret-pattern-review'
    && finding.path === 'tests/portable-http.test.ts'
  )));

  const historicalBinaryPaths = report.findings.reviewRequired
    .filter((finding) => finding.kind === 'historical-binary-file-not-scanned')
    .map((finding) => finding.path);
  const expectedHistoricalBinaryPaths = [
    'docs/screenshots/builder-scored.png',
    'docs/screenshots/home-desktop.png',
    'docs/screenshots/home-mobile.png'
  ];
  for (const filePath of expectedHistoricalBinaryPaths) {
    assert(historicalBinaryPaths.includes(filePath));
  }
  assert(!historicalBinaryPaths.includes('<path unavailable>'));
  for (const directoryPath of ['.github', 'docs', 'src', 'tests', 'portable']) {
    assert(!historicalBinaryPaths.includes(directoryPath));
  }
  assert(!result.stdout.includes('FLAG{TEST_ONLY}'));
});
