import { AppError, ERROR_CODES } from '../../../shared/errors.ts';
import {
  validateConfiguredAgentBuild,
  type AgentBuildDefinition,
} from '../../../shared/agent-build-contract.ts';

/**
 * AA-T8 is intentionally a separate scoring family. This contract is an
 * admission/normalization seam only; it is not a production judge and it does
 * not add a new EvaluationPurpose or rewrite the legacy Submission schema.
 */
export const AGENT_SHOWCASE_JUDGE_CONTRACT_VERSION = 1 as const;
export const AGENT_SHOWCASE_JUDGE_KIND = 'hidden-agent-judge' as const;
export const AGENT_SHOWCASE_SCORE_VERSION = 'agent-showcase-score-v1' as const;

export type AgentShowcaseTrustLane = 'demo' | 'byok' | 'platform';

export interface AgentShowcaseVersionedRef {
  readonly id: string;
  readonly versionId: string;
  readonly contentDigest: string;
}

export interface AgentShowcaseScoreComponentWeight {
  readonly id: string;
  readonly weight: number;
}

/**
 * A profile is supplied by a server-owned resolver. There is deliberately no
 * default profile or default weight set in this adapter.
 */
export interface AgentShowcaseScoreProfile {
  readonly profileId: string;
  readonly versionId: string;
  readonly contentDigest: string;
  readonly components: readonly AgentShowcaseScoreComponentWeight[];
}

export interface AgentShowcaseJudgePolicy {
  readonly profile: AgentShowcaseScoreProfile;
  readonly judge: AgentShowcaseVersionedRef;
  readonly season: AgentShowcaseVersionedRef;
  readonly environment: AgentShowcaseVersionedRef;
  readonly runtime: {
    readonly kind: 'pi';
    readonly adapterVersion: string;
    readonly policyVersion: string;
  };
  readonly trustLane: AgentShowcaseTrustLane;
  readonly comparatorKey: string;
}

/**
 * This is a reference to a sealed hidden output, not an artifact read API.
 * It contains no bytes, public bundle reference, expected answer, or raw
 * output. A future approved judge may resolve this reference inside its own
 * isolated worker, but the adapter never reads it.
 */
export interface AgentShowcaseHiddenEvidenceRef {
  readonly kind: 'sealed-hidden-agent-output';
  readonly bundleStatus: 'sealed';
  readonly executionStatus: 'completed';
  readonly attemptId: string;
  readonly hiddenBundleId: string;
  readonly manifestDigest: string;
  readonly outputDigest: string;
}

/**
 * Input accepted by the hidden Agent boundary. The object is parsed strictly
 * so public bundle ids, hidden answers, raw output, URLs and storage paths
 * cannot be smuggled in as extra fields.
 */
export interface AgentShowcaseJudgeAdmissionRequest {
  readonly ownerId: string;
  readonly buildId: string;
  readonly buildVersionId: string;
  readonly hiddenRunId: string;
  readonly hiddenAttemptId: string;
  readonly runtime: 'pi';
  readonly trustLane: AgentShowcaseTrustLane;
  readonly environmentVersionId: string;
  readonly environmentDigest: string;
  readonly definition: unknown;
}

export interface AgentShowcaseJudgeAdmission {
  readonly contractVersion: typeof AGENT_SHOWCASE_JUDGE_CONTRACT_VERSION;
  readonly kind: typeof AGENT_SHOWCASE_JUDGE_KIND;
  readonly ownerId: string;
  readonly buildId: string;
  readonly buildVersionId: string;
  readonly hiddenRunId: string;
  readonly hiddenAttemptId: string;
  readonly runtime: AgentShowcaseJudgePolicy['runtime'];
  readonly trustLane: AgentShowcaseTrustLane;
  readonly environment: AgentShowcaseVersionedRef;
  readonly profile: AgentShowcaseVersionedRef;
  readonly judge: AgentShowcaseVersionedRef;
  readonly season: AgentShowcaseVersionedRef;
  readonly comparatorKey: string;
  readonly scoreProfile: AgentShowcaseScoreProfile;
  readonly evidence: AgentShowcaseHiddenEvidenceRef;
}

