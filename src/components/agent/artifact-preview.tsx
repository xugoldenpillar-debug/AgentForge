'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Braces,
  FileCode2,
  FileJson,
  FileText,
  Image as ImageIcon,
  Pause,
  Play,
  RotateCcw,
  Table2,
} from 'lucide-react';
import { useLocale } from '@/lib/i18n';
import styles from './artifact-preview.module.css';

/**
 * API-shaped, data-only preview types. These mirror the server preview
 * projection without importing server code into the browser bundle.
 */
export type ArtifactPreviewFormat = 'html' | 'css' | 'markdown' | 'svg' | 'json' | 'csv' | 'text' | 'image';
export type ArtifactPreviewRenderer =
  | 'html-sandbox'
  | 'css-text'
  | 'markdown-sanitized'
  | 'svg-animation-sandbox'
  | 'json-tree'
  | 'csv-table'
  | 'plain-text'
  | 'image';

export type ArtifactPreviewProjection = {
  plan: {
    artifactId: string;
    relativePath: string;
    mediaType: string;
    format: ArtifactPreviewFormat;
    renderer: ArtifactPreviewRenderer;
    maxBytes: number;
    allowScripts: false;
    allowRemoteResources: false;
    allowNavigation: false;
    allowForms: false;
    allowPopups: false;
    rawHtmlAllowed: false;
    formulaExecution: false;
  };
  body:
    | { kind: 'text'; content: string }
    | { kind: 'binary'; base64: string };
};

export type ArtifactPreviewFile = {
  artifactId: string;
  relativePath: string;
  bytes: number;
  projection: ArtifactPreviewProjection;
};

type ArtifactPreviewPanelProps = {
  files: readonly ArtifactPreviewFile[];
  heading?: string;
  description?: string;
  sourceLabel?: string;
  emptyMessage?: string;
};

const FORMAT_ICONS: Record<ArtifactPreviewFormat, typeof FileText> = {
  html: FileCode2,
  css: FileCode2,
  markdown: FileText,
  svg: ImageIcon,
  json: FileJson,
  csv: Table2,
  text: FileText,
  image: ImageIcon,
};

const SAFE_IMAGE_MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']);
const MAX_RENDERED_TEXT_CHARS = 100_000;

function formatLabel(format: ArtifactPreviewFormat): string {
  return format === 'markdown' ? 'MD' : format.toUpperCase();
}

function trimPreviewText(value: string, truncatedLabel = 'preview truncated by client'): string {
  return value.length > MAX_RENDERED_TEXT_CHARS
    ? `${value.slice(0, MAX_RENDERED_TEXT_CHARS)}\n\n[${truncatedLabel}]`
    : value;
}

