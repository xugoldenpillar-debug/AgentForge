import { createHash } from 'node:crypto';
import { AppError, ERROR_CODES } from './errors.ts';
import { parseAgentBuildRuntimeSelection, type AgentBuildRuntimeSelection } from './agent-build-contract.ts';
import {
  ARTIFACT_MEDIA_TYPES,
  parseArtifactMediaType,
  parseSha256Digest,
  type ArtifactMediaType,
} from './artifact-contract.ts';
import type {
  EnvironmentArtifactPolicyV1,
  EnvironmentLimitsV1,
  EnvironmentSystemCapabilityId,
} from './environment-contract.ts';

export const AGENT_RUNTIME_SNAPSHOT_VERSION = 1 as const;
export const AGENT_RUNTIME_SNAPSHOT_KIND = 'agent-permission-snapshot' as const;

export const AGENT_RUNTIME_SNAPSHOT_LIMITS = Object.freeze({
  maxSerializedBytes: 128 * 1024,
  maxCapabilities: 32,
  maxArtifacts: 128,
  maxArtifactBytes: 8 * 1024 * 1024,
  maxTotalBytes: 32 * 1024 * 1024,
});

export type AgentRuntimeCapabilityPermission =
  | 'read-only'
  | 'scoped-workspace-only'
  | 'scoped-output-only'
  | 'static-only'
  | 'none';

export const AGENT_RUNTIME_CAPABILITY_PERMISSIONS: Readonly<Record<EnvironmentSystemCapabilityId, AgentRuntimeCapabilityPermission>> = Object.freeze({
  'workspace.read': 'read-only',
  'workspace.write': 'scoped-workspace-only',
  'artifact.write': 'scoped-output-only',
  'preview.static': 'static-only',
  'network.none': 'none',
});

export interface AgentRuntimeBuildIdentityV1 {
  readonly ownerId: string;
  readonly buildId: string;
  readonly buildVersionId: string;
  readonly definitionDigest: string;
}

export interface AgentRuntimeEffectiveCapabilityV1 {
  readonly kind: 'system';
  readonly capabilityId: EnvironmentSystemCapabilityId;
  readonly permission: AgentRuntimeCapabilityPermission;
  readonly versionId: string;
  readonly contentDigest: string;
}

export interface AgentRuntimePermissionSnapshotV1 {
  readonly schemaVersion: typeof AGENT_RUNTIME_SNAPSHOT_VERSION;
  readonly kind: typeof AGENT_RUNTIME_SNAPSHOT_KIND;
  readonly agent: {
    readonly nodeId: string;
    readonly runtime: 'pi';
    readonly policyVersion: string;
  };
  readonly build: AgentRuntimeBuildIdentityV1;
  readonly environment: {
    readonly templateId: string;
    readonly versionId: string;
    readonly contentDigest: string;
    readonly runtime: AgentBuildRuntimeSelection;
    readonly networkMode: 'disabled';
  };
  readonly effectiveCapabilities: readonly AgentRuntimeEffectiveCapabilityV1[];
  readonly limits: EnvironmentLimitsV1;
  readonly artifactPolicy: EnvironmentArtifactPolicyV1;
  readonly snapshotDigest: string;
}

export type AgentRuntimePermissionSnapshotInputV1 = Omit<AgentRuntimePermissionSnapshotV1, 'snapshotDigest'>;

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/u;
const VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const CONTROL = /[\u0000-\u001f\u007f]/u;
const ALIASES = new Set(['latest', 'current', 'head', 'main', 'master']);
const CAPABILITY_IDS = Object.keys(AGENT_RUNTIME_CAPABILITY_PERMISSIONS) as EnvironmentSystemCapabilityId[];
const MESSAGE = 'Invalid Agent runtime permission snapshot.';

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
    if (++nodes > 4096 || depth > 8) reject();
    if (typeof value === 'string') {
      stringChars += value.length;
      if (stringChars > AGENT_RUNTIME_SNAPSHOT_LIMITS.maxSerializedBytes || /[\uD800-\uDFFF]/u.test(value)) reject();
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

function id(value: unknown, max = 160): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max || !ID.test(value) || ALIASES.has(value.toLowerCase())) reject();
  return value;
}

function version(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 160 || !VERSION.test(value) || value.includes('..') || ALIASES.has(value.toLowerCase())) reject();
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

function parseLimits(value: unknown): EnvironmentLimitsV1 {
  const record = object(value, ['maxExecutionMs', 'maxMemoryMiB', 'maxDiskBytes', 'maxProcesses']);
  return Object.freeze({
    maxExecutionMs: boundedInteger(record.maxExecutionMs, 1_000, 600_000),
    maxMemoryMiB: boundedInteger(record.maxMemoryMiB, 128, 8_192),
    maxDiskBytes: boundedInteger(record.maxDiskBytes, 1_024 * 1_024, 32 * 1024 * 1024),
    maxProcesses: boundedInteger(record.maxProcesses, 1, 64),
  });
}

function parseArtifactPolicy(value: unknown): EnvironmentArtifactPolicyV1 {
  const record = object(value, ['allowedMediaTypes', 'maxArtifacts', 'maxArtifactBytes', 'maxTotalBytes']);
  if (!Array.isArray(record.allowedMediaTypes) || record.allowedMediaTypes.length === 0 || record.allowedMediaTypes.length > ARTIFACT_MEDIA_TYPES.length) reject();
  const allowedMediaTypes = [...new Set(record.allowedMediaTypes.map(parseArtifactMediaType))];
  const maxArtifactBytes = boundedInteger(record.maxArtifactBytes, 1, AGENT_RUNTIME_SNAPSHOT_LIMITS.maxArtifactBytes);
  const maxTotalBytes = boundedInteger(record.maxTotalBytes, maxArtifactBytes, AGENT_RUNTIME_SNAPSHOT_LIMITS.maxTotalBytes);
  return Object.freeze({
    allowedMediaTypes: Object.freeze(allowedMediaTypes),
    maxArtifacts: boundedInteger(record.maxArtifacts, 1, AGENT_RUNTIME_SNAPSHOT_LIMITS.maxArtifacts),
    maxArtifactBytes,
    maxTotalBytes,
  });
}