/**
 * The judge port is intentionally not compatible with the old Judge interface:
 * it cannot receive `expected` or `actual`, and it returns only bounded score
 * components. A real implementation must be injected by a later AA-T8 gate.
 */
export interface HiddenAgentJudgePort {
  readonly kind: typeof AGENT_SHOWCASE_JUDGE_KIND;
  readonly id: string;
  readonly versionId: string;
  readonly contentDigest: string;
  evaluate(input: HiddenAgentJudgeInput): Promise<HiddenAgentJudgeDecision>;
}

export interface HiddenAgentJudgeInput {
  readonly contractVersion: typeof AGENT_SHOWCASE_JUDGE_CONTRACT_VERSION;
  readonly kind: typeof AGENT_SHOWCASE_JUDGE_KIND;
  readonly admission: AgentShowcaseJudgeAdmission;
  readonly evidence: AgentShowcaseHiddenEvidenceRef;
}

export interface HiddenAgentJudgeDecision {
  readonly judge: AgentShowcaseVersionedRef;
  readonly evidence: 'complete';
  readonly components: Readonly<Record<string, number>>;
}

export interface AgentShowcaseScoreRecord {
  readonly kind: 'agent-showcase-score';
  readonly scoreVersion: typeof AGENT_SHOWCASE_SCORE_VERSION;
  readonly ownerId: string;
  readonly buildId: string;
  readonly buildVersionId: string;
  readonly hiddenRunId: string;
  readonly hiddenAttemptId: string;
  readonly profile: AgentShowcaseVersionedRef;
  readonly judge: AgentShowcaseVersionedRef;
  readonly season: AgentShowcaseVersionedRef;
  readonly environment: AgentShowcaseVersionedRef;
  readonly runtime: AgentShowcaseJudgePolicy['runtime'];
  readonly trustLane: AgentShowcaseTrustLane;
  readonly comparatorKey: string;
  readonly components: Readonly<Record<string, number>>;
  readonly total: number;
  readonly evidence: 'complete';
  /** Explicit guard against accidentally creating a legacy Submission. */
  readonly legacySubmissionId: null;
}

export interface AgentShowcaseAdmissionResolver {
  /** Resolve only server-owned Profile/Season/Judge/Environment identities. */
  resolve(input: {
    readonly request: AgentShowcaseJudgeAdmissionRequest;
    readonly definition: AgentBuildDefinition;
  }): Promise<AgentShowcaseJudgePolicy | null>;
}

/**
 * Resolves the hidden output from server-owned Run/Attempt state. The caller
 * never supplies a bundle id or digest to the judge boundary; otherwise a
 * public bundle could be relabeled as hidden by a crafted request.
 */
export interface AgentShowcaseHiddenEvidenceResolver {
  resolve(input: {
    readonly request: AgentShowcaseJudgeAdmissionRequest;
  }): Promise<AgentShowcaseHiddenEvidenceRef | null>;
}

export interface AgentShowcaseJudgeAdapterOptions {
  readonly resolver?: AgentShowcaseAdmissionResolver;
  readonly evidenceResolver?: AgentShowcaseHiddenEvidenceResolver;
  readonly judge?: HiddenAgentJudgePort;
}

const LEGACY_DAG_COMPONENTS = new Set([
  'accuracy',
  'robustness',
  'security',
  'efficiency',
  'elegance',
]);
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const CONTROL = /[\u0000-\u001f\u007f]/u;
const MAX_ID_CHARS = 160;
const MAX_COMPONENTS = 12;
const MAX_COMPONENT_ID_CHARS = 80;
const MISSING_RESOLVER_MESSAGE =
  'Agent hidden judging is unavailable until a server-owned Profile/Season resolver is configured.';
const MISSING_JUDGE_MESSAGE =
  'Agent hidden judging is unavailable until an approved hidden Agent judge is configured.';
