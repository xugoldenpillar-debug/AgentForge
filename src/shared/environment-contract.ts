import { createHash } from 'node:crypto';
import { AppError, ERROR_CODES } from './errors.ts';
import {
  agentBuildCapabilityReferenceIdentity,
  parseAgentBuildCapabilityRef,
} from './agent-build-contract.ts';
import type { AgentBuildCapabilityRef, AgentBuildRuntimeSelection } from './agent-build-contract.ts';
import { ARTIFACT_MEDIA_TYPES, parseArtifactMediaType, type ArtifactMediaType } from './artifact-contract.ts';

export const ENVIRONMENT_TEMPLATE_CONTRACT_VERSION = 1 as const;
export const ENVIRONMENT_TEMPLATE_LIMITS = Object.freeze({
  maxIdChars: 80,
  maxNameChars: 120,
  maxDescriptionChars: 2_000,
  maxCapabilities: 32,
  maxSerializedBytes: 128 * 1024,
  maxExecutionMs: 600_000,
  maxMemoryMiB: 8_192,
  maxDiskBytes: 32 * 1024 * 1024,
  maxProcesses: 64,
});

export type EnvironmentTemplateScope = 'platform' | 'private';

export interface EnvironmentTemplateOwnershipV1 {
  readonly scope: EnvironmentTemplateScope;
  readonly ownerId: string | null;
}

export type EnvironmentSystemCapabilityId =
  | 'workspace.read'
  | 'workspace.write'
  | 'artifact.write'
  | 'preview.static'
  | 'network.none';

export interface EnvironmentSystemCapabilityRefV1 {
  readonly kind: 'system';
  readonly capabilityId: EnvironmentSystemCapabilityId;
  readonly versionId: string;
  readonly contentDigest: string;
}

export type EnvironmentCapabilityRefV1 = AgentBuildCapabilityRef | EnvironmentSystemCapabilityRefV1;

export interface EnvironmentLimitsV1 {
  readonly maxExecutionMs: number;
  readonly maxMemoryMiB: number;
  readonly maxDiskBytes: number;
  readonly maxProcesses: number;
}

export interface EnvironmentArtifactPolicyV1 {
  readonly allowedMediaTypes: readonly ArtifactMediaType[];
  readonly maxArtifacts: number;
  readonly maxArtifactBytes: number;
  readonly maxTotalBytes: number;
}

export interface EnvironmentTemplateVersionV1 {
  readonly schemaVersion: typeof ENVIRONMENT_TEMPLATE_CONTRACT_VERSION;
  readonly templateId: string;
  readonly versionId: string;
  readonly versionNumber: number;
  readonly name: string;
  readonly description: string;
  readonly runtime: AgentBuildRuntimeSelection;
  readonly capabilities: readonly EnvironmentCapabilityRefV1[];
  readonly limits: EnvironmentLimitsV1;
  readonly artifactPolicy: EnvironmentArtifactPolicyV1;
  /**
   * Optional on the wire for v1 compatibility. Server-normalized versions
   * use platform/null when legacy rows omit ownership metadata.
   */
  readonly scope?: EnvironmentTemplateScope;
  readonly ownerId?: string | null;
}

export interface EnvironmentTemplateVersionReferenceV1 {
  readonly templateId: string;
  readonly versionId: string;
  readonly contentDigest: string;
}

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/u;
const VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const ALIASES = new Set(['latest', 'current', 'head', 'main', 'master']);
const CONTROL = /[\u0000-\u001f\u007f]/u;
const MESSAGE = 'Invalid Environment Template contract.';

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
    if (++nodes > ENVIRONMENT_TEMPLATE_LIMITS.maxCapabilities * 256 || depth > 8) reject();
    if (typeof value === 'string') {
      stringChars += value.length;
      if (stringChars > ENVIRONMENT_TEMPLATE_LIMITS.maxSerializedBytes || /[\uD800-\uDFFF]/u.test(value)) reject();
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
      if (typeof key !== 'string' || ['__proto__', 'prototype', 'constructor'].includes(key)) reject();
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

function id(value: unknown, max = ENVIRONMENT_TEMPLATE_LIMITS.maxIdChars): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max || !ID.test(value) || ALIASES.has(value.toLowerCase())) reject();
  return value;
}

function parseEnvironmentTemplateScope(value: unknown): EnvironmentTemplateScope {
  if (value !== 'platform' && value !== 'private') reject();
  return value;
}

function parseEnvironmentTemplateOwnerId(value: unknown): string | null {
  if (value === null) return null;
  return id(value);
}

function runtimeVersion(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > ENVIRONMENT_TEMPLATE_LIMITS.maxIdChars ||
    !VERSION.test(value) || value.includes('..') || ALIASES.has(value.toLowerCase())) reject();
  return value;
}

