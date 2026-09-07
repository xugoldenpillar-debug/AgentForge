import { createHash } from 'node:crypto';
import { AppError, ERROR_CODES } from './errors.ts';
import type {
  AgentBuildCapabilityRef,
  AgentBuildPinnedRef,
  AgentBuildRuntimeSelection,
} from './agent-build-contract.ts';

export const ARTIFACT_CONTRACT_VERSION = 1 as const;
/** Runtime collection manifests carry fence/environment evidence that is not part
 * of the persisted artifact input manifest. Keeping a separate versioned contract
 * prevents a collector from accidentally exposing storage references or treating a
 * live snapshot as a durable record. */
export const ARTIFACT_COLLECTION_MANIFEST_VERSION = 1 as const;
export const CREATION_BRIEF_CONTRACT_VERSION = 1 as const;
export const CREATION_RUN_CONTRACT_VERSION = 1 as const;

export const ARTIFACT_LIMITS = Object.freeze({
  maxIdChars: 80,
  maxPathChars: 240,
  maxObjectKeyChars: 512,
  maxObjectVersionChars: 160,
  maxOutputSlotChars: 80,
  maxMediaTypeChars: 120,
  maxArtifacts: 128,
  maxArtifactBytes: 8 * 1024 * 1024,
  maxBundleBytes: 32 * 1024 * 1024,
  maxManifestBytes: 128 * 1024,
  maxStringChars: 64 * 1024,
  maxDepth: 8,
  maxNodes: 4096,
  maxBriefTitleChars: 120,
  maxBriefInstructionsChars: 16 * 1024,
  maxBriefAttachments: 16,
  maxBriefAttachmentBytes: 8 * 1024 * 1024,
  maxBriefInputBytes: 32 * 1024 * 1024,
  maxRunIdempotencyKeyChars: 160,
  maxSnapshotBytes: 128 * 1024,
});

export const ARTIFACT_MEDIA_TYPES = Object.freeze([
  'text/html',
  'text/markdown',
  'text/plain',
  'text/csv',
  'text/css',
  'text/javascript',
  'application/json',
  'application/pdf',
  'image/svg+xml',
  'image/png',
  'image/jpeg',
  'image/webp',
  'audio/mpeg',
  'video/mp4',
] as const);

export type ArtifactMediaType = typeof ARTIFACT_MEDIA_TYPES[number];
export type ArtifactVisibility = 'private' | 'public';
export type ArtifactBundleStatus = 'collecting' | 'sealed' | 'rejected';
export type ArtifactCollectionClassification = 'public-feedback' | 'private-creation' | 'hidden';

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/u;
const VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const ALIASES = new Set(['latest', 'current', 'head', 'main', 'master']);
const DANGEROUS_SEGMENTS = new Set(['', '.', '..']);
const CONTROL = /[\u0000-\u001f\u007f]/u;
const MESSAGE = 'Invalid Artifact Arena contract.';

function reject(): never {
  throw new AppError(MESSAGE, 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
}

function plainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function inspectJson(input: unknown): void {
  let nodes = 0;
  let stringChars = 0;
  const ancestors = new Set<object>();
  const visit = (value: unknown, depth: number): void => {
    if (++nodes > ARTIFACT_LIMITS.maxNodes || depth > ARTIFACT_LIMITS.maxDepth) reject();
    if (typeof value === 'string') {
      stringChars += value.length;
      if (stringChars > ARTIFACT_LIMITS.maxStringChars || /[\uD800-\uDFFF]/u.test(value)) reject();
      return;
    }
    if (value === null || typeof value === 'boolean') return;
    if (typeof value === 'number' && Number.isFinite(value)) return;
    if (typeof value !== 'object' || ancestors.has(value)) reject();
    const array = Array.isArray(value);
    const prototype = Object.getPrototypeOf(value);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) reject();
    const keys = Reflect.ownKeys(value);
    if (keys.length > 128 || (array && keys.length !== value.length + 1)) reject();
    ancestors.add(value);
    for (const key of keys) {
      if (typeof key !== 'string' || key.length > ARTIFACT_LIMITS.maxIdChars ||
        ['__proto__', 'prototype', 'constructor'].includes(key)) reject();
      if (array && key === 'length') continue;
      if (array && !/^(0|[1-9][0-9]*)$/u.test(key)) reject();
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) reject();
      visit(descriptor.value, depth + 1);
    }
    ancestors.delete(value);
  };
  visit(input, 0);
}

