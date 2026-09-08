import sanitizeHtml from 'sanitize-html';
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
  svg: 'svg-animation-sandbox',
  json: 'json-tree',
  csv: 'csv-table',
  text: 'plain-text',
  image: 'image'
};

const REMOTE_URL_PATTERN = /(?:https?:\/\/|ftp:\/\/|\/\/)[^\s"'<>`]+/gi;
const REMOTE_URL_TEST_PATTERN = /(?:https?:\/\/|ftp:\/\/|\/\/)[^\s"'<>`]+/i;
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

const SAFE_ANIMATED_ATTRIBUTES = new Set([
  'cx', 'cy', 'd', 'fill', 'fill-opacity', 'height', 'opacity', 'points', 'r', 'rx', 'ry',
  'stroke', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-opacity', 'stroke-width',
  'transform', 'viewbox', 'width', 'x', 'x1', 'x2', 'y', 'y1', 'y2',
]);

const ALLOWED_MARKUP_TAGS = [
  'html', 'head', 'body', 'main', 'section', 'article', 'div', 'span', 'p', 'h1', 'h2', 'h3',
  'svg', 'g', 'defs', 'symbol', 'use', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline',
  'polygon', 'text', 'tspan', 'clipPath', 'mask', 'linearGradient', 'radialGradient', 'stop',
  'filter', 'feGaussianBlur', 'feOffset', 'feColorMatrix', 'feBlend', 'style',
  'animate', 'animateMotion', 'animateTransform', 'set', 'mpath',
];

const GLOBAL_ATTRIBUTES = [
  'id', 'class', 'role', 'aria-label', 'viewBox', 'xmlns', 'width', 'height', 'x', 'y', 'x1', 'x2',
  'y1', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'd', 'points', 'fill', 'fill-opacity', 'stroke',
  'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset',
  'stroke-opacity', 'opacity', 'transform', 'transform-origin', 'preserveAspectRatio', 'clip-path',
  'mask', 'filter', 'offset', 'stop-color', 'stop-opacity', 'font-size', 'font-family',
  'font-weight', 'text-anchor', 'dominant-baseline', 'style',
];

const ANIMATION_ATTRIBUTES = [
  'attributeName', 'attributeType', 'begin', 'by', 'calcMode', 'dur', 'end', 'fill', 'from',
  'keyPoints', 'keySplines', 'keyTimes', 'path', 'repeatCount', 'repeatDur', 'restart', 'rotate',
  'to', 'type', 'values', 'additive', 'accumulate', 'href', 'xlink:href',
];

// sanitize-html preserves SVG tag case when lowerCaseTags is disabled, but
// parser versions and HTML inputs may still expose the lower-case spelling.
// Keep both spellings mapped to the same declaration so motion attributes are
// never silently removed just because the parser normalized the tag name.
const ANIMATION_ATTRIBUTE_ALLOWLIST = {
  animate: ANIMATION_ATTRIBUTES,
  animateMotion: ANIMATION_ATTRIBUTES,
  animateTransform: ANIMATION_ATTRIBUTES,
  animatemotion: ANIMATION_ATTRIBUTES,
  animatetransform: ANIMATION_ATTRIBUTES,
  set: ANIMATION_ATTRIBUTES,
};

function sanitizeMarkup(input: string, svg: boolean): string {
  const withSafeStyles = input.replace(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/giu, (_match, css: string) => {
    return `<style>${sanitizeCss(css)}</style>`;
  });
  return sanitizeHtml(withSafeStyles, {
    allowedTags: ALLOWED_MARKUP_TAGS,
    allowVulnerableTags: true,
    allowedAttributes: {
      '*': GLOBAL_ATTRIBUTES,
      ...ANIMATION_ATTRIBUTE_ALLOWLIST,
      use: ['href', 'xlink:href'],
      mpath: ['href', 'xlink:href'],
    },
    allowedSchemes: [],
    allowProtocolRelative: false,
    parser: { lowerCaseTags: false, lowerCaseAttributeNames: false },
    transformTags: {
      '*': (tagName, attributes) => ({ tagName, attribs: sanitizeMarkupAttributes(attributes, tagName) }),
    },
    exclusiveFilter(frame) {
      const lower = frame.tag.toLowerCase();
      if (!svg && lower === 'svg') return false;
      if (!['animate', 'animatemotion', 'animatetransform', 'set'].includes(lower)) return false;
      const target = String(frame.attribs.attributeName ?? frame.attribs.attributename ?? '').toLowerCase();
      return lower !== 'animatemotion' && !SAFE_ANIMATED_ATTRIBUTES.has(target);
    },
    disallowedTagsMode: 'discard',
    textFilter: (text) => redactRemoteUrls(text),
  }).replace(/<!--[^]*?-->/gu, '');
}

function sanitizeMarkupAttributes(attributes: Record<string, string>, tagName: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, raw] of Object.entries(attributes)) {
    const lower = name.toLowerCase();
    if (lower.startsWith('on') || ['src', 'srcset', 'action', 'formaction', 'poster', 'srcdoc', 'background', 'manifest', 'ping'].includes(lower)) continue;
    if (lower === 'href' || lower === 'xlink:href') {
      if (!raw.startsWith('#') || !/#[A-Za-z_][A-Za-z0-9_.:-]*$/u.test(raw)) continue;
    }
    if (lower === 'style') {
      const css = sanitizeInlineStyle(raw);
      if (css) result[name] = css;
      continue;
    }
    if (['attributeName', 'attributename'].includes(name) && !SAFE_ANIMATED_ATTRIBUTES.has(raw.toLowerCase())) continue;
    if (/\b(?:javascript|vbscript|data):/iu.test(raw) || REMOTE_URL_TEST_PATTERN.test(raw)) continue;
    result[name] = raw.slice(0, 4096);
  }
  if (['script', 'iframe', 'object', 'embed', 'foreignobject', 'form', 'meta', 'link', 'base'].includes(tagName.toLowerCase())) return {};
  return result;
}

function sanitizeInlineStyle(input: string): string {
  return input.split(';').map((declaration) => declaration.trim()).filter(Boolean).flatMap((declaration) => {
    const separator = declaration.indexOf(':');
    if (separator <= 0) return [];
    const property = declaration.slice(0, separator).trim().toLowerCase();
    const value = declaration.slice(separator + 1).trim();
    const allowed = /^(?:animation(?:-[a-z-]+)?|transform(?:-origin)?|opacity|fill|fill-opacity|stroke|stroke-width|stroke-opacity|stroke-dasharray|stroke-dashoffset|visibility)$/u.test(property);
    if (!allowed || unsafeCss(value)) return [];
    return [`${property}:${value.slice(0, 1024)}`];
  }).join(';');
}

function unsafeCss(value: string): boolean {
  return /(?:url\s*\(|@import|@font-face|expression\s*\(|behavior\s*:|-moz-binding|javascript:|vbscript:|data:|https?:|\/\/)/iu.test(value);
}

function sanitizeCss(input: string): string {
  return input
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/@(?:import|font-face|namespace|document|supports)\b[^;{]*(?:;|\{[\s\S]*?\})/giu, '')
    .replace(/url\s*\([^)]*\)/giu, '')
    .replace(/expression\s*\([^)]*\)/giu, '')
    .replace(/(?:behavior\s*:|-moz-binding\s*:)[^;}]+/giu, '')
    .replace(/\b(?:javascript|vbscript|data):/giu, '')
    .replace(REMOTE_URL_PATTERN, '')
    .slice(0, 100_000);
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