function removeUnsafeMarkup(content: string, svg: boolean): string {
  let safe = content
    .replace(/<\/?(?:script|iframe|object|embed|foreignObject|frame|frameset|base|form|input|button|textarea|select|meta|link)(?:\s[^>]*)?>[\s\S]*?<\/?(?:script|iframe|object|embed|foreignObject|frame|frameset|base|form|input|button|textarea|select|meta|link)\s*>/giu, '')
    .replace(/<\s*\/?(?:script|iframe|object|embed|foreignObject|frame|frameset|base|form|input|button|textarea|select|meta|link)\b[^>]*>/giu, '')
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/giu, '')
    .replace(/\s+(?:href|src|action|formaction|poster)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/giu, (attribute) => {
      return /(?:https?:|ftp:|\/\/|javascript:|vbscript:|data:)/iu.test(attribute) ? '' : attribute;
    })
    .replace(/(?:https?:\/\/|ftp:\/\/|\/\/)[^\s"'<>`]+/giu, '[remote resource removed]')
    .replace(/\b(?:javascript|vbscript|data):[^\s"'<>`]*/giu, '[unsafe scheme removed]');

  if (svg) {
    safe = safe.replace(/<\s*(?:foreignObject|script|iframe|object|embed)\b[^>]*>[\s\S]*?<\s*\/(?:foreignObject|script|iframe|object|embed)\s*>/giu, '');
  }
  return trimPreviewText(safe);
}

function buildSandboxDocument(content: string, format: 'html' | 'svg', paused = false): string {
  let safe = removeUnsafeMarkup(content, format === 'svg');
  if (paused) {
    safe = safe.replace(/<\/?(?:animate|animateMotion|animateTransform|set|mpath)\b[^>]*>/giu, '');
  }
  const policy = "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' blob:; font-src 'none'; connect-src 'none'; script-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
  const pauseRule = paused ? '*,*::before,*::after{animation-play-state:paused!important}' : '';
  const meta = `<meta http-equiv="Content-Security-Policy" content="${policy}"><style>${pauseRule}@media (prefers-reduced-motion: reduce){*,*::before,*::after{animation-play-state:paused!important}svg *{animation-play-state:paused!important}}</style>`;
  if (format === 'svg') {
    return `<!doctype html><html><head><meta charset="utf-8">${meta}</head><body style="margin:0;background:#0b100d;display:grid;place-items:center;min-height:100vh">${safe}</body></html>`;
  }
  if (/<\s*head\b[^>]*>/iu.test(safe)) return safe.replace(/<\s*head\b[^>]*>/iu, (head) => `${head}${meta}`);
  return `<!doctype html><html><head><meta charset="utf-8">${meta}</head><body>${safe}</body></html>`;
}

function cleanMarkdownInline(value: string): string {
  return value
    .replace(/<[^>]*>/g, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(`{1,3})(.*?)\1/g, '$2')
    .replace(/[*_~]/g, '')
    .replace(/(?:https?:\/\/|ftp:\/\/|\/\/)[^\s]+/gi, '[remote link removed]');
}

function MarkdownProjection({ content }: { content: string }) {
  const lines = trimPreviewText(content).split('\n');
  const blocks: ReactNode[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? '';
    if (!line.trim()) {
      index += 1;
      continue;
    }
    if (/^```/u.test(line)) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !/^```/u.test(lines[index] ?? '')) {
        code.push(lines[index] ?? '');
        index += 1;
      }
      index += 1;
      blocks.push(<pre className={styles.code} key={`code-${index}`}>{code.join('\n')}</pre>);
      continue;
    }
    if (/^#{1,3}\s/u.test(line)) {
      const level = Math.min(3, line.match(/^#+/u)?.[0].length ?? 1);
      const Heading = level === 1 ? 'h1' : level === 2 ? 'h2' : 'h3';
      blocks.push(<Heading key={`heading-${index}`}>{cleanMarkdownInline(line.replace(/^#{1,3}\s/u, ''))}</Heading>);
      index += 1;
      continue;
    }
    if (/^[-*]\s/u.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^[-*]\s/u.test(lines[index] ?? '')) {
        items.push(cleanMarkdownInline((lines[index] ?? '').replace(/^[-*]\s/u, '')));
        index += 1;
      }
      blocks.push(<ul key={`list-${index}`}>{items.map((item, itemIndex) => <li key={`${itemIndex}-${item}`}>{item}</li>)}</ul>);
      continue;
    }
    if (/^>\s?/u.test(line)) {
      blocks.push(<blockquote key={`quote-${index}`}>{cleanMarkdownInline(line.replace(/^>\s?/u, ''))}</blockquote>);
      index += 1;
      continue;
    }
    const paragraph: string[] = [line];
    index += 1;
    while (index < lines.length && (lines[index] ?? '').trim() && !/^(?:#{1,3}\s|```|[-*]\s|>\s?)/u.test(lines[index] ?? '')) {
      paragraph.push(lines[index] ?? '');
      index += 1;
    }
    blocks.push(<p key={`paragraph-${index}`}>{cleanMarkdownInline(paragraph.join(' '))}</p>);
  }
  return <div className={styles.markdown}>{blocks}</div>;
}

function JsonValue({ value, depth = 0 }: { value: unknown; depth?: number }): ReactNode {
  if (depth > 6) return <span className={styles.muted}>[depth limit]</span>;
  if (value === null) return <span className={styles.null}>null</span>;
  if (typeof value === 'string') return <span className={styles.string}>"{value}"</span>;
  if (typeof value === 'number' || typeof value === 'boolean') return <span className={styles.number}>{String(value)}</span>;
  if (Array.isArray(value)) {
    return <ol className={styles.tree}>{value.map((item, index) => <li key={index}><JsonValue value={item} depth={depth + 1} /></li>)}</ol>;
  }
  if (value && typeof value === 'object') {
    return <dl className={styles.tree}>{Object.entries(value).map(([key, item]) => <div key={key}><dt>{key}</dt><dd><JsonValue value={item} depth={depth + 1} /></dd></div>)}</dl>;
  }
  return <span className={styles.muted}>unsupported value</span>;
}

function JsonProjection({ content }: { content: string }) {
  try {
    return <div className={styles.json}><JsonValue value={JSON.parse(trimPreviewText(content))} /></div>;
  } catch {
    return <pre className={styles.code}>{trimPreviewText(content)}</pre>;
  }
}

function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (const character of trimPreviewText(content)) {
    if (character === '"') {
      if (quoted && cell.endsWith('"')) cell = cell.slice(0, -1);
      else quoted = !quoted;
    } else if (character === ',' && !quoted) {
      row.push(cell);
      cell = '';
    } else if (character === '\n' && !quoted) {
      row.push(cell.replace(/\r$/u, ''));
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += character;
    }
  }
  if (cell || row.length) {
    row.push(cell.replace(/\r$/u, ''));
    rows.push(row);
  }
  return rows.slice(0, 200).map((current) => current.slice(0, 40));
}