function object(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!plainObject(value)) reject();
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !required.includes(key) && !optional.includes(key))) reject();
  if (required.some((key) => !Object.hasOwn(record, key))) reject();
  return record;
}

function id(value: unknown, max = ARTIFACT_LIMITS.maxIdChars): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max || !ID.test(value) || ALIASES.has(value.toLowerCase())) reject();
  return value;
}

function version(value: unknown, max = ARTIFACT_LIMITS.maxObjectVersionChars): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max || !VERSION.test(value) ||
    value.includes('..') || ALIASES.has(value.toLowerCase())) reject();
  return value;
}

export function parseSha256Digest(value: unknown): string {
  if (typeof value !== 'string' || !DIGEST.test(value)) reject();
  return value;
}

function boundedText(value: unknown, max: number, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && value.trim().length === 0) || CONTROL.test(value)) reject();
  return value;
}

export function normalizeArtifactPath(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > ARTIFACT_LIMITS.maxPathChars || CONTROL.test(value) ||
    value.includes('\\') || value.startsWith('/') || value.endsWith('/') || value.includes(':')) reject();
  const segments = value.split('/');
  if (segments.some((segment) => DANGEROUS_SEGMENTS.has(segment) || segment.length > 80 || !/^[A-Za-z0-9._-]+$/u.test(segment))) reject();
  return segments.join('/');
}

function normalizeObjectKey(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > ARTIFACT_LIMITS.maxObjectKeyChars || CONTROL.test(value) ||
    value.includes('\\') || value.startsWith('/') || value.endsWith('/') || value.includes(':')) reject();
  const segments = value.split('/');
  if (segments.some((segment) => DANGEROUS_SEGMENTS.has(segment) || segment.length > 120 || !/^[A-Za-z0-9._-]+$/u.test(segment))) reject();
  return segments.join('/');
}

function normalizeObjectVersion(value: unknown): string {
  return version(value, ARTIFACT_LIMITS.maxObjectVersionChars);
}

export function parseArtifactMediaType(value: unknown): ArtifactMediaType {
  if (typeof value !== 'string' || value.length > ARTIFACT_LIMITS.maxMediaTypeChars ||
    !ARTIFACT_MEDIA_TYPES.includes(value as ArtifactMediaType)) reject();
  return value as ArtifactMediaType;
}

function nonNegativeInteger(value: unknown, maximum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > maximum) reject();
  return value;
}

function positiveInteger(value: unknown, maximum: number): number {
  const result = nonNegativeInteger(value, maximum);
  if (result < 1) reject();
  return result;
}

function digestOf(value: unknown, domain: string): string {
  return `sha256:${createHash('sha256').update(`${domain}\n${JSON.stringify(value)}`, 'utf8').digest('hex')}`;
}

export interface ArtifactObjectReferenceV1 {
  readonly storageKey: string;
  readonly objectVersion: string;
}

export interface ArtifactManifestEntryV1 {
  readonly artifactId: string;
  readonly path: string;
  readonly mediaType: ArtifactMediaType;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly object: ArtifactObjectReferenceV1;
}

export interface ArtifactCollectionManifestEntryV1 {
  readonly artifactId: string;
  readonly slotId: string;
  readonly relativePath: string;
  readonly mediaType: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly objectVersion: string;
  readonly classification: ArtifactCollectionClassification;
}

export interface ArtifactCollectionManifestV1 {
  readonly manifestVersion: typeof ARTIFACT_COLLECTION_MANIFEST_VERSION;
  readonly businessRef: string;
  readonly attemptId: string;
  readonly fenceToken: string;
  readonly environmentDigest: string;
  readonly snapshotDigest: string;
  readonly outputContractVersion: string;
  readonly entries: readonly ArtifactCollectionManifestEntryV1[];
  readonly manifestDigest: string;
  readonly sealedAt: string;
}

export interface ArtifactManifestV1 {
  readonly schemaVersion: typeof ARTIFACT_CONTRACT_VERSION;
  readonly bundleId: string;
  readonly attemptId: string;
  readonly outputSlot: string;
  readonly entries: readonly ArtifactManifestEntryV1[];
  readonly totalBytes: number;
  readonly entrypoint: string | null;
}

