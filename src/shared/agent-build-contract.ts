import { AppError, ERROR_CODES } from './errors.ts';
import type { ExecutionIdentity } from './runtime-contract.ts';
import type { ToolId } from './types.ts';

export const AGENT_BUILD_SCHEMA_VERSION = 1 as const;
/** Future HTTP adapters must enforce this on raw bytes before JSON parsing. */
export const AGENT_BUILD_HTTP_MAX_BODY_BYTES = 128 * 1024;
export const AGENT_BUILD_LIMITS = Object.freeze({
  maxInstructionsChars: 8000,
  maxIdChars: 80,
  maxSkills: 16,
  maxCapabilities: 16,
  maxDepth: 6,
  maxNodes: 1024,
  maxStringChars: 32768,
  maxSerializedBytes: 65536
});

/** Catalog identity only: resolution, digest verification and approval are server duties. */
export interface AgentBuildPinnedRef {
  readonly id: string;
  readonly versionId: string;
  readonly contentDigest: string;
}

export interface AgentBuildSkillRef {
  readonly kind: 'declarative';
  readonly componentId: string;
  readonly versionId: string;
  readonly contentDigest: string;
}

export type AgentBuildCapabilityRef =
  | {
    readonly kind: 'tool';
    readonly toolId: ToolId;
    readonly versionId: string;
    readonly contentDigest: string;
  }
  | {
    readonly kind: 'mcp-read';
    readonly serviceId: string;
    readonly toolId: string;
    readonly versionId: string;
    readonly contentDigest: string;
  };

export interface AgentBuildDefinitionV1 {
  readonly mode: 'agent';
  readonly definitionSchemaVersion: typeof AGENT_BUILD_SCHEMA_VERSION;
  readonly instructions: string;
  readonly modelSelection: AgentBuildPinnedRef | null;
  readonly skillRefs: readonly AgentBuildSkillRef[];
  readonly requestedCapabilities: readonly AgentBuildCapabilityRef[];
  readonly outputContractRef: AgentBuildPinnedRef | null;
  /** Existing Benchmark Profile identity, not a client-defined compatibility policy. */
  readonly profileRef: AgentBuildPinnedRef | null;
  readonly environmentRef: AgentBuildPinnedRef | null;
  readonly runtimeSelection: AgentBuildRuntimeSelection | null;
}

export type AgentBuildRuntimeSelection = Readonly<
  Pick<ExecutionIdentity, 'adapterVersion' | 'policyVersion'> & { kind: 'pi' }
>;

/** Separate from Workflow and RunDefinition; no implicit conversion to an executable task. */
export type AgentBuildDefinition = AgentBuildDefinitionV1;

/** A configuration gate is additive to B1 parsing; B2 still owns the private draft policy. */
export interface ConfiguredAgentBuildRequirements {
  readonly requireModel?: boolean;
  readonly requireEnvironment?: boolean;
  readonly requireOutputContract?: boolean;
  readonly requireRuntime?: boolean;
}

/**
 * A configuration is executable-relevant when it names any dependency,
 * capability, environment, output contract, profile, or runtime. This is a
 * structural classification only; it does not grant or resolve anything.
 */
export function isConfiguredAgentBuild(definition: AgentBuildDefinition): boolean {
  return Boolean(
    definition.modelSelection ||
    definition.skillRefs.length > 0 ||
    definition.requestedCapabilities.length > 0 ||
    definition.outputContractRef ||
    definition.profileRef ||
    definition.environmentRef ||
    definition.runtimeSelection
  );
}

const TOOLS: ReadonlySet<ToolId> = new Set([
  'calculator', 'json-validator', 'text-search', 'date-parser', 'string-matcher'
]);
const ALIASES = new Set(['latest', 'current', 'head', 'main', 'master']);
const MESSAGE = 'Invalid Agent Build definition.';