const MISSING_EVIDENCE_RESOLVER_MESSAGE =
  'Agent hidden judging is unavailable until server-owned hidden evidence is configured.';
const JUDGE_FAILURE_MESSAGE =
  'Agent hidden judging is unavailable because the approved judge did not produce a valid result.';

/**
 * Minimum executable AA-T8 seam. It validates an immutable hidden-run
 * admission, delegates only to an explicitly injected judge, and returns an
 * Agent-specific score record. It never calls the DAG scorer, writes a Run or
 * Submission, reads artifact bytes, or falls back to a demo/legacy judge.
 */
export class AgentShowcaseJudgeAdapter {
  private readonly resolver?: AgentShowcaseAdmissionResolver;
  private readonly evidenceResolver?: AgentShowcaseHiddenEvidenceResolver;
  private readonly judge?: HiddenAgentJudgePort;

  constructor(options: AgentShowcaseJudgeAdapterOptions = {}) {
    this.resolver = options.resolver;
    this.evidenceResolver = options.evidenceResolver;
    this.judge = options.judge;
  }

  async admit(input: unknown): Promise<AgentShowcaseJudgeAdmission> {
    const parsedRequest = parseAdmissionRequest(input);
    const definition = validateDefinition(parsedRequest.definition);
    // Pass only the canonical frozen definition to server-owned resolvers.
    // The caller's nested object must not remain a mutable TOCTOU input after
    // validation.
    const request = Object.freeze({ ...parsedRequest, definition });

    if (!this.resolver) unavailable(MISSING_RESOLVER_MESSAGE);
    if (!this.evidenceResolver) unavailable(MISSING_EVIDENCE_RESOLVER_MESSAGE);
    if (!this.judge) unavailable(MISSING_JUDGE_MESSAGE);

    let evidence: AgentShowcaseHiddenEvidenceRef | null;
    try {
      evidence = await this.evidenceResolver.resolve({ request });
    } catch {
      unavailable(MISSING_EVIDENCE_RESOLVER_MESSAGE);
    }
    if (!evidence) unavailable(MISSING_EVIDENCE_RESOLVER_MESSAGE);
    const normalizedEvidence = parseEvidence(evidence, invalidRuntimeState);
    if (normalizedEvidence.attemptId !== request.hiddenAttemptId) invalidRuntimeState();

    let policy: AgentShowcaseJudgePolicy | null;
    try {
      policy = await this.resolver.resolve({ request, definition });
    } catch {
      unavailable(MISSING_RESOLVER_MESSAGE);
    }
    if (!policy) unavailable(MISSING_RESOLVER_MESSAGE);

    const normalizedPolicy = parsePolicy(policy);
    if (this.judge.kind !== AGENT_SHOWCASE_JUDGE_KIND ||
      this.judge.id !== normalizedPolicy.judge.id ||
      this.judge.versionId !== normalizedPolicy.judge.versionId ||
      this.judge.contentDigest !== normalizedPolicy.judge.contentDigest) {
      invalidRuntimeState();
    }
    assertPolicyMatchesRequest(normalizedPolicy, request, definition);

    return deepFreeze({
      contractVersion: AGENT_SHOWCASE_JUDGE_CONTRACT_VERSION,
      kind: AGENT_SHOWCASE_JUDGE_KIND,
      ownerId: request.ownerId,
      buildId: request.buildId,
      buildVersionId: request.buildVersionId,
      hiddenRunId: request.hiddenRunId,
      hiddenAttemptId: request.hiddenAttemptId,
      runtime: normalizedPolicy.runtime,
      trustLane: normalizedPolicy.trustLane,
      environment: normalizedPolicy.environment,
      profile: {
        id: normalizedPolicy.profile.profileId,
        versionId: normalizedPolicy.profile.versionId,
        contentDigest: normalizedPolicy.profile.contentDigest,
      },
      judge: normalizedPolicy.judge,
      season: normalizedPolicy.season,
      comparatorKey: normalizedPolicy.comparatorKey,
      scoreProfile: normalizedPolicy.profile,
      evidence: normalizedEvidence,
    });
  }