export interface ArtifactBundleReferenceV1 {
  readonly bundleId: string;
  readonly attemptId: string;
  readonly outputSlot: string;
  readonly snapshotDigest: string;
  readonly manifestDigest: string;
}

export interface ArtifactRecordInputV1 {
  readonly artifactId: string;
  readonly bundleId: string;
  readonly path: string;
  readonly mediaType: ArtifactMediaType;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly storageKey: string;
  readonly objectVersion: string;
  readonly visibility: ArtifactVisibility;
}

function parseManifestEntry(value: unknown): ArtifactManifestEntryV1 {
  const record = object(value, ['artifactId', 'path', 'mediaType', 'sizeBytes', 'sha256', 'object']);
  const objectRef = object(record.object, ['storageKey', 'objectVersion']);
  return Object.freeze({
    artifactId: id(record.artifactId),
    path: normalizeArtifactPath(record.path),
    mediaType: parseArtifactMediaType(record.mediaType),
    sizeBytes: positiveInteger(record.sizeBytes, ARTIFACT_LIMITS.maxArtifactBytes),
    sha256: parseSha256Digest(record.sha256),
    object: Object.freeze({
      storageKey: normalizeObjectKey(objectRef.storageKey),
      objectVersion: normalizeObjectVersion(objectRef.objectVersion),
    }),
  });
}

export function parseArtifactManifest(input: unknown): ArtifactManifestV1 {
  inspectJson(input);
  const record = object(input, ['schemaVersion', 'bundleId', 'attemptId', 'outputSlot', 'entries', 'totalBytes', 'entrypoint']);
  if (record.schemaVersion !== ARTIFACT_CONTRACT_VERSION) reject();
  const outputSlot = id(record.outputSlot, ARTIFACT_LIMITS.maxOutputSlotChars);
  const entriesInput = record.entries;
  if (!Array.isArray(entriesInput) || entriesInput.length > ARTIFACT_LIMITS.maxArtifacts) reject();
  const entries = entriesInput.map(parseManifestEntry);
  const paths = new Set(entries.map((entry) => entry.path));
  const artifactIds = new Set(entries.map((entry) => entry.artifactId));
  if (paths.size !== entries.length || artifactIds.size !== entries.length) reject();
  const totalBytes = entries.reduce((sum, entry) => sum + entry.sizeBytes, 0);
  if (totalBytes > ARTIFACT_LIMITS.maxBundleBytes || totalBytes !== record.totalBytes) reject();
  const entrypoint = record.entrypoint === null ? null : normalizeArtifactPath(record.entrypoint);
  if (entrypoint !== null && !paths.has(entrypoint)) reject();
  const result: ArtifactManifestV1 = Object.freeze({
    schemaVersion: ARTIFACT_CONTRACT_VERSION,
    bundleId: id(record.bundleId),
    attemptId: id(record.attemptId),
    outputSlot,
    entries: Object.freeze(entries),
    totalBytes,
    entrypoint,
  });
  if (new TextEncoder().encode(JSON.stringify(result)).length > ARTIFACT_LIMITS.maxManifestBytes) reject();
  return result;
}

export function digestArtifactManifest(input: unknown): string {
  return digestOf(parseArtifactManifest(input), 'agentforge:artifact-manifest:v1');
}

/**
 * The collector manifest is a runtime snapshot description. Durable storage
 * needs a second, explicit materialization step because only the storage
 * adapter knows immutable object keys. Keeping this adapter here makes the
 * conversion typed and prevents a collection manifest from being persisted as
 * if it were already a durable ArtifactManifestV1.
 */
export interface ArtifactManifestMaterializationInputV1 {
  readonly collection: ArtifactCollectionManifestV1;
  readonly bundleId: string;
  readonly outputSlot: string;
  readonly entrypoint: string | null;
  /** One immutable storage key must be supplied for every collected artifact. */
  readonly storageKeys: Readonly<Record<string, string>>;
}

