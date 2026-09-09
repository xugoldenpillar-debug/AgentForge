'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  GitFork,
  Heart,
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
import { normalizeProviderBaseUrl, validateProviderFormValues } from '@/shared/provider-protocol';
import { LanguageSwitcher, localizeError, useToast } from '@/components/common';
import { Button } from '@/components/ui/button';
import {
  acknowledgeUnknownCreationRun,
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
  isApiError,
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
  type ShowcaseBallotView,
  type ShowcaseLeaderboardView,
} from '@/lib/client-api';
import { useLocale } from '@/lib/i18n';
import type { MessageKey } from '@/shared/i18n/types';
import styles from './agent-builder.module.css';
import { AgentProviderForm } from './agent-provider-form';
import { AgentSkillPicker } from './agent-skill-picker';
import { draftMatchesBuild, parseCreationSession, type PersistedCreationSession } from './creation-session';
import type { AgentBuildSkillRef } from '@/shared/agent-build-contract';

const UI_ENABLED = process.env.NEXT_PUBLIC_AGENT_BUILDER_UI !== 'false';
const STORAGE_KEY = 'agentforge.artifact-arena.creation-v3';
const COMPARATOR_KEY = 'artifact-arena:showcase:v1';
const POLICY_VERSION = 'showcase-pairwise-v1';
const SEASON_ID = 'season-2026-launch';

type BusyAction =
  | 'credential'
  | 'build'
  | 'run'
  | 'cancel'
  | 'acknowledge'
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

const RUN_FAILURE_MESSAGE_KEYS: Readonly<Record<string, MessageKey>> = Object.freeze({
  CREATION_EXECUTION_AUTHORIZATION_LOST: 'artifactArena.failure.executionAuthorizationLost',
  CREATION_PI_RUNTIME_FAILED: 'artifactArena.failure.piRuntime',
  CREATION_SANDBOX_START_FAILED: 'artifactArena.failure.sandboxStart',
  CREATION_ARTIFACT_POLICY_DENIED: 'artifactArena.failure.artifactPolicy',
  CREATION_ARTIFACT_COLLECTION_FAILED: 'artifactArena.failure.artifactCollection',
  CREATION_ARTIFACT_SEAL_FAILED: 'artifactArena.failure.artifactSeal',
  UPSTREAM_RESULT_UNKNOWN: 'artifactArena.failure.upstreamUnknown',
  PROVIDER_AUTHENTICATION_FAILED: 'errors.providerAuthenticationFailed',
  PROVIDER_REQUEST_INVALID: 'errors.providerRequestInvalid',
  PROVIDER_REQUEST_FAILED: 'errors.providerRequestFailed',
  PROVIDER_RESPONSE_INVALID: 'errors.providerResponseInvalid',
  PROVIDER_NETWORK_REJECTED: 'errors.providerNetworkRejected',
  BUDGET_EXCEEDED: 'errors.budgetExceeded',
  PROVIDER_AUTHORIZATION_REVOKED: 'errors.providerNotFound',
  CREATION_SNAPSHOT_INVALID: 'artifactArena.failure.configuration',
  CREATION_CONFIGURATION_INVALID: 'artifactArena.failure.configuration',
  CREATION_SNAPSHOT_DEPENDENCY_MISSING: 'artifactArena.failure.configuration',
  CREATION_JOB_ASSOCIATION_MISMATCH: 'artifactArena.failure.configuration',
});

