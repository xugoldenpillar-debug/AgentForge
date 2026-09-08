import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { AppError, ERROR_CODES } from '../src/shared/errors.ts';
import { collectArtifacts, computeArtifactManifestDigest, planPreview, projectPreview, projectPreviewContent, projectArtifactBundle, readArtifactStorageObject, UnavailableArtifactStorageAdapter, type ArtifactCollectionContext, type ArtifactCollectionManifest, type ArtifactManifestEntry, type ArtifactOutputSlot, type ArtifactSnapshotReader } from '../src/server/artifacts/index.ts';
import { computeSandboxSnapshotDigest } from '../src/server/sandbox/index.ts';
import type { ArtifactReadBundle } from '../src/server/artifacts/access.ts';
import type { SandboxSnapshot, SandboxSnapshotEntry } from '../src/server/sandbox/index.ts';

const context: ArtifactCollectionContext = {
  businessRef: 'problem:pelican',
  attemptId: 'attempt-1',
  fenceToken: 'fence-1',
  environmentDigest: 'sha256:environment',
  outputContractVersion: 'output-v1',
  limits: { maxEntries: 4, maxFileBytes: 32, maxOutputBytes: 64 }
};

const slots: readonly ArtifactOutputSlot[] = [
  { slotId: 'entry', relativePath: 'dist/index.html', mediaTypes: ['text/html'], classification: 'public-feedback', required: true, maxBytes: 32 },
  { slotId: 'readme', relativePath: 'README.md', mediaTypes: ['text/markdown'], classification: 'private-creation', required: false, maxBytes: 32 }
];