  async score(input: unknown): Promise<AgentShowcaseScoreRecord> {
    const admission = await this.admit(input);
    const judge = this.judge;
    if (!judge) unavailable(MISSING_JUDGE_MESSAGE);

    let decision: HiddenAgentJudgeDecision;
    try {
      decision = await judge.evaluate({
        contractVersion: AGENT_SHOWCASE_JUDGE_CONTRACT_VERSION,
        kind: AGENT_SHOWCASE_JUDGE_KIND,
        admission,
        evidence: admission.evidence,
      });
    } catch {
      unavailable(JUDGE_FAILURE_MESSAGE);
    }

    const normalizedDecision = parseDecision(decision);
    if (!sameRef(normalizedDecision.judge, admission.judge)) unavailable(JUDGE_FAILURE_MESSAGE);
    if (normalizedDecision.evidence !== 'complete') unavailable(JUDGE_FAILURE_MESSAGE);

    const components = normalizeComponents(admission.scoreProfile, normalizedDecision.components);
    const total = calculateAgentShowcaseScore(admission.scoreProfile, components);
    return deepFreeze({
      kind: 'agent-showcase-score',
      scoreVersion: AGENT_SHOWCASE_SCORE_VERSION,
      ownerId: admission.ownerId,
      buildId: admission.buildId,
      buildVersionId: admission.buildVersionId,
      hiddenRunId: admission.hiddenRunId,
      hiddenAttemptId: admission.hiddenAttemptId,
      profile: admission.profile,
      judge: admission.judge,
      season: admission.season,
      environment: admission.environment,
      runtime: admission.runtime,
      trustLane: admission.trustLane,
      comparatorKey: admission.comparatorKey,
      components,
      total,
      evidence: 'complete',
      legacySubmissionId: null,
    });
  }
}

/**
 * Deterministic normalization for the future Agent score family. No default
 * weights are supplied; the profile must be resolved and approved by the
 * server-owned catalog before this function can be called.
 */
export function calculateAgentShowcaseScore(
  profile: AgentShowcaseScoreProfile,
  components: Readonly<Record<string, number>>,
): number {
  const normalizedProfile = parseScoreProfile(profile);
  const normalizedComponents = normalizeComponents(normalizedProfile, components);
  const total = normalizedProfile.components.reduce(
    (sum, component) => sum + component.weight * normalizedComponents[component.id] * 1000,
    0,
  );
  return Math.round(total);
}

function validateDefinition(input: unknown): AgentBuildDefinition {
  const definition = validateConfiguredAgentBuild(input, 'private', {
    requireModel: true,
    requireEnvironment: true,
    requireOutputContract: true,
    requireRuntime: true,
  });
  if (!definition.profileRef) invalidRequest();
  return definition;
}

function parseAdmissionRequest(input: unknown): AgentShowcaseJudgeAdmissionRequest {
  const record = exactRecord(input, [
    'ownerId',
    'buildId',
    'buildVersionId',
    'hiddenRunId',
    'hiddenAttemptId',
    'runtime',
    'trustLane',
    'environmentVersionId',
    'environmentDigest',
    'definition',
  ]);
  const runtime = record.runtime;
  const trustLane = record.trustLane;
  if (runtime !== 'pi') invalidRequest();
  if (trustLane !== 'demo' && trustLane !== 'byok' && trustLane !== 'platform') invalidRequest();
  const ownerId = identifier(record.ownerId);
  const buildId = identifier(record.buildId);
  const buildVersionId = identifier(record.buildVersionId);
  const hiddenRunId = identifier(record.hiddenRunId);
  const hiddenAttemptId = identifier(record.hiddenAttemptId);
  const environmentVersionId = identifier(record.environmentVersionId);
  const environmentDigest = digest(record.environmentDigest);
  return Object.freeze({
    ownerId,
    buildId,
    buildVersionId,
    hiddenRunId,
    hiddenAttemptId,
    runtime: 'pi',
    trustLane,
    environmentVersionId,
    environmentDigest,
    definition: record.definition,
  });
}