const PUBLICATION_STATUS_KEYS: Record<OwnerPublicationView['status'], MessageKey> = {
  pending: 'artifactArena.publication.pending',
  published: 'artifactArena.publication.published',
  rejected: 'artifactArena.publication.rejected',
  withdrawn: 'artifactArena.publication.withdrawn',
  'taken-down': 'artifactArena.publication.taken-down',
};

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
  const storageKey = useRef('');
  const epoch = useRef(0);
  const initialInstructions = useRef(t('builderPlus.defaultInstructions'));
  const initialLanguage = useRef(language);
  initialInstructions.current = t('builderPlus.defaultInstructions');
  initialLanguage.current = language;
  const [bootAttempt, setBootAttempt] = useState(0);
  const leaderboardRequest = useRef(0);
  const likeRevision = useRef(0);
  const voteRequest = useRef<{ ballotId: string; choice: string; key: string } | null>(null);
  const [pickerGeneration, setPickerGeneration] = useState(0);
  const runRequest = useRef<{ versionId: string; credentialId: string; key: string } | null>(null);
  const retryRequest = useRef<{ runId: string; key: string } | null>(null);

  const [challenges, setChallenges] = useState<AnimationChallengeView[]>([]);
  const [credentials, setCredentials] = useState<ProviderCredentialView[]>([]);
  const [challengeVersionId, setChallengeVersionId] = useState('');
  const [credentialId, setCredentialId] = useState('');
  const [buildTitle, setBuildTitle] = useState('');
  const [instructions, setInstructions] = useState('');
  const [build, setBuild] = useState<AgentBuildView | null>(null);
  const [runStatus, setRunStatus] = useState<CreationRunStatusView | null>(null);
  const [bundle, setBundle] = useState<ArtifactBundleView | null>(null);
  const [previews, setPreviews] = useState<ArtifactPreviewFile[]>([]);
  const [publication, setPublication] = useState<OwnerPublicationView | null>(null);
  const [publicTitle, setPublicTitle] = useState('');
  const [publicDescription, setPublicDescription] = useState(t('builderPlus.defaultDescription'));
  const [publishConfirmed, setPublishConfirmed] = useState(false);
  const [entryId, setEntryId] = useState('');
  const [ballot, setBallot] = useState<ShowcaseBallotView | null>(null);
  const [ballotRequested, setBallotRequested] = useState(false);
  const [ballotPreviews, setBallotPreviews] = useState<{ a: ArtifactPreviewFile[]; b: ArtifactPreviewFile[] }>({ a: [], b: [] });
  const [leaderboard, setLeaderboard] = useState<ShowcaseLeaderboardView | null>(null);
  const [likes, setLikes] = useState<Record<string, LikeSummaryView>>({});
  const [loading, setLoading] = useState(true);
  const [busy, updateBusy] = useState<BusyAction>(null);
  const busyRef = useRef<BusyAction>(null);
  const setBusy = useCallback((value: React.SetStateAction<BusyAction>) => {
    const next = typeof value === 'function' ? value(busyRef.current) : value;
    busyRef.current = next;
    updateBusy(next);
  }, []);
  const [authenticated, setAuthenticated] = useState(false);
  const [allowedHosts, setAllowedHosts] = useState<string[]>([]);
  const [skillRefs, setSkillRefs] = useState<readonly AgentBuildSkillRef[]>([]);
  const [skillBusy, setSkillBusy] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [storageWarning, setStorageWarning] = useState(false);
  const [pollingFailed, setPollingFailed] = useState(false);
  const [error, setError] = useState('');
  const [authRequired, setAuthRequired] = useState(false);

  const selected = useMemo(() => {
    for (const challenge of challenges) {
      const version = challenge.versions.find((candidate) => candidate.id === challengeVersionId);
      if (version) return { challenge, version };
    }
    return null;
  }, [challengeVersionId, challenges]);
  const selectedCredential = credentials.find((credential) => credential.id === credentialId) ?? null;
  const run = runStatus?.run ?? null;
  const jobUnknown = runStatus?.job?.state === 'unknown';
  const runActive = (run?.status === 'queued' || run?.status === 'running') && !jobUnknown;
  const runRetryable = Boolean(run?.evaluationJobId) && !jobUnknown
    && (run?.status === 'failed' || run?.status === 'cancelled' || run?.status === 'incomplete');
  const runComplete = run?.status === 'completed' && Boolean(run.artifactBundleId);
  const runFailureCode = runStatus?.job?.failure?.code;
  const runFailureMessageKey = runFailureCode ? RUN_FAILURE_MESSAGE_KEYS[runFailureCode] : undefined;
  const displayedRunStatusKey = jobUnknown
    ? 'artifactArena.status.unknown' as const
    : run
      ? RUN_STATUS_KEYS[run.status]
      : 'artifactArena.status.idle' as const;
  const isPublished = publication?.status === 'published';
  const previewReady = Boolean(
    bundle
      && previews.length > 0
      && previews.some((file) => file.relativePath === 'index.html'),
  );
  const partition = challengeVersionId ? roundId(challengeVersionId) : '';
  const dirty = !draftMatchesBuild({ title: buildTitle, instructions, skillRefs }, build ? {
    title: build.version.title, instructions: build.version.agentDefinition.instructions, skillRefs: build.version.agentDefinition.skillRefs,
  } : null);
  const locked = loading || busy !== null || !authenticated;
  const editingLocked = locked || runActive || skillBusy;

  const fail = useCallback((reason: unknown) => {
    setAuthRequired(isApiError(reason) && reason.code === 'AUTH_REQUIRED');
    const message = localizeError(reason, t);
    setError(message);
    toast(message || t('artifactArena.operationFailed'), true);
  }, [t, toast]);
  const failureHandler = useRef(fail);
  failureHandler.current = fail;
  const reportFailure = useCallback((reason: unknown) => failureHandler.current(reason), []);

  const persist = useCallback((patch: PersistedCreationSession) => {
    if (!storageKey.current) return;
    try {
      const next = parseCreationSession(JSON.stringify({ ...parseCreationSession(window.localStorage.getItem(storageKey.current)), ...patch }));
      window.localStorage.setItem(storageKey.current, JSON.stringify(next));
      setStorageWarning(false);
    } catch {
      // A storage failure must not turn a successful remote save/run into a reported failure.
      setStorageWarning(true);
    }
  }, []);

  const loadBundle = useCallback(async (bundleId: string) => {
    const scope = epoch.current;
    setPreviewLoading(true);
    setBundle(null);
    setPreviews([]);
    setPublishConfirmed(false);    try {
      const nextBundle = await getArtifactBundle(bundleId);
      const results = await Promise.allSettled(nextBundle.entries.map(async (entry) => previewFile(entry, await getArtifactPreview(entry.artifactId))));
      if (scope !== epoch.current) return;
      setBundle(nextBundle);
      setPreviews(results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []));
      const failure = results.find((result) => result.status === 'rejected');
      if (failure?.status === 'rejected') reportFailure(failure.reason);
    } catch (reason) {
      if (scope === epoch.current) reportFailure(reason);
    } finally {
      if (scope === epoch.current) setPreviewLoading(false);
    }
  }, [reportFailure]);

  const refreshLeaderboard = useCallback(async (showBusy = true) => {
    if (!partition || (showBusy && busyRef.current)) return;
    const scope = epoch.current;
    const requestId = ++leaderboardRequest.current;
    const revision = likeRevision.current;
    if (showBusy) setBusy('leaderboard');
    try {
      const next = await getShowcaseLeaderboard({ roundId: partition, comparatorKey: COMPARATOR_KEY, policyVersion: POLICY_VERSION });
      if (scope !== epoch.current || requestId !== leaderboardRequest.current) return;
      setLeaderboard(next);
      const summaries = await Promise.all(next.rows.map(async (row) => {
        try { return await getPublicationLikes(row.publication.publicationId); }
        catch { return null; }
      }));
      if (scope !== epoch.current || requestId !== leaderboardRequest.current) return;
      if (revision !== likeRevision.current) return;
      setLikes((current) => {
        const updated = { ...current };
        summaries.forEach((summary) => { if (summary) updated[summary.publicationId] = summary; });
        return updated;
      });
    } catch (reason) {
      if (scope === epoch.current) reportFailure(reason);
    } finally {
      if (showBusy) setBusy((value) => value === 'leaderboard' ? null : value);
    }
  }, [reportFailure, partition, setBusy]);

  useEffect(() => {
    if (!UI_ENABLED) { setLoading(false); return; }
    const controller = new AbortController();
    const scope = ++epoch.current;
    const current = () => !controller.signal.aborted && scope === epoch.current;
    void (async () => {
      setLoading(true);
      try {
        const [challengeResult, providerResult] = await Promise.allSettled([
          listAnimationChallenges(controller.signal), listProviders(controller.signal),
        ]);
        if (!current()) return;
        setAuthRequired(false);
        if (challengeResult.status === 'rejected') throw challengeResult.reason;
        const challengeRows = challengeResult.value;        setChallenges(challengeRows);
        let saved: PersistedCreationSession = {};
        if (providerResult.status === 'fulfilled') {
          const providers = providerResult.value;
          setAuthenticated(true);
          setAllowedHosts(providers.allowedHosts);
          setCredentials(providers.credentials);
          storageKey.current = `${STORAGE_KEY}:${providers.ownerId}`;
          try { saved = parseCreationSession(window.localStorage.getItem(storageKey.current)); }
          catch { setStorageWarning(true); }
          setCredentialId(providers.credentials.some((item) => item.id === saved.credentialId)
            ? saved.credentialId! : providers.credentials[0]?.id ?? '');
        } else if (!isApiError(providerResult.reason) || providerResult.reason.status !== 401) {
          reportFailure(providerResult.reason);
        }
        const versions = challengeRows.flatMap((challenge) => challenge.versions);
        const version = versions.find((candidate) => candidate.id === saved.challengeVersionId) ?? versions[0];
        setChallengeVersionId(version?.id ?? '');
        const title = (initialLanguage.current === 'zh-CN' ? version?.title : version?.titleEn) ?? '';
        setBuildTitle(saved.draftTitle ?? title);
        setPublicTitle(title);
        setInstructions(saved.draftInstructions ?? initialInstructions.current);
        setSkillRefs(saved.draftSkillRefs ?? []);
        let loadedBuild: AgentBuildView | null = null;
        if (saved.buildId) {
          try {
            loadedBuild = await getAgentBuild(saved.buildId, saved.buildVersionId, controller.signal);
            if (!current()) return;
            if (loadedBuild.version.animationChallengeVersionId !== version?.id) loadedBuild = null;
            if (loadedBuild) {
              setBuild(loadedBuild);
              setBuildTitle(saved.draftTitle ?? loadedBuild.version.title);
              setInstructions(saved.draftInstructions ?? loadedBuild.version.agentDefinition.instructions);
              setSkillRefs(saved.draftSkillRefs ?? loadedBuild.version.agentDefinition.skillRefs);
            }
          } catch (reason) { if (current()) reportFailure(reason); }
        }
        if (saved.runId && loadedBuild) {
          try {
            const loadedRun = await getCreationRun(saved.runId, controller.signal);
            if (!current()) return;
            if (loadedRun.run.buildVersionId === loadedBuild.version.id && loadedRun.run.challengeVersionId === version?.id) {
              setRunStatus(loadedRun);
              if (loadedRun.run.artifactBundleId) await loadBundle(loadedRun.run.artifactBundleId);
              if (saved.publicationId) {
                const loadedPublication = await getOwnerPublication(saved.publicationId, controller.signal);
                if (!current()) return;
                setPublication(loadedPublication);
                setPublicTitle(loadedPublication.title);
                setPublicDescription(loadedPublication.description);
                setEntryId(saved.entryId ?? '');
              }
            }
          } catch (reason) { if (current()) reportFailure(reason); }
        }
      } catch (reason) {
        if (current()) reportFailure(reason);
      } finally {
        if (current()) setLoading(false);
      }
    })();
    return () => { controller.abort(); epoch.current += 1; };
  }, [reportFailure, loadBundle, bootAttempt]);

  useEffect(() => {
    if (loading || !authenticated) return;
    const timer = window.setTimeout(() => persist({ challengeVersionId, credentialId, draftTitle: buildTitle,
      draftInstructions: instructions, draftSkillRefs: skillRefs }), 300);
    return () => window.clearTimeout(timer);
  }, [authenticated, buildTitle, challengeVersionId, credentialId, instructions, loading, persist, skillRefs]);

  useEffect(() => {
    if (!dirty && !busy && !skillBusy) return;
    const guard = (event: BeforeUnloadEvent) => {
      if (!authenticated) return;
      persist({ challengeVersionId, credentialId, draftTitle: buildTitle, draftInstructions: instructions, draftSkillRefs: skillRefs });
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [authenticated, dirty, busy, skillBusy, persist, challengeVersionId, credentialId, buildTitle, instructions, skillRefs]);

  useEffect(() => {
    if (!runActive || !run?.id || loading) return;
    const controller = new AbortController();
    const scope = epoch.current;
    let delay = 1500;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await getCreationRun(run.id, controller.signal);
        if (controller.signal.aborted || scope !== epoch.current) return;
        setPollingFailed(false);
        setRunStatus(next);
        delay = 1500;
        if (next.run.artifactBundleId) await loadBundle(next.run.artifactBundleId);
        if (next.run.status !== 'running' && next.run.status !== 'queued') return;
      } catch {
        if (controller.signal.aborted || scope !== epoch.current) return;
        setPollingFailed(true);
        delay = Math.min(delay * 2, 15000);
      }
      if (!controller.signal.aborted && scope === epoch.current) timer = setTimeout(poll, delay);
    };
    timer = setTimeout(poll, delay);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [loadBundle, loading, run?.id, runActive]);

  useEffect(() => {
    if (partition && !loading) void refreshLeaderboard(false);
  }, [partition, refreshLeaderboard, loading]);

  const changeChallenge = (next: string) => {
    if (loading || busyRef.current || runActive || skillBusy || next === challengeVersionId) return;
    if (dirty && buildTitle && !window.confirm(t('builderPlus.discardChanges'))) return;
    epoch.current += 1;
    setPreviewLoading(false);
    setPollingFailed(false);
    setChallengeVersionId(next);
    setBuild(null);
    setRunStatus(null);
    setBundle(null);
    setPreviews([]);
    setPublishConfirmed(false);
    setPublication(null);
    setEntryId('');
    setBallot(null);
    setBallotPreviews({ a: [], b: [] });
    setLeaderboard(null);
    const version = challenges.flatMap((challenge) => challenge.versions).find((item) => item.id === next);
    const title = language === 'zh-CN' ? version?.title ?? '' : version?.titleEn ?? '';
    setBuildTitle(title);
    setPublicTitle(title);
    setInstructions(t('builderPlus.defaultInstructions'));
    setSkillRefs([]);
    setBallotRequested(false);
    setLikes({});
    setError('');
    persist({ draftTitle: title, draftInstructions: t('builderPlus.defaultInstructions'), draftSkillRefs: [], challengeVersionId: next, buildId: '', buildVersionId: '', runId: '', publicationId: '', entryId: '' });
  };

  const credentialSaved = (saved: ProviderCredentialView) => {
    setCredentials((rows) => [saved, ...rows.filter((row) => row.id !== saved.id)]);
    setCredentialId(saved.id);
    persist({ credentialId: saved.id });  };

  const saveBuild = async () => {
    if (!selected || editingLocked || busyRef.current || !buildTitle.trim() || !instructions.trim()) return;
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
          skillRefs,
          requestedCapabilities: [],
          outputContractRef: selected.challenge.agentBuildContract.outputContractRef,
          profileRef: null,
          environmentRef: selected.challenge.agentBuildContract.environmentRef,
          runtimeSelection: selected.challenge.agentBuildContract.runtimeSelection,
        },
      });
      epoch.current += 1;
      setPreviewLoading(false);
      setBuild(saved);
      setSkillRefs(saved.version.agentDefinition.skillRefs);
      persist({ draftTitle: buildTitle, draftInstructions: instructions, draftSkillRefs: skillRefs, challengeVersionId: selected.version.id, buildId: saved.id, buildVersionId: saved.version.id, runId: '', publicationId: '', entryId: '' });
      setRunStatus(null); setBundle(null); setPreviews([]); setPublishConfirmed(false); setPublication(null); setEntryId('');      toast(t('artifactArena.buildSaved'));
    } catch (reason) { fail(reason); }
    finally { setBusy(null); }
  };

  const startRun = async () => {
    if (!selected || !build || !credentialId || editingLocked || dirty || busyRef.current) return;
    setBusy('run'); setError('');
    try {
      const previous = runRequest.current;
      const key = previous?.versionId === build.version.id && previous.credentialId === credentialId ? previous.key : crypto.randomUUID();
      runRequest.current = { versionId: build.version.id, credentialId, key };
      const next = await createCreationRun({ buildVersionId: build.version.id, challengeVersionId: selected.version.id, credentialId, idempotencyKey: key }, { idempotencyKey: key });
      epoch.current += 1;
      runRequest.current = null;
      setPreviewLoading(false);
      setPollingFailed(false);
      setRunStatus(next);
      setBundle(null); setPreviews([]); setPublishConfirmed(false); setPublication(null); setEntryId('');
      persist({ runId: next.run.id, publicationId: '', entryId: '' });
    } catch (reason) { fail(reason); }
    finally { setBusy(null); }
  };

  const cancelRun = async () => {
    if (locked || busyRef.current || skillBusy) return;
    if (!run) return;
    setBusy('cancel');
    try { setRunStatus(await cancelCreationRun(run.id)); }
    catch (reason) { fail(reason); }
    finally { setBusy(null); }
  };

  const acknowledgeUnknownRun = async () => {
    if (!run || !jobUnknown || !window.confirm(t('artifactArena.unknownConfirm'))) return;
    setBusy('acknowledge'); setError('');
    try {
      setRunStatus(await acknowledgeUnknownCreationRun(run.id));
      toast(t('artifactArena.unknownAcknowledged'));
    } catch (reason) { fail(reason); }
    finally { setBusy(null); }
  };

  const retryRun = async () => {
    if (locked || busyRef.current || skillBusy) return;
    if (!run) return;
    setBusy('retry');
    try {
      const key = retryRequest.current?.runId === run.id ? retryRequest.current.key : crypto.randomUUID();
      retryRequest.current = { runId: run.id, key };
      const next = await retryCreationRun(run.id, key);
      retryRequest.current = null;
      epoch.current += 1;
      setPreviewLoading(false);
      setPublication(null); setEntryId(''); setPublishConfirmed(false);
      setRunStatus(next); setBundle(null); setPreviews([]);
      persist({ runId: next.run.id, publicationId: '', entryId: '' });    } catch (reason) { fail(reason); }
    finally { setBusy(null); }
  };

  const publish = async () => {
    if (locked || busyRef.current || skillBusy) return;
    if (!run || !bundle || !previewReady || !publishConfirmed) return;    setBusy('publish');
    try {
      const next = await requestPublication({
        publishConfirmed: true,
        creationRunId: run.id,
        expectedSnapshotDigest: bundle.snapshotDigest,
        expectedManifestDigest: bundle.manifestDigest,
        title: publicTitle.trim(),
        description: publicDescription.trim(),
        entryPath: 'index.html',
        publicArtifactIds: bundle.entries.map((entry) => entry.artifactId),
      });
      setPublication(next);
      setPublishConfirmed(false);
      persist({ publicationId: next.id });
      toast(t('artifactArena.publication.published'));
    } catch (reason) { fail(reason); }
    finally { setBusy(null); }
  };

  const refreshPublication = async () => {
    if (locked || busyRef.current || skillBusy) return;
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
    if (editingLocked || dirty || busyRef.current) return;
    if (!build) return;
    setBusy('fork');
    try {
      const fork = await forkAgentBuild(build.id, build.version.id);
      setBuild(fork);
      epoch.current += 1;
      setPreviewLoading(false);
      setBuildTitle(fork.title);
      setInstructions(fork.version.agentDefinition.instructions);
      setSkillRefs(fork.version.agentDefinition.skillRefs);
      setRunStatus(null); setBundle(null); setPreviews([]); setPublishConfirmed(false); setPublication(null); setEntryId('');
      persist({ draftTitle: fork.title, draftInstructions: fork.version.agentDefinition.instructions, draftSkillRefs: fork.version.agentDefinition.skillRefs, buildId: fork.id, buildVersionId: fork.version.id, runId: '', publicationId: '', entryId: '' });      toast(t('artifactArena.buildForked'));
    } catch (reason) { fail(reason); }
    finally { setBusy(null); }
  };

  const enterRanking = async () => {
    if (locked || busyRef.current || skillBusy) return;
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
    if (locked || busyRef.current || skillBusy) return;
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
    if (locked || busyRef.current || skillBusy || !ballot || ballot.status !== 'open' || Date.parse(ballot.expiresAt) <= Date.now()) return;
    setBusy('vote');
    try {
      const previous = voteRequest.current;
      const key = previous?.ballotId === ballot.id && previous.choice === choice ? previous.key : crypto.randomUUID();
      voteRequest.current = { ballotId: ballot.id, choice, key };
      const result = await castShowcaseVote(ballot.id, choice, key);
      voteRequest.current = null;
      setBallot(result.ballot);
      toast(t('artifactArena.voteSent'));
      await refreshLeaderboard(false);
    } catch (reason) { fail(reason); }
    finally { setBusy(null); }
  };

  const toggleLike = async (publicationId: string) => {
    if (locked || busyRef.current || skillBusy) return;
    const current = likes[publicationId];
    setBusy(`like:${publicationId}`);
    likeRevision.current += 1;
    try {
      const next = current?.likedByViewer ? await unlikePublication(publicationId) : await likePublication(publicationId);
      setLikes((rows) => ({ ...rows, [publicationId]: next }));
    } catch (reason) { fail(reason); }
    finally { setBusy(null); }
  };

  useEffect(() => {
    if (ballot?.status !== 'open') return;
    const timer = window.setTimeout(() => setBallot((current) => current?.id === ballot.id ? { ...current, status: 'expired' } : current),
      Math.max(0, Math.min(Date.parse(ballot.expiresAt) - Date.now(), 2_147_483_647)));
    return () => window.clearTimeout(timer);
  }, [ballot?.id, ballot?.status, ballot?.expiresAt]);

  const reset = () => {
    if (editingLocked || busyRef.current) return;
    if (!window.confirm(t('builderPlus.resetConfirm'))) return;
    epoch.current += 1;
    try { if (storageKey.current) window.localStorage.removeItem(storageKey.current); }
    catch { setStorageWarning(true); }
    setBuild(null); setRunStatus(null); setBundle(null); setPreviews([]); setPublishConfirmed(false); setPublication(null); setEntryId('');
    setBallot(null); setBallotRequested(false); setBallotPreviews({ a: [], b: [] });
    setPickerGeneration((n) => n + 1);
    setSkillRefs([]); setInstructions(t('builderPlus.defaultInstructions')); setPollingFailed(false); setPreviewLoading(false);
    const title = language === 'zh-CN' ? selected?.version.title ?? '' : selected?.version.titleEn ?? '';
    setPublicTitle(title); setBuildTitle(title); setPublicDescription(t('builderPlus.defaultDescription')); setError(''); setAuthRequired(false);  };

  if (!UI_ENABLED) {
    return <main className={styles.shell}><div className={styles.disabled}><AlertTriangle /><h1>{t('artifactArena.unavailable')}</h1></div></main>;
  }

  return (
    <main className={styles.shell}>
      <header className={styles.hero}>
        <div className={styles.heroTop}>
          <Link href="/" className={styles.brand}>AgentForge / Artifact Arena</Link>
          <div className={styles.heroActions}><LanguageSwitcher /><Button variant="ghost" size="sm" onClick={reset} disabled={editingLocked}><RotateCcw size={13} />{t('artifactArena.reset')}</Button></div>
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
          <StepLabel complete={Boolean(build) && !dirty}>{t('artifactArena.step.build')}</StepLabel>
          <StepLabel complete={runComplete}>{t('artifactArena.step.run')}</StepLabel>
          <StepLabel complete={previewReady}>{t('artifactArena.step.preview')}</StepLabel>
          <StepLabel complete={Boolean(publication)}>{t('artifactArena.step.publish')}</StepLabel>
          <StepLabel complete={Boolean(entryId)}>{t('artifactArena.step.community')}</StepLabel>
        </div>
      </header>

      {loading && <div className={styles.banner}><LoaderCircle className={styles.spin} size={16} />{t('artifactArena.recovering')}</div>}
      {!loading && !authenticated && <div className={styles.banner}><Link href="/login?next=/agent-builder">{t('builderPlus.signIn')}</Link></div>}
      {!loading && (!authenticated || challenges.length === 0) && <Button variant="outline" onClick={() => { setError(''); setBootAttempt((n) => n + 1); }}>{t('common.tryAgain')}</Button>}
      {storageWarning && <div className={styles.banner} role="status">{t('builderPlus.storageUnavailable')}</div>}
      {error && <div className={`${styles.banner} ${styles.errorBanner}`} role="alert"><AlertTriangle size={16} /><span>{error}</span>{authRequired && <Link href="/login?next=/agent-builder" className={styles.bannerAction}>{t('artifactArena.signInAgain')}</Link>}</div>}      <div className={styles.securityNote}><ShieldCheck size={18} /><p>{t('artifactArena.securityNote')}</p></div>

      <section className={styles.stage}>
        <div className={styles.stageHeader}><span>01</span><div><h2>{t('artifactArena.challengeTitle')}</h2><p>{t('artifactArena.challengeHelp')}</p></div></div>
        <div className={styles.challengeGrid}>
          {challenges.flatMap((challenge) => challenge.versions.map((version) => {
            const active = version.id === challengeVersionId;
            return <button key={version.id} type="button" className={`${styles.challengeCard} ${active ? styles.challengeActive : ''}`} disabled={loading || busy !== null || runActive || skillBusy} onClick={() => changeChallenge(version.id)} aria-pressed={active}>
              <div className={styles.challengeCardTop}><span>{String(challenge.position).padStart(2, '0')}</span><small>{t('artifactArena.version', { version: version.versionNumber })}</small></div>
              <h3>{language === 'zh-CN' ? version.title : version.titleEn}</h3>
              <p>{language === 'zh-CN' ? version.instructions : version.instructionsEn}</p>
              <div className={styles.challengeMeta}>{challenge.runAvailability.enabled ? <><CheckCircle2 size={13} />{t('artifactArena.available')}</> : <><AlertTriangle size={13} />{t('artifactArena.unavailable')}</>}</div>
            </button>;
          }))}
        </div>
        {selected && <div className={styles.promptPlate}><span>{t('artifactArena.originalPrompt')}</span><blockquote>{language === 'zh-CN' ? selected.version.instructions : selected.version.instructionsEn}</blockquote><p>{t('artifactArena.requirements')}</p></div>}
      </section>

      <div className={styles.twoColumn}>
        <section className={styles.stage}>
          <div className={styles.stageHeader}><span>02</span><div><h2>{t('artifactArena.providerTitle')}</h2><p>{t('artifactArena.providerHelp')}</p></div></div>
          <AgentProviderForm disabled={editingLocked || credentials.length >= 10} allowedHosts={allowedHosts} onSaved={credentialSaved} />
          <p className={styles.providerNote}>{t('builderPlus.credentialCount', { count: credentials.length })} <Link href="/providers">{t('navigation.manageCredentials')}</Link></p>
          <div className={styles.savedBox}><label><span>{t('artifactArena.selectCredential')}</span><select disabled={editingLocked} value={credentialId} onChange={(event) => { setCredentialId(event.target.value); persist({ credentialId: event.target.value }); }}><option value="">{t('artifactArena.noCredentials')}</option>{credentials.map((credential) => <option key={credential.id} value={credential.id}>{credential.name} · {credential.modelId} · {credential.keyMask}</option>)}</select></label>{selectedCredential && <small>{t(`providers.protocol.${selectedCredential.protocol}`)} · {selectedCredential.baseUrl}</small>}</div>        </section>

        <section className={styles.stage}>
          <div className={styles.stageHeader}><span>03</span><div><h2>{t('artifactArena.buildTitle')}</h2><p>{t('artifactArena.instructionsHelp')}</p></div></div>
          <div className={styles.formGrid}>
            <label className={styles.fullField}><span>{t('artifactArena.buildName')}</span><input disabled={editingLocked} required minLength={1} maxLength={80} value={buildTitle} onChange={(event) => setBuildTitle(event.target.value)} /></label>
            <label className={styles.fullField}><span>{t('artifactArena.instructions')}</span><textarea disabled={editingLocked} required minLength={1} maxLength={8000} rows={9} value={instructions} onChange={(event) => setInstructions(event.target.value)} /></label>
            <div className={`${styles.fullField} ${styles.buttonRow}`}><Button variant="default" onClick={saveBuild} disabled={editingLocked || !selected || !buildTitle.trim() || !instructions.trim()}>{busy === 'build' ? <LoaderCircle className={styles.spin} size={14} /> : <Save size={14} />}{busy === 'build' ? t('artifactArena.savingBuild') : t('artifactArena.saveBuild')}</Button>{build && <Button variant="outline" onClick={forkBuild} disabled={editingLocked || dirty}>{busy === 'fork' ? <LoaderCircle className={styles.spin} size={14} /> : <GitFork size={14} />}{busy === 'fork' ? t('artifactArena.forkingBuild') : t('artifactArena.forkBuild')}</Button>}</div>
          </div>
          {authenticated && <AgentSkillPicker key={`${challengeVersionId}:${pickerGeneration}`} value={skillRefs} onChange={setSkillRefs} disabled={locked || runActive} onBusyChange={setSkillBusy} />}
          <p className={styles.providerNote} role="status">{t(dirty ? 'builderPlus.unsavedChanges' : 'builderPlus.savedVersion')}</p>
          {build && <div className={styles.digestLine}><span>Build {build.id}</span><span>v{build.version.revision}</span><code>{build.version.definitionDigest.slice(0, 24)}…</code></div>}
        </section>
      </div>

      <section className={styles.stage}>
        <div className={styles.stageHeader}><span>04</span><div><h2>{t('artifactArena.runTitle')}</h2><p>{t('artifactArena.resumeHint')}</p></div></div>
        <div className={styles.runConsole}>
          <div>
            <div className={styles.runStatus}><span>{t('artifactArena.status')}</span><strong className={runActive ? styles.live : runComplete ? styles.success : ''}>{t(displayedRunStatusKey)}</strong>{runFailureCode && <code>{runFailureCode}</code>}</div>
            {runFailureMessageKey && <p className={styles.runFailureHelp}>{t(runFailureMessageKey)}</p>}
          </div>
          <div className={styles.buttonRow}><Button variant="default" onClick={startRun} disabled={editingLocked || dirty || !selected?.challenge.runAvailability.enabled || !build || !credentialId || jobUnknown}>{busy === 'run' ? <LoaderCircle className={styles.spin} size={14} /> : <Play size={14} />}{busy === 'run' ? t('artifactArena.runStarting') : t('artifactArena.startRun')}</Button>{runActive && <Button variant="destructive" onClick={cancelRun} disabled={locked}>{busy === 'cancel' ? <LoaderCircle className={styles.spin} size={14} /> : <PauseCircle size={14} />}{busy === 'cancel' ? t('artifactArena.cancellingRun') : t('artifactArena.cancelRun')}</Button>}{jobUnknown && <Button variant="outline" onClick={acknowledgeUnknownRun} disabled={locked}>{busy === 'acknowledge' ? <LoaderCircle className={styles.spin} size={14} /> : <AlertTriangle size={14} />}{busy === 'acknowledge' ? t('artifactArena.acknowledgingUnknown') : t('artifactArena.acknowledgeUnknown')}</Button>}{runRetryable && <Button variant="outline" onClick={retryRun} disabled={locked || skillBusy}>{busy === 'retry' ? <LoaderCircle className={styles.spin} size={14} /> : <RefreshCw size={14} />}{busy === 'retry' ? t('artifactArena.retryingRun') : t('artifactArena.retryRun')}</Button>}</div>
          {jobUnknown && <p className={styles.hint}>{t('artifactArena.unknownHelp')}</p>}        </div>
        {pollingFailed && <p className={styles.providerNote} role="status">{t('builderPlus.pollingRetry')}</p>}
        {dirty && <p className={styles.providerNote}>{t('builderPlus.saveBeforeRun')}</p>}
        {run && <div className={styles.timeline}><span>{run.id}</span><span>{runStatus?.job?.state ?? run.status}</span><span>{run.updatedAt}</span></div>}
      </section>

      <section className={styles.stage}>
        <div className={styles.stageHeader}><span>05</span><div><h2>{t('artifactArena.previewTitle')}</h2><p>{t('artifactArena.previewDescription')}</p></div></div>
        {previewLoading && previews.length === 0 ? <div className={styles.empty}><LoaderCircle className={styles.spin} />{t('artifactArena.previewLoading')}</div> : <ArtifactPreviewPanel files={previews} heading={t('artifactArena.previewTitle')} description={t('artifactArena.previewDescription')} sourceLabel={t('artifactPreview.sealedSource')} emptyMessage={t('artifactArena.previewEmpty')} featured />}        {bundle && <div className={styles.fileActions}>{bundle.entries.map((entry) => <Button key={entry.artifactId} variant="ghost" size="sm" onClick={async () => {
          try { const blob = await downloadArtifact(entry.artifactId); const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = entry.relativePath.split('/').pop() || 'artifact'; document.body.append(anchor); anchor.click(); anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); } catch (reason) { fail(reason); }
        }}><Download size={13} />{t('artifactArena.download')} {entry.relativePath}</Button>)}</div>}
      </section>

      <div className={styles.twoColumn}>
        <section className={styles.stage}>
          <div className={styles.stageHeader}><span>06</span><div><h2>{t('artifactArena.publishTitle')}</h2><p>{t('artifactArena.publishHelp')}</p></div></div>
          <div className={styles.formGrid}>
            <label className={styles.fullField}><span>{t('artifactArena.publicTitle')}</span><input disabled={editingLocked || Boolean(publication)} minLength={1} maxLength={160} value={publicTitle} onChange={(event) => setPublicTitle(event.target.value)} /></label>
            <label className={styles.fullField}><span>{t('artifactArena.publicDescription')}</span><textarea disabled={editingLocked || Boolean(publication)} minLength={1} maxLength={2000} rows={5} value={publicDescription} onChange={(event) => setPublicDescription(event.target.value)} /></label>
            <label className={`${styles.fullField} ${styles.publishConsent}`}><input type="checkbox" checked={publishConfirmed} onChange={(event) => setPublishConfirmed(event.target.checked)} disabled={editingLocked || !runComplete || !previewReady || Boolean(publication)} /><span><strong>{t('artifactArena.publishConsent')}</strong><small>{t('artifactArena.publishConsentHelp')}</small></span></label>
            <div className={`${styles.fullField} ${styles.buttonRow}`}><Button variant="default" onClick={publish} disabled={editingLocked || !runComplete || !previewReady || !publishConfirmed || !publicTitle.trim() || !publicDescription.trim() || Boolean(publication)}>{busy === 'publish' ? <LoaderCircle className={styles.spin} size={14} /> : <Sparkles size={14} />}{busy === 'publish' ? t('artifactArena.publishing') : t('artifactArena.publishNow')}</Button>{publication && <Button variant="outline" onClick={refreshPublication} disabled={locked}><RefreshCw className={busy === 'publication' ? styles.spin : ''} size={14} />{t('artifactArena.refreshStatus')}</Button>}</div>          </div>
          {publication && <div className={`${styles.publicationState} ${isPublished ? styles.published : ''}`}><span>{t('artifactArena.publicationStatus')}</span><strong>{t(PUBLICATION_STATUS_KEYS[publication.status])}</strong><code>{publication.releaseDigest.slice(0, 24)}…</code></div>}
        </section>

        <section className={styles.stage}>
          <div className={styles.stageHeader}><span>07</span><div><h2>{t('artifactArena.communityTitle')}</h2><p>{t('artifactArena.communityHelp')}</p></div></div>
          <div className={styles.communityActions}><Button variant="default" onClick={enterRanking} disabled={locked || !isPublished || Boolean(entryId)}>{busy === 'entry' ? <LoaderCircle className={styles.spin} size={14} /> : <Trophy size={14} />}{busy === 'entry' ? t('artifactArena.enteringRanking') : entryId ? t('artifactArena.enteredRanking') : t('artifactArena.enterRanking')}</Button><Button variant="outline" onClick={issueBallot} disabled={locked || !partition}>{busy === 'ballot' ? <LoaderCircle className={styles.spin} size={14} /> : <Vote size={14} />}{busy === 'ballot' ? t('artifactArena.issuingBallot') : t('artifactArena.issueBallot')}</Button></div>
          {ballot && ballot.candidates ? <div className={styles.ballot}>
            {(['a', 'b'] as const).map((side) => <article key={side} className={styles.candidate}><div className={styles.candidateHeader}><span>{side === 'a' ? t('artifactArena.candidateA') : t('artifactArena.candidateB')}</span><ShieldCheck size={14} /></div><ArtifactPreviewPanel files={ballotPreviews[side]} heading={side === 'a' ? t('artifactArena.candidateA') : t('artifactArena.candidateB')} description={t('artifactArena.previewDescription')} sourceLabel={t('artifactPreview.publishedSource')} emptyMessage={t('artifactArena.previewLoading')} /></article>)}
            <div className={styles.voteRow}><Button onClick={() => vote('a')} disabled={locked || ballot.status !== 'open' || Date.parse(ballot.expiresAt) <= Date.now()}>{t('artifactArena.voteA')}</Button><Button onClick={() => vote('tie')} disabled={locked || ballot.status !== 'open' || Date.parse(ballot.expiresAt) <= Date.now()}>{t('artifactArena.voteTie')}</Button><Button onClick={() => vote('b')} disabled={locked || ballot.status !== 'open' || Date.parse(ballot.expiresAt) <= Date.now()}>{t('artifactArena.voteB')}</Button><Button variant="ghost" onClick={() => vote('skip')} disabled={locked || ballot.status !== 'open' || Date.parse(ballot.expiresAt) <= Date.now()}>{t('artifactArena.voteSkip')}</Button></div>          </div> : ballotRequested ? <div className={styles.empty}>{t('artifactArena.noBallot')}</div> : null}
        </section>
      </div>

      <section className={styles.stage}>
        <div className={styles.stageHeader}><span>08</span><div><h2>{t('artifactArena.leaderboard')}</h2><p>{partition}</p></div><Button variant="ghost" size="sm" onClick={() => refreshLeaderboard()} disabled={busy === 'leaderboard'}><RefreshCw className={busy === 'leaderboard' ? styles.spin : ''} size={13} />{t('artifactArena.refreshLeaderboard')}</Button></div>
        {leaderboard && <><div className={`${styles.sampleBar} ${leaderboard.sample.qualified ? styles.sampleQualified : ''}`}><div><strong>{leaderboard.sample.qualified ? t('artifactArena.sampleQualified') : t('artifactArena.sampleInsufficient', { votes: leaderboard.sample.minValidVotes, voters: leaderboard.sample.minIndependentVoters })}</strong><span>{t('artifactArena.sample', { votes: leaderboard.sample.validVotes, voters: leaderboard.sample.independentVoters })}</span></div><div><span>{t('artifactArena.validVotes')}</span><strong>{formatNumber(leaderboard.sample.validVotes)}</strong></div><div><span>{t('artifactArena.independentVoters')}</span><strong>{formatNumber(leaderboard.sample.independentVoters)}</strong></div></div>
          {leaderboard.rows.length ? <div className={styles.leaderRows}>{leaderboard.rows.map((row, index) => { const summary = likes[row.publication.publicationId]; return <article className={styles.leaderRow} key={row.entryId}><span className={styles.rank}>{row.qualified ? String(index + 1).padStart(2, '0') : '—'}</span><div><strong>{row.publication.title}</strong><p>{row.publication.description}</p></div><div className={styles.scoreCell}><span>{t('artifactArena.communityScore')}</span><strong>{row.qualified ? Math.round(row.score * 100) : '—'}</strong><small>{t('artifactArena.sample', { votes: row.comparisons, voters: row.validVoters })}</small>{!row.qualified && <small>{t('artifactArena.sampleInsufficient', { votes: leaderboard.sample.minValidVotes, voters: leaderboard.sample.minIndependentVoters })}</small>}</div><div className={styles.likeCell}><Button variant={summary?.likedByViewer ? 'default' : 'outline'} size="sm" onClick={() => toggleLike(row.publication.publicationId)} disabled={locked}><Heart size={13} fill={summary?.likedByViewer ? 'currentColor' : 'none'} />{summary?.likedByViewer ? t('artifactArena.unlike') : t('artifactArena.like')}</Button><span>{t('artifactArena.likes', { count: summary?.count ?? 0 })}</span></div></article>; })}</div> : <div className={styles.empty}>{t('artifactArena.noEntries')}</div>}
        </>}
      </section>
    </main>
  );
}
