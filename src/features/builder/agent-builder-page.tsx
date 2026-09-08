'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  GitFork,
  Heart,
  KeyRound,
  LoaderCircle,
  PauseCircle,
  Play,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldCheck,
  Sparkles,
  Trophy,
  Vote,
} from 'lucide-react';
import { ArtifactPreviewPanel, type ArtifactPreviewFile } from '@/components/agent/artifact-preview';
import { LanguageSwitcher, localizeError, useToast } from '@/components/common';
import { Button } from '@/components/ui/button';
import {
  addProvider,
  cancelCreationRun,
  castShowcaseVote,
  createCreationRun,
  createShowcaseEntry,
  downloadArtifact,
  forkAgentBuild,
  getAgentBuild,
  getArtifactBundle,
  getArtifactPreview,
  getCreationRun,
  getOwnerPublication,
  getPublicationLikes,
  getPublicArtifactPreview,
  getShowcaseLeaderboard,
  issueShowcaseBallot,
  likePublication,
  listAnimationChallenges,
  listProviders,
  requestPublication,
  retryCreationRun,
  saveAgentBuild,
  unlikePublication,
  type AgentBuildView,
  type AnimationChallengeView,
  type ArtifactBundleView,
  type CreationRunStatusView,
  type LikeSummaryView,
  type OwnerPublicationView,
  type ProviderCredentialView,
  type ProviderProtocol,
  type ShowcaseBallotView,
  type ShowcaseLeaderboardView,
} from '@/lib/client-api';
import { useLocale } from '@/lib/i18n';
import { PROVIDER_PROTOCOL_BASE_URLS, PROVIDER_PROTOCOLS } from '@/shared/provider-protocol';
import type { MessageKey } from '@/shared/i18n/types';
import styles from './agent-builder.module.css';

const UI_ENABLED = process.env.NEXT_PUBLIC_AGENT_BUILDER_UI !== 'false';
const STORAGE_KEY = 'agentforge.artifact-arena.creation-v2';
const COMPARATOR_KEY = 'artifact-arena:showcase:v1';
const POLICY_VERSION = 'showcase-pairwise-v1';
const SEASON_ID = 'season-2026-launch';

interface PersistedCreationSession {
  challengeVersionId?: string;
  credentialId?: string;
  buildId?: string;
  buildVersionId?: string;
  runId?: string;
  publicationId?: string;
  entryId?: string;
}

type BusyAction =
  | 'credential'
  | 'build'
  | 'run'
  | 'cancel'
  | 'retry'
  | 'preview'
  | 'publish'
  | 'publication'
  | 'fork'
  | 'entry'
  | 'ballot'
  | 'vote'
  | 'leaderboard'
  | `like:${string}`
  | null;

const RUN_STATUS_KEYS: Record<NonNullable<CreationRunStatusView['run']>['status'], MessageKey> = {
  queued: 'artifactArena.status.queued',
  running: 'artifactArena.status.running',
  completed: 'artifactArena.status.completed',
  failed: 'artifactArena.status.failed',
  cancelled: 'artifactArena.status.cancelled',
  incomplete: 'artifactArena.status.incomplete',
};

const PUBLICATION_STATUS_KEYS: Record<OwnerPublicationView['status'], MessageKey> = {
  pending: 'artifactArena.publication.pending',
  published: 'artifactArena.publication.published',
  rejected: 'artifactArena.publication.rejected',
  withdrawn: 'artifactArena.publication.withdrawn',
  'taken-down': 'artifactArena.publication.taken-down',
};

function readPersisted(): PersistedCreationSession {
  if (typeof window === 'undefined') return {};
  try {
    const value = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}');
    return value && typeof value === 'object' ? value as PersistedCreationSession : {};
  } catch {
    return {};
  }
}

function roundId(challengeVersionId: string): string {
  return `${challengeVersionId}:${SEASON_ID}:byok`;
}

function previewFile(bundleEntry: ArtifactBundleView['entries'][number], projection: Awaited<ReturnType<typeof getArtifactPreview>>): ArtifactPreviewFile {
  return {
    artifactId: bundleEntry.artifactId,
    relativePath: bundleEntry.relativePath,
    bytes: bundleEntry.bytes,
    projection,
  };
}

function publicPreviewFile(
  publicationId: string,
  relativePath: string,
  bytes: number,
  projection: Awaited<ReturnType<typeof getPublicArtifactPreview>>,
): ArtifactPreviewFile {
  return { artifactId: `${publicationId}:${relativePath}`, relativePath, bytes, projection: {
    ...projection,
    plan: { ...projection.plan, artifactId: `${publicationId}:${relativePath}` },
  } };
}