function parseBuildIdentity(value: unknown): AgentRuntimeBuildIdentityV1 {
  const record = object(value, ['ownerId', 'buildId', 'buildVersionId', 'definitionDigest']);
  return Object.freeze({
    ownerId: id(record.ownerId),
    buildId: id(record.buildId),
    buildVersionId: id(record.buildVersionId),
    definitionDigest: parseSha256Digest(record.definitionDigest),
  });
}

function parseCapability(value: unknown): AgentRuntimeEffectiveCapabilityV1 {
  const record = object(value, ['kind', 'capabilityId', 'permission', 'versionId', 'contentDigest']);
  if (record.kind !== 'system' || !CAPABILITY_IDS.includes(record.capabilityId as EnvironmentSystemCapabilityId)) reject();
  const capabilityId = record.capabilityId as EnvironmentSystemCapabilityId;
  if (record.permission !== AGENT_RUNTIME_CAPABILITY_PERMISSIONS[capabilityId]) reject();
  return Object.freeze({
    kind: 'system',
    capabilityId,
    permission: record.permission as AgentRuntimeCapabilityPermission,
    versionId: id(record.versionId),
    contentDigest: parseSha256Digest(record.contentDigest),
  });
}

function parseEnvironment(value: unknown): AgentRuntimePermissionSnapshotV1['environment'] {
  const record = object(value, ['templateId', 'versionId', 'contentDigest', 'runtime', 'networkMode']);
  if (record.networkMode !== 'disabled') reject();
  return Object.freeze({
    templateId: id(record.templateId),
    versionId: id(record.versionId),
    contentDigest: parseSha256Digest(record.contentDigest),
    runtime: parseAgentBuildRuntimeSelection(record.runtime),
    networkMode: 'disabled',
  });
}

function normalizeSnapshotBody(input: unknown): AgentRuntimePermissionSnapshotInputV1 {
  inspectJson(input);
  const record = object(input, ['schemaVersion', 'kind', 'agent', 'build', 'environment', 'effectiveCapabilities', 'limits', 'artifactPolicy']);
  if (record.schemaVersion !== AGENT_RUNTIME_SNAPSHOT_VERSION || record.kind !== AGENT_RUNTIME_SNAPSHOT_KIND) reject();
  const agentRecord = object(record.agent, ['nodeId', 'runtime', 'policyVersion']);
  if (agentRecord.runtime !== 'pi') reject();
  const rawCapabilities = record.effectiveCapabilities;
  if (!Array.isArray(rawCapabilities) || rawCapabilities.length > AGENT_RUNTIME_SNAPSHOT_LIMITS.maxCapabilities) reject();
  const capabilities = rawCapabilities.map(parseCapability).sort((left, right) => left.capabilityId.localeCompare(right.capabilityId));
  if (new Set(capabilities.map((capability) => capability.capabilityId)).size !== capabilities.length) reject();
  const normalized: AgentRuntimePermissionSnapshotInputV1 = {
    schemaVersion: AGENT_RUNTIME_SNAPSHOT_VERSION,
    kind: AGENT_RUNTIME_SNAPSHOT_KIND,
    agent: Object.freeze({
      nodeId: id(agentRecord.nodeId),
      runtime: 'pi',
      policyVersion: version(agentRecord.policyVersion),
    }),
    build: parseBuildIdentity(record.build),
    environment: parseEnvironment(record.environment),
    effectiveCapabilities: Object.freeze(capabilities),
    limits: parseLimits(record.limits),
    artifactPolicy: parseArtifactPolicy(record.artifactPolicy),
  };
  if (new TextEncoder().encode(canonicalJson(normalized)).length > AGENT_RUNTIME_SNAPSHOT_LIMITS.maxSerializedBytes) reject();
  return normalized;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

function digestText(value: string): string {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

export function digestAgentRuntimePermissionSnapshot(input: AgentRuntimePermissionSnapshotInputV1): string {
  return digestText(`agentforge:agent-runtime-permission-snapshot:v1\n${canonicalJson(input)}`);
}

export function createAgentRuntimePermissionSnapshot(input: AgentRuntimePermissionSnapshotInputV1): AgentRuntimePermissionSnapshotV1 {
  const normalized = normalizeSnapshotBody(input);
  return parseAgentRuntimePermissionSnapshot({
    ...normalized,
    snapshotDigest: digestAgentRuntimePermissionSnapshot(normalized),
  });
}

export function parseAgentRuntimePermissionSnapshot(input: unknown): AgentRuntimePermissionSnapshotV1 {
  inspectJson(input);
  const record = object(input, ['schemaVersion', 'kind', 'agent', 'build', 'environment', 'effectiveCapabilities', 'limits', 'artifactPolicy', 'snapshotDigest']);
  const normalized = normalizeSnapshotBody({
    schemaVersion: record.schemaVersion,
    kind: record.kind,
    agent: record.agent,
    build: record.build,
    environment: record.environment,
    effectiveCapabilities: record.effectiveCapabilities,
    limits: record.limits,
    artifactPolicy: record.artifactPolicy,
  });
  const snapshotDigest = parseSha256Digest(record.snapshotDigest);
  if (snapshotDigest !== digestAgentRuntimePermissionSnapshot(normalized)) reject();
  return deepFreeze({ ...normalized, snapshotDigest });
}