export function materializeArtifactManifest(
  input: ArtifactManifestMaterializationInputV1
): ArtifactManifestV1 {
  if (!plainObject(input) || !plainObject(input.storageKeys) || !Array.isArray(input.collection?.entries)) reject();
  const entries = input.collection.entries.map((entry) => {
    const storageKey = input.storageKeys[entry.artifactId];
    if (typeof storageKey !== 'string' || storageKey.trim().length === 0) reject();
    return {
      artifactId: entry.artifactId,
      path: entry.relativePath,
      mediaType: entry.mediaType,
      sizeBytes: entry.bytes,
      sha256: entry.sha256,
      object: {
        storageKey,
        objectVersion: entry.objectVersion,
      },
    };
  });
  return parseArtifactManifest({
    schemaVersion: ARTIFACT_CONTRACT_VERSION,
    bundleId: input.bundleId,
    attemptId: input.collection.attemptId,
    outputSlot: input.outputSlot,
    entries,
    totalBytes: entries.reduce((sum, entry) => sum + entry.sizeBytes, 0),
    entrypoint: input.entrypoint,
  });
}

export function parseArtifactBundleReference(input: unknown): ArtifactBundleReferenceV1 {
  inspectJson(input);
  const record = object(input, ['bundleId', 'attemptId', 'outputSlot', 'snapshotDigest', 'manifestDigest']);
  return Object.freeze({
    bundleId: id(record.bundleId),
    attemptId: id(record.attemptId),
    outputSlot: id(record.outputSlot, ARTIFACT_LIMITS.maxOutputSlotChars),
    snapshotDigest: parseSha256Digest(record.snapshotDigest),
    manifestDigest: parseSha256Digest(record.manifestDigest),
  });
}

export function artifactReferenceIdentity(reference: ArtifactBundleReferenceV1): string {
  return `${reference.bundleId}:${reference.attemptId}:${reference.outputSlot}:${reference.snapshotDigest}:${reference.manifestDigest}`;
}

export function parseArtifactRecord(input: unknown): ArtifactRecordInputV1 {
  inspectJson(input);
  const record = object(input, ['artifactId', 'bundleId', 'path', 'mediaType', 'sizeBytes', 'sha256', 'storageKey', 'objectVersion', 'visibility']);
  if (record.visibility !== 'private' && record.visibility !== 'public') reject();
  return Object.freeze({
    artifactId: id(record.artifactId),
    bundleId: id(record.bundleId),
    path: normalizeArtifactPath(record.path),
    mediaType: parseArtifactMediaType(record.mediaType),
    sizeBytes: positiveInteger(record.sizeBytes, ARTIFACT_LIMITS.maxArtifactBytes),
    sha256: parseSha256Digest(record.sha256),
    storageKey: normalizeObjectKey(record.storageKey),
    objectVersion: normalizeObjectVersion(record.objectVersion),
    visibility: record.visibility,
  });
}

export interface CreationInputAttachmentRefV1 {
  readonly attachmentId: string;
  readonly path: string;
  readonly mediaType: ArtifactMediaType;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly object: ArtifactObjectReferenceV1;
}

export interface CreationOutputPolicyV1 {
  readonly allowedMediaTypes: readonly ArtifactMediaType[];
  readonly maxArtifacts: number;
  readonly maxArtifactBytes: number;
  readonly maxTotalBytes: number;
  readonly requiredPaths: readonly string[];
}

export interface CreationBriefVersionV1 {
  readonly schemaVersion: typeof CREATION_BRIEF_CONTRACT_VERSION;
  readonly briefId: string;
  readonly versionId: string;
  readonly versionNumber: number;
  readonly title: string;
  readonly instructions: string;
  readonly inputAttachments: readonly CreationInputAttachmentRefV1[];
  readonly outputPolicy: CreationOutputPolicyV1;
}

export interface CreationBriefVersionReferenceV1 {
  readonly briefId: string;
  readonly versionId: string;
  readonly contentDigest: string;
}

function parseInputAttachment(value: unknown): CreationInputAttachmentRefV1 {
  const record = object(value, ['attachmentId', 'path', 'mediaType', 'sizeBytes', 'sha256', 'object']);
  const objectRef = object(record.object, ['storageKey', 'objectVersion']);
  return Object.freeze({
    attachmentId: id(record.attachmentId),
    path: normalizeArtifactPath(record.path),
    mediaType: parseArtifactMediaType(record.mediaType),
    sizeBytes: positiveInteger(record.sizeBytes, ARTIFACT_LIMITS.maxBriefAttachmentBytes),
    sha256: parseSha256Digest(record.sha256),
    object: Object.freeze({
      storageKey: normalizeObjectKey(objectRef.storageKey),
      objectVersion: normalizeObjectVersion(objectRef.objectVersion),
    }),
  });
}