function StepLabel({ children, complete = false }: { children: React.ReactNode; complete?: boolean }) {
  return <span className={`${styles.stepLabel} ${complete ? styles.stepComplete : ''}`}>
    {complete ? <CheckCircle2 size={13} /> : <span className={styles.stepDot} />}{children}
  </span>;
}

export function AgentBuilderPage() {
  const { t, language, formatNumber } = useLocale();
  const toast = useToast();
  const restored = useRef<PersistedCreationSession | null>(null);
  if (!restored.current) restored.current = readPersisted();

  const [challenges, setChallenges] = useState<AnimationChallengeView[]>([]);
  const [credentials, setCredentials] = useState<ProviderCredentialView[]>([]);
  const [challengeVersionId, setChallengeVersionId] = useState(restored.current.challengeVersionId ?? '');
  const [credentialId, setCredentialId] = useState(restored.current.credentialId ?? '');
  const [protocol, setProtocol] = useState<ProviderProtocol>('openai-chat');
  const [baseUrl, setBaseUrl] = useState(PROVIDER_PROTOCOL_BASE_URLS['openai-chat']);
  const [credentialName, setCredentialName] = useState('My animation model');
  const [modelId, setModelId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [buildTitle, setBuildTitle] = useState('');
  const [instructions, setInstructions] = useState('Create a polished, self-contained animation. Use only inline SVG, restricted CSS keyframes, and declarative SVG animation. Write index.html before finishing.');
  const [build, setBuild] = useState<AgentBuildView | null>(null);
  const [runStatus, setRunStatus] = useState<CreationRunStatusView | null>(null);
  const [bundle, setBundle] = useState<ArtifactBundleView | null>(null);
  const [previews, setPreviews] = useState<ArtifactPreviewFile[]>([]);
  const [publication, setPublication] = useState<OwnerPublicationView | null>(null);
  const [publicTitle, setPublicTitle] = useState('');
  const [publicDescription, setPublicDescription] = useState('A community animation created with Pi in the isolated AgentForge sandbox.');
  const [entryId, setEntryId] = useState(restored.current.entryId ?? '');
  const [ballot, setBallot] = useState<ShowcaseBallotView | null>(null);
  const [ballotRequested, setBallotRequested] = useState(false);
  const [ballotPreviews, setBallotPreviews] = useState<{ a: ArtifactPreviewFile[]; b: ArtifactPreviewFile[] }>({ a: [], b: [] });
  const [leaderboard, setLeaderboard] = useState<ShowcaseLeaderboardView | null>(null);
  const [likes, setLikes] = useState<Record<string, LikeSummaryView>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<BusyAction>(null);
  const [error, setError] = useState('');

  const selected = useMemo(() => {
    for (const challenge of challenges) {
      const version = challenge.versions.find((candidate) => candidate.id === challengeVersionId);
      if (version) return { challenge, version };
    }
    return null;
  }, [challengeVersionId, challenges]);
  const selectedCredential = credentials.find((credential) => credential.id === credentialId) ?? null;
  const run = runStatus?.run ?? null;
  const runActive = run?.status === 'queued' || run?.status === 'running';
  const runRetryable = run?.status === 'failed' || run?.status === 'cancelled' || run?.status === 'incomplete';
  const runComplete = run?.status === 'completed' && Boolean(run.artifactBundleId);
  const isPublished = publication?.status === 'published';
  const partition = challengeVersionId ? roundId(challengeVersionId) : '';

  const fail = useCallback((reason: unknown) => {
    const message = localizeError(reason, t);
    setError(message);
    toast(message || t('artifactArena.operationFailed'), true);
  }, [t, toast]);

  const persist = useCallback((patch: PersistedCreationSession) => {
    const next = { ...readPersisted(), ...patch };
    for (const [key, value] of Object.entries(next)) if (!value) delete next[key as keyof PersistedCreationSession];
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }, []);

  const loadBundle = useCallback(async (bundleId: string) => {
    setBusy('preview');
    try {
      const nextBundle = await getArtifactBundle(bundleId);
      const nextPreviews = await Promise.all(nextBundle.entries.map(async (entry) => previewFile(entry, await getArtifactPreview(entry.artifactId))));
      setBundle(nextBundle);
      setPreviews(nextPreviews);
    } catch (reason) {
      fail(reason);
    } finally {
      setBusy((value) => value === 'preview' ? null : value);
    }
  }, [fail]);

  const refreshLeaderboard = useCallback(async (showBusy = true) => {
    if (!partition) return;
    if (showBusy) setBusy('leaderboard');
    try {
      const next = await getShowcaseLeaderboard({ roundId: partition, comparatorKey: COMPARATOR_KEY, policyVersion: POLICY_VERSION });
      setLeaderboard(next);
      const summaries = await Promise.all(next.rows.map(async (row) => {
        try { return await getPublicationLikes(row.publication.publicationId); }
        catch { return null; }
      }));
      setLikes((current) => {
        const updated = { ...current };
        summaries.forEach((summary) => { if (summary) updated[summary.publicationId] = summary; });
        return updated;
      });
    } catch (reason) {
      fail(reason);
    } finally {
      if (showBusy) setBusy((value) => value === 'leaderboard' ? null : value);
    }
  }, [fail, partition]);

  useEffect(() => {
    const controller = new AbortController();
    const saved = restored.current ?? {};
    (async () => {
      setLoading(true);
      try {
        const [challengeRows, providerRows] = await Promise.all([
          listAnimationChallenges(controller.signal),
          listProviders(controller.signal),
        ]);
        if (controller.signal.aborted) return;
        setChallenges(challengeRows);
        setCredentials(providerRows.credentials);
        const defaultVersion = saved.challengeVersionId || challengeRows[0]?.versions[0]?.id || '';
        setChallengeVersionId(defaultVersion);
        setCredentialId(saved.credentialId && providerRows.credentials.some((item) => item.id === saved.credentialId)
          ? saved.credentialId
          : providerRows.credentials[0]?.id ?? '');
        if (saved.buildId) {
          const loadedBuild = await getAgentBuild(saved.buildId, saved.buildVersionId, controller.signal);
          setBuild(loadedBuild);
          setBuildTitle(loadedBuild.title);
          setInstructions(loadedBuild.version.agentDefinition.instructions);
        }
        if (saved.runId) {
          const loadedRun = await getCreationRun(saved.runId, controller.signal);
          setRunStatus(loadedRun);
          if (loadedRun.run.artifactBundleId) await loadBundle(loadedRun.run.artifactBundleId);
        }
        if (saved.publicationId) {
          const loadedPublication = await getOwnerPublication(saved.publicationId, controller.signal);
          setPublication(loadedPublication);
          setPublicTitle(loadedPublication.title);
          setPublicDescription(loadedPublication.description);
        }
      } catch (reason) {
        if (!controller.signal.aborted) fail(reason);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [fail, loadBundle]);

  useEffect(() => {
    if (!selected || buildTitle) return;
    setBuildTitle(`${language === 'zh-CN' ? selected.version.title : selected.version.titleEn} / my build`);
    setPublicTitle(language === 'zh-CN' ? selected.version.title : selected.version.titleEn);
  }, [buildTitle, language, selected]);

  useEffect(() => {
    if (!runActive || !run?.id) return;
    let stopped = false;
    const timer = window.setInterval(async () => {
      try {
        const next = await getCreationRun(run.id);
        if (stopped) return;
        setRunStatus(next);
        if (next.run.artifactBundleId) {
          persist({ runId: next.run.id });
          await loadBundle(next.run.artifactBundleId);
        }
      } catch (reason) {
        if (!stopped) fail(reason);
      }
    }, 1500);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [fail, loadBundle, persist, run?.id, runActive]);

  useEffect(() => {
    if (partition) void refreshLeaderboard(false);
  }, [partition, refreshLeaderboard]);

  const changeChallenge = (next: string) => {
    setChallengeVersionId(next);
    setBuild(null);
    setRunStatus(null);
    setBundle(null);
    setPreviews([]);
    setPublication(null);
    setEntryId('');
    setBallot(null);
    setBallotPreviews({ a: [], b: [] });
    setLeaderboard(null);
    setBuildTitle('');
    persist({ challengeVersionId: next, buildId: '', buildVersionId: '', runId: '', publicationId: '', entryId: '' });
  };

  const saveCredential = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy('credential'); setError('');
    try {
      const saved = await addProvider({ protocol, name: credentialName.trim(), baseUrl: baseUrl.trim(), modelId: modelId.trim(), apiKey });
      setCredentials((rows) => [saved, ...rows.filter((row) => row.id !== saved.id)]);
      setCredentialId(saved.id);
      setApiKey('');
      persist({ credentialId: saved.id });
      toast(t('artifactArena.credentialSaved'));
    } catch (reason) { fail(reason); }
    finally { setBusy(null); }
  };

  const saveBuild = async () => {
    if (!selected) return;
    setBusy('build'); setError('');
    try {
      const saved = await saveAgentBuild({
        ...(build ? { buildId: build.id, currentVersionId: build.currentVersionId } : {}),
        title: buildTitle.trim(),
        mode: 'agent',
        animationChallengeVersionId: selected.version.id,
        visibility: 'private',
        agentDefinition: {
          mode: 'agent',
          definitionSchemaVersion: 1,
          instructions: instructions.trim(),
          modelSelection: selected.challenge.agentBuildContract.modelSelection,
          skillRefs: [],
          requestedCapabilities: [],
          outputContractRef: selected.challenge.agentBuildContract.outputContractRef,
          profileRef: null,
          environmentRef: selected.challenge.agentBuildContract.environmentRef,
          runtimeSelection: selected.challenge.agentBuildContract.runtimeSelection,
        },
      });
      setBuild(saved);
      persist({ challengeVersionId: selected.version.id, buildId: saved.id, buildVersionId: saved.version.id, runId: '', publicationId: '', entryId: '' });
      setRunStatus(null); setBundle(null); setPreviews([]); setPublication(null); setEntryId('');
      toast(t('artifactArena.buildSaved'));
    } catch (reason) { fail(reason); }
    finally { setBusy(null); }
  };

  const startRun = async () => {
    if (!selected || !build || !credentialId) return;
    setBusy('run'); setError('');
    try {
      const key = crypto.randomUUID();
      const next = await createCreationRun({ buildVersionId: build.version.id, challengeVersionId: selected.version.id, credentialId, idempotencyKey: key }, { idempotencyKey: key });
      setRunStatus(next);
      setBundle(null); setPreviews([]); setPublication(null); setEntryId('');
      persist({ runId: next.run.id, publicationId: '', entryId: '' });
    } catch (reason) { fail(reason); }
    finally { setBusy(null); }
  };

  const cancelRun = async () => {
    if (!run) return;
    setBusy('cancel');
    try { setRunStatus(await cancelCreationRun(run.id)); }
    catch (reason) { fail(reason); }
    finally { setBusy(null); }
  };

  const retryRun = async () => {
    if (!run) return;
    setBusy('retry');
    try {
      const next = await retryCreationRun(run.id, crypto.randomUUID());
      setRunStatus(next); setBundle(null); setPreviews([]);
      persist({ runId: next.run.id });
    } catch (reason) { fail(reason); }
    finally { setBusy(null); }
  };

  const publish = async () => {
    if (!run || !bundle) return;
    setBusy('publish');
    try {
      const next = await requestPublication({
        creationRunId: run.id,
        expectedSnapshotDigest: bundle.snapshotDigest,
        expectedManifestDigest: bundle.manifestDigest,
        title: publicTitle.trim(),
        description: publicDescription.trim(),
        entryPath: 'index.html',
        publicArtifactIds: bundle.entries.map((entry) => entry.artifactId),
      });
      setPublication(next);
      persist({ publicationId: next.id });
      toast(t('artifactArena.publication.pending'));
    } catch (reason) { fail(reason); }
    finally { setBusy(null); }
  };

  const refreshPublication = async () => {
    if (!publication) return;
    setBusy('publication');
    try {
      const next = await getOwnerPublication(publication.id);
      setPublication(next);
      if (next.status === 'published') {
        const summary = await getPublicationLikes(next.id);
        setLikes((current) => ({ ...current, [next.id]: summary }));
      }
    } catch (reason) { fail(reason); }
    finally { setBusy(null); }
  };

  const forkBuild = async () => {
    if (!build) return;
    setBusy('fork');
    try {
      const fork = await forkAgentBuild(build.id, build.version.id);
      setBuild(fork);
      setBuildTitle(fork.title);
      setRunStatus(null); setBundle(null); setPreviews([]); setPublication(null); setEntryId('');
      persist({ buildId: fork.id, buildVersionId: fork.version.id, runId: '', publicationId: '', entryId: '' });
      toast(t('artifactArena.buildForked'));
    } catch (reason) { fail(reason); }
    finally { setBusy(null); }
  };

  const enterRanking = async () => {
    if (!publication || !partition) return;
    setBusy('entry');
    try {
      const next = await createShowcaseEntry({ publicationId: publication.id, roundId: partition, comparatorKey: COMPARATOR_KEY, policyVersion: POLICY_VERSION });
      setEntryId(next.id);
      persist({ entryId: next.id });
      toast(t('artifactArena.enteredRanking'));
      await refreshLeaderboard(false);
    } catch (reason) { fail(reason); }
    finally { setBusy(null); }
  };

  const issueBallot = async () => {
    if (!partition) return;
    setBusy('ballot'); setBallotRequested(true); setBallot(null); setBallotPreviews({ a: [], b: [] });
    try {
      const next = await issueShowcaseBallot({ roundId: partition, comparatorKey: COMPARATOR_KEY, policyVersion: POLICY_VERSION }, crypto.randomUUID());
      setBallot(next);
      if (next?.candidates) {
        const [a, b] = await Promise.all((['a', 'b'] as const).map(async (side) => {
          const candidate = next.candidates![side].publication;
          const file = candidate.files.find((item) => item.relativePath === candidate.entryPath);
          if (!file) return [];
          const projection = await getPublicArtifactPreview(candidate.publicationId, candidate.entryPath);
          return [publicPreviewFile(candidate.publicationId, candidate.entryPath, file.sizeBytes, projection)];
        }));
        setBallotPreviews({ a, b });
      }
    } catch (reason) { fail(reason); }
    finally { setBusy(null); }
  };

  const vote = async (choice: 'a' | 'b' | 'tie' | 'skip') => {
    if (!ballot) return;
    setBusy('vote');
    try {
      const result = await castShowcaseVote(ballot.id, choice, crypto.randomUUID());
      setBallot(result.ballot);
      toast(t('artifactArena.voteSent'));
      await refreshLeaderboard(false);
    } catch (reason) { fail(reason); }
    finally { setBusy(null); }
  };

  const toggleLike = async (publicationId: string) => {
    const current = likes[publicationId];
    setBusy(`like:${publicationId}`);
    try {
      const next = current?.likedByViewer ? await unlikePublication(publicationId) : await likePublication(publicationId);
      setLikes((rows) => ({ ...rows, [publicationId]: next }));
    } catch (reason) { fail(reason); }
    finally { setBusy(null); }
  };

  const reset = () => {
    window.localStorage.removeItem(STORAGE_KEY);
    setBuild(null); setRunStatus(null); setBundle(null); setPreviews([]); setPublication(null); setEntryId(''); setBallot(null); setBallotRequested(false); setBallotPreviews({ a: [], b: [] });
    setPublicTitle(''); setBuildTitle(''); setError('');
  };

  if (!UI_ENABLED) {
    return <main className={styles.shell}><div className={styles.disabled}><AlertTriangle /><h1>{t('artifactArena.unavailable')}</h1></div></main>;
  }

  return (
    <main className={styles.shell}>
      <header className={styles.hero}>
        <div className={styles.heroTop}>
          <Link href="/" className={styles.brand}>AgentForge / Artifact Arena</Link>
          <div className={styles.heroActions}><LanguageSwitcher /><Button variant="ghost" size="sm" onClick={reset}><RotateCcw size={13} />{t('artifactArena.reset')}</Button></div>
        </div>
        <div className={styles.heroGrid}>
          <div>
            <p className={styles.eyebrow}>{t('artifactArena.eyebrow')}</p>
            <h1>{t('artifactArena.title')}</h1>
            <p className={styles.subtitle}>{t('artifactArena.subtitle')}</p>
          </div>
          <div className={styles.launchBadge}><Sparkles size={18} /><div><strong>{t('artifactArena.open')}</strong><span>Pi → EF → gVisor/runsc → immutable artifacts</span></div></div>
        </div>
        <div className={styles.steps}>
          <StepLabel complete={Boolean(selected)}>{t('artifactArena.step.challenge')}</StepLabel>
          <StepLabel complete={Boolean(credentialId)}>{t('artifactArena.step.provider')}</StepLabel>
          <StepLabel complete={Boolean(build)}>{t('artifactArena.step.build')}</StepLabel>
          <StepLabel complete={runComplete}>{t('artifactArena.step.run')}</StepLabel>
          <StepLabel complete={previews.length > 0}>{t('artifactArena.step.preview')}</StepLabel>
          <StepLabel complete={Boolean(publication)}>{t('artifactArena.step.publish')}</StepLabel>
          <StepLabel complete={Boolean(entryId)}>{t('artifactArena.step.community')}</StepLabel>
        </div>
      </header>

      {loading && <div className={styles.banner}><LoaderCircle className={styles.spin} size={16} />{t('artifactArena.recovering')}</div>}
      {error && <div className={`${styles.banner} ${styles.errorBanner}`} role="alert"><AlertTriangle size={16} />{error}</div>}
      <div className={styles.securityNote}><ShieldCheck size={18} /><p>{t('artifactArena.securityNote')}</p></div>

      <section className={styles.stage}>
        <div className={styles.stageHeader}><span>01</span><div><h2>{t('artifactArena.challengeTitle')}</h2><p>{t('artifactArena.challengeHelp')}</p></div></div>
        <div className={styles.challengeGrid}>
          {challenges.flatMap((challenge) => challenge.versions.map((version) => {
            const active = version.id === challengeVersionId;
            return <button key={version.id} type="button" className={`${styles.challengeCard} ${active ? styles.challengeActive : ''}`} onClick={() => changeChallenge(version.id)} aria-pressed={active}>
              <div className={styles.challengeCardTop}><span>{String(challenge.position).padStart(2, '0')}</span><small>{t('artifactArena.version', { version: version.versionNumber })}</small></div>
              <h3>{language === 'zh-CN' ? version.title : version.titleEn}</h3>
              <p>{language === 'zh-CN' ? version.instructions : version.instructionsEn}</p>
              <div className={styles.challengeMeta}>{challenge.runAvailability.enabled ? <><CheckCircle2 size={13} />{t('artifactArena.available')}</> : <><AlertTriangle size={13} />{t('artifactArena.unavailable')}</>}</div>
            </button>;
          }))}
        </div>
        {selected && <div className={styles.promptPlate}><span>{t('artifactArena.originalPrompt')}</span><blockquote>{selected.version.instructions}</blockquote><p>{t('artifactArena.requirements')}</p></div>}
      </section>

      <div className={styles.twoColumn}>
        <section className={styles.stage}>
          <div className={styles.stageHeader}><span>02</span><div><h2>{t('artifactArena.providerTitle')}</h2><p>{t('artifactArena.providerHelp')}</p></div></div>
          <form className={styles.formGrid} onSubmit={saveCredential}>
            <label><span>{t('providers.protocol')}</span><select value={protocol} onChange={(event) => {
              const next = event.target.value as ProviderProtocol;
              setProtocol(next);
              if (Object.values(PROVIDER_PROTOCOL_BASE_URLS).includes(baseUrl)) setBaseUrl(PROVIDER_PROTOCOL_BASE_URLS[next]);
            }}>{PROVIDER_PROTOCOLS.map((value) => <option value={value} key={value}>{t(`providers.protocol.${value}`)}</option>)}</select></label>
            <label><span>{t('artifactArena.credentialName')}</span><input required minLength={1} maxLength={80} value={credentialName} onChange={(event) => setCredentialName(event.target.value)} /></label>
            <label className={styles.fullField}><span>{t('artifactArena.baseUrl')}</span><input required type="url" maxLength={300} value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} /></label>
            <label><span>{t('artifactArena.modelId')}</span><input required maxLength={160} value={modelId} onChange={(event) => setModelId(event.target.value)} placeholder="gpt-5.2 / claude-sonnet / gemini-2.5-pro" /></label>
            <label><span>{t('artifactArena.apiKey')}</span><input required type="password" autoComplete="off" maxLength={1000} value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={t('providers.keyPlaceholder')} /></label>
            <div className={styles.fullField}><Button type="submit" variant="default" disabled={busy === 'credential'}>{busy === 'credential' ? <LoaderCircle className={styles.spin} size={14} /> : <KeyRound size={14} />}{busy === 'credential' ? t('artifactArena.savingCredential') : t('artifactArena.saveCredential')}</Button></div>
          </form>
          <div className={styles.savedBox}><label><span>{t('artifactArena.selectCredential')}</span><select value={credentialId} onChange={(event) => { setCredentialId(event.target.value); persist({ credentialId: event.target.value }); }}><option value="">{t('artifactArena.noCredentials')}</option>{credentials.map((credential) => <option key={credential.id} value={credential.id}>{credential.name} · {credential.modelId} · {credential.keyMask}</option>)}</select></label>{selectedCredential && <small>{t(`providers.protocol.${selectedCredential.protocol}`)} · {selectedCredential.baseUrl}</small>}</div>
        </section>

        <section className={styles.stage}>
          <div className={styles.stageHeader}><span>03</span><div><h2>{t('artifactArena.buildTitle')}</h2><p>{t('artifactArena.instructionsHelp')}</p></div></div>
          <div className={styles.formGrid}>
            <label className={styles.fullField}><span>{t('artifactArena.buildName')}</span><input required minLength={1} maxLength={160} value={buildTitle} onChange={(event) => setBuildTitle(event.target.value)} /></label>
            <label className={styles.fullField}><span>{t('artifactArena.instructions')}</span><textarea required minLength={1} maxLength={8000} rows={9} value={instructions} onChange={(event) => setInstructions(event.target.value)} /></label>
            <div className={`${styles.fullField} ${styles.buttonRow}`}><Button variant="default" onClick={saveBuild} disabled={!selected || !buildTitle.trim() || !instructions.trim() || busy === 'build'}>{busy === 'build' ? <LoaderCircle className={styles.spin} size={14} /> : <Save size={14} />}{busy === 'build' ? t('artifactArena.savingBuild') : t('artifactArena.saveBuild')}</Button>{build && <Button variant="outline" onClick={forkBuild} disabled={busy === 'fork'}>{busy === 'fork' ? <LoaderCircle className={styles.spin} size={14} /> : <GitFork size={14} />}{busy === 'fork' ? t('artifactArena.forkingBuild') : t('artifactArena.forkBuild')}</Button>}</div>
          </div>
          {build && <div className={styles.digestLine}><span>Build {build.id}</span><span>v{build.version.revision}</span><code>{build.version.definitionDigest.slice(0, 24)}…</code></div>}
        </section>
      </div>

      <section className={styles.stage}>
        <div className={styles.stageHeader}><span>04</span><div><h2>{t('artifactArena.runTitle')}</h2><p>{t('artifactArena.resumeHint')}</p></div></div>
        <div className={styles.runConsole}>
          <div className={styles.runStatus}><span>{t('artifactArena.status')}</span><strong className={runActive ? styles.live : runComplete ? styles.success : ''}>{run ? t(RUN_STATUS_KEYS[run.status]) : t('artifactArena.status.idle')}</strong>{runStatus?.job?.failure && <code>{runStatus.job.failure.code}</code>}</div>
          <div className={styles.buttonRow}><Button variant="default" onClick={startRun} disabled={!selected?.challenge.runAvailability.enabled || !build || !credentialId || runActive || busy === 'run'}>{busy === 'run' ? <LoaderCircle className={styles.spin} size={14} /> : <Play size={14} />}{busy === 'run' ? t('artifactArena.runStarting') : t('artifactArena.startRun')}</Button>{runActive && <Button variant="destructive" onClick={cancelRun} disabled={busy === 'cancel'}>{busy === 'cancel' ? <LoaderCircle className={styles.spin} size={14} /> : <PauseCircle size={14} />}{busy === 'cancel' ? t('artifactArena.cancellingRun') : t('artifactArena.cancelRun')}</Button>}{runRetryable && <Button variant="outline" onClick={retryRun} disabled={busy === 'retry'}>{busy === 'retry' ? <LoaderCircle className={styles.spin} size={14} /> : <RefreshCw size={14} />}{busy === 'retry' ? t('artifactArena.retryingRun') : t('artifactArena.retryRun')}</Button>}</div>
        </div>
        {run && <div className={styles.timeline}><span>{run.id}</span><span>{runStatus?.job?.state ?? run.status}</span><span>{run.updatedAt}</span></div>}
      </section>

      <section className={styles.stage}>
        <div className={styles.stageHeader}><span>05</span><div><h2>{t('artifactArena.previewTitle')}</h2><p>{t('artifactArena.previewDescription')}</p></div></div>
        {busy === 'preview' && previews.length === 0 ? <div className={styles.empty}><LoaderCircle className={styles.spin} />{t('artifactArena.previewLoading')}</div> : <ArtifactPreviewPanel files={previews} heading={t('artifactArena.previewTitle')} description={t('artifactArena.previewDescription')} sourceLabel="sealed / no-script" emptyMessage={t('artifactArena.previewEmpty')} />}
        {bundle && <div className={styles.fileActions}>{bundle.entries.map((entry) => <Button key={entry.artifactId} variant="ghost" size="sm" onClick={async () => {
          try { const blob = await downloadArtifact(entry.artifactId); const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = entry.relativePath.split('/').pop() || 'artifact'; anchor.click(); URL.revokeObjectURL(url); } catch (reason) { fail(reason); }
        }}><Download size={13} />{t('artifactArena.download')} {entry.relativePath}</Button>)}</div>}
      </section>

      <div className={styles.twoColumn}>
        <section className={styles.stage}>
          <div className={styles.stageHeader}><span>06</span><div><h2>{t('artifactArena.publishTitle')}</h2><p>{t('artifactArena.publishHelp')}</p></div></div>
          <div className={styles.formGrid}>
            <label className={styles.fullField}><span>{t('artifactArena.publicTitle')}</span><input minLength={1} maxLength={160} value={publicTitle} onChange={(event) => setPublicTitle(event.target.value)} /></label>
            <label className={styles.fullField}><span>{t('artifactArena.publicDescription')}</span><textarea minLength={1} maxLength={2000} rows={5} value={publicDescription} onChange={(event) => setPublicDescription(event.target.value)} /></label>
            <div className={`${styles.fullField} ${styles.buttonRow}`}><Button variant="default" onClick={publish} disabled={!runComplete || !bundle || Boolean(publication) || busy === 'publish'}>{busy === 'publish' ? <LoaderCircle className={styles.spin} size={14} /> : <Sparkles size={14} />}{busy === 'publish' ? t('artifactArena.requestingReview') : t('artifactArena.requestReview')}</Button>{publication && <Button variant="outline" onClick={refreshPublication} disabled={busy === 'publication'}><RefreshCw className={busy === 'publication' ? styles.spin : ''} size={14} />{t('artifactArena.refreshStatus')}</Button>}</div>
          </div>
          {publication && <div className={`${styles.publicationState} ${isPublished ? styles.published : ''}`}><span>{t('artifactArena.publicationStatus')}</span><strong>{t(PUBLICATION_STATUS_KEYS[publication.status])}</strong><code>{publication.releaseDigest.slice(0, 24)}…</code></div>}
        </section>

        <section className={styles.stage}>
          <div className={styles.stageHeader}><span>07</span><div><h2>{t('artifactArena.communityTitle')}</h2><p>{t('artifactArena.communityHelp')}</p></div></div>
          <div className={styles.communityActions}><Button variant="default" onClick={enterRanking} disabled={!isPublished || Boolean(entryId) || busy === 'entry'}>{busy === 'entry' ? <LoaderCircle className={styles.spin} size={14} /> : <Trophy size={14} />}{busy === 'entry' ? t('artifactArena.enteringRanking') : entryId ? t('artifactArena.enteredRanking') : t('artifactArena.enterRanking')}</Button><Button variant="outline" onClick={issueBallot} disabled={!partition || busy === 'ballot'}>{busy === 'ballot' ? <LoaderCircle className={styles.spin} size={14} /> : <Vote size={14} />}{busy === 'ballot' ? t('artifactArena.issuingBallot') : t('artifactArena.issueBallot')}</Button></div>
          {ballot && ballot.candidates ? <div className={styles.ballot}>
            {(['a', 'b'] as const).map((side) => <article key={side} className={styles.candidate}><div className={styles.candidateHeader}><span>{side === 'a' ? t('artifactArena.candidateA') : t('artifactArena.candidateB')}</span><ShieldCheck size={14} /></div><ArtifactPreviewPanel files={ballotPreviews[side]} heading={side === 'a' ? t('artifactArena.candidateA') : t('artifactArena.candidateB')} description={t('artifactArena.previewDescription')} sourceLabel="blind / published" emptyMessage={t('artifactArena.previewLoading')} /></article>)}
            <div className={styles.voteRow}><Button onClick={() => vote('a')} disabled={ballot.status !== 'open' || busy === 'vote'}>{t('artifactArena.voteA')}</Button><Button onClick={() => vote('tie')} disabled={ballot.status !== 'open' || busy === 'vote'}>{t('artifactArena.voteTie')}</Button><Button onClick={() => vote('b')} disabled={ballot.status !== 'open' || busy === 'vote'}>{t('artifactArena.voteB')}</Button><Button variant="ghost" onClick={() => vote('skip')} disabled={ballot.status !== 'open' || busy === 'vote'}>{t('artifactArena.voteSkip')}</Button></div>
          </div> : ballotRequested ? <div className={styles.empty}>{t('artifactArena.noBallot')}</div> : null}
        </section>
      </div>

      <section className={styles.stage}>
        <div className={styles.stageHeader}><span>08</span><div><h2>{t('artifactArena.leaderboard')}</h2><p>{partition}</p></div><Button variant="ghost" size="sm" onClick={() => refreshLeaderboard()} disabled={busy === 'leaderboard'}><RefreshCw className={busy === 'leaderboard' ? styles.spin : ''} size={13} />{t('artifactArena.refreshLeaderboard')}</Button></div>
        {leaderboard && <><div className={`${styles.sampleBar} ${leaderboard.sample.qualified ? styles.sampleQualified : ''}`}><div><strong>{leaderboard.sample.qualified ? t('artifactArena.sampleQualified') : t('artifactArena.sampleInsufficient', { votes: leaderboard.sample.minValidVotes, voters: leaderboard.sample.minIndependentVoters })}</strong><span>{t('artifactArena.sample', { votes: leaderboard.sample.validVotes, voters: leaderboard.sample.independentVoters })}</span></div><div><span>{t('artifactArena.validVotes')}</span><strong>{formatNumber(leaderboard.sample.validVotes)}</strong></div><div><span>{t('artifactArena.independentVoters')}</span><strong>{formatNumber(leaderboard.sample.independentVoters)}</strong></div></div>
          {leaderboard.rows.length ? <div className={styles.leaderRows}>{leaderboard.rows.map((row, index) => { const summary = likes[row.publication.publicationId]; return <article className={styles.leaderRow} key={row.entryId}><span className={styles.rank}>{row.qualified ? String(index + 1).padStart(2, '0') : '—'}</span><div><strong>{row.publication.title}</strong><p>{row.publication.description}</p></div><div className={styles.scoreCell}><span>{t('artifactArena.communityScore')}</span><strong>{row.qualified ? Math.round(row.score * 100) : '—'}</strong><small>{t('artifactArena.sample', { votes: row.comparisons, voters: row.validVoters })}</small>{!row.qualified && <small>{t('artifactArena.sampleInsufficient', { votes: leaderboard.sample.minValidVotes, voters: leaderboard.sample.minIndependentVoters })}</small>}</div><div className={styles.likeCell}><Button variant={summary?.likedByViewer ? 'default' : 'outline'} size="sm" onClick={() => toggleLike(row.publication.publicationId)} disabled={busy === `like:${row.publication.publicationId}`}><Heart size={13} fill={summary?.likedByViewer ? 'currentColor' : 'none'} />{summary?.likedByViewer ? t('artifactArena.unlike') : t('artifactArena.like')}</Button><span>{t('artifactArena.likes', { count: summary?.count ?? 0 })}</span></div></article>; })}</div> : <div className={styles.empty}>{t('artifactArena.noEntries')}</div>}
        </>}
      </section>
    </main>
  );
}