function parseEvidence(input: unknown, invalid: () => never = invalidRequest): AgentShowcaseHiddenEvidenceRef {
  const record = exactRecord(input, [
    'kind',
    'bundleStatus',
    'executionStatus',
    'attemptId',
    'hiddenBundleId',
    'manifestDigest',
    'outputDigest',
  ], invalid);
  if (record.kind !== 'sealed-hidden-agent-output' || record.bundleStatus !== 'sealed' || record.executionStatus !== 'completed') invalid();
  return Object.freeze({
    kind: 'sealed-hidden-agent-output',
    bundleStatus: 'sealed',
    executionStatus: 'completed',
    attemptId: runtimeIdentifier(record.attemptId),
    hiddenBundleId: runtimeIdentifier(record.hiddenBundleId),
    manifestDigest: digest(record.manifestDigest),
    outputDigest: digest(record.outputDigest),
  });
}

function parsePolicy(input: AgentShowcaseJudgePolicy): AgentShowcaseJudgePolicy {
  const record = exactRecord(input, [
    'profile',
    'judge',
    'season',
    'environment',
    'runtime',
    'trustLane',
    'comparatorKey',
  ]);
  const runtime = exactRecord(record.runtime, ['kind', 'adapterVersion', 'policyVersion']);
  if (runtime.kind !== 'pi') invalidRuntimeState();
  const trustLane = record.trustLane;
  if (trustLane !== 'demo' && trustLane !== 'byok' && trustLane !== 'platform') invalidRuntimeState();
  const normalized = {
    profile: parseScoreProfile(record.profile),
    judge: parseVersionedRef(record.judge),
    season: parseVersionedRef(record.season),
    environment: parseVersionedRef(record.environment),
    runtime: {
      kind: 'pi' as const,
      adapterVersion: version(runtime.adapterVersion),
      policyVersion: version(runtime.policyVersion),
    },
    trustLane,
    comparatorKey: identifier(record.comparatorKey),
  } satisfies AgentShowcaseJudgePolicy;
  return Object.freeze(normalized);
}

function parseScoreProfile(input: unknown): AgentShowcaseScoreProfile {
  const record = exactRecord(input, ['profileId', 'versionId', 'contentDigest', 'components']);
  const componentsInput = record.components;
  if (!Array.isArray(componentsInput) || componentsInput.length === 0 || componentsInput.length > MAX_COMPONENTS) {
    invalidRuntimeState();
  }
  const components = componentsInput.map((entry) => {
    const component = exactRecord(entry, ['id', 'weight']);
    const id = componentId(component.id);
    if (LEGACY_DAG_COMPONENTS.has(id)) invalidRuntimeState();
    if (typeof component.weight !== 'number' || !Number.isFinite(component.weight) || component.weight < 0) {
      invalidRuntimeState();
    }
    return Object.freeze({ id, weight: component.weight });
  });
  const ids = new Set(components.map((component) => component.id));
  if (ids.size !== components.length) invalidRuntimeState();
  const weightSum = components.reduce((sum, component) => sum + component.weight, 0);
  if (Math.abs(weightSum - 1) > 1e-9) invalidRuntimeState();
  return Object.freeze({
    profileId: identifier(record.profileId),
    versionId: version(record.versionId),
    contentDigest: digest(record.contentDigest),
    components: Object.freeze(components),
  });
}

function parseVersionedRef(input: unknown): AgentShowcaseVersionedRef {
  const record = exactRecord(input, ['id', 'versionId', 'contentDigest']);
  return Object.freeze({
    id: identifier(record.id),
    versionId: version(record.versionId),
    contentDigest: digest(record.contentDigest),
  });
}

function parseDecision(input: HiddenAgentJudgeDecision): HiddenAgentJudgeDecision {
  const record = exactRecord(input, ['judge', 'evidence', 'components']);
  if (record.evidence !== 'complete') invalidRuntimeState();
  const components = record.components;
  if (!isPlainObject(components)) invalidRuntimeState();
  const normalizedComponents: Record<string, number> = {};
  for (const [key, value] of Object.entries(components)) {
    normalizedComponents[componentId(key)] = boundedScore(value);
  }
  return Object.freeze({
    judge: parseVersionedRef(record.judge),
    evidence: 'complete',
    components: Object.freeze(normalizedComponents),
  });
}