function digest(value: unknown): string {
  if (typeof value !== 'string' || !DIGEST.test(value)) reject();
  return value;
}

function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max || value.trim().length === 0 || CONTROL.test(value)) reject();
  return value;
}

function boundedInteger(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) reject();
  return value;
}

function parseRuntime(value: unknown): AgentBuildRuntimeSelection {
  const record = object(value, ['kind', 'adapterVersion', 'policyVersion']);
  if (record.kind !== 'pi') reject();
  return Object.freeze({ kind: 'pi', adapterVersion: runtimeVersion(record.adapterVersion), policyVersion: runtimeVersion(record.policyVersion) });
}

function parseSystemCapability(value: unknown): EnvironmentSystemCapabilityRefV1 {
  const record = object(value, ['kind', 'capabilityId', 'versionId', 'contentDigest']);
  const capabilityIds: readonly EnvironmentSystemCapabilityId[] = [
    'workspace.read', 'workspace.write', 'artifact.write', 'preview.static', 'network.none',
  ];
  if (!capabilityIds.includes(record.capabilityId as EnvironmentSystemCapabilityId)) reject();
  return Object.freeze({
    kind: 'system',
    capabilityId: record.capabilityId as EnvironmentSystemCapabilityId,
    versionId: id(record.versionId),
    contentDigest: digest(record.contentDigest),
  });
}

export function parseEnvironmentCapabilityRef(value: unknown): EnvironmentCapabilityRefV1 {
  if (!plainObject(value)) reject();
  if (value.kind === 'system') return parseSystemCapability(value);
  return parseAgentBuildCapabilityRef(value);
}

export function environmentCapabilityIdentity(ref: EnvironmentCapabilityRefV1): string {
  if (ref.kind === 'system') return `system:${ref.capabilityId}`;
  return `agent:${agentBuildCapabilityReferenceIdentity(ref)}`;
}

export function environmentCapabilityReferenceIdentity(ref: EnvironmentCapabilityRefV1): string {
  return ref.kind === 'system'
    ? `system:${ref.capabilityId}:${ref.versionId}:${ref.contentDigest}`
    : `agent:${agentBuildCapabilityReferenceIdentity(ref)}`;
}

function parseCapabilities(value: unknown): readonly EnvironmentCapabilityRefV1[] {
  if (!Array.isArray(value) || value.length > ENVIRONMENT_TEMPLATE_LIMITS.maxCapabilities) reject();
  const parsed = value.map(parseEnvironmentCapabilityRef);
  if (new Set(parsed.map(environmentCapabilityIdentity)).size !== parsed.length) reject();
  parsed.sort((left, right) => environmentCapabilityIdentity(left).localeCompare(environmentCapabilityIdentity(right)));
  return Object.freeze(parsed);
}

function parseLimits(value: unknown): EnvironmentLimitsV1 {
  const record = object(value, ['maxExecutionMs', 'maxMemoryMiB', 'maxDiskBytes', 'maxProcesses']);
  return Object.freeze({
    maxExecutionMs: boundedInteger(record.maxExecutionMs, 1_000, ENVIRONMENT_TEMPLATE_LIMITS.maxExecutionMs),
    maxMemoryMiB: boundedInteger(record.maxMemoryMiB, 128, ENVIRONMENT_TEMPLATE_LIMITS.maxMemoryMiB),
    maxDiskBytes: boundedInteger(record.maxDiskBytes, 1_024 * 1_024, ENVIRONMENT_TEMPLATE_LIMITS.maxDiskBytes),
    maxProcesses: boundedInteger(record.maxProcesses, 1, ENVIRONMENT_TEMPLATE_LIMITS.maxProcesses),
  });
}

function parseArtifactPolicy(value: unknown): EnvironmentArtifactPolicyV1 {
  const record = object(value, ['allowedMediaTypes', 'maxArtifacts', 'maxArtifactBytes', 'maxTotalBytes']);
  if (!Array.isArray(record.allowedMediaTypes) || record.allowedMediaTypes.length === 0 || record.allowedMediaTypes.length > ARTIFACT_MEDIA_TYPES.length) reject();
  const allowedMediaTypes = [...new Set(record.allowedMediaTypes.map(parseArtifactMediaType))];
  const maxArtifacts = boundedInteger(record.maxArtifacts, 1, 128);
  const maxArtifactBytes = boundedInteger(record.maxArtifactBytes, 1, 8 * 1024 * 1024);
  const maxTotalBytes = boundedInteger(record.maxTotalBytes, maxArtifactBytes, 32 * 1024 * 1024);
  return Object.freeze({
    allowedMediaTypes: Object.freeze(allowedMediaTypes),
    maxArtifacts,
    maxArtifactBytes,
    maxTotalBytes,
  });
}