function CsvProjection({ content }: { content: string }) {
  const rows = parseCsv(content);
  if (!rows.length) return <p className={styles.muted}>No CSV rows to preview.</p>;
  const [head, ...body] = rows;
  return <div className={styles.tableWrap}><table className={styles.table}><thead><tr>{head.map((cell, index) => <th key={index}>{cell}</th>)}</tr></thead><tbody>{body.map((row, rowIndex) => <tr key={rowIndex}>{head.map((_, index) => <td key={index}>{row[index] ?? ''}</td>)}</tr>)}</tbody></table></div>;
}

function BinaryProjection({ projection, binaryLabel, disabledLabel }: { projection: ArtifactPreviewProjection; binaryLabel: string; disabledLabel: string }) {
  if (!SAFE_IMAGE_MEDIA_TYPES.has(projection.plan.mediaType.toLowerCase())) {
    return <div className={styles.placeholder}><ImageIcon size={20} /><strong>{binaryLabel}</strong><span>{disabledLabel}</span></div>;
  }
  return <img className={styles.image} src={`data:${projection.plan.mediaType};base64,${projection.body.kind === 'binary' ? projection.body.base64 : ''}`} alt={`${projection.plan.relativePath} preview`} />;
}

function ProjectionBody({ projection, paused, replayKey, binaryLabel, binaryDisabledLabel }: { projection: ArtifactPreviewProjection; paused: boolean; replayKey: number; binaryLabel: string; binaryDisabledLabel: string }) {
  if (projection.body.kind === 'binary') return <BinaryProjection projection={projection} binaryLabel={binaryLabel} disabledLabel={binaryDisabledLabel} />;
  const content = projection.body.content;
  switch (projection.plan.renderer) {
    case 'html-sandbox':
      return <iframe key={`${projection.plan.artifactId}:${paused}:${replayKey}`} className={styles.sandbox} title={`${projection.plan.relativePath} sandboxed preview`} sandbox="" referrerPolicy="no-referrer" srcDoc={buildSandboxDocument(content, 'html', paused)} />;
    case 'svg-animation-sandbox':
      return <iframe key={`${projection.plan.artifactId}:${paused}:${replayKey}`} className={styles.sandbox} title={`${projection.plan.relativePath} isolated preview`} sandbox="" referrerPolicy="no-referrer" srcDoc={buildSandboxDocument(content, 'svg', paused)} />;
    case 'markdown-sanitized':
      return <MarkdownProjection content={content} />;
    case 'json-tree':
      return <JsonProjection content={content} />;
    case 'csv-table':
      return <CsvProjection content={content} />;
    case 'css-text':
    case 'plain-text':
    default:
      return <pre className={styles.code}>{trimPreviewText(content)}</pre>;
  }
}

