import { AppError, ERROR_CODES, ensure } from '../../shared/errors.ts';
import { validateBoundedLimit } from '../sandbox/path-policy.ts';
import { digestArtifactBytes, isArtifactDigest } from './integrity.ts';
import type { ArtifactCollectionManifest, ArtifactCollectionManifestEntry, PreviewContentProjection, PreviewFormat, PreviewProjection, PreviewRenderer } from './types.ts';
import { assertArtifactManifestIntegrity } from './integrity.ts';

const FORMAT_BY_MEDIA_TYPE: Readonly<Record<string, PreviewFormat>> = {
  'text/html': 'html',
  'application/xhtml+xml': 'html',
  'text/css': 'css',
  'text/markdown': 'markdown',
  'text/x-markdown': 'markdown',
  'image/svg+xml': 'svg',
  'application/json': 'json',
  'text/csv': 'csv',
  'text/plain': 'text'
};

const RENDERER_BY_FORMAT: Readonly<Record<PreviewFormat, PreviewRenderer>> = {
  html: 'html-sandbox',
  css: 'css-text',
  markdown: 'markdown-sanitized',
  svg: 'svg-rasterized',
  json: 'json-tree',
  csv: 'csv-table',
  text: 'plain-text',
  image: 'image'
};

const REMOTE_URL_PATTERN = /(?:https?:\/\/|ftp:\/\/|\/\/)[^\s"'<>`]+/gi;
const DANGEROUS_SCHEME_PATTERN = /\b(?:javascript|vbscript|data):/gi;

export function planPreview(entry: ArtifactCollectionManifestEntry): PreviewProjection | null {
  const format = inferPreviewFormat(entry);
  if (format === null) return null;
  const renderer = RENDERER_BY_FORMAT[format];
  return {
    artifactId: entry.artifactId,
    relativePath: entry.relativePath,
    mediaType: entry.mediaType,
    format,
    renderer,
    maxBytes: entry.bytes,
    allowScripts: false,
    allowRemoteResources: false,
    allowNavigation: false,
    allowForms: false,
    allowPopups: false,
    rawHtmlAllowed: false,
    formulaExecution: false
  };
}

/** Returns only a renderer policy. It never returns a URL, host path, or executable content. */
export function projectPreview(manifest: { readonly entries: readonly ArtifactCollectionManifestEntry[] }, artifactId: string, maxBytes: number): PreviewProjection {
  const entry = findEntry(manifest.entries, artifactId);
  ensure(entry.classification !== 'hidden', 'This artifact is not available for preview.', 404, ERROR_CODES.RESOURCE_NOT_FOUND);
  const projection = planPreview(entry);
  ensure(projection !== null, 'This artifact format cannot be previewed safely.', 415, ERROR_CODES.REQUEST_VALIDATION_FAILED);
  validateBoundedLimit(maxBytes, entry.bytes, 'preview read limit');
  return { ...projection, maxBytes };
}

/**
 * Converts sealed bytes to a renderer-specific, data-only projection.
 * This function intentionally strips executable markup and all remote resource references.
 */
export function projectPreviewContent(
  manifest: ArtifactCollectionManifest,
  artifactId: string,
  bytes: Uint8Array,
  maxBytes: number
): PreviewContentProjection {
  assertArtifactManifestIntegrity(manifest);
  const entry = findEntry(manifest.entries, artifactId);
  ensure(entry.classification !== 'hidden', 'This artifact is not available for preview.', 404, ERROR_CODES.RESOURCE_NOT_FOUND);
  const plan = projectPreview(manifest, artifactId, maxBytes);
  ensure(bytes instanceof Uint8Array, 'Preview bytes are invalid.', 409, ERROR_CODES.RUNTIME_POLICY_DENIED);
  ensure(bytes.byteLength === entry.bytes, 'Preview bytes do not match the sealed artifact.', 409, ERROR_CODES.RUNTIME_POLICY_DENIED);
  ensure(isArtifactDigest(entry.sha256) && digestArtifactBytes(bytes) === entry.sha256, 'Preview artifact integrity check failed.', 409, ERROR_CODES.RUNTIME_POLICY_DENIED);
  ensure(bytes.byteLength <= maxBytes, 'Preview bytes exceed the permitted limit.', 413, ERROR_CODES.REQUEST_BODY_TOO_LARGE);
  if (plan.format === 'image') {
    return { plan, body: { kind: 'binary', base64: Buffer.from(bytes).toString('base64') } };
  }

  const text = decodeText(bytes);
  const content = projectText(plan.format, text);
  return { plan, body: { kind: 'text', content } };
}

function findEntry(entries: readonly ArtifactCollectionManifestEntry[], artifactId: string): ArtifactCollectionManifestEntry {
  ensure(typeof artifactId === 'string' && artifactId.length > 0, 'Preview artifact id is required.', 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
  const entry = entries.find((candidate) => candidate.artifactId === artifactId);
  ensure(entry !== undefined, 'Preview artifact not found.', 404, ERROR_CODES.RESOURCE_NOT_FOUND);
  return entry;
}

function inferPreviewFormat(entry: ArtifactCollectionManifestEntry): PreviewFormat | null {
  const mediaType = entry.mediaType.toLocaleLowerCase('en-US').split(';', 1)[0];
  const knownFormat = FORMAT_BY_MEDIA_TYPE[mediaType];
  if (knownFormat !== undefined) return knownFormat;
  if (mediaType.startsWith('image/') && mediaType !== 'image/svg+xml') return 'image';
  const extension = entry.relativePath.toLocaleLowerCase('en-US').split('.').pop() ?? '';
  if (extension === 'md' || extension === 'markdown') return 'markdown';
  if (['txt', 'log', 'ts', 'tsx', 'js', 'jsx', 'py', 'jsonl', 'yaml', 'yml'].includes(extension)) return 'text';
  if (extension === 'csv') return 'csv';
  if (extension === 'html' || extension === 'htm') return 'html';
  if (extension === 'css') return 'css';
  if (extension === 'svg') return 'svg';
  return null;
}

function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new AppError('Preview text is not valid UTF-8.', 415, ERROR_CODES.REQUEST_VALIDATION_FAILED);
  }
}