export function parseEnvironmentTemplateVersion(input: unknown): EnvironmentTemplateVersionV1 {
  inspectJson(input);
  const record = object(
    input,
    ['schemaVersion', 'templateId', 'versionId', 'versionNumber', 'name', 'description', 'runtime', 'capabilities', 'limits', 'artifactPolicy'],
    ['scope', 'ownerId'],
  );
  if (record.schemaVersion !== ENVIRONMENT_TEMPLATE_CONTRACT_VERSION) reject();

  const hasOwnershipMetadata = Object.hasOwn(record, 'scope') || Object.hasOwn(record, 'ownerId');
  const scope = record.scope === undefined ? 'platform' : parseEnvironmentTemplateScope(record.scope);
  const ownerId = record.ownerId === undefined ? null : parseEnvironmentTemplateOwnerId(record.ownerId);
  if ((scope === 'platform' && ownerId !== null) || (scope === 'private' && ownerId === null)) reject();

  // Do not rewrite legacy v1 digests: omitted ownership remains the implicit
  // platform/null default. Explicit metadata is canonicalized and included.
  const result: EnvironmentTemplateVersionV1 = {
    schemaVersion: ENVIRONMENT_TEMPLATE_CONTRACT_VERSION,
    templateId: id(record.templateId),
    versionId: id(record.versionId),
    versionNumber: boundedInteger(record.versionNumber, 1, 1_000_000),
    name: text(record.name, ENVIRONMENT_TEMPLATE_LIMITS.maxNameChars),
    description: text(record.description, ENVIRONMENT_TEMPLATE_LIMITS.maxDescriptionChars),
    runtime: parseRuntime(record.runtime),
    capabilities: parseCapabilities(record.capabilities),
    limits: parseLimits(record.limits),
    artifactPolicy: parseArtifactPolicy(record.artifactPolicy),
    ...(hasOwnershipMetadata ? { scope, ownerId } : {}),
  };
  const frozen = Object.freeze(result);
  if (new TextEncoder().encode(JSON.stringify(frozen)).length > ENVIRONMENT_TEMPLATE_LIMITS.maxSerializedBytes) reject();
  return frozen;
}

export function environmentTemplateOwnership(
  input: Pick<EnvironmentTemplateVersionV1, 'scope' | 'ownerId'>,
): EnvironmentTemplateOwnershipV1 {
  const scope = input.scope ?? 'platform';
  const ownerId = input.ownerId ?? null;
  if ((scope === 'platform' && ownerId !== null) || (scope === 'private' && ownerId === null)) reject();
  return Object.freeze({ scope, ownerId });
}

export function digestEnvironmentTemplateVersion(input: unknown): string {
  const normalized = parseEnvironmentTemplateVersion(input);
  return `sha256:${createHash('sha256').update('agentforge:environment-template:v1\n', 'utf8').update(JSON.stringify(normalized), 'utf8').digest('hex')}`;
}

export function parseEnvironmentTemplateVersionReference(input: unknown): EnvironmentTemplateVersionReferenceV1 {
  inspectJson(input);
  const record = object(input, ['templateId', 'versionId', 'contentDigest']);
  return Object.freeze({ templateId: id(record.templateId), versionId: id(record.versionId), contentDigest: digest(record.contentDigest) });
}

export function intersectEnvironmentCapabilities(
  requested: readonly AgentBuildCapabilityRef[],
  allowed: readonly EnvironmentCapabilityRefV1[],
): readonly AgentBuildCapabilityRef[] {
  const allowedIdentities = new Set(allowed
    .filter((capability): capability is AgentBuildCapabilityRef => capability.kind !== 'system')
    .map(environmentCapabilityReferenceIdentity));
  const result = requested.filter((capability) => allowedIdentities.has(environmentCapabilityReferenceIdentity(capability)));
  return Object.freeze([...result]);
}

export function intersectCapabilityLayers(
  requested: readonly AgentBuildCapabilityRef[],
  ...layers: readonly (readonly EnvironmentCapabilityRefV1[])[]
): readonly AgentBuildCapabilityRef[] {
  return layers.reduce<readonly AgentBuildCapabilityRef[]>(
    (current, layer) => intersectEnvironmentCapabilities(current, layer),
    [...requested],
  );
}

export function environmentTemplateVersionReference(
  template: EnvironmentTemplateVersionV1,
): EnvironmentTemplateVersionReferenceV1 {
  return Object.freeze({
    templateId: template.templateId,
    versionId: template.versionId,
    contentDigest: digestEnvironmentTemplateVersion(template),
  });
}