function normalizeComponents(
  profile: AgentShowcaseScoreProfile,
  components: Readonly<Record<string, number>>,
): Readonly<Record<string, number>> {
  if (!isPlainObject(components)) invalidRuntimeState();
  const expected = new Set(profile.components.map((component) => component.id));
  const actualKeys = Object.keys(components);
  if (actualKeys.length !== expected.size || actualKeys.some((key) => !expected.has(key))) invalidRuntimeState();
  const result: Record<string, number> = {};
  for (const component of profile.components) result[component.id] = boundedScore(components[component.id]);
  return Object.freeze(result);
}

function assertPolicyMatchesRequest(
  policy: AgentShowcaseJudgePolicy,
  request: AgentShowcaseJudgeAdmissionRequest,
  definition: AgentBuildDefinition,
): void {
  const profileRef = definition.profileRef;
  const environmentRef = definition.environmentRef;
  const runtime = definition.runtimeSelection;
  if (!profileRef || !environmentRef || !runtime) invalidRuntimeState();
  if (policy.profile.profileId !== profileRef.id || policy.profile.versionId !== profileRef.versionId || policy.profile.contentDigest !== profileRef.contentDigest) {
    invalidRuntimeState();
  }
  if (policy.environment.id !== environmentRef.id || policy.environment.versionId !== environmentRef.versionId || policy.environment.contentDigest !== environmentRef.contentDigest) {
    invalidRuntimeState();
  }
  if (policy.environment.versionId !== request.environmentVersionId || policy.environment.contentDigest !== request.environmentDigest) {
    invalidRuntimeState();
  }
  if (policy.runtime.kind !== request.runtime || policy.runtime.adapterVersion !== runtime.adapterVersion || policy.runtime.policyVersion !== runtime.policyVersion) {
    invalidRuntimeState();
  }
  if (policy.trustLane !== request.trustLane) invalidRuntimeState();
}

function sameRef(left: AgentShowcaseVersionedRef, right: AgentShowcaseVersionedRef): boolean {
  return left.id === right.id && left.versionId === right.versionId && left.contentDigest === right.contentDigest;
}

function exactRecord(input: unknown, allowedKeys: readonly string[], invalid: () => never = invalidRequest): Record<string, unknown> {
  if (!isPlainObject(input)) invalid();
  const allowed = new Set(allowedKeys);
  const keys = Object.keys(input);
  if (keys.length !== allowed.size || keys.some((key) => !allowed.has(key))) invalid();
  return input;
}

function identifier(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_ID_CHARS || CONTROL.test(value)) invalidRequest();
  return value;
}

function version(value: unknown): string {
  const result = identifier(value);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(result)) invalidRuntimeState();
  return result;
}

function componentId(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_COMPONENT_ID_CHARS || CONTROL.test(value)) invalidRuntimeState();
  if (!/^[a-z][a-z0-9._-]*$/u.test(value)) invalidRuntimeState();
  return value;
}

function digest(value: unknown): string {
  if (typeof value !== 'string' || !DIGEST.test(value)) invalidRuntimeState();
  return value;
}

function runtimeIdentifier(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_ID_CHARS || CONTROL.test(value)) invalidRuntimeState();
  return value;
}


function boundedScore(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) invalidRuntimeState();
  return value;
}

function invalidRequest(): never {
  throw new AppError('Invalid Agent hidden judge request.', 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
}

function invalidRuntimeState(): never {
  throw new AppError('Agent hidden judge configuration is invalid.', 503, ERROR_CODES.RUNTIME_UNAVAILABLE);
}

function unavailable(message: string): never {
  throw new AppError(message, 503, ERROR_CODES.RUNTIME_UNAVAILABLE);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return value;
}
