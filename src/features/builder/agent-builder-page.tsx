'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  FileCode2,
  FileJson,
  FileText,
  Lock,
  Maximize2,
  Play,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  TimerOff,
  Workflow,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/common';
import { ArtifactPreviewPanel, type ArtifactPreviewFile, type ArtifactPreviewFormat, type ArtifactPreviewRenderer } from '@/components/agent/artifact-preview';
import { cn } from '@/lib/utils';
import {
  compileAgentCanvas,
  digestAgentCanvas,
  serializeAgentCanvas,
  validateAgentCanvas,
  type AgentCanvasNode,
  type AgentConfigValue,
} from '@/lib/agent-builder-canvas';
import {
  AGENT_BUILDER_PANELS,
  agentBuilderPanelLabel,
  type AgentBuilderPanel,
} from '@/lib/agent-builder-view';
import {
  DEFAULT_AGENT_CANVAS,
  agentCanvasForFlow,
  agentConfigValue,
  useAgentBuilderStore,
} from './agent-store';
import { AgentCanvas, AgentNodePalette } from './agent-canvas';
import styles from './agent-builder.module.css';

const UI_ENABLED = process.env.NEXT_PUBLIC_AGENT_BUILDER_UI !== 'false';

type Fixture = {
  artifactId: string;
  relativePath: string;
  bytes: number;
  format: ArtifactPreviewFormat;
  renderer: ArtifactPreviewRenderer;
  mediaType: string;
  content: string;
};