export function ArtifactPreviewPanel({
  files,
  heading = 'Artifact preview',
  description = 'Data-only projection · no scripts, navigation, forms, popups, or remote resources',
  sourceLabel = 'static / no-script',
  emptyMessage = 'No previewable artifacts are available.',
}: ArtifactPreviewPanelProps) {
  const { t } = useLocale();
  const [selectedId, setSelectedId] = useState(files[0]?.artifactId ?? '');
  const [paused, setPaused] = useState(false);
  const [replayKey, setReplayKey] = useState(0);
  const selected = useMemo(
    () => files.find((file) => file.artifactId === selectedId) ?? files[0],
    [files, selectedId],
  );

  useEffect(() => {
    if (!files.some((file) => file.artifactId === selectedId)) {
      setSelectedId(files[0]?.artifactId ?? '');
      setPaused(false);
      setReplayKey((value) => value + 1);
    }
  }, [files, selectedId]);

  if (!selected) {
    return <section className={styles.panel} aria-label={heading}><div className={styles.header}><div><strong>{heading}</strong><span>{emptyMessage}</span></div></div></section>;
  }

  const PreviewIcon = FORMAT_ICONS[selected.projection.plan.format];
  return (
    <section className={styles.panel} aria-label={heading}>
      <div className={styles.header}>
        <div><strong>{heading}</strong><span>{description}</span></div>
        <span className={styles.source}>{sourceLabel}</span>
      </div>
      <div className={styles.main}>
        <aside className={styles.tree} aria-label="Artifact files">
          <div className={styles.treeTitle}>{t('artifactPreview.files', { count: String(files.length).padStart(2, '0') })}</div>
          <div className={styles.fileList}>
            {files.map((file) => {
              const Icon = FORMAT_ICONS[file.projection.plan.format];
              const active = file.artifactId === selected.artifactId;
              return <button className={`${styles.fileRow} ${active ? styles.active : ''}`} key={file.artifactId} type="button" aria-pressed={active} onClick={() => setSelectedId(file.artifactId)}><Icon size={13} /><span>{file.relativePath}</span><small>{file.bytes} B</small></button>;
            })}
          </div>
        </aside>
        <div className={styles.viewport}>
          <div className={styles.canvas}>
            <div className={styles.canvasHeader}>
              <PreviewIcon size={13} /><span>{selected.relativePath}</span>
              {(selected.projection.plan.renderer === 'html-sandbox' || selected.projection.plan.renderer === 'svg-animation-sandbox') && (
                <div className={styles.animationControls} aria-label={t('artifactPreview.animationControls')}>
                  <button type="button" onClick={() => setPaused((value) => !value)} aria-label={paused ? t('artifactPreview.resume') : t('artifactPreview.pause')}>
                    {paused ? <Play size={12} /> : <Pause size={12} />}<span>{paused ? t('artifactPreview.resume') : t('artifactPreview.pause')}</span>
                  </button>
                  <button type="button" onClick={() => { setPaused(false); setReplayKey((value) => value + 1); }} aria-label={t('artifactPreview.replay')}>
                    <RotateCcw size={12} /><span>{t('artifactPreview.replay')}</span>
                  </button>
                </div>
              )}
              <span className={styles.format}>{formatLabel(selected.projection.plan.format)}</span>
            </div>
            <div className={styles.content}><ProjectionBody projection={selected.projection} paused={paused} replayKey={replayKey} binaryLabel={t('artifactPreview.binary')} binaryDisabledLabel={t('artifactPreview.binaryDisabled')} /></div>
          </div>
        </div>
      </div>
    </section>
  );
}
