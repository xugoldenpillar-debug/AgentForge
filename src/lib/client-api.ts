'use client';

import type { RunEvent } from '../shared/types.ts';

const MAX_ERROR_MESSAGE_LENGTH = 4000;

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function boundedMessage(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  return value.slice(0, MAX_ERROR_MESSAGE_LENGTH);
}

function stableCode(value: unknown): string | undefined {
  return typeof value === 'string' && /^[A-Z][A-Z0-9_]{1,99}$/.test(value) ? value : undefined;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status = 500, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/**
 * Accept the legacy `{ error: string }` envelope and the structured
 * `{ error: { code, message } }` envelope without ever stringifying an
 * arbitrary server object into the UI.
 */
export function normalizeApiError(payload: unknown, fallbackMessage: string, status = 500): ApiError {
  const envelope = isRecord(payload) && 'error' in payload ? payload.error : payload;
  if (typeof envelope === 'string') return new ApiError(boundedMessage(envelope, fallbackMessage), status);
  if (isRecord(envelope)) {
    return new ApiError(
      boundedMessage(envelope.message, fallbackMessage),
      status,
      stableCode(envelope.code)
    );
  }
  return new ApiError(fallbackMessage, status);
}

async function readPayload(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

export async function api<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/arena/${path}`, {
    credentials: 'same-origin',
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers }
  });
  const data = await readPayload(response);
  if (!response.ok) throw normalizeApiError(data, 'Request failed.', response.status);
  return data as T;
}

export const post = <T = unknown>(path: string, body: unknown) => api<T>(path, { method: 'POST', body: JSON.stringify(body) });

function parseRunEvent(line: string): RunEvent {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    throw new ApiError('Run stream returned invalid data.', 502, 'INTERNAL_SERVER_ERROR');
  }
  if (!isRecord(value)) throw new ApiError('Run stream returned invalid data.', 502, 'INTERNAL_SERVER_ERROR');
  if (value.type === 'error') throw normalizeApiError({ error: value }, 'Run failed.', 502);
  return value as RunEvent;
}

export async function consumeRun(body: unknown, onEvent: (event: RunEvent) => void, signal: AbortSignal): Promise<void> {
  const response = await fetch('/api/arena/runs', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal
  });
  if (!response.ok) {
    const data = await readPayload(response);
    throw normalizeApiError(data, 'Run failed.', response.status);
  }
  if (!response.body) throw new ApiError('No execution stream was returned.', 502, 'INTERNAL_SERVER_ERROR');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    let split: number;
    while ((split = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, split);
      buffer = buffer.slice(split + 1);
      if (line.trim()) onEvent(parseRunEvent(line));
    }
    if (done) break;
  }
  if (buffer.trim()) onEvent(parseRunEvent(buffer));
}

export type EvaluationJobState =
  | 'accepted'
  | 'queued'
  | 'running'
  | 'cancelling'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'incomplete'
  | 'unknown'
  | 'reconciling'
  | 'expired';

export type EvaluationAttemptState =
  | 'created'
  | 'claimed'
  | 'running'
  | 'cancelling'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'incomplete'
  | 'unknown'
  | 'reconciling'
  | 'expired';

export interface EvaluationStatus {
  job: {
    id: string;
    purpose: 'competitive' | 'author-self-test' | 'component-evaluation' | 'creation';
    state: EvaluationJobState;
    association: {
      kind: 'competitive-run' | 'self-test-run' | 'component-evaluation' | 'creation-run';
      runId?: string;
      visibility?: 'public' | 'hidden';
      businessRecordId?: string;
    };
    snapshot: {
      schemaVersion: number;
      buildVersionId: string;
      testSuiteVersionId: string | null;
      runtimeAdapter: string;
      modelOfferingId: string | null;
      policyVersion: string;
      capturedAt: string;
    };
    snapshotDigest: string;
    cancellationReason: string | null;
    cancellationRequestedAt: string | null;
    acceptedAt: string;
    createdAt: string;
    updatedAt: string;
    completedAt: string | null;
    completion: { evidence: 'complete' | 'partial' } | null;
    failure: { code: string; retryable: boolean } | null;
  };
  attempts: Array<{
    id: string;
    number: number;
    state: EvaluationAttemptState;
    startedAt: string | null;
    finishedAt: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  run: RecordValue | null;
}

export interface CreateEvaluationResponse extends EvaluationStatus {
  created: boolean;
}

const TERMINAL_EVALUATION_STATES = new Set<EvaluationJobState>([
  'completed',
  'failed',
  'cancelled',
  'incomplete',
  'unknown',
  'expired',
]);

export function isEvaluationTerminal(state: EvaluationJobState): boolean {
  return TERMINAL_EVALUATION_STATES.has(state);
}

export async function createEvaluation(
  body: RecordValue,
  options: { idempotencyKey?: string; signal?: AbortSignal } = {},
): Promise<CreateEvaluationResponse> {
  const bodyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : '';
  const optionKey = options.idempotencyKey?.trim() || '';
  if (optionKey && bodyKey && optionKey !== bodyKey) {
    throw new ApiError('The idempotency key header does not match the request body.', 409, 'REQUEST_VALIDATION_FAILED');
  }
  const key = optionKey || bodyKey;
  if (!key) throw new ApiError('An idempotency key is required for asynchronous evaluations.', 400, 'REQUEST_VALIDATION_FAILED');
  const payload = { ...body, idempotencyKey: key };
  return api<CreateEvaluationResponse>('evaluation-jobs', {
    method: 'POST',
    body: JSON.stringify(payload),
    signal: options.signal,
    headers: { 'Idempotency-Key': key },
  });
}

export async function getEvaluation(jobId: string, signal?: AbortSignal): Promise<EvaluationStatus> {
  if (!jobId.trim()) throw new ApiError('An evaluation job ID is required.', 400, 'REQUEST_VALIDATION_FAILED');
  return api<EvaluationStatus>(`evaluation-jobs/${encodeURIComponent(jobId)}`, { signal });
}

/** Fetch the durable status again after a browser/request disconnect. */
export async function recoverEvaluation(jobId: string, signal?: AbortSignal): Promise<EvaluationStatus> {
  return getEvaluation(jobId, signal);
}

export async function cancelEvaluation(
  jobId: string,
  options: { signal?: AbortSignal } = {},
): Promise<EvaluationStatus & { cancellationRequested: boolean }> {
  if (!jobId.trim()) throw new ApiError('An evaluation job ID is required.', 400, 'REQUEST_VALIDATION_FAILED');
  return api<EvaluationStatus & { cancellationRequested: boolean }>(`evaluation-jobs/${encodeURIComponent(jobId)}/cancel`, {
    method: 'POST',
    body: JSON.stringify({ reason: 'user-requested' }),
    signal: options.signal,
  });
}

function waitForPoll(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason ?? new DOMException('The operation was aborted.', 'AbortError'));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, delayMs);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(signal.reason ?? new DOMException('The operation was aborted.', 'AbortError'));
    }, { once: true });
  });
}

function isRetryablePollError(error: unknown): boolean {
  return !isApiError(error) || error.status === 408 || error.status === 425 || error.status === 429 || error.status >= 500;
}

/**
 * Polls the authoritative status endpoint. Transient network/server failures
 * are retried so a dropped browser connection can resume from the stable job ID;
 * auth, ownership, validation, and not-found errors are never hidden.
 */
export async function pollEvaluation(
  jobId: string,
  options: {
    intervalMs?: number;
    maxIntervalMs?: number;
    signal?: AbortSignal;
    onUpdate?: (status: EvaluationStatus) => void;
  } = {},
): Promise<EvaluationStatus> {
  let delay = Math.max(100, options.intervalMs ?? 1000);
  const maxDelay = Math.max(delay, options.maxIntervalMs ?? 5000);
  for (;;) {
    let status: EvaluationStatus;
    try {
      status = await getEvaluation(jobId, options.signal);
    } catch (error) {
      if (!isRetryablePollError(error)) throw error;
      await waitForPoll(delay, options.signal);
      delay = Math.min(maxDelay, delay * 2);
      continue;
    }
    options.onUpdate?.(status);
    if (isEvaluationTerminal(status.job.state)) return status;
    await waitForPoll(delay, options.signal);
    delay = Math.min(maxDelay, delay * 2);
  }
}

export async function consumePiSelfTest(
  body: unknown,
  onEvent: (event: Record<string, unknown>) => void,
  signal: AbortSignal
): Promise<void> {
  const response = await fetch('/api/arena/pi-self-test', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal
  });
  if (!response.ok) {
    const data = await readPayload(response);
    throw normalizeApiError(data, 'Pi self-test failed.', response.status);
  }
  if (!response.body) throw new ApiError('No execution stream was returned.', 502, 'INTERNAL_SERVER_ERROR');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    let split: number;
    while ((split = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, split);
      buffer = buffer.slice(split + 1);
      if (!line.trim()) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        throw new ApiError('Run stream returned invalid data.', 502, 'INTERNAL_SERVER_ERROR');
      }
      if (!isRecord(parsed)) throw new ApiError('Run stream returned invalid data.', 502, 'INTERNAL_SERVER_ERROR');
      if (parsed.type === 'error') throw normalizeApiError({ error: parsed }, 'Pi self-test failed.', 502);
      onEvent(parsed);
    }
    if (done) break;
  }
  if (buffer.trim()) {
    const parsed = JSON.parse(buffer) as Record<string, unknown>;
    if (parsed.type === 'error') throw normalizeApiError({ error: parsed }, 'Pi self-test failed.', 502);
    onEvent(parsed);
  }
}

export type ProviderProtocol = 'openai-chat' | 'openai-responses' | 'anthropic-messages' | 'google-generative-ai';

export interface ProviderCredentialView {
  id: string;
  name: string;
  protocol: ProviderProtocol;
  baseUrl: string;
  modelId: string;
  keyMask: string;
  inputPrice: number | null;
  outputPrice: number | null;
  createdAt: string;
}

export interface ProviderCatalogView {
  credentials: ProviderCredentialView[];
  demo: boolean;
  platform: { id: string; name: string; modelId: string; inputPrice: number | null; outputPrice: number | null } | null;
  allowedHosts: string[];
  customHostsEnabled: boolean;
  runtime: 'next';
}

export interface AgentBuildPinnedRefView {
  id: string;
  versionId: string;
  contentDigest: string;
}

export interface AgentRuntimeSelectionView {
  kind: 'pi';
  adapterVersion: string;
  policyVersion: string;
}

export interface AnimationChallengeVersionView {
  id: string;
  challengeId: string;
  versionNumber: number;
  title: string;
  titleEn: string;
  instructions: string;
  instructionsEn: string;
  outputPolicyVersion: 'svg-animation-v1';
  contentDigest: string;
}

export interface AnimationChallengeView {
  id: string;
  slug: string;
  position: number;
  status: 'published';
  versions: AnimationChallengeVersionView[];
  outputPolicy: {
    version: 'svg-animation-v1';
    requiredPaths: readonly ['index.html'];
    optionalReadme: true;
    inlineSvgRequired: true;
    hiddenSuite: false;
    automaticCorrectnessJudge: false;
    scriptsAllowed: false;
    animationModes: readonly ('css-keyframes' | 'svg-declarative')[];
    maxFiles: number;
    maxFileBytes: number;
    maxBundleBytes: number;
    maxParseDepth: number;
    maxNodes: number;
    maxAnimations: number;
  };
  agentBuildContract: {
    modelSelection: AgentBuildPinnedRefView;
    outputContractRef: AgentBuildPinnedRefView;
    environmentRef: AgentBuildPinnedRefView;
    runtimeSelection: AgentRuntimeSelectionView;
  };
  runAvailability: { enabled: boolean; reason: string };
}

export interface AgentBuildDefinitionView {
  mode: 'agent';
  definitionSchemaVersion: 1;
  instructions: string;
  modelSelection: AgentBuildPinnedRefView;
  skillRefs: [];
  requestedCapabilities: [];
  outputContractRef: AgentBuildPinnedRefView;
  profileRef: null;
  environmentRef: AgentBuildPinnedRefView;
  runtimeSelection: AgentRuntimeSelectionView;
}

export interface AgentBuildView {
  id: string;
  title: string;
  visibility: 'private';
  currentVersionId: string;
  parentBuildId: string | null;
  animationChallengeId: string | null;
  animationChallengeVersion: AnimationChallengeVersionView | null;
  mode: 'agent';
  owner: boolean;
  canFork: boolean;
  version: {
    id: string;
    revision: number;
    title: string;
    visibility: 'private';
    createdAt: string;
    mode: 'agent';
    animationChallengeVersionId: string | null;
    agentDefinition: AgentBuildDefinitionView;
    definitionDigest: string;
  };
}

export interface CreationRunView {
  id: string;
  buildId: string;
  buildVersionId: string;
  challengeVersionId: string | null;
  evaluationJobId: string | null;
  artifactBundleId: string | null;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'incomplete';
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface CreationRunStatusView {
  run: CreationRunView;
  job: null | {
    id: string;
    state: EvaluationJobState;
    modelOfferingId: string | null;
    snapshotDigest: string;
    cancellationRequestedAt: string | null;
    acceptedAt: string;
    createdAt: string;
    updatedAt: string;
    completedAt: string | null;
    completion: { evidence: 'complete' | 'partial'; summary?: RecordValue } | null;
    failure: { code: string; retryable: boolean } | null;
  };
}

export interface CreateCreationRunResponse extends CreationRunStatusView {
  created: boolean;
}

export interface ArtifactBundleView {
  bundleId: string;
  outputSlot: string;
  status: 'collecting' | 'sealed' | 'rejected';
  snapshotDigest: string;
  manifestDigest: string;
  entries: Array<{
    artifactId: string;
    relativePath: string;
    mediaType: string;
    bytes: number;
    sha256: string;
    classification: 'public-feedback' | 'private-creation' | 'hidden';
  }>;
  sealedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ArtifactPreviewView {
  plan: {
    artifactId: string;
    relativePath: string;
    mediaType: string;
    format: 'html' | 'css' | 'markdown' | 'svg' | 'json' | 'csv' | 'text' | 'image';
    renderer: 'html-sandbox' | 'css-text' | 'markdown-sanitized' | 'svg-animation-sandbox' | 'json-tree' | 'csv-table' | 'plain-text' | 'image';
    maxBytes: number;
    allowScripts: false;
    allowRemoteResources: false;
    allowNavigation: false;
    allowForms: false;
    allowPopups: false;
    rawHtmlAllowed: false;
    formulaExecution: false;
  };
  body: { kind: 'text'; content: string } | { kind: 'binary'; base64: string };
}

export interface PublicationFileView {
  artifactId?: string;
  relativePath: string;
  mediaType: string;
  previewKind: 'html' | 'markdown' | 'svg' | 'image' | 'json' | 'csv' | 'text' | 'download';
  sizeBytes: number;
  sha256: string;
}

export interface OwnerPublicationView {
  id: string;
  ownerId: string;
  sourceBundleId: string;
  sourceSnapshotDigest: string;
  sourceManifestDigest: string;
  sourceAttemptFence: string;
  releaseDigest: string;
  title: string;
  description: string;
  entryPath: string;
  files: PublicationFileView[];
  status: 'pending' | 'published' | 'rejected' | 'withdrawn' | 'taken-down';
  revision: number;
  createdAt: string;
  updatedAt: string;
  reviewedAt: string | null;
  withdrawnAt: string | null;
}

export interface PublicPublicationView {
  publicationId: string;
  title: string;
  description: string;
  entryPath: string;
  releaseDigest: string;
  files: Omit<PublicationFileView, 'artifactId'>[];
  createdAt: string;
}

export interface LikeSummaryView {
  publicationId: string;
  count: number;
  likedByViewer: boolean;
  changed?: boolean;
}

export interface ShowcaseEntryView {
  id: string;
  ownerId: string;
  publicationId: string;
  comparatorKey: string;
  policyVersion: string;
  roundId: string;
  status: 'active' | 'withdrawn';
  publicationReleaseDigest: string;
  publication: PublicPublicationView;
  createdAt: string;
  withdrawnAt: string | null;
}

export interface ShowcaseBallotView {
  id: string;
  voterId: string;
  roundId: string;
  comparatorKey: string;
  policyVersion: string;
  entryAId: string;
  entryBId: string;
  pairKey: string;
  requestDigest: string;
  idempotencyKey: string;
  issuedAt: string;
  expiresAt: string;
  status: 'open' | 'cast' | 'expired';
  castVoteId: string | null;
  candidates: null | {
    a: { entryId: string; publication: PublicPublicationView };
    b: { entryId: string; publication: PublicPublicationView };
  };
}

export interface ShowcaseLeaderboardView {
  roundId: string;
  comparatorKey: string;
  policyVersion: string;
  sample: {
    validVotes: number;
    independentVoters: number;
    minValidVotes: number;
    minIndependentVoters: number;
    qualified: boolean;
  };
  rows: Array<{
    entryId: string;
    publication: PublicPublicationView;
    comparisons: number;
    halfPoints: number;
    points: number;
    score: number;
    validVoters: number;
    qualified: boolean;
  }>;
}

function idempotencyAgreement(body: RecordValue, optionKey?: string): { key: string; body: RecordValue } {
  const bodyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : '';
  const explicitKey = optionKey?.trim() ?? '';
  if (bodyKey && explicitKey && bodyKey !== explicitKey) {
    throw new ApiError('The idempotency key header does not match the request body.', 409, 'REQUEST_VALIDATION_FAILED');
  }
  const key = explicitKey || bodyKey;
  if (!key) throw new ApiError('An idempotency key is required.', 400, 'REQUEST_VALIDATION_FAILED');
  return { key, body: { ...body, idempotencyKey: key } };
}

async function idempotentPost<T>(path: string, body: RecordValue, key?: string, signal?: AbortSignal): Promise<T> {
  const agreed = idempotencyAgreement(body, key);
  return api<T>(path, {
    method: 'POST',
    body: JSON.stringify(agreed.body),
    headers: { 'Idempotency-Key': agreed.key },
    signal,
  });
}

export const listAnimationChallenges = (signal?: AbortSignal) => api<AnimationChallengeView[]>('animation-challenges', { signal });
export const listProviders = (signal?: AbortSignal) => api<ProviderCatalogView>('providers', { signal });
export const addProvider = (body: {
  protocol: ProviderProtocol;
  name: string;
  baseUrl: string;
  modelId: string;
  apiKey: string;
}) => post<ProviderCredentialView>('providers', body);
export const deleteProvider = (credentialId: string) => api<{ ok?: boolean }>(`providers/${encodeURIComponent(credentialId)}`, { method: 'DELETE' });

export const saveAgentBuild = (body: {
  buildId?: string;
  currentVersionId?: string;
  title: string;
  mode: 'agent';
  animationChallengeVersionId: string;
  visibility: 'private';
  agentDefinition: AgentBuildDefinitionView;
}) => post<AgentBuildView>('builds', body);

export const getAgentBuild = (buildId: string, versionId?: string, signal?: AbortSignal) => {
  const query = new URLSearchParams({ mode: 'agent' });
  if (versionId) query.set('version', versionId);
  return api<AgentBuildView>(`builds/${encodeURIComponent(buildId)}?${query.toString()}`, { signal });
};

export const forkAgentBuild = (buildId: string, versionId: string) => post<AgentBuildView>(`builds/${encodeURIComponent(buildId)}/fork`, {
  mode: 'agent',
  versionId,
});

export const createCreationRun = (
  body: { buildVersionId: string; challengeVersionId: string; credentialId: string; idempotencyKey?: string },
  options: { idempotencyKey?: string; signal?: AbortSignal } = {},
) => idempotentPost<CreateCreationRunResponse>('creation-runs', body, options.idempotencyKey, options.signal);

export const getCreationRun = (runId: string, signal?: AbortSignal) => api<CreationRunStatusView>(`creation-runs/${encodeURIComponent(runId)}`, { signal });
export const cancelCreationRun = (runId: string, signal?: AbortSignal) => api<CreationRunStatusView>(`creation-runs/${encodeURIComponent(runId)}/cancel`, {
  method: 'POST',
  body: '{}',
  signal,
});
export const retryCreationRun = (runId: string, idempotencyKey: string, signal?: AbortSignal) => idempotentPost<CreateCreationRunResponse>(
  `creation-runs/${encodeURIComponent(runId)}/retry`,
  { idempotencyKey },
  idempotencyKey,
  signal,
);

export const getArtifactBundle = (bundleId: string, signal?: AbortSignal) => api<ArtifactBundleView>(`artifact-bundles/${encodeURIComponent(bundleId)}`, { signal });
export const getArtifactPreview = (artifactId: string, signal?: AbortSignal) => api<ArtifactPreviewView>(`artifacts/${encodeURIComponent(artifactId)}/preview`, { signal });

export async function downloadArtifact(artifactId: string, signal?: AbortSignal): Promise<Blob> {
  const response = await fetch(`/api/arena/artifacts/${encodeURIComponent(artifactId)}/content`, {
    credentials: 'same-origin',
    signal,
  });
  if (!response.ok) throw normalizeApiError(await readPayload(response), 'Artifact download failed.', response.status);
  return response.blob();
}

export const requestPublication = (body: {
  publishConfirmed: true;
  creationRunId: string;
  expectedSnapshotDigest: string;
  expectedManifestDigest: string;
  title: string;
  description: string;
  entryPath: string;
  publicArtifactIds: string[];
}) => post<OwnerPublicationView>('showcase/publications', body);
export const getOwnerPublication = (publicationId: string, signal?: AbortSignal) => api<OwnerPublicationView>(`showcase/publications/${encodeURIComponent(publicationId)}/owner`, { signal });
export const getPublicPublication = (publicationId: string, signal?: AbortSignal) => api<PublicPublicationView>(`showcase/publications/${encodeURIComponent(publicationId)}`, { signal });
export const getPublicArtifactPreview = (publicationId: string, relativePath: string, signal?: AbortSignal) => api<ArtifactPreviewView>(
  `showcase/publications/${encodeURIComponent(publicationId)}/preview?${new URLSearchParams({ path: relativePath }).toString()}`,
  { signal },
);
export const getPublicationLikes = (publicationId: string, signal?: AbortSignal) => api<LikeSummaryView>(`showcase/publications/${encodeURIComponent(publicationId)}/likes`, { signal });
export const likePublication = (publicationId: string) => api<LikeSummaryView>(`showcase/publications/${encodeURIComponent(publicationId)}/like`, { method: 'PUT' });
export const unlikePublication = (publicationId: string) => api<LikeSummaryView>(`showcase/publications/${encodeURIComponent(publicationId)}/like`, { method: 'DELETE' });

export const createShowcaseEntry = (body: { publicationId: string; roundId: string; comparatorKey: string; policyVersion: string }) => post<ShowcaseEntryView>('showcase/entries', body);
export const issueShowcaseBallot = (
  body: { roundId: string; comparatorKey: string; policyVersion: string; idempotencyKey?: string },
  idempotencyKey: string,
  signal?: AbortSignal,
) => idempotentPost<ShowcaseBallotView | null>('showcase/ballots', body, idempotencyKey, signal);
export const getShowcaseBallot = (ballotId: string, signal?: AbortSignal) => api<ShowcaseBallotView>(`showcase/ballots/${encodeURIComponent(ballotId)}`, { signal });
export const castShowcaseVote = (
  ballotId: string,
  choice: 'a' | 'b' | 'tie' | 'skip',
  idempotencyKey: string,
  signal?: AbortSignal,
) => idempotentPost<{ vote: { id: string; validity: 'accepted' | 'excluded'; exclusionReason: string | null }; ballot: ShowcaseBallotView }>(
  `showcase/ballots/${encodeURIComponent(ballotId)}/votes`,
  { choice, idempotencyKey },
  idempotencyKey,
  signal,
);
export const getShowcaseLeaderboard = (
  params: { roundId: string; comparatorKey: string; policyVersion: string },
  signal?: AbortSignal,
) => api<ShowcaseLeaderboardView>(`showcase/leaderboard?${new URLSearchParams(params).toString()}`, { signal });