function reject(): never {
  // Never reflect private instructions, reference identities or secret-looking input in errors.
  throw new AppError(MESSAGE, 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
}

/**
 * Accept only bounded JSON data, including at the JS-call boundary. No getters,
 * custom prototypes, symbols, hidden properties, sparse arrays or cyclic shapes.
 * This is not a sandbox for hostile JS Proxies; HTTP adapters must supply parsed JSON.
 */
function inspectJson(input: unknown): void {
  let nodes = 0;
  let stringChars = 0;
  const ancestors = new Set<object>();
  function visit(value: unknown, depth: number): void {
    if (++nodes > AGENT_BUILD_LIMITS.maxNodes || depth > AGENT_BUILD_LIMITS.maxDepth) reject();
    if (typeof value === 'string') {
      stringChars += value.length;
      if (stringChars > AGENT_BUILD_LIMITS.maxStringChars || /[\uD800-\uDFFF]/u.test(value)) reject();
      return;
    }
    if (value === null || typeof value === 'boolean') return;
    if (typeof value === 'number' && Number.isFinite(value)) return;
    if (typeof value !== 'object' || value === null || ancestors.has(value)) reject();
    const array = Array.isArray(value);
    const prototype = Object.getPrototypeOf(value);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) reject();
    const keys = Reflect.ownKeys(value);
    if (keys.length > 64) reject();
    if (array && (value.length > Math.max(AGENT_BUILD_LIMITS.maxSkills, AGENT_BUILD_LIMITS.maxCapabilities) || keys.length !== value.length + 1)) reject();
    ancestors.add(value);
    for (const key of keys) {
      if (typeof key !== 'string' || key.length > AGENT_BUILD_LIMITS.maxIdChars || ['__proto__', 'prototype', 'constructor'].includes(key)) reject();
      if (array && key === 'length') continue;
      if (array && !/^(0|[1-9][0-9]*)$/.test(key)) reject();
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) reject();
      visit(descriptor.value, depth + 1);
    }
    ancestors.delete(value);
  }
  visit(input, 0);
}

function object(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) reject();
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !required.includes(key) && !optional.includes(key))) reject();
  if (required.some((key) => !Object.hasOwn(record, key))) reject();
  return record;
}

function id(value: unknown): string {
  if (typeof value !== 'string' || value.length > AGENT_BUILD_LIMITS.maxIdChars ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value) || ALIASES.has(value.toLowerCase())) reject();
  return value;
}

function runtimeVersion(value: unknown): string {
  if (typeof value !== 'string' || value.length > AGENT_BUILD_LIMITS.maxIdChars ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) || value.includes('..') ||
    ALIASES.has(value.toLowerCase())) reject();
  return value;
}

function digest(value: unknown): string {
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(value)) reject();
  return value;
}

function pinned(value: unknown): AgentBuildPinnedRef {
  const ref = object(value, ['id', 'versionId', 'contentDigest']);
  return Object.freeze({ id: id(ref.id), versionId: id(ref.versionId), contentDigest: digest(ref.contentDigest) });
}

function optionalPinned(record: Record<string, unknown>, key: string): AgentBuildPinnedRef | null {
  return !Object.hasOwn(record, key) || record[key] === null ? null : pinned(record[key]);
}

export function parseAgentBuildRuntimeSelection(value: unknown): AgentBuildRuntimeSelection {
  const runtime = object(value, ['kind', 'adapterVersion', 'policyVersion']);
  if (runtime.kind !== 'pi') reject();
  return Object.freeze({
    kind: 'pi',
    adapterVersion: runtimeVersion(runtime.adapterVersion),
    policyVersion: runtimeVersion(runtime.policyVersion)
  });
}

function list<T>(value: unknown, maximum: number, parse: (item: unknown) => T, identity: (item: T) => string): T[] {
  if (!Array.isArray(value) || value.length > maximum) reject();
  const parsed = value.map(parse);
  if (new Set(parsed.map(identity)).size !== parsed.length) reject();
  return parsed;
}

function skill(value: unknown): AgentBuildSkillRef {
  const ref = object(value, ['kind', 'componentId', 'versionId', 'contentDigest']);
  if (ref.kind !== 'declarative') reject();
  return Object.freeze({ kind: 'declarative', componentId: id(ref.componentId), versionId: id(ref.versionId), contentDigest: digest(ref.contentDigest) });
}

export function parseAgentBuildCapabilityRef(value: unknown): AgentBuildCapabilityRef {
  const ref = object(value, ['kind', 'toolId', 'versionId', 'contentDigest'], ['serviceId']);
  const toolId = id(ref.toolId);
  const versionId = id(ref.versionId);
  const contentDigest = digest(ref.contentDigest);
  if (ref.kind === 'tool' && !Object.hasOwn(ref, 'serviceId') && TOOLS.has(toolId as ToolId)) {
    return Object.freeze({ kind: 'tool', toolId: toolId as ToolId, versionId, contentDigest });
  }
  if (ref.kind === 'mcp-read' && Object.hasOwn(ref, 'serviceId')) {
    return Object.freeze({ kind: 'mcp-read', serviceId: id(ref.serviceId), toolId, versionId, contentDigest });
  }
  return reject();
}

export function agentBuildCapabilityIdentity(ref: AgentBuildCapabilityRef): string {
  return ref.kind === 'tool' ? `tool:${ref.toolId}` : `mcp-read:${ref.serviceId}:${ref.toolId}`;
}

/**
 * Includes the pinned version and digest so capability intersection cannot
 * silently accept a stale or substituted implementation.
 */