function parseOutputPolicy(value: unknown): CreationOutputPolicyV1 {
  const record = object(value, ['allowedMediaTypes', 'maxArtifacts', 'maxArtifactBytes', 'maxTotalBytes', 'requiredPaths']);
  if (!Array.isArray(record.allowedMediaTypes) || record.allowedMediaTypes.length === 0 || record.allowedMediaTypes.length > ARTIFACT_MEDIA_TYPES.length) reject();
  const allowedMediaTypes = [...new Set(record.allowedMediaTypes.map(parseArtifactMediaType))];
  if (!allowedMediaTypes.length) reject();
  const maxArtifacts = positiveInteger(record.maxArtifacts, ARTIFACT_LIMITS.maxArtifacts);
  const maxArtifactBytes = positiveInteger(record.maxArtifactBytes, ARTIFACT_LIMITS.maxArtifactBytes);
  const maxTotalBytes = positiveInteger(record.maxTotalBytes, ARTIFACT_LIMITS.maxBundleBytes);
  if (maxArtifactBytes > maxTotalBytes) reject();
  if (!Array.isArray(record.requiredPaths) || record.requiredPaths.length > maxArtifacts) reject();
  const requiredPaths = record.requiredPaths.map(normalizeArtifactPath);
  if (new Set(requiredPaths).size !== requiredPaths.length) reject();
  return Object.freeze({
    allowedMediaTypes: Object.freeze(allowedMediaTypes),
    maxArtifacts,
    maxArtifactBytes,
    maxTotalBytes,
    requiredPaths: Object.freeze(requiredPaths),
  });
}

export function parseCreationBriefVersion(input: unknown): CreationBriefVersionV1 {
  inspectJson(input);
  const record = object(input, ['schemaVersion', 'briefId', 'versionId', 'versionNumber', 'title', 'instructions', 'inputAttachments', 'outputPolicy']);
  if (record.schemaVersion !== CREATION_BRIEF_CONTRACT_VERSION) reject();
  const attachmentsInput = record.inputAttachments;
  if (!Array.isArray(attachmentsInput) || attachmentsInput.length > ARTIFACT_LIMITS.maxBriefAttachments) reject();
  const inputAttachments = attachmentsInput.map(parseInputAttachment);
  const attachmentPaths = new Set(inputAttachments.map((attachment) => attachment.path));
  const attachmentIds = new Set(inputAttachments.map((attachment) => attachment.attachmentId));
  if (attachmentPaths.size !== inputAttachments.length || attachmentIds.size !== inputAttachments.length) reject();
  const totalInputBytes = inputAttachments.reduce((sum, attachment) => sum + attachment.sizeBytes, 0);
  if (totalInputBytes > ARTIFACT_LIMITS.maxBriefInputBytes) reject();
  return Object.freeze({
    schemaVersion: CREATION_BRIEF_CONTRACT_VERSION,
    briefId: id(record.briefId),
    versionId: id(record.versionId),
    versionNumber: positiveInteger(record.versionNumber, 1_000_000),
    title: boundedText(record.title, ARTIFACT_LIMITS.maxBriefTitleChars),
    instructions: boundedText(record.instructions, ARTIFACT_LIMITS.maxBriefInstructionsChars),
    inputAttachments: Object.freeze(inputAttachments),
    outputPolicy: parseOutputPolicy(record.outputPolicy),
  });
}

export function digestCreationBriefVersion(input: unknown): string {
  return digestOf(parseCreationBriefVersion(input), 'agentforge:creation-brief:v1');
}

export function parseCreationBriefVersionReference(input: unknown): CreationBriefVersionReferenceV1 {
  inspectJson(input);
  const record = object(input, ['briefId', 'versionId', 'contentDigest']);
  return Object.freeze({
    briefId: id(record.briefId),
    versionId: id(record.versionId),
    contentDigest: parseSha256Digest(record.contentDigest),
  });
}