function digest(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function makeReader(entries: readonly { entry: SandboxSnapshotEntry; bytes: Uint8Array }[], snapshotDigest?: string): ArtifactSnapshotReader {
  const byPath = new Map(entries.map(({ entry, bytes }) => [entry.relativePath, { entry, bytes }]));
  const snapshotBase = {
    snapshotId: 'snapshot-1',
    attemptId: context.attemptId,
    fenceToken: context.fenceToken,
    sealedAt: '2026-09-07T00:00:00.000Z',
    entries: entries.map(({ entry }) => entry)
  } as const;
  const snapshot: SandboxSnapshot = {
    ...snapshotBase,
    snapshotDigest: snapshotDigest ?? computeSandboxSnapshotDigest(snapshotBase)
  };
  return {
    snapshot,
    async readFile(relativePath) {
      const found = byPath.get(relativePath);
      assert(found !== undefined);
      return {
        relativePath,
        bytes: new Uint8Array(found.bytes),
        objectVersion: found.entry.objectVersion
      };
    }
  };
}

function file(relativePath: string, content: string, overrides: Partial<SandboxSnapshotEntry> = {}): { entry: SandboxSnapshotEntry; bytes: Uint8Array } {
  const bytes = new TextEncoder().encode(content);
  return {
    entry: {
      relativePath,
      kind: 'file',
      bytes: bytes.byteLength,
      mediaType: 'text/html',
      classification: 'public-feedback',
      objectVersion: `${relativePath}-v1`,
      ...overrides
    },
    bytes
  };
}

function isCoded(error: unknown, code: string): boolean {
  return error instanceof AppError && error.code === code;
}

function previewManifest(entries: readonly ArtifactManifestEntry[]): ArtifactCollectionManifest {
  const base: ArtifactCollectionManifest = {
    manifestVersion: 1,
    businessRef: 'problem:preview',
    attemptId: 'attempt-preview',
    fenceToken: 'fence-preview',
    environmentDigest: digest(new TextEncoder().encode('environment')),
    snapshotDigest: digest(new TextEncoder().encode('snapshot')),
    outputContractVersion: 'output-v1',
    entries,
    sealedAt: '2026-09-07T00:00:00.000Z',
    manifestDigest: ''
  };
  return { ...base, manifestDigest: computeArtifactManifestDigest(base) };
}

test('collector creates an immutable manifest with a deterministic digest', async () => {
  const html = file('dist/index.html', '<h1>pelican</h1>');
  const readme = file('README.md', '# result', { mediaType: 'text/markdown', classification: 'private-creation' });
  const first = await collectArtifacts(makeReader([html, readme]), context, slots);
  const second = await collectArtifacts(makeReader([readme, html]), context, slots);
  assert.equal(first.manifest.manifestDigest, second.manifest.manifestDigest);
  assert.deepEqual(first.manifest.entries.map((entry) => entry.relativePath), ['README.md', 'dist/index.html']);
  assert.equal(first.manifest.entries[0]?.classification, 'private-creation');
  assert.equal(first.manifest.entries[0]?.sha256, digest(readme.bytes));
  assert.equal(Object.hasOwn(first.manifest, 'storageKey'), false);
  assert.equal(Object.hasOwn(first.manifest.entries[0] ?? {}, 'hostPath'), false);
});

test('collector rejects traversal, duplicate normalized paths, and special files', async () => {
  const traversal = file('../dist/index.html', '<h1>bad</h1>');
  await assert.rejects(() => collectArtifacts(makeReader([traversal], `sha256:${'0'.repeat(64)}`), context, slots), (error: unknown) => isCoded(error, ERROR_CODES.REQUEST_VALIDATION_FAILED));

  const duplicateA = file('dist/index.html', 'one');
  const duplicateB = file('DIST/INDEX.HTML', 'two');
  await assert.rejects(() => collectArtifacts(makeReader([duplicateA, duplicateB], `sha256:${'0'.repeat(64)}`), context, slots), (error: unknown) => isCoded(error, ERROR_CODES.REQUEST_VALIDATION_FAILED));

  const special = file('dist/index.html', '', { kind: 'symlink' });
  await assert.rejects(() => collectArtifacts(makeReader([special]), context, slots), (error: unknown) => isCoded(error, ERROR_CODES.REQUEST_VALIDATION_FAILED));
});

test('collector enforces entry, per-file, output, slot, and required-output limits', async () => {
  const tooLarge = file('dist/index.html', '12345');
  await assert.rejects(
    () => collectArtifacts(makeReader([tooLarge]), { ...context, limits: { maxEntries: 4, maxFileBytes: 4, maxOutputBytes: 64 } }, slots),
    (error: unknown) => isCoded(error, ERROR_CODES.REQUEST_VALIDATION_FAILED)
  );

  const tooMany = Array.from({ length: 5 }, (_, index) => file(`extra-${index}.txt`, 'x', { mediaType: 'text/plain' }));
  const fourSlots = tooMany.slice(0, 4).map((item, index) => ({
    slotId: `slot-${index}`,
    relativePath: item.entry.relativePath,
    mediaTypes: ['text/plain'],
    classification: 'public-feedback' as const,
    required: false,
    maxBytes: 32
  }));
  await assert.rejects(
    () => collectArtifacts(makeReader(tooMany), { ...context, limits: { maxEntries: 4, maxFileBytes: 32, maxOutputBytes: 64 } }, fourSlots),
    (error: unknown) => isCoded(error, ERROR_CODES.REQUEST_BODY_TOO_LARGE)
  );

  const overOutput = [file('dist/index.html', '1234567890'), file('README.md', '1234567890', { mediaType: 'text/markdown', classification: 'private-creation' })];
  await assert.rejects(
    () => collectArtifacts(makeReader(overOutput), { ...context, limits: { maxEntries: 4, maxFileBytes: 32, maxOutputBytes: 10 } }, slots),
    (error: unknown) => isCoded(error, ERROR_CODES.REQUEST_BODY_TOO_LARGE)
  );

  await assert.rejects(
    () => collectArtifacts(makeReader([file('README.md', '# only', { mediaType: 'text/markdown', classification: 'private-creation' })]), context, slots),
    (error: unknown) => isCoded(error, ERROR_CODES.REQUEST_VALIDATION_FAILED)
  );
});

test('hidden classification is never downgraded by a public output slot', async () => {
  const hidden = file('dist/index.html', '<h1>hidden</h1>', { classification: 'hidden' });
  const result = await collectArtifacts(makeReader([hidden]), context, [slots[0]!]);
  assert.equal(result.manifest.entries[0]?.classification, 'hidden');
});

test('collector refuses unstable bytes and mismatched reader paths', async () => {
  const original = file('dist/index.html', 'stable');
  const reader = makeReader([original]);
  const unstable: ArtifactSnapshotReader = {
    snapshot: reader.snapshot,
    async readFile() {
      return { relativePath: 'dist/index.html', bytes: new TextEncoder().encode('changed'), objectVersion: 'dist/index.html-v1' };
    }
  };
  await assert.rejects(() => collectArtifacts(unstable, context, [slots[0]!]), (error: unknown) => isCoded(error, ERROR_CODES.RUNTIME_POLICY_DENIED));

  const wrongPath: ArtifactSnapshotReader = {
    snapshot: reader.snapshot,
    async readFile() {
      return { relativePath: 'other.html', bytes: original.bytes, objectVersion: 'dist/index.html-v1' };
    }
  };
  await assert.rejects(() => collectArtifacts(wrongPath, context, [slots[0]!]), (error: unknown) => isCoded(error, ERROR_CODES.RUNTIME_POLICY_DENIED));
});

test('storage adapter seam is bounded, version-pinned, and fail-closed without a provider', async () => {
  const bytes = new TextEncoder().encode('sealed');
  const entry = {
    artifactId: 'storage-artifact',
    slotId: 'slot',
    relativePath: 'dist/index.html',
    mediaType: 'text/html',
    bytes: bytes.byteLength,
    sha256: digest(bytes),
    objectVersion: 'object-v1',
    classification: 'public-feedback' as const
  };
  const request = {
    ownerId: 'owner-1',
    bundleId: 'bundle-1',
    artifactId: entry.artifactId,
    storageKey: 'artifacts/bundle-1/storage-artifact',
    objectVersion: entry.objectVersion,
    maxBytes: bytes.byteLength
  };
  const read = await readArtifactStorageObject({
    async read(received) {
      assert.deepEqual(received, request);
      return { bytes, objectVersion: 'object-v1' };
    }
  }, request, entry);
  assert.deepEqual(read, bytes);

  await assert.rejects(
    () => readArtifactStorageObject({ async read() { return { bytes, objectVersion: 'object-v2' }; } }, request, entry),
    (error: unknown) => isCoded(error, ERROR_CODES.RUNTIME_POLICY_DENIED)
  );
  await assert.rejects(
    () => readArtifactStorageObject({ async read() { return { bytes: new Uint8Array(bytes.byteLength + 1), objectVersion: 'object-v1' }; } }, request, entry),
    (error: unknown) => isCoded(error, ERROR_CODES.REQUEST_BODY_TOO_LARGE)
  );
  await assert.rejects(
    () => readArtifactStorageObject({ async read() { return { bytes: new Uint8Array(bytes.byteLength - 1), objectVersion: 'object-v1' }; } }, request, entry),
    (error: unknown) => isCoded(error, ERROR_CODES.RUNTIME_POLICY_DENIED)
  );
  await assert.rejects(
    () => readArtifactStorageObject({ async read() { return { bytes: new TextEncoder().encode('tamper'), objectVersion: 'object-v1' }; } }, request, entry),
    (error: unknown) => isCoded(error, ERROR_CODES.RUNTIME_POLICY_DENIED)
  );
  await assert.rejects(
    () => new UnavailableArtifactStorageAdapter().read(request),
    (error: unknown) => isCoded(error, ERROR_CODES.RUNTIME_UNAVAILABLE)
  );
});

test('collector rejects a syntactically valid but mismatched snapshot digest', async () => {
  const html = file('dist/index.html', '<h1>digest</h1>');
  await assert.rejects(
    () => collectArtifacts(makeReader([html], `sha256:${'0'.repeat(64)}`), context, slots),
    (error: unknown) => isCoded(error, ERROR_CODES.RUNTIME_POLICY_DENIED)
  );
});

test('hidden artifacts are excluded from owner projections and preview planning', () => {
  const visibleBytes = new TextEncoder().encode('visible');
  const hiddenBytes = new TextEncoder().encode('hidden');
  const visible: ArtifactManifestEntry = {
    artifactId: 'visible', slotId: 'slot', relativePath: 'visible.txt', mediaType: 'text/plain',
    bytes: visibleBytes.byteLength, sha256: digest(visibleBytes), objectVersion: 'v1', classification: 'public-feedback'
  };
  const hidden: ArtifactManifestEntry = {
    artifactId: 'hidden', slotId: 'judge', relativePath: 'judge.json', mediaType: 'application/json',
    bytes: hiddenBytes.byteLength, sha256: digest(hiddenBytes), objectVersion: 'v1', classification: 'hidden'
  };
  const manifest = previewManifest([visible, hidden]);
  const bundle: ArtifactReadBundle = {
    bundleId: 'bundle-hidden', ownerId: 'owner-1', outputSlot: 'site', status: 'sealed', manifest,
    sealedAt: manifest.sealedAt, createdAt: manifest.sealedAt, updatedAt: manifest.sealedAt
  };
  assert.deepEqual(projectArtifactBundle(bundle).entries.map((entry) => entry.artifactId), ['visible']);
  assert.throws(() => projectPreview(manifest, hidden.artifactId, hidden.bytes), (error: unknown) => isCoded(error, ERROR_CODES.RESOURCE_NOT_FOUND));
  assert.throws(() => projectPreviewContent(manifest, hidden.artifactId, hiddenBytes, hidden.bytes), (error: unknown) => isCoded(error, ERROR_CODES.RESOURCE_NOT_FOUND));
});

test('preview projection is data-only and covers supported artifact formats', () => {
  const entries: ArtifactManifestEntry[] = [
    { artifactId: 'a-html', slotId: 'slot', relativePath: 'index.html', mediaType: 'text/html', bytes: 1, sha256: 'sha256:a', objectVersion: 'v1', classification: 'public-feedback' },
    { artifactId: 'a-css', slotId: 'slot', relativePath: 'style.css', mediaType: 'text/css', bytes: 1, sha256: 'sha256:b', objectVersion: 'v1', classification: 'public-feedback' },
    { artifactId: 'a-md', slotId: 'slot', relativePath: 'README.md', mediaType: 'text/markdown', bytes: 1, sha256: 'sha256:c', objectVersion: 'v1', classification: 'public-feedback' },
    { artifactId: 'a-svg', slotId: 'slot', relativePath: 'image.svg', mediaType: 'image/svg+xml', bytes: 1, sha256: 'sha256:d', objectVersion: 'v1', classification: 'public-feedback' },
    { artifactId: 'a-json', slotId: 'slot', relativePath: 'data.json', mediaType: 'application/json', bytes: 1, sha256: 'sha256:e', objectVersion: 'v1', classification: 'public-feedback' },
    { artifactId: 'a-csv', slotId: 'slot', relativePath: 'data.csv', mediaType: 'text/csv', bytes: 1, sha256: 'sha256:f', objectVersion: 'v1', classification: 'public-feedback' },
    { artifactId: 'a-text', slotId: 'slot', relativePath: 'code.ts', mediaType: 'text/plain', bytes: 1, sha256: 'sha256:g', objectVersion: 'v1', classification: 'public-feedback' },
    { artifactId: 'a-image', slotId: 'slot', relativePath: 'image.png', mediaType: 'image/png', bytes: 1, sha256: 'sha256:h', objectVersion: 'v1', classification: 'public-feedback' }
  ];
  const formats = entries.map((entry) => planPreview(entry)?.format);
  assert.deepEqual(formats, ['html', 'css', 'markdown', 'svg', 'json', 'csv', 'text', 'image']);
  for (const entry of entries) {
    const projection = projectPreview({ entries }, entry.artifactId, entry.bytes);
    assert.equal(projection.allowScripts, false);
    assert.equal(projection.allowRemoteResources, false);
    assert.equal(projection.allowNavigation, false);
    assert.equal(projection.rawHtmlAllowed, false);
    assert.equal(Object.hasOwn(projection, 'url'), false);
  }
  const unsupported: ArtifactManifestEntry = { ...entries[0]!, artifactId: 'unknown', relativePath: 'archive.bin', mediaType: 'application/octet-stream' };
  assert.equal(planPreview(unsupported), null);

  const htmlBytes = new TextEncoder().encode('<script>alert(1)</script><img src="https://example.test/x.png"><h1>safe</h1>');
  const htmlEntry = { ...entries[0]!, bytes: htmlBytes.byteLength, sha256: digest(htmlBytes) };
  const htmlProjection = projectPreviewContent(
    previewManifest([htmlEntry]),
    htmlEntry.artifactId,
    htmlBytes,
    htmlBytes.byteLength
  );
  assert.equal(htmlProjection.body.kind, 'text');
  if (htmlProjection.body.kind === 'text') {
    assert.equal(htmlProjection.body.content.includes('<script'), false);
    assert.equal(htmlProjection.body.content.includes('https://example.test'), false);
    assert.equal(htmlProjection.body.content.includes('<h1>safe</h1>'), true);
  }

  const jsonBytes = new TextEncoder().encode('{"url":"https://example.test","ok":true}');
  const jsonEntry = { ...entries[4]!, bytes: jsonBytes.byteLength, sha256: digest(jsonBytes) };
  const jsonProjection = projectPreviewContent(
    previewManifest([jsonEntry]),
    jsonEntry.artifactId,
    jsonBytes,
    jsonBytes.byteLength
  );
  assert.equal(jsonProjection.body.kind, 'text');
  if (jsonProjection.body.kind === 'text') assert.equal(jsonProjection.body.content.includes('https://example.test'), false);
});


test('preview sanitization removes event handlers, remote resources, and dangerous markdown links', () => {
  const htmlBytes = new TextEncoder().encode('<svg/onload=alert(1)><a/href=https://remote.invalid>x</a><img/src=data:text/html,x><h1>safe</h1>');
  const htmlEntry: ArtifactManifestEntry = {
    artifactId: 'san-html', slotId: 'slot', relativePath: 'index.html', mediaType: 'text/html',
    bytes: htmlBytes.byteLength, sha256: digest(htmlBytes), objectVersion: 'v1', classification: 'public-feedback'
  };
  const htmlProjection = projectPreviewContent(previewManifest([htmlEntry]), htmlEntry.artifactId, htmlBytes, htmlBytes.byteLength);
  assert.equal(htmlProjection.body.kind, 'text');
  if (htmlProjection.body.kind === 'text') {
    assert.doesNotMatch(htmlProjection.body.content, /onload|href|src|https:\/\/|data:/i);
    assert.match(htmlProjection.body.content, /<h1>safe<\/h1>/i);
  }

  const markdownBytes = new TextEncoder().encode('[javascript](javascript:alert(1)) [external](//remote.invalid/x) [data](data:text/html,x)');
  const markdownEntry: ArtifactManifestEntry = {
    artifactId: 'san-md', slotId: 'slot', relativePath: 'README.md', mediaType: 'text/markdown',
    bytes: markdownBytes.byteLength, sha256: digest(markdownBytes), objectVersion: 'v1', classification: 'public-feedback'
  };
  const markdownProjection = projectPreviewContent(previewManifest([markdownEntry]), markdownEntry.artifactId, markdownBytes, markdownBytes.byteLength);
  assert.equal(markdownProjection.body.kind, 'text');
  if (markdownProjection.body.kind === 'text') {
    assert.doesNotMatch(markdownProjection.body.content, /javascript:|remote\.invalid|data:/i);
    assert.match(markdownProjection.body.content, /javascript/);
  }
});

test('preview sanitization independently rejects consecutive remote-valued SVG attributes', () => {
  const content = '<svg id="https://remote.invalid/a-long-first-value" filter="//x.invalid/f"><rect width="10" height="10" /></svg>';
  const bytes = new TextEncoder().encode(content);
  const entry: ArtifactManifestEntry = {
    artifactId: 'consecutive-remote-attributes', slotId: 'entry', relativePath: 'index.svg', mediaType: 'image/svg+xml',
    bytes: bytes.byteLength, sha256: digest(bytes), objectVersion: 'v1', classification: 'public-feedback',
  };
  const projection = projectPreviewContent(previewManifest([entry]), entry.artifactId, bytes, bytes.byteLength);
  assert.equal(projection.body.kind, 'text');
  if (projection.body.kind !== 'text') return;
  assert.doesNotMatch(projection.body.content, /remote\.invalid|x\.invalid|https?:\/\/|\/\//i);
  assert.doesNotMatch(projection.body.content, /id=|filter=/i);
  assert.match(projection.body.content, /<rect\b/i);
});

test('animation preview preserves approved CSS and SVG animation while rejecting active content', () => {
  const content = `<!doctype html><html><head><style>
    @keyframes pedal { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
    .wheel { animation: pedal 1s linear infinite; background: url(https://remote.invalid/x); }
    @import url(https://remote.invalid/import.css);
  </style></head><body>
    <svg viewBox="0 0 100 100" onload="alert(1)">
      <circle class="wheel" cx="50" cy="50" r="20"><animate attributeName="opacity" values="1;.5;1" dur="1s" repeatCount="indefinite" /></circle>
      <animate attributeName="href" values="javascript:alert(1)" dur="1s" />
      <foreignObject><iframe src="https://remote.invalid/frame"></iframe></foreignObject>
    </svg><script>alert(1)</script>
  </body></html>`;
  const bytes = new TextEncoder().encode(content);
  const entry: ArtifactManifestEntry = {
    artifactId: 'animated-html', slotId: 'entry', relativePath: 'index.html', mediaType: 'text/html',
    bytes: bytes.byteLength, sha256: digest(bytes), objectVersion: 'v1', classification: 'public-feedback',
  };
  const projection = projectPreviewContent(previewManifest([entry]), entry.artifactId, bytes, bytes.byteLength);
  assert.equal(projection.body.kind, 'text');
  if (projection.body.kind !== 'text') return;
  assert.match(projection.body.content, /@keyframes\s+pedal/i);
  assert.match(projection.body.content, /animation:\s*pedal/i);
  assert.match(projection.body.content, /<animate\b[^>]*attributeName="opacity"/i);
  assert.doesNotMatch(projection.body.content, /<script|onload|foreignObject|iframe|remote\.invalid|javascript:|@import|url\s*\(/i);
  assert.doesNotMatch(projection.body.content, /attributeName="href"/i);
});
