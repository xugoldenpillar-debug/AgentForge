'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useBuilderStore } from './store';
import {
  ErrorNotice,
  localizeError,
  GradeList,
  Icon,
  LaneNote,
  Loading,
  useData,
  useSession,
  useToast,
} from '@/components/common';
import { Button } from '@/components/ui/button';
import { ApiError, api, consumeRun, post } from '@/lib/client-api';
import { validateWorkflow } from '@/lib/workflow/validate';
import { JSON_SCHEMA, NODE_LABELS, ROUTES, SKILLS, TOOLS } from '@/shared/catalog';
import type { CaseResult, Config, NodeKind, RunEvent, RunSummary, Trace, Workflow } from '@/shared/types';
import type { MessageKey } from '@/shared/i18n/types';
import { localizeCatalogItem, systemLabel } from '@/shared/i18n/system-content';
import { cn } from '@/lib/utils';
import { useLocale } from '@/lib/i18n';

const WorkflowCanvas = dynamic(() => import('./canvas').then((module) => module.WorkflowCanvas), {
  ssr: false,
  loading: () => <Loading />,
});

const NODE_ICONS: Record<NodeKind, string> = {
  input: 'ArrowDownToLine',
  prompt: 'Code2',
  model: 'Cpu',
  skill: 'Sparkles',
  tool: 'Wrench',
  validator: 'ShieldCheck',
  output: 'ArrowUpFromLine',
};
const NODES = Object.keys(NODE_LABELS) as NodeKind[];

type ProviderCredential = { id: string; name: string; keyMask: string; modelId: string };
type ProvidersResponse = {
  demo?: boolean;
  platform?: { modelId: string };
  credentials?: ProviderCredential[];
};

type ApiProblem = {
  id: string;
  slug: string;
  title: string;
  starter: Workflow;
  constraints: { tokenBudget: number };
};

type ApiBuild = {
  id: string;
  title: string;
  visibility: 'public' | 'private';
  owner?: boolean;
  version: { id: string; revision: number };
  currentVersionId: string;
  problem: { slug: string };
  workflow: Workflow;
};

function displayError(error: unknown, translate: (key: MessageKey) => string): string {
  if (error instanceof Error && localizeError(error, translate) !== error.message) return localizeError(error, translate);
  const message = error instanceof Error ? error.message : String(error);
  if (/read.?only/i.test(message)) return translate('errors.readOnlyBuild');
  if (/sign in|authentication/i.test(message)) return translate('errors.authentication');
  if (/workflow/i.test(message) && /invalid|valid/i.test(message)) return translate('errors.workflowInvalid');
  if (/challenge.*(unavailable|not found)|problem.*not found/i.test(message)) return translate('errors.challengeUnavailable');
  return message;
}

function CodeEditor({
  value,
  onChange,
  label,
  placeholder,
  rows = 7,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
  rows?: number;
}) {
  const toast = useToast();
  const { t, formatNumber } = useLocale();
  const copy = () => {
    navigator.clipboard.writeText(value)
      .then(() => toast(t('builder.copied')))
      .catch(() => toast(t('builder.clipboardUnavailable'), true));
  };

  return (
    <div className="field">
      <div className="flex justify-between items-center mb-1">
        <label className="label">{label}</label>
        <button type="button" className="button ghost small" aria-label={`${t('builder.duplicate')} ${label}`} onClick={copy}>
          <Icon name="Copy" size={11} />
        </button>
      </div>
      <div className="code-editor">
        <div className="line-numbers" aria-hidden="true">
          {value.split('\n').map((_, index) => <span key={index}>{index + 1}</span>)}
        </div>
        <textarea
          aria-label={label}
          spellCheck={false}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          maxLength={8000}
          placeholder={placeholder}
          rows={rows}
        />
      </div>
      <div className="prompt-footer">
        <span>{formatNumber(value.length)} {t('builder.characters')}</span>
        <span>~{formatNumber(Math.ceil(new TextEncoder().encode(value).length / 4))} {t('builder.tokensEstimate')}</span>
      </div>
    </div>
  );
}