export function agentBuildCapabilityReferenceIdentity(ref: AgentBuildCapabilityRef): string {
  return `${agentBuildCapabilityIdentity(ref)}:${ref.versionId}:${ref.contentDigest}`;
}

function capabilityIdentity(ref: AgentBuildCapabilityRef): string {
  return agentBuildCapabilityIdentity(ref);
}

/** Parse one capability at a public boundary without changing B2 draft policy. */
export function parseAgentBuildCapability(value: unknown): AgentBuildCapabilityRef {
  inspectJson(value);
  return parseAgentBuildCapabilityRef(value);
}

/**
 * B1 structural validation ONLY. Defaults: omitted skillRefs/requestedCapabilities
 * become []; omitted selections/references become null (explicit null accepted).
 * mode/schema version/instructions are required. Empty/whitespace instructions
 * are valid drafts. Explicit undefined is always rejected, even on optional keys.
 * Fully pinned selections are required when present; no partial references.
 * Parsing has no runtime availability, grants, readiness or authorization checks.
 * CRLF/CR instructions become LF, with all other whitespace preserved. Skill
 * order is meaningful; capability order is a set sorted by identity (ASCII).
 * Same component/tool identity twice is invalid even with different versions.
 *
 * No credentials/bindings/grants, endpoints, paths, executable attachments,
 * arbitrary configuration or policy overrides are represented. Instruction text
 * is untrusted and may itself contain private data: this is NOT a public/Fork
 * projection or a secret scanner. B2 must authorize the selected historical Build
 * and every dependency, and rebind caller credentials outside this definition.
 * Never mark accepted references approved, or infer Profile/runtime compatibility.
 */
export function parseAgentBuildDefinition(input: unknown): AgentBuildDefinition {
  inspectJson(input);
  const value = object(input, [
    'mode', 'definitionSchemaVersion', 'instructions'
  ], [
    'modelSelection', 'outputContractRef', 'profileRef', 'environmentRef',
    'runtimeSelection', 'skillRefs', 'requestedCapabilities'
  ]);
  if (value.mode !== 'agent' || value.definitionSchemaVersion !== AGENT_BUILD_SCHEMA_VERSION) reject();
  if (typeof value.instructions !== 'string' || value.instructions.length > AGENT_BUILD_LIMITS.maxInstructionsChars ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value.instructions)) reject();
  const skills = list(Object.hasOwn(value, 'skillRefs') ? value.skillRefs : [], AGENT_BUILD_LIMITS.maxSkills, skill, (ref) => ref.componentId);
  const capabilities = list(Object.hasOwn(value, 'requestedCapabilities') ? value.requestedCapabilities : [], AGENT_BUILD_LIMITS.maxCapabilities, parseAgentBuildCapabilityRef, capabilityIdentity);
  capabilities.sort((a, b) => capabilityIdentity(a) < capabilityIdentity(b) ? -1 : 1);
  const result: AgentBuildDefinition = Object.freeze({
    mode: 'agent',
    definitionSchemaVersion: AGENT_BUILD_SCHEMA_VERSION,
    instructions: value.instructions.replace(/\r\n?/g, '\n'),
    modelSelection: optionalPinned(value, 'modelSelection'),
    skillRefs: Object.freeze(skills),
    requestedCapabilities: Object.freeze(capabilities),
    outputContractRef: optionalPinned(value, 'outputContractRef'),
    profileRef: optionalPinned(value, 'profileRef'),
    environmentRef: optionalPinned(value, 'environmentRef'),
    runtimeSelection: !Object.hasOwn(value, 'runtimeSelection') || value.runtimeSelection === null
      ? null
      : parseAgentBuildRuntimeSelection(value.runtimeSelection)
  });
  if (new TextEncoder().encode(JSON.stringify(result)).length > AGENT_BUILD_LIMITS.maxSerializedBytes) reject();
  return result;
}


/**
 * Additive configuration validation for T1/T3 callers. This function does not
 * authorize catalog references, resolve credentials, or alter privateAgentDraft.
 * Callers must perform owner, release and capability authorization separately.
 */
export function validateConfiguredAgentBuild(
  input: unknown,
  visibility: unknown,
  requirements: ConfiguredAgentBuildRequirements = {}
): AgentBuildDefinition {
  const definition = parseAgentBuildDefinition(input);
  if (visibility !== 'private') reject();
  if (requirements.requireModel && !definition.modelSelection) reject();
  if (requirements.requireEnvironment && !definition.environmentRef) reject();
  if (requirements.requireOutputContract && !definition.outputContractRef) reject();
  if (requirements.requireRuntime && !definition.runtimeSelection) reject();
  return definition;
}