export interface CreationBuildContextV1 {
  readonly schemaVersion: typeof CREATION_RUN_CONTRACT_VERSION;
  readonly kind: 'creation';
  readonly buildRef: {
    readonly buildId: string;
    readonly versionId: string;
    readonly definitionDigest: string;
  };
  readonly briefVersionRef: CreationBriefVersionReferenceV1;
  readonly environmentVersionRef: {
    readonly templateId: string;
    readonly versionId: string;
    readonly contentDigest: string;
  };
  readonly runtimeSelection: AgentBuildRuntimeSelection;
  readonly trustLane: 'demo' | 'byok' | 'platform';
  readonly outputContractRef: AgentBuildPinnedRef | null;
}

function parseBuildRef(value: unknown): CreationBuildContextV1['buildRef'] {
  const record = object(value, ['buildId', 'versionId', 'definitionDigest']);
  return Object.freeze({ buildId: id(record.buildId), versionId: id(record.versionId), definitionDigest: parseSha256Digest(record.definitionDigest) });
}

function parseEnvironmentVersionRef(value: unknown): CreationBuildContextV1['environmentVersionRef'] {
  const record = object(value, ['templateId', 'versionId', 'contentDigest']);
  return Object.freeze({ templateId: id(record.templateId), versionId: id(record.versionId), contentDigest: parseSha256Digest(record.contentDigest) });
}

export function parseCreationBuildContext(input: unknown): CreationBuildContextV1 {
  inspectJson(input);
  const record = object(input, ['schemaVersion', 'kind', 'buildRef', 'briefVersionRef', 'environmentVersionRef', 'runtimeSelection', 'trustLane', 'outputContractRef']);
  if (record.schemaVersion !== CREATION_RUN_CONTRACT_VERSION || record.kind !== 'creation') reject();
  if (record.trustLane !== 'demo' && record.trustLane !== 'byok' && record.trustLane !== 'platform') reject();
  const outputContractRef = record.outputContractRef === null ? null : parsePinnedRef(record.outputContractRef);
  return Object.freeze({
    schemaVersion: CREATION_RUN_CONTRACT_VERSION,
    kind: 'creation',
    buildRef: parseBuildRef(record.buildRef),
    briefVersionRef: parseCreationBriefVersionReference(record.briefVersionRef),
    environmentVersionRef: parseEnvironmentVersionRef(record.environmentVersionRef),
    runtimeSelection: parseRuntimeSelection(record.runtimeSelection),
    trustLane: record.trustLane,
    outputContractRef,
  });
}

function parsePinnedRef(value: unknown): AgentBuildPinnedRef {
  const record = object(value, ['id', 'versionId', 'contentDigest']);
  return Object.freeze({ id: id(record.id), versionId: id(record.versionId), contentDigest: parseSha256Digest(record.contentDigest) });
}

function parseRuntimeSelection(value: unknown): AgentBuildRuntimeSelection {
  const record = object(value, ['kind', 'adapterVersion', 'policyVersion']);
  if (record.kind !== 'pi') reject();
  return Object.freeze({
    kind: 'pi',
    adapterVersion: version(record.adapterVersion),
    policyVersion: version(record.policyVersion),
  });
}

export function creationBuildContextIdentity(context: CreationBuildContextV1): string {
  return `${context.buildRef.buildId}:${context.buildRef.versionId}:${context.briefVersionRef.briefId}:${context.briefVersionRef.versionId}:${context.environmentVersionRef.templateId}:${context.environmentVersionRef.versionId}:${context.runtimeSelection.adapterVersion}:${context.runtimeSelection.policyVersion}:${context.trustLane}`;
}

export function digestCreationBuildContext(input: unknown): string {
  return digestOf(parseCreationBuildContext(input), 'agentforge:creation-build-context:v1');
}

export interface CreationRunReferenceV1 {
  readonly runId: string;
  readonly ownerId: string;
  readonly context: CreationBuildContextV1;
  readonly snapshotDigest: string;
}

export function parseCreationRunReference(input: unknown): CreationRunReferenceV1 {
  inspectJson(input);
  const record = object(input, ['runId', 'ownerId', 'context', 'snapshotDigest']);
  return Object.freeze({
    runId: id(record.runId),
    ownerId: id(record.ownerId),
    context: parseCreationBuildContext(record.context),
    snapshotDigest: parseSha256Digest(record.snapshotDigest),
  });
}