function SchemaEditor({
  schema,
  update,
}: {
  schema: Record<string, unknown> | undefined;
  update: (schema: Record<string, unknown>) => void;
}) {
  const { t } = useLocale();
  const [text, setText] = useState(JSON.stringify(schema || JSON_SCHEMA, null, 2));
  const [error, setError] = useState('');

  useEffect(() => setText(JSON.stringify(schema || JSON_SCHEMA, null, 2)), [schema]);

  return (
    <>
      <CodeEditor
        label={t('builder.jsonSchema')}
        value={text}
        rows={9}
        onChange={(value) => {
          setText(value);
          try {
            const parsed = JSON.parse(value);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid schema');
            update(parsed as Record<string, unknown>);
            setError('');
          } catch {
            setError(t('builder.invalidJson'));
          }
        }}
      />
      {error && <div className="error-text">{error}</div>}
    </>
  );
}

function Inspector({
  providers,
  problem,
  revision,
}: {
  providers: ProvidersResponse | null;
  problem: ApiProblem | null;
  revision: number;
}) {
  const store = useBuilderStore();
  const { language, t } = useLocale();
  const node = store.nodes.find((item) => item.id === store.selectedId);
  if (!node) {
    return (
      <aside className="config-panel">
        <div className="panel-eyebrow">{t('builder.nodeConfiguration')}</div>
        <div className="build-inspector-empty">
          <Icon name="SlidersHorizontal" size={25} />
          <p className="mt-2">{t('builder.selectNode')}<br />{t('builder.connectHandles')}</p>
        </div>
      </aside>
    );
  }

  const { kind, config } = node.data;
  const update = (value: Partial<Config>) => store.update(node.id, value);
  const fields = providers?.credentials || [];
  const catalogSkill = SKILLS.find((skill) => skill.id === config.skillId);
  const catalogTool = TOOLS.find((tool) => tool.id === config.toolId);
  const kindLabel = systemLabel('node', kind, kind.toUpperCase(), language);

  return (
    <aside className="config-panel">
      <div className="panel-eyebrow flex justify-between">
        {t('builder.nodeConfigTitle', { kind: kindLabel.toUpperCase() })}
        <span className="dim">v{revision || 1}</span>
      </div>
      <div className="config-body">
        <div className="inspector-node-title">
          <span className={`component-icon ${kind}`}><Icon name={NODE_ICONS[kind]} /></span>
          <span>{node.data.label}</span>
        </div>
        <div className="field">
          <label className="label">{t('builder.nodeName')}</label>
          <input value={node.data.label} maxLength={80} onChange={(event) => store.update(node.id, {}, event.target.value)} />
        </div>

        {kind === 'prompt' && (
          <>
            <CodeEditor label={t('builder.systemPrompt')} value={config.systemPrompt || ''} onChange={(systemPrompt) => update({ systemPrompt })} />
            <CodeEditor label={t('builder.userTemplate')} value={config.userTemplate || ''} onChange={(userTemplate) => update({ userTemplate })} rows={3} />
            <p className="helper">{t('builder.variablesHint', { input: '{{input}}', previous: '{{previous}}' })}</p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                const original = problem?.starter?.nodes.find((item) => item.kind === 'prompt');
                if (original) update(original.config);
              }}
            >
              <Icon name="RotateCcw" size={12} />{t('builder.resetMissionStarter')}
            </Button>
          </>
        )}

        {kind === 'model' && (
          <>
            <div className="field">
              <label className="label">{t('builder.provider')}</label>
              <select
                aria-label={t('builder.nodeProvider')}
                value={config.credentialId || ''}
                onChange={(event) => {
                  const id = event.target.value;
                  const provider = fields.find((item) => item.id === id);
                  update({
                    credentialId: id,
                    modelId: id === 'demo' ? 'demo-forge' : id === 'platform' ? providers?.platform?.modelId : provider?.modelId || '',
                  });
                }}
              >
                <option value="">{t('builder.selectProvider')}</option>
                {config.credentialId === 'demo' && !providers?.demo && <option value="demo" disabled>{t('builder.demoSimulator')}</option>}
                {providers?.demo && <option value="demo">{t('builder.demoSimulator')} / {t('builder.noApiCost')}</option>}
                {providers?.platform && <option value="platform">{t('builder.platformGateway')}</option>}
                {fields.map((provider) => <option key={provider.id} value={provider.id}>{provider.name} / {provider.keyMask}</option>)}

              </select>
            </div>
            <div className="field">
              <label className="label">{t('builder.modelId')}</label>
              <input value={config.modelId || ''} disabled={config.credentialId === 'demo' || config.credentialId === 'platform'} maxLength={160} onChange={(event) => update({ modelId: event.target.value })} />
            </div>
            <div className="form-grid">
              <div className="field">
                <label className="label">{t('builder.maxOutputTokens')}</label>
                <input type="number" min={16} max={8192} value={config.maxTokens || 512} onChange={(event) => update({ maxTokens: Number(event.target.value) })} />
              </div>
              <div className="field">
                <label className="label">{t('builder.temperature')}</label>
                <input type="number" min={0} max={2} step={0.1} value={config.temperature ?? 0} onChange={(event) => update({ temperature: Number(event.target.value) })} />
              </div>
            </div>
            {providers?.demo && <div className="callout small">{t('builder.demoResultsHint')}</div>}
            <Link href="/providers" className="section-link mt-3"><Icon name="Settings" size={12} /> {t('builder.manageCredentials')}</Link>
          </>
        )}

        {kind === 'skill' && (
          <>
            <div className="field">
              <label className="label">{t('builder.skillCard')}</label>
              <select value={config.skillId || 'structured'} onChange={(event) => update({ skillId: event.target.value as Config['skillId'] })}>
                {SKILLS.map((skill) => <option value={skill.id} key={skill.id}>{localizeCatalogItem('skill', skill.id, 'name', skill.name, language)}</option>)}
              </select>
            </div>
            <p className="helper mb-3">{catalogSkill && localizeCatalogItem('skill', catalogSkill.id, 'description', catalogSkill.description, language)}</p>
            {config.skillId === 'structured' && <SchemaEditor schema={config.schema} update={(schema) => update({ schema })} />}
            {config.skillId === 'concise' && <div className="field"><label className="label">{t('builder.maximumOutputCharacters')}</label><input type="number" min={1} max={8000} value={config.maxLength || 300} onChange={(event) => update({ maxLength: Number(event.target.value) })} /></div>}
            <div className="callout small">{t('builder.skillPlacementHint')}</div>
          </>
        )}

        {kind === 'tool' && (
          <>
            <div className="field">
              <label className="label">{t('builder.registeredTool')}</label>
              <select value={config.toolId || 'json-validator'} onChange={(event) => update({ toolId: event.target.value as Config['toolId'] })}>
                {TOOLS.map((tool) => <option key={tool.id} value={tool.id}>{localizeCatalogItem('tool', tool.id, 'name', tool.name, language)}</option>)}
              </select>
            </div>
            <p className="helper mb-3">{catalogTool && localizeCatalogItem('tool', catalogTool.id, 'description', catalogTool.description, language)}</p>
            {config.toolId === 'json-validator' && <SchemaEditor schema={config.schema} update={(schema) => update({ schema })} />}
            {(['calculator', 'text-search', 'string-matcher'] as string[]).includes(config.toolId || '') && (
              <div className="field">
                <label className="label">
                  {config.toolId === 'calculator' ? t('builder.expression') : config.toolId === 'text-search' ? t('builder.searchQuery') : t('builder.textToMatch')}
                </label>
                <input
                  value={config.toolId === 'calculator' ? config.expression || '' : config.toolId === 'text-search' ? config.query || '' : config.match || ''}
                  maxLength={1000}
                  onChange={(event) => update({ [config.toolId === 'calculator' ? 'expression' : config.toolId === 'text-search' ? 'query' : 'match']: event.target.value })}
                />
              </div>
            )}
            <div className="callout small">{t('builder.toolPlacementHint')}</div>
          </>
        )}

        {kind === 'validator' && (
          <>
            <div className="field">
              <label className="label">{t('builder.outputContract')}</label>
              <select
                value={config.format || 'json'}
                onChange={(event) => {
                  const format = event.target.value as Config['format'];
                  update({ format, schema: format === 'json' ? JSON_SCHEMA : undefined, values: format === 'enum' ? ROUTES : undefined });
                }}
              >
                <option value="json">{t('builder.jsonSchema')}</option>
                <option value="enum">{t('builder.exactEnum')}</option>
                <option value="text">{t('builder.nonemptyText')}</option>
              </select>
            </div>
            {(config.format || 'json') === 'json' && <SchemaEditor schema={config.schema} update={(schema) => update({ schema })} />}
            {config.format === 'enum' && <CodeEditor label={t('builder.allowedValues')} rows={5} value={(config.values || ROUTES).join('\n')} onChange={(value) => update({ values: value.split('\n').filter(Boolean) })} />}
            <p className="helper">{t('builder.validatorHint')}</p>
          </>
        )}

        {kind === 'input' && <div className="callout small">{t('builder.inputNodeHint')}</div>}
        {kind === 'output' && <div className="callout small">{t('builder.outputNodeHint')}</div>}

        <div className="divider" />
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => store.duplicate(node.id)}><Icon name="Copy" size={12} />{t('builder.duplicate')}</Button>
          <Button variant="ghost" size="sm" className="danger-text" onClick={() => store.remove(node.id)}><Icon name="Trash2" size={12} />{t('builder.delete')}</Button>
        </div>
        <p className="helper mt-2">{t('builder.deleteNodeHint')}</p>
      </div>
    </aside>
  );
}