const FIXTURE_FILES: readonly Fixture[] = [
  {
    artifactId: 'fixture-index-html',
    relativePath: 'index.html',
    bytes: 1842,
    format: 'html',
    renderer: 'html-sandbox',
    mediaType: 'text/html',
    content: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Pelican on a bicycle</title>
    <style>
      :root { color-scheme: dark; font-family: system-ui, sans-serif; }
      body { min-height: 100vh; margin: 0; display: grid; place-items: center; background: #111827; color: #f8fafc; }
      main { width: min(620px, 86vw); padding: 32px; border: 1px solid #475569; border-radius: 22px; background: #1e293b; text-align: center; }
      .scene { margin: 22px auto; font-size: clamp(70px, 14vw, 130px); letter-spacing: .1em; }
      p { color: #cbd5e1; line-height: 1.6; }
    </style>
  </head>
  <body>
    <main>
      <div class="scene" role="img" aria-label="A pelican riding a bicycle">🦩 🚲</div>
      <h1>Pedal-powered confidence</h1>
      <p>Static local preview. No Pi run or saved backend artifact is connected.</p>
    </main>
  </body>
</html>`,
  },
  {
    artifactId: 'fixture-readme-md',
    relativePath: 'README.md',
    bytes: 612,
    format: 'markdown',
    renderer: 'markdown-sanitized',
    mediaType: 'text/markdown',
    content: `# Pelican bicycle / handoff

## What this demonstrates

- A self-contained HTML artifact
- A readable handoff for the next builder
- A preview boundary that does not execute untrusted JavaScript

> This is a local fixture for the Agent Builder UI. It is not a Pi run or a saved backend artifact.
`,
  },
  {
    artifactId: 'fixture-summary-json',
    relativePath: 'summary.json',
    bytes: 328,
    format: 'json',
    renderer: 'json-tree',
    mediaType: 'application/json',
    content: `{
  "entrypoint": "index.html",
  "requiredFiles": ["index.html", "README.md"],
  "previewPolicy": "static-no-script",
  "runtime": "pi",
  "status": "fixture-only"
}`,
  },
  {
    artifactId: 'fixture-scene-svg',
    relativePath: 'scene.svg',
    bytes: 978,
    format: 'svg',
    renderer: 'svg-rasterized',
    mediaType: 'image/svg+xml',
    content: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 320">
  <rect width="640" height="320" rx="24" fill="#172033"/>
  <circle cx="210" cy="238" r="48" fill="none" stroke="#b7e778" stroke-width="8"/>
  <circle cx="434" cy="238" r="48" fill="none" stroke="#b7e778" stroke-width="8"/>
  <path d="M210 238h112l-44-86h116l40 86M278 152l-26-42m124 42 26-42" fill="none" stroke="#f8fafc" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
  <text x="320" y="82" fill="#f8fafc" font-size="34" text-anchor="middle">static artifact preview</text>
</svg>`,
  },
  {
    artifactId: 'fixture-data-csv',
    relativePath: 'checks.csv',
    bytes: 164,
    format: 'csv',
    renderer: 'csv-table',
    mediaType: 'text/csv',
    content: `check,status,detail
required files,ready,index.html and README.md present
network,disabled,fixture never makes a remote request
execution,pending,Pi and sandbox are unavailable`,
  },
  {
    artifactId: 'fixture-notes-txt',
    relativePath: 'notes.txt',
    bytes: 128,
    format: 'text',
    renderer: 'plain-text',
    mediaType: 'text/plain',
    content: 'Preview content is a data-only projection.\nThe local UI never executes generated scripts.',
  },
];

function toPreviewFile(fixture: Fixture): ArtifactPreviewFile {
  return {
    artifactId: fixture.artifactId,
    relativePath: fixture.relativePath,
    bytes: fixture.bytes,
    projection: {
      plan: {
        artifactId: fixture.artifactId,
        relativePath: fixture.relativePath,
        mediaType: fixture.mediaType,
        format: fixture.format,
        renderer: fixture.renderer,
        maxBytes: fixture.bytes,
        allowScripts: false,
        allowRemoteResources: false,
        allowNavigation: false,
        allowForms: false,
        allowPopups: false,
        rawHtmlAllowed: false,
        formulaExecution: false,
      },
      body: { kind: 'text', content: fixture.content },
    },
  };
}

const PREVIEW_FILES = FIXTURE_FILES.map(toPreviewFile);

function capabilityPermission(capability: string): string {
  return {
    'workspace.read': 'read-only',
    'workspace.write': 'scoped-workspace-only',
    'artifact.write': 'scoped-output-only',
    'preview.static': 'static-only',
    'network.none': 'none',
  }[capability] ?? 'scoped-output-only';
}

function configField(node: { data: { config: AgentCanvasNode['config'] } }, key: string): string {
  return agentConfigValue(node.data.config[key]);
}

function Inspector() {
  const nodes = useAgentBuilderStore((state) => state.nodes);
  const selectedId = useAgentBuilderStore((state) => state.selectedId);
  const update = useAgentBuilderStore((state) => state.update);
  const remove = useAgentBuilderStore((state) => state.remove);
  const node = nodes.find((item) => item.id === selectedId);

  if (!node) {
    return (
      <aside className={cn(styles.panel, styles.inspector)} data-panel="configure" aria-label="Agent configuration">
        <div className={styles.panelHeader}><span className={styles.panelTitle}>Configure</span></div>
        <div className={styles.emptyInspector}><div><SlidersHorizontal size={24} /><p>Select a node to inspect its draft configuration.</p></div></div>
      </aside>
    );
  }

  const updateConfig = (key: string, value: AgentConfigValue) => update(node.id, { [key]: value });
  const kind = node.data.kind;
  return (
    <aside className={cn(styles.panel, styles.inspector)} data-panel="configure" aria-label="Agent configuration">
      <div className={styles.panelHeader}>
        <div><span className={styles.panelTitle}>Configure</span><div className={styles.panelHint}>Draft-only · changes do not grant runtime access</div></div>
        <span className={styles.edgeChip}>v1</span>
      </div>
      <div className={styles.inspectorBody}>
        <div className={styles.selectedHeading}>
          <span className={styles.selectedIcon}><Workflow size={14} /></span>
          <div><strong>{node.data.label}</strong><span>{kind}</span></div>
        </div>
        <div className={styles.field}>
          <label htmlFor="agent-node-name">Node label</label>
          <input id="agent-node-name" value={node.data.label} maxLength={120} onChange={(event) => update(node.id, {}, event.target.value)} />
        </div>

        {kind === 'task' && <>
          <div className={styles.field}><label htmlFor="agent-task-brief">Brief</label><textarea id="agent-task-brief" value={configField(node, 'brief')} onChange={(event) => updateConfig('brief', event.target.value)} /></div>
          <div className={styles.field}><label htmlFor="agent-task-profile">Profile reference</label><input id="agent-task-profile" value={configField(node, 'profileRef')} onChange={(event) => updateConfig('profileRef', event.target.value)} /></div>
        </>}
        {kind === 'agent' && <>
          <div className={styles.field}><label htmlFor="agent-instructions">Instructions</label><textarea id="agent-instructions" value={configField(node, 'instructions')} onChange={(event) => updateConfig('instructions', event.target.value)} /></div>
          <div className={styles.field}><label htmlFor="agent-runtime">Runtime</label><input id="agent-runtime" disabled value="pi (unavailable)" /></div>
          <div className={styles.field}><label htmlFor="agent-policy">Policy version</label><input id="agent-policy" value={configField(node, 'policyVersion')} onChange={(event) => updateConfig('policyVersion', event.target.value)} /></div>
          <p className={styles.helper}>The runtime field is displayed for intent only. This page never starts Pi.</p>
        </>}
        {kind === 'model' && <>
          <div className={styles.field}><label htmlFor="agent-model-provider">Provider lane</label><input id="agent-model-provider" value={configField(node, 'provider')} onChange={(event) => updateConfig('provider', event.target.value)} /></div>
          <div className={styles.field}><label htmlFor="agent-model-id">Model reference</label><input id="agent-model-id" value={configField(node, 'modelId')} onChange={(event) => updateConfig('modelId', event.target.value)} /></div>
          <div className={styles.field}><label htmlFor="agent-model-version">Catalog version</label><input id="agent-model-version" value={configField(node, 'modelVersion')} onChange={(event) => updateConfig('modelVersion', event.target.value)} /></div>
          <p className={styles.helper}>The UI records references only; it never probes paid models or stores credentials.</p>
        </>}
        {kind === 'skill' && <>
          <div className={styles.field}><label htmlFor="agent-skill-id">Skill reference</label><input id="agent-skill-id" value={configField(node, 'skillId')} onChange={(event) => updateConfig('skillId', event.target.value)} /></div>
          <div className={styles.field}><label htmlFor="agent-skill-version">Version</label><input id="agent-skill-version" value={configField(node, 'versionId')} onChange={(event) => updateConfig('versionId', event.target.value)} /></div>
          <p className={styles.helper}>Only declarative, version-pinned skills are represented in this slice.</p>
        </>}
        {kind === 'environment' && <>
          <div className={styles.field}><label htmlFor="agent-environment-template">Fixed template</label><select id="agent-environment-template" disabled value={configField(node, 'templateId')}><option value="static-preview">static-preview</option></select></div>
          <div className={styles.field}><label htmlFor="agent-environment-version">Version</label><input id="agent-environment-version" disabled value={configField(node, 'versionId')} /></div>
          <div className={styles.field}><label htmlFor="agent-environment-network">Network</label><input id="agent-environment-network" disabled value="disabled" /></div>
          <p className={styles.helper}>Environment permissions are fixed by the approved template. Canvas edges cannot change them at runtime.</p>
        </>}
        {kind === 'inputMount' && <>
          <div className={styles.field}><label htmlFor="agent-input-mount">Mount reference</label><input id="agent-input-mount" value={configField(node, 'mountId')} onChange={(event) => updateConfig('mountId', event.target.value)} /></div>
          <div className={styles.field}><label htmlFor="agent-input-source">Source kind</label><input id="agent-input-source" value={configField(node, 'sourceKind')} onChange={(event) => updateConfig('sourceKind', event.target.value)} /></div>
          <label className="flex items-center gap-2 small muted"><input type="checkbox" checked={node.data.config.readOnly === true} disabled /> read-only input (fixed)</label>
        </>}
        {kind === 'capability' && <>
          <div className={styles.field}><label htmlFor="agent-capability-id">Capability request</label><select id="agent-capability-id" value={configField(node, 'capabilityId')} onChange={(event) => updateConfig('capabilityId', event.target.value)}><option value="artifact.write">artifact.write</option><option value="workspace.read">workspace.read</option><option value="workspace.write">workspace.write</option><option value="preview.static">preview.static</option><option value="network.none">network.none</option></select></div>
          <div className={styles.field}><label htmlFor="agent-capability-permission">Scope</label><input id="agent-capability-permission" disabled value={capabilityPermission(configField(node, 'capabilityId'))} /></div>
          <p className={styles.helper}>A capability node is a request, not a grant. The server must intersect it with the environment policy.</p>
        </>}
        {kind === 'outputContract' && <>
          <div className={styles.field}><label htmlFor="agent-output-format">Output formats</label><select id="agent-output-format" value={configField(node, 'format')} onChange={(event) => updateConfig('format', event.target.value)}><option value="html+md">HTML + Markdown</option><option value="json">JSON</option><option value="svg">SVG</option><option value="csv">CSV</option></select></div>
          <div className={styles.field}><label htmlFor="agent-output-entrypoint">Entrypoint</label><input id="agent-output-entrypoint" value={configField(node, 'entrypoint')} onChange={(event) => updateConfig('entrypoint', event.target.value)} /></div>
          <div className={styles.field}><label htmlFor="agent-output-files">Required files</label><input id="agent-output-files" value={configField(node, 'requiredFiles')} onChange={(event) => updateConfig('requiredFiles', event.target.value.split(',').map((item) => item.trim()).filter(Boolean))} /></div>
        </>}

        <div className="divider" />
        <Button variant="destructive" size="sm" type="button" onClick={() => remove(node.id)}><Icon name="Trash2" size={12} /> Remove node</Button>
      </div>
    </aside>
  );
}

function PalettePanel() {
  return (
    <aside className={cn(styles.panel, styles.palette)} data-panel="palette" aria-label="Agent node palette">
      <div className={styles.paletteIntro}>
        <div className={styles.panelTitle}>Agent nodes</div>
        <p>Compose intent and approved capabilities. Edges are not execution order.</p>
      </div>
      <div className={styles.paletteList}><AgentNodePalette /></div>
      <div className={styles.fixedNote}><ShieldCheck size={13} /><span>Fixed environment: static preview / v1 · no network · scoped output only.</span></div>
    </aside>
  );
}

function RunStatusPanel({ valid, compileErrors }: { valid: boolean; compileErrors: readonly string[] }) {
  return (
    <section className={cn(styles.panel, styles.runStatus)} data-panel="run" aria-label="Run status">
      <div className={styles.panelHeader}>
        <div><span className={styles.panelTitle}>Run status</span><div className={styles.panelHint}>Execution is intentionally unavailable in this front-end slice</div></div>
        <span className={styles.statusChip}><TimerOff size={10} /> unavailable</span>
      </div>
      <div className={styles.runBody}>
        <div className={styles.runState}><Lock size={17} /><div><strong>No run started</strong><span>There is no backend Attempt, Pi process, or sealed Artifact Bundle to report.</span></div></div>
        <div className={styles.timeline}>
          <div className={styles.timelineItem}><span className={styles.timelineDot} /><div><strong>Local draft</strong><span>Canvas editing and semantic validation are available.</span></div></div>
          <div className={styles.timelineItem}><span className={styles.timelineDotMuted} /><div><strong>Agent B2 save</strong><span>Unavailable · no request is sent.</span></div></div>
          <div className={styles.timelineItem}><span className={styles.timelineDotMuted} /><div><strong>Pi + sandbox run</strong><span>Unavailable · no process is started.</span></div></div>
          <div className={styles.timelineItem}><span className={styles.timelineDotMuted} /><div><strong>Artifact sealing</strong><span>{valid ? 'Waiting for a real run.' : `${compileErrors.length} validation issue(s) block a future run.`}</span></div></div>
        </div>
      </div>
    </section>
  );
}

export function AgentBuilderPage() {
  const [mobilePanel, setMobilePanel] = useState<AgentBuilderPanel>('canvas');
  const [digest, setDigest] = useState('calculating…');
  const nodes = useAgentBuilderStore((state) => state.nodes);
  const edges = useAgentBuilderStore((state) => state.edges);
  const notice = useAgentBuilderStore((state) => state.notice);
  const load = useAgentBuilderStore((state) => state.load);
  const canvas = useMemo(() => agentCanvasForFlow(nodes, edges), [nodes, edges]);
  const validation = useMemo(() => validateAgentCanvas(canvas), [canvas]);
  const compileResult = useMemo(() => compileAgentCanvas(canvas), [canvas]);
  const serializedLength = serializeAgentCanvas(canvas).length;

  useEffect(() => {
    if (!useAgentBuilderStore.getState().nodes.length) load(DEFAULT_AGENT_CANVAS);
  }, [load]);

  useEffect(() => {
    let active = true;
    void digestAgentCanvas(canvas).then((value) => { if (active) setDigest(value); });
    return () => { active = false; };
  }, [canvas]);

  if (!UI_ENABLED) {
    return (
      <main className={styles.shell}>
        <div className={styles.callout}><AlertTriangle size={15} /><div><strong>Agent Builder is disabled.</strong><br />Set <code>NEXT_PUBLIC_AGENT_BUILDER_UI=true</code> to enable the local design slice. This flag does not enable Pi, sandbox, save, or run capabilities.</div></div>
      </main>
    );
  }

  const compileErrors = compileResult.valid ? [] : compileResult.errors;
  return (
    <main className={styles.shell}>
      <div className={styles.topbar}>
        <Link href="/" className={styles.brandLink}>← AgentForge / Builder</Link>
        <div className={styles.statusRow}>
          <span className={styles.statusChip}><Lock size={10} /> local draft</span>
          <span className={styles.statusChip}><Sparkles size={10} /> B2 unavailable</span>
          <span className={styles.statusChip}><TimerOff size={10} /> Pi unavailable</span>
          <span className={styles.statusChip}><ShieldCheck size={10} /> fixed environment</span>
        </div>
      </div>

      <div className={styles.titleRow}>
        <div><div className="eyebrow">AA-T5 / AA-T9</div><h1 className={styles.title}>Build an agent. Preview the handoff.</h1><p className={styles.description}>A separate Agent canvas for Task, Agent, Model, Skill, Environment, Input Mount, Capability, and Output Contract configuration. The current slice is local-only until backend contracts and sandbox Gates are available.</p></div>
      </div>

      <div className={styles.callout} role="status"><AlertTriangle size={15} /><div><strong>Design mode only.</strong> Save and Run stay disabled because configured Agent B2, Pi → Evaluation Foundation execution, and Artifact Bundle APIs are not connected. Editing this canvas cannot grant permissions, start a process, or claim a real model result.</div></div>

      <div className={styles.toolbar}>
        <div className={styles.toolbarInfo}><CheckCircle2 size={13} className={validation.valid ? 'accent' : 'danger'} /><strong>{validation.valid ? 'Canvas contract valid' : `${validation.errors.length} canvas issue(s)`}</strong><span>·</span><span>{nodes.length} nodes / {edges.length} config edges</span><span>·</span><span>{serializedLength} B</span></div>
        <div className={styles.toolbarActions}><Button variant="outline" size="sm" disabled title="Agent Builder backend contract is not connected"><Save size={13} /> Save draft</Button><Button variant="default" size="sm" disabled title="Pi runtime and sandbox are not connected"><Play size={13} /> Run</Button></div>
      </div>

      <div className={styles.tabList} role="tablist" aria-label="Agent Builder panels">
        {AGENT_BUILDER_PANELS.map((panel) => <button key={panel} type="button" role="tab" aria-selected={mobilePanel === panel} className={cn(styles.tab, mobilePanel === panel && styles.tabActive)} onClick={() => setMobilePanel(panel)}>{agentBuilderPanelLabel(panel)}</button>)}
      </div>

      <div className={styles.workspace} data-mobile-tab={mobilePanel}>
        <PalettePanel />
        <section className={cn(styles.panel, styles.canvasPanel)} data-panel="canvas" aria-label="Agent canvas">
          <div className={styles.panelHeader}><div><div className={styles.panelTitle}>Agent canvas</div><div className={styles.panelHint}>Drag from the palette or click + · connect only valid configuration relations</div></div><span className={styles.edgeChip}><Workflow size={10} /> config graph</span></div>
          <div className={styles.canvasBody}><AgentCanvas /></div>
        </section>
        <Inspector />
        <RunStatusPanel valid={validation.valid} compileErrors={compileErrors} />
        <div className={styles.preview}><ArtifactPreviewPanel files={PREVIEW_FILES} heading="Artifact preview" description="Local data-only fixture · no backend Artifact Bundle is connected" sourceLabel="static / no-script" /></div>
      </div>

      <div className={styles.footerRow}><span className={styles.digest}>canvas digest: {digest}</span><span>{compileResult.valid ? 'compiled plan ready for server handoff' : 'compile blocked by validation'} · layout coordinates excluded <Maximize2 size={11} /></span></div>
      {notice && <div className="small muted mt-2" role="status"><ChevronRight size={12} /> {notice}</div>}
    </main>
  );
}