function projectText(format: PreviewFormat, text: string): string {
  switch (format) {
    case 'html':
      return sanitizeMarkup(text, false);
    case 'svg':
      return sanitizeMarkup(text, true);
    case 'css':
      return sanitizeCss(text);
    case 'markdown':
      return sanitizeMarkdown(text);
    case 'json':
      return sanitizeJson(text);
    case 'csv':
    case 'text':
      return redactRemoteUrls(text);
    case 'image':
      throw new AppError('Binary images do not have a text projection.', 415, ERROR_CODES.REQUEST_VALIDATION_FAILED);
  }
}

function sanitizeMarkup(input: string, svg: boolean): string {
  let output = input
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\s*script\b[^>]*>[\s\S]*?<\s*\/\s*script\s*>/gi, '')
    .replace(/<\s*(?:iframe|object|embed|applet|form|base|meta|link|style|template)\b[^>]*>[\s\S]*?<\s*\/\s*(?:iframe|object|embed|applet|form|base|meta|link|style|template)\s*>/gi, '')
    .replace(/<\s*(?:script|iframe|object|embed|applet|form|base|meta|link|style|template)\b[^>]*\/?>/gi, '')
    // A slash is accepted by the HTML tokenizer before an attribute name
    // (`<svg/onload=...>`). Treat it as an attribute boundary as well as
    // whitespace; otherwise event/resource attributes can survive this pass.
    .replace(/(?:[\s/])+on[a-z0-9:_-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    // Remove every fetch/navigation-capable attribute instead of trying to
    // classify its value. This keeps entity/whitespace/encoding tricks from
    // reaching an HTML or SVG renderer.
    .replace(/(?:[\s/])+(?:href|src|srcset|imagesrcset|action|formaction|poster|xlink:href|srcdoc|background|manifest|ping)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(?:[\s/])+style\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  if (svg) {
    output = output
      .replace(/<\s*(?:foreignObject|animate|animateMotion|animateTransform|set|style)\b[^>]*>[\s\S]*?<\s*\/\s*(?:foreignObject|animate|animateMotion|animateTransform|set|style)\s*>/gi, '')
      .replace(/<\s*(?:foreignObject|animate|animateMotion|animateTransform|set|style)\b[^>]*\/?>/gi, '');
  }
  return redactRemoteUrls(output);
}

function sanitizeCss(input: string): string {
  return redactRemoteUrls(input)
    .replace(/@import\s+(?:url\([^)]*\)|[^;]+);?/gi, '')
    .replace(/url\s*\([^)]*\)/gi, 'url("[blocked-resource]")')
    .replace(/expression\s*\([^)]*\)/gi, '[blocked-expression]');
}

function sanitizeMarkdown(input: string): string {
  // Keep ordinary Markdown text/formatting, but escape all link/image
  // delimiters after removing raw HTML. Reference links and nested
  // destinations then render as literal text rather than an actionable URL.
  return redactRemoteUrls(input)
    .replace(/<[^>]*>/g, '')
    .replace(/([\[\]\(\)])/g, '\\$1');
}

function sanitizeJson(input: string): string {
  try {
    const parsed: unknown = JSON.parse(input);
    return JSON.stringify(redactJsonValue(parsed), null, 2);
  } catch {
    return redactRemoteUrls(input);
  }
}

function redactJsonValue(value: unknown): unknown {
  if (typeof value === 'string') return redactRemoteUrls(value);
  if (Array.isArray(value)) return value.map((item) => redactJsonValue(item));
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) result[key] = redactJsonValue(source[key]);
    return result;
  }
  return value;
}

function redactRemoteUrls(input: string): string {
  return input
    .replace(DANGEROUS_SCHEME_PATTERN, '[blocked-scheme]:')
    .replace(REMOTE_URL_PATTERN, '[blocked-url]');
}