export function BuilderPage() {
  const router = useRouter();
  const query = useSearchParams();
  const toast = useToast();
  const { t, language, formatNumber, formatMoney, formatDuration } = useLocale();
  const { user, loading: authLoading } = useSession();
  const store = useBuilderStore();
  const [problem, setProblem] = useState<ApiProblem | null>(null);
  const [build, setBuild] = useState<ApiBuild | null>(null);
  const [title, setTitle] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>('private');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [kind, setKind] = useState<'public' | 'hidden'>('public');
  const [tab, setTab] = useState<'results' | 'trace' | 'energy'>('results');
  const [cases, setCases] = useState<CaseResult[]>([]);
  const [traces, setTraces] = useState<Array<Trace & { caseNumber: number }>>([]);
  const [summary, setSummary] = useState<RunSummary | null>(null);
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [consent, setConsent] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const loaded = useRef('');
  const { data: providers } = useData<ProvidersResponse>(user ? 'providers' : null);

  const buildId = query.get('build');
  const problemId = query.get('problem') || 'messy-json-extractor';
  const version = query.get('version');
  const skill = query.get('skill');

  useEffect(() => {
    const key = `${buildId}:${problemId}:${version}`;
    if (loaded.current === key) return;
    let active = true;
    setLoading(true);
    setError('');
    (async () => {
      try {
        let loadedBuild: ApiBuild | null = null;
        let loadedProblem: ApiProblem;
        if (buildId) {
          loadedBuild = await api<ApiBuild>(`builds/${buildId}${version ? `?version=${encodeURIComponent(version)}` : ''}`);
          if (!loadedBuild.owner) throw new Error('This build is read-only. Open its detail page and fork it first.');
          loadedProblem = await api<ApiProblem>(`problems/${loadedBuild.problem.slug}`);
        } else {
          loadedProblem = await api<ApiProblem>(`problems/${problemId}`);
        }
        if (!active) return;
        loaded.current = key;
        setProblem(loadedProblem);
        setBuild(loadedBuild);
        setTitle(loadedBuild?.title || `${loadedProblem.title} / my build`);
        setVisibility(loadedBuild?.visibility || 'private');
        useBuilderStore.getState().load(loadedBuild?.workflow || loadedProblem.starter);
        if (!loadedBuild && SKILLS.some((item) => item.id === skill)) {
          useBuilderStore.getState().add('skill', undefined, skill as Config['skillId'], true);
        }
        setSummary(null);
        setCases([]);
        setTraces([]);
      } catch (reason) {
        if (active) setError(displayError(reason, t));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [buildId, problemId, version, skill, t]);

  useEffect(() => () => controller.current?.abort(), []);

  useEffect(() => {
    const before = (event: BeforeUnloadEvent) => {
      if (useBuilderStore.getState().dirty) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', before);
    return () => window.removeEventListener('beforeunload', before);
  }, []);

  const unconfigured = store.nodes.some((node) => node.data.kind === 'model' && !node.data.config.credentialId);
  const real = store.nodes.some((node) => node.data.kind === 'model' && !!node.data.config.credentialId && node.data.config.credentialId !== 'demo');

  async function save() {
    if (!user) {
      router.push(`/login?next=${encodeURIComponent(`/builder?${query}`)}`);
      throw new Error(t('builder.signInToSave'));
    }
    const workflow = validateWorkflow(store.exportWorkflow());
    if (build && !store.dirty && title === build.title && visibility === build.visibility && build.version.id === build.currentVersionId) return build;
    setSaving(true);
    try {
      const saved = await post<ApiBuild>('builds', {
        ...(build ? { buildId: build.id, currentVersionId: build.currentVersionId } : {}),
        problemId: problem?.id,
        title,
        visibility,
        workflow,
      });
      setBuild(saved);
      useBuilderStore.setState({ dirty: false });
      toast(t('builder.savedVersion', { revision: saved.version.revision }));
      loaded.current = `${saved.id}:${problem?.slug}:null`;
      window.history.replaceState(null, '', `/builder?build=${saved.id}&problem=${problem?.slug}`);
      return saved;
    } finally {
      setSaving(false);
    }
  }

  async function run(runKind: 'public' | 'hidden') {
    setError('');
    if (unconfigured) {
      setError(t('builder.providerRequired'));
      return;
    }
    if (real && !consent) {
      setError(t('errors.providerConsent'));
      return;
    }
    setRunning(true);
    setKind(runKind);
    setTab(runKind === 'public' ? 'trace' : 'results');
    setCases([]);
    setTraces([]);
    setSummary(null);
    setProgress({ completed: 0, total: 0 });
    store.clearTrace();
    controller.current = new AbortController();
    try {
      const saved = await save();
      await consumeRun(
        { buildId: saved.id, kind: runKind, consent },
        (event: RunEvent) => {
          if (event.type === 'start') setProgress({ completed: 0, total: event.total });
          if (event.type === 'trace') {
            store.trace(event.trace.nodeId, event.trace.state, event.trace.tokens);
            setTraces((value) => [...value.slice(-199), { ...event.trace, caseNumber: event.caseNumber }]);
          }
          if (event.type === 'case') setCases((value) => [...value, event.result]);
          if (event.type === 'progress') setProgress({ completed: event.completed, total: event.total });
          if (event.type === 'complete') {
            setSummary(event.summary);
            setTab('results');
            toast(runKind === 'hidden'
              ? `${t('builder.submit')} · ${event.summary.score.total} / 1000`
              : t('builder.runPublic'));
          }
          if (event.type === 'error') throw new ApiError(event.message, 502, event.code);
        },
        controller.current.signal,
      );
    } catch (reason) {
      setError(reason instanceof Error && reason.name === 'AbortError' ? t('builder.runCancelled') : displayError(reason, t));
    } finally {
      setRunning(false);
    }
  }

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(store.exportWorkflow(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'agentforge-workflow.json';
    anchor.click();
    URL.revokeObjectURL(url);
    toast(t('builder.exported'));
  };

  if (loading || authLoading) return <Loading />;
  if (!problem) {
    return (
      <main className="container page">
        <ErrorNotice message={error || t('errors.challengeUnavailable')} />
        <Link href="/challenges" className="button outline mt-3">{t('builder.backToChallenges')}</Link>
      </main>
    );
  }

  const nodeLabel = (nodeKind: NodeKind) => systemLabel('node', nodeKind, NODE_LABELS[nodeKind], language);
  const scoreLabel = kind === 'hidden' ? t('builder.arenaScore') : t('builder.practiceScore');

  return (
    <main className="builder-page">
      <div className="builder-toolbar">
        <div className="builder-title">
          <div className="breadcrumb">
            <Link href={`/challenges/${problem.slug}`}>{problem.title}</Link>
            <Icon name="ChevronRight" size={10} />
            <span>{t('builder.title').toUpperCase()}</span>
          </div>
          <div className="flex items-center gap-2">
            <input aria-label={t('builder.buildName')} value={title} maxLength={80} onChange={(event) => setTitle(event.target.value)} />
            <span className="chip">v{build?.version.revision || 1}{store.dirty ? ' *' : ''}</span>
          </div>
        </div>
        <div className="toolbar-actions">
          <select aria-label={t('builder.visibility')} value={visibility} onChange={(event) => setVisibility(event.target.value as 'public' | 'private')}>
            <option value="private">{t('builder.secretPrompt')}</option>
            <option value="public">{t('builder.publicPrompt')}</option>
          </select>
          <Button variant="ghost" size="icon" title={t('builder.exportWorkflow')} onClick={exportJson}><Icon name="Download" /></Button>
          <Button variant="outline" disabled={saving || running} onClick={() => save().catch((reason) => setError(displayError(reason, t)))}><Icon name="Save" size={14} />{saving ? t('builder.saving') : t('builder.save')}</Button>
          {running ? <Button variant="outline" onClick={() => controller.current?.abort()}><Icon name="X" />{t('builder.cancel')}</Button> : <Button variant="outline" onClick={() => run('public')}><Icon name="Play" size={14} />{t('builder.runPublic')}</Button>}
          <Button disabled={running || saving} onClick={() => run('hidden')}><Icon name="Send" size={14} />{t('builder.submit')}</Button>
        </div>
      </div>

      {unconfigured && <div className="callout warning mb-2">{t('builder.providerRequired')} <Link href="/providers">{t('builder.manageCredentials')}</Link></div>}
      {error && <div className="builder-error"><ErrorNotice message={error} /></div>}
      {real && <label className="callout small mb-2 flex items-center gap-2"><input type="checkbox" style={{ width: 15 }} checked={consent} onChange={(event) => setConsent(event.target.checked)} />{t('builder.usageConsent')}</label>}

      <div className="builder-grid">
        <aside className="palette">
          <div className="panel-eyebrow">{t('builder.components')}<span className="dim">7</span></div>
          <div className="palette-body">
            <div className="eyebrow mb-2">{t('builder.dragToCanvas')}</div>
            {NODES.map((nodeKind) => (
              <button
                draggable
                type="button"
                onDragStart={(event) => event.dataTransfer.setData('application/agentforge', nodeKind)}
                className="palette-item"
                key={nodeKind}
                onClick={() => store.add(nodeKind)}
              >
                <span className={`component-icon ${nodeKind}`}><Icon name={NODE_ICONS[nodeKind]} size={14} /></span>
                <span>{nodeLabel(nodeKind)}</span>
                <Icon name="Plus" size={11} />
              </button>
            ))}
            <div className="divider" />
            <div className="eyebrow mb-2">{t('builder.quickEquip')}</div>
            <p className="helper mb-2">{t('builder.insertSkill')}</p>
            {SKILLS.map((skillItem) => (
              <button className="equip-card" type="button" key={skillItem.id} onClick={() => store.add('skill', undefined, skillItem.id, true)} title={localizeCatalogItem('skill', skillItem.id, 'description', skillItem.description, language)}>
                <Icon name={skillItem.icon} size={12} />
                <span>{localizeCatalogItem('skill', skillItem.id, 'name', skillItem.name, language)}</span>
                <Icon name="Plus" size={10} />
              </button>
            ))}
            <div className="palette-hint"><Icon name="GitFork" size={13} /><p>{t('builder.connectPathHint')}</p></div>
          </div>
          <div className="palette-footer"><Icon name="ShieldCheck" size={12} /> {t('builder.controlledTools')}</div>
        </aside>

        <section className="canvas-panel">
          <div className="canvas-toolbar">
            <span><span className="status-dot" /> {running ? t('builder.executing') : t('builder.workflowCanvas')}</span>
            <span>{t('builder.nodesEdges', { nodes: store.nodes.length, edges: store.edges.length })}</span>
          </div>
          <WorkflowCanvas />
          <div className="canvas-shortcuts"><span>{t('builder.paletteHint')}</span><span>{formatNumber(problem.constraints.tokenBudget)} {t('builder.energy')}</span></div>
        </section>

        <Inspector providers={providers} problem={problem} revision={build?.version.revision || 1} />

        <section className="run-console" aria-live="polite">
          <div className="console-header">
            <Icon name="Terminal" size={14} />
            {([['results', t('builder.testResults')], ['trace', t('builder.executionTrace')], ['energy', t('builder.energy')]] as const).map(([id, label]) => (
              <button type="button" key={id} className={cn('console-tab', tab === id && 'active')} onClick={() => setTab(id)}>
                {label}{id === 'results' && cases.length > 0 ? ` (${formatNumber(cases.filter((item) => item.passed).length)}/${formatNumber(cases.length)})` : ''}
              </button>
            ))}
            <span className="mono small dim" style={{ marginLeft: 'auto' }}>
              {running ? <><span className="spinner" /> {formatNumber(progress.completed)}/{formatNumber(progress.total)}</> : summary ? `${systemLabel('tier', summary.tier, summary.tier.toUpperCase(), language)} / ${kind === 'hidden' ? t('common.submitted') : t('common.public')}` : t('common.ready')}
            </span>
          </div>
          {running && <div className="run-progress"><span style={{ width: `${progress.total ? progress.completed / progress.total * 100 : 3}%` }} /></div>}
          <div className="console-body">
            {summary && (tab === 'results' || tab === 'energy') && (
              <>
                <div className="console-score">
                  <div>
                    <div className="eyebrow">{scoreLabel}</div>
                    <div className="score-large">{summary.score.total}<small>/1000</small></div>
                    <div className="score-verdict">{t('builder.testsPassed', { passed: formatNumber(summary.passed), total: formatNumber(summary.total) })}</div>
                    {kind === 'hidden' && <Link href={`/leaderboard?problem=${problem.id}&tier=${summary.tier}`} className="section-link mt-2">{t('navigation.viewLeaderboard')} <Icon name="ArrowUpRight" size={11} /></Link>}
                  </div>
                  <GradeList score={summary.score} />
                  <div className="energy-breakdown">
                    <div><label>{t('builder.prompt')}</label><span>{formatNumber(summary.metrics.inputTokens)} {t('common.tokens')}</span></div>
                    <div><label>{t('builder.reasoning')}</label><span>{formatNumber(summary.metrics.reasoningTokens)} {t('common.tokens')}</span></div>
                    <div><label>{t('builder.visibleOutput')}</label><span>{formatNumber(Math.max(0, summary.metrics.outputTokens - summary.metrics.reasoningTokens))} {t('common.tokens')}</span></div>
                    <div><label>{t('common.totalEnergy')}</label><b className="accent">{formatNumber(summary.metrics.inputTokens + summary.metrics.outputTokens)}</b></div>
                    <div><label>{t('builder.toolCallsAllCases')}</label><span>{summary.metrics.toolCalls}</span></div>
                    <div><label>{t('builder.costLabel', { mode: summary.tier === 'demo' ? t('common.simulated') : t('common.estimated') })}</label><span>{formatMoney(summary.metrics.cost)}</span></div>
                    <div><label>{t('builder.summedExecutionTime')}</label><span>{formatDuration(summary.metrics.latency)}</span></div>
                  </div>
                </div>
                <div className="divider" />
              </>
            )}

            {tab === 'results' && kind === 'public' && cases.map((item, index) => (
              <details className="case-result" key={item.caseId} open={!item.passed}>
                <summary>
                  <span className={cn('result-status', item.passed ? 'accent' : 'danger-text')}>{item.passed ? t('common.pass') : t('common.fail')}</span>
                  <span>{t('common.case')} {formatNumber(index + 1)} / {systemLabel('category', item.category, item.category, language)}</span>
                  <span className="dim mono" style={{ marginLeft: 'auto' }}>{formatDuration(item.latency)} / {formatNumber(item.inputTokens + item.outputTokens)} {t('common.tokens')}</span>
                  <Icon name="ChevronDown" size={12} />
                </summary>
                <div className="case-details">
                  <div style={{ gridColumn: '1/3' }}><span className="eyebrow">{t('common.input')}</span><pre>{item.input}</pre></div>
                  <div><span className="eyebrow">{t('common.expected')}</span><pre>{JSON.stringify(item.expected, null, 2)}</pre></div>
                  <div><span className="eyebrow">{t('common.actual')}</span><pre>{item.actual}</pre></div>
                  <div className="case-stats"><span>{t('common.input')}: {formatNumber(item.inputTokens)}</span><span>{t('common.output')}: {formatNumber(item.outputTokens)}</span><span>{t('common.cost')}: {item.cost == null ? t('common.unknown') : formatMoney(item.cost)}</span><span>{item.failureType ? systemLabel('failure', item.failureType, item.failureType, language) : t('common.contractPassed')}</span></div>
                </div>
              </details>
            ))}

            {tab === 'results' && kind === 'hidden' && (summary || running) && (
              <>
                <div className="callout small"><Icon name="Lock" size={13} /> {t('builder.hiddenServerOnly')} {running ? ` ${t('builder.hiddenRunHint')}` : ` ${t('builder.onlyAggregateResults')}`}</div>
                {summary && <><div className="flex gap-3 wrap mt-3">{Object.entries(summary.failures).map(([name, count]) => <span className="chip" key={name}>{systemLabel('failure', name, name, language)}: {formatNumber(count)}</span>)}{!Object.keys(summary.failures).length && <span className="chip green">{t('builder.allContractsPassed')}</span>}</div><div className="mt-3"><LaneNote tier={summary.tier} /></div></>}
              </>
            )}

            {tab === 'trace' && <div className="console-traces">{traces.map((trace, index) => <div className="trace-line" key={`${trace.nodeId}-${trace.caseNumber}-${index}`}><span className="dim">{String(index + 1).padStart(3, '0')}</span><span className={trace.state === 'failed' ? 'danger-text' : 'accent'}>{trace.state === 'running' ? t('builder.statusRun') : trace.state === 'done' ? t('builder.statusDone') : t('builder.statusFail')}</span><span className="node-label">{trace.label}</span><span className="dim">{t('common.case')} {formatNumber(trace.caseNumber)}</span><span className="trace-token">{trace.tokens === undefined ? '' : `${formatNumber(trace.tokens)} ${t('common.tokens')}`}{trace.latency === undefined ? '' : ` / ${formatDuration(trace.latency)}`}</span></div>)}{!traces.length && <p className="dim">{kind === 'hidden' ? t('builder.hiddenServerOnly') : t('builder.runPublicToWatch')}</p>}</div>}

            {!running && !summary && !cases.length && tab !== 'trace' && <div className="console-welcome"><Icon name="Terminal" /><div><strong>{t('builder.agentReady')}</strong><p>{t('builder.firstRunHint')}</p></div></div>}
            {running && !cases.length && !summary && tab !== 'trace' && <div className="console-welcome"><span className="spinner" /><div><strong>{kind === 'hidden' ? t('builder.judgeRunning') : t('builder.workflowExecuting')}</strong><p>{t('builder.caseProgress', { completed: formatNumber(progress.completed), total: formatNumber(progress.total) })}</p></div></div>}
          </div>
        </section>
      </div>
    </main>
  );
}
