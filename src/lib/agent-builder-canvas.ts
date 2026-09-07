/**
 * Browser-safe Agent Builder canvas contracts.
 *
 * This module is intentionally independent from the Workflow DAG contract. An
 * Agent canvas describes configuration intent and capability requests; its
 * edges are never execution order and must never be passed to
 * validateWorkflow(). The server remains authoritative for resolving pinned
 * references, grants, ownership, and runtime availability.
 */

export const AGENT_CANVAS_SCHEMA_VERSION = 1 as const;

export const AGENT_NODE_KINDS = [
  'task',
  'agent',
  'model',
  'skill',
  'environment',
  'inputMount',
  'capability',
  'outputContract',
] as const;

export const AGENT_EDGE_RELATIONS = [
  'configures',
  'supplies',
  'grants-request',
  'expects',
] as const;

export type AgentNodeKind = (typeof AGENT_NODE_KINDS)[number];
export type AgentEdgeRelation = (typeof AGENT_EDGE_RELATIONS)[number];
export type AgentConfigValue = string | number | boolean | string[] | null;
export type AgentNodeConfig = Record<string, AgentConfigValue>;

export type AgentCanvasNode = {
  id: string;
  kind: AgentNodeKind;
  label: string;
  config: AgentNodeConfig;
};

export type AgentCanvasEdge = {
  id: string;
  source: string;
  target: string;
  relation: AgentEdgeRelation;
};

export type AgentCanvasDocument = {
  schemaVersion: typeof AGENT_CANVAS_SCHEMA_VERSION;
  nodes: AgentCanvasNode[];
  edges: AgentCanvasEdge[];
};

export type AgentCanvasValidation = {
  valid: boolean;
  errors: string[];
};

export type CompiledAgentCanvas = {
  schemaVersion: typeof AGENT_CANVAS_SCHEMA_VERSION;
  task: {
    id: string;
    brief: string;
    profileRef: string | null;
  };
  agent: {
    id: string;
    instructions: string;
    runtime: 'pi';
    policyVersion: string;
  };
  model: {
    id: string;
    provider: string;
    modelId: string;
    modelVersion: string;
  };
  skillRefs: Array<{
    id: string;
    kind: 'declarative';
    componentId: string;
    versionId: string;
    contentDigest: string;
  }>;
  environment: {
    id: string;
    templateId: string;
    versionId: string;
    contentDigest: string;
    networkMode: 'disabled';
  };
  inputMounts: Array<{
    id: string;
    mountId: string;
    sourceKind: string;
    readOnly: true;
  }>;
  requestedCapabilities: Array<{
    id: string;
    capabilityId: ApprovedCapabilityId;
    permission: ApprovedCapabilityPermission;
  }>;
  outputContract: {
    id: string;
    format: string;
    entrypoint: string;
    requiredFiles: string[];
  };
};

export type AgentCanvasCompileResult =
  | { valid: true; plan: CompiledAgentCanvas; semanticJson: string }
  | { valid: false; errors: string[] };

const CONFIG_FIELDS: Record<AgentNodeKind, readonly string[]> = {
  task: ['brief', 'profileRef'],
  agent: ['instructions', 'runtime', 'policyVersion'],
  model: ['provider', 'modelId', 'modelVersion'],
  skill: ['skillId', 'versionId', 'contentDigest', 'kind'],
  environment: ['templateId', 'versionId', 'contentDigest', 'networkMode', 'runtime'],
  inputMount: ['mountId', 'sourceKind', 'readOnly'],
  capability: ['capabilityId', 'permission'],
  outputContract: ['format', 'entrypoint', 'requiredFiles'],
};

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u;
const PATH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/u;
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const CONTROL_PATTERN = `[\\u0000-\\u001f\\u007f]`;
const CONTROL = new RegExp(CONTROL_PATTERN, 'u');
const UNPAIRED_SURROGATE = /[\uD800-\uDFFF]/u;
const URL_PATTERN = /(?:^|[\s("'`])(?:https?:\/\/|ftp:\/\/|\/\/)[^\s"'<>`]+/iu;
const ABSOLUTE_PATH_PATTERN = /(?:^|[\s("'`])(?:[A-Za-z]:[\\/]|\\\\|\/(?:Users|home|tmp|private|var)\/|~\/)/u;
const ENCODED_PATH_PATTERN = /%(?:2e|2f|5c)/iu;
const SECRET_PATTERN = /(?:\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|credential|authorization)\b\s*[:=]|\bBearer\s+[A-Za-z0-9._-]{12,}|\bsk-[A-Za-z0-9_-]{12,})/iu;
const ALIASES = new Set(['latest', 'current', 'head', 'main', 'master']);

export type ApprovedCapabilityId =
  | 'workspace.read'
  | 'workspace.write'
  | 'artifact.write'
  | 'preview.static'
  | 'network.none';

export type ApprovedCapabilityPermission =
  | 'read-only'
  | 'scoped-workspace-only'
  | 'scoped-output-only'
  | 'static-only'
  | 'none';

export const APPROVED_CAPABILITY_PERMISSIONS: Readonly<Record<ApprovedCapabilityId, ApprovedCapabilityPermission>> = {
  'workspace.read': 'read-only',
  'workspace.write': 'scoped-workspace-only',
  'artifact.write': 'scoped-output-only',
  'preview.static': 'static-only',
  'network.none': 'none',
};

function isNodeKind(value: unknown): value is AgentNodeKind {
  return typeof value === 'string' && (AGENT_NODE_KINDS as readonly string[]).includes(value);
}

function isEdgeRelation(value: unknown): value is AgentEdgeRelation {
  return typeof value === 'string' && (AGENT_EDGE_RELATIONS as readonly string[]).includes(value);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isConfigValue(value: unknown): value is AgentConfigValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function sanitizeString(value: string): string {
  return value
    .replace(/(?:\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|secret|credential)\b\s*[:=]\s*)[^\s,;]+/giu, '[redacted]')
    .replace(/\bBearer\s+[A-Za-z0-9._-]{12,}/giu, 'Bearer [redacted]')
    .replace(/\bsk-[A-Za-z0-9_-]{12,}/giu, '[redacted]')
    .replace(/(^|[\s("'`])(?:[A-Za-z]:[\\/]|\\\\|\/(?:Users|home|tmp|private|var)\/|~\/)[^\s"'<>`]*/gu, (_match, prefix: string) => `${prefix}[redacted path]`);
}

function sanitizeValue(value: AgentConfigValue): AgentConfigValue {
  if (typeof value === 'string') return sanitizeString(value);
  if (Array.isArray(value)) return value.map(sanitizeString);
  return value;
}

/**
 * Keep only deliberately public canvas fields. This is a defensive projection
 * for local drafts; it is not an authorization or secret-management boundary.
 */
export function sanitizeAgentNode(node: AgentCanvasNode): AgentCanvasNode {
  const allowed = isNodeKind(node.kind) ? new Set(CONFIG_FIELDS[node.kind]) : new Set<string>();
  const config: AgentNodeConfig = {};
  if (isPlainRecord(node.config)) {
    for (const [key, value] of Object.entries(node.config)) {
      if (!allowed.has(key) || !isConfigValue(value)) continue;
      config[key] = sanitizeValue(value);
    }
  }
  return {
    id: typeof node.id === 'string' ? node.id : '',
    kind: node.kind,
    label: typeof node.label === 'string' ? sanitizeString(node.label).slice(0, 120) : '',
    config,
  };
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableValue(entry)]),
    );
  }
  return value;
}

/**
 * React Flow positions are intentionally absent from the semantic document.
 * Layout changes therefore cannot alter the serialized canvas or digest.
 */
export function normalizeAgentCanvas(canvas: AgentCanvasDocument): AgentCanvasDocument {
  return {
    schemaVersion: AGENT_CANVAS_SCHEMA_VERSION,
    nodes: canvas.nodes
      .map(sanitizeAgentNode)
      .sort((left, right) => left.id.localeCompare(right.id)),
    edges: canvas.edges
      .map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        relation: edge.relation,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  };
}

export function serializeAgentCanvas(canvas: AgentCanvasDocument): string {
  return JSON.stringify(stableValue(normalizeAgentCanvas(canvas)));
}

/**
 * SHA-256 is computed with Web Crypto where available. The fallback is only a
 * deterministic local display aid and must never authorize a run or publish.
 */
export async function digestAgentCanvas(canvas: AgentCanvasDocument): Promise<string> {
  const serialized = serializeAgentCanvas(canvas);
  if (globalThis.crypto?.subtle) {
    const bytes = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(serialized));
    return `sha256:${Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
  }

  let hash = 2166136261;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fallback:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function hasNode(canvas: AgentCanvasDocument, kind: AgentNodeKind): boolean {
  return canvas.nodes.some((node) => node.kind === kind);
}

function relationAllowed(source: AgentCanvasNode, target: AgentCanvasNode, relation: AgentEdgeRelation): boolean {
  if (relation === 'configures') return source.kind === 'task' && target.kind === 'agent';
  if (relation === 'supplies') {
    return target.kind === 'agent' && ['inputMount', 'model', 'skill', 'environment'].includes(source.kind);
  }
  if (relation === 'grants-request') return source.kind === 'agent' && target.kind === 'capability';
  if (relation === 'expects') return source.kind === 'agent' && target.kind === 'outputContract';
  return false;
}

function pushValueError(errors: string[], nodeId: string, field: string, message: string): void {
  errors.push(`Agent node ${nodeId || '(unnamed)'} ${field}: ${message}.`);
}

function validateSafeText(errors: string[], value: unknown, nodeId: string, field: string, maxLength: number): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    pushValueError(errors, nodeId, field, 'must be a bounded non-empty string');
    return false;
  }
  if (CONTROL.test(value) || UNPAIRED_SURROGATE.test(value)) pushValueError(errors, nodeId, field, 'contains control characters');
  if (URL_PATTERN.test(value)) pushValueError(errors, nodeId, field, 'must not contain an arbitrary URL');
  if (ABSOLUTE_PATH_PATTERN.test(value) || ENCODED_PATH_PATTERN.test(value)) pushValueError(errors, nodeId, field, 'must not contain a host path');
  if (SECRET_PATTERN.test(value)) pushValueError(errors, nodeId, field, 'must not contain credentials or secret-like values');
  return true;
}

function validateIdentifier(errors: string[], value: unknown, nodeId: string, field: string): value is string {
  if (!validateSafeText(errors, value, nodeId, field, 120)) return false;
  if (!ID_PATTERN.test(value) || ALIASES.has(value.toLowerCase())) {
    pushValueError(errors, nodeId, field, 'must be a pinned identifier, not an alias');
    return false;
  }
  return true;
}

function validateDigest(errors: string[], value: unknown, nodeId: string, field: string): value is string {
  if (!validateSafeText(errors, value, nodeId, field, 80)) return false;
  if (!DIGEST_PATTERN.test(value)) {
    pushValueError(errors, nodeId, field, 'must be a sha256 digest');
    return false;
  }
  return true;
}

function validateRelativePath(errors: string[], value: unknown, nodeId: string, field: string): value is string {
  if (!validateSafeText(errors, value, nodeId, field, 240)) return false;
  if (!PATH_PATTERN.test(value) || value.split('/').some((segment) => segment === '.' || segment === '..')) {
    pushValueError(errors, nodeId, field, 'must be a safe relative path');
    return false;
  }
  return true;
}

function configForNode(node: AgentCanvasNode): Record<string, unknown> | null {
  if (!isPlainRecord(node.config)) return null;
  return node.config;
}

function validateNodeConfig(node: AgentCanvasNode, errors: string[]): void {
  const config = configForNode(node);
  if (!config || !isNodeKind(node.kind)) return;
  const allowed = CONFIG_FIELDS[node.kind];
  for (const [key, value] of Object.entries(config)) {
    if (!allowed.includes(key)) errors.push(`Agent node ${node.id || '(unnamed)'} contains unsupported config field ${key}.`);
    if (!isConfigValue(value)) pushValueError(errors, node.id, key, 'must be a JSON scalar or string array');
  }

  const requiredText = (field: string, max = 8_000) => validateSafeText(errors, config[field], node.id, field, max);
  const identifier = (field: string) => validateIdentifier(errors, config[field], node.id, field);
  const digest = (field: string) => validateDigest(errors, config[field], node.id, field);

  switch (node.kind) {
    case 'task':
      requiredText('brief');
      if (config.profileRef !== undefined && config.profileRef !== null) identifier('profileRef');
      break;
    case 'agent':
      requiredText('instructions');
      if (config.runtime !== 'pi') pushValueError(errors, node.id, 'runtime', 'must use the approved pi runtime');
      identifier('policyVersion');
      break;
    case 'model':
      identifier('provider');
      identifier('modelId');
      identifier('modelVersion');
      break;
    case 'skill':
      if (config.kind !== 'declarative') pushValueError(errors, node.id, 'kind', 'must be declarative');
      identifier('skillId');
      identifier('versionId');
      digest('contentDigest');
      break;
    case 'environment':
      identifier('templateId');
      identifier('versionId');
      digest('contentDigest');
      if (config.networkMode !== 'disabled') pushValueError(errors, node.id, 'networkMode', 'must remain disabled in this UI slice');
      if (config.runtime !== undefined) identifier('runtime');
      break;
    case 'inputMount':
      identifier('mountId');
      identifier('sourceKind');
      if (config.readOnly !== true) pushValueError(errors, node.id, 'readOnly', 'must be true for approved input mounts');
      break;
    case 'capability': {
      const capabilityId = config.capabilityId;
      if (!validateSafeText(errors, capabilityId, node.id, 'capabilityId', 120) || !(capabilityId in APPROVED_CAPABILITY_PERMISSIONS)) {
        pushValueError(errors, node.id, 'capabilityId', 'is not an approved system capability');
        break;
      }
      const expected = APPROVED_CAPABILITY_PERMISSIONS[capabilityId as ApprovedCapabilityId];
      if (config.permission !== expected) {
        pushValueError(errors, node.id, 'permission', `must remain ${expected} for ${capabilityId}`);
      }
      break;
    }
    case 'outputContract': {
      requiredText('format', 80);
      if (!validateRelativePath(errors, config.entrypoint, node.id, 'entrypoint')) break;
      const requiredFiles = config.requiredFiles;
      if (!Array.isArray(requiredFiles) || requiredFiles.length === 0 || requiredFiles.length > 32 || !requiredFiles.every((file) => typeof file === 'string')) {
        pushValueError(errors, node.id, 'requiredFiles', 'must be a bounded non-empty list of paths');
        break;
      }
      const paths = new Set<string>();
      for (const file of requiredFiles) {
        validateRelativePath(errors, file, node.id, 'requiredFiles');
        if (paths.has(file)) pushValueError(errors, node.id, 'requiredFiles', 'must not contain duplicate paths');
        paths.add(file);
      }
      break;
    }
  }
}

function validateCycles(canvas: AgentCanvasDocument, nodeById: Map<string, AgentCanvasNode>, errors: string[]): void {
  const adjacency = new Map<string, string[]>();
  for (const node of canvas.nodes) adjacency.set(node.id, []);
  for (const edge of canvas.edges) {
    if (nodeById.has(edge.source) && nodeById.has(edge.target)) adjacency.get(edge.source)?.push(edge.target);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (nodeId: string): void => {
    if (visiting.has(nodeId)) {
      errors.push('Agent canvas configuration graph must not contain cycles.');
      return;
    }
    if (visited.has(nodeId)) return;
    visiting.add(nodeId);
    for (const target of adjacency.get(nodeId) ?? []) visit(target);
    visiting.delete(nodeId);
    visited.add(nodeId);
  };
  for (const node of canvas.nodes) visit(node.id);
}

function edgeCount(canvas: AgentCanvasDocument, relation: AgentEdgeRelation, sourceKind: AgentNodeKind, targetKind: AgentNodeKind): number {
  const nodeById = new Map(canvas.nodes.map((node) => [node.id, node]));
  return canvas.edges.filter((edge) => nodeById.get(edge.source)?.kind === sourceKind && nodeById.get(edge.target)?.kind === targetKind && edge.relation === relation).length;
}

export function validateAgentCanvas(canvas: AgentCanvasDocument): AgentCanvasValidation {
  const errors: string[] = [];
  if (!canvas || typeof canvas !== 'object') return { valid: false, errors: ['Agent canvas must be an object.'] };
  if (canvas.schemaVersion !== AGENT_CANVAS_SCHEMA_VERSION) {
    errors.push(`Unsupported Agent canvas schema version: ${String(canvas.schemaVersion)}.`);
  }
  if (!Array.isArray(canvas.nodes) || !Array.isArray(canvas.edges)) return { valid: false, errors: [...errors, 'Agent canvas nodes and edges must be arrays.'] };
  if (!canvas.nodes.length) errors.push('Add at least one Agent node.');

  const ids = new Set<string>();
  for (const node of canvas.nodes) {
    if (!node || typeof node !== 'object') {
      errors.push('Every Agent node must be an object.');
      continue;
    }
    if (typeof node.id !== 'string' || !ID_PATTERN.test(node.id)) errors.push(`Agent node id ${String(node.id)} is invalid.`);
    if (ids.has(node.id)) errors.push(`Duplicate Agent node id: ${node.id}.`);
    ids.add(node.id);
    if (!isNodeKind(node.kind)) errors.push(`Unsupported Agent node kind: ${String(node.kind)}.`);
    if (!validateSafeText(errors, node.label, node.id || '(unnamed)', 'label', 120)) continue;
    validateNodeConfig(node, errors);
  }

  const nodeById = new Map(canvas.nodes.map((node) => [node.id, node]));
  const edgeIds = new Set<string>();
  const edgeKeys = new Set<string>();
  for (const edge of canvas.edges) {
    if (!edge || typeof edge !== 'object') {
      errors.push('Every Agent edge must be an object.');
      continue;
    }
    if (typeof edge.id !== 'string' || !ID_PATTERN.test(edge.id)) errors.push(`Agent edge id ${String(edge.id)} is invalid.`);
    if (edgeIds.has(edge.id)) errors.push(`Duplicate Agent edge id: ${edge.id}.`);
    edgeIds.add(edge.id);
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (!source || !target) {
      errors.push(`Agent edge ${edge.id} references a missing node.`);
      continue;
    }
    if (source.id === target.id) errors.push(`Agent edge ${edge.id} cannot connect a node to itself.`);
    if (!isEdgeRelation(edge.relation)) {
      errors.push(`Unsupported Agent edge relation: ${String(edge.relation)}.`);
      continue;
    }
    const edgeKey = `${edge.source}\u0000${edge.target}\u0000${edge.relation}`;
    if (edgeKeys.has(edgeKey)) errors.push(`Duplicate Agent configuration edge: ${edge.source} → ${edge.target} (${edge.relation}).`);
    edgeKeys.add(edgeKey);
    if (!relationAllowed(source, target, edge.relation)) {
      errors.push(`Relation ${edge.relation} is not allowed from ${source.kind} to ${target.kind}.`);
    }
  }

  validateCycles(canvas, nodeById, errors);

  const coreNodes: Array<[AgentNodeKind, string]> = [
    ['task', 'Task'],
    ['agent', 'Agent'],
    ['environment', 'Environment'],
    ['outputContract', 'Output Contract'],
    ['model', 'Model'],
  ];
  for (const [kind, label] of coreNodes) {
    const count = canvas.nodes.filter((node) => node.kind === kind).length;
    if (count === 0) errors.push(`Agent canvas requires a ${label} node.`);
    if (count > 1) errors.push(`Agent canvas supports one ${label} node in this slice.`);
  }

  if (edgeCount(canvas, 'configures', 'task', 'agent') !== 1) errors.push('Agent canvas requires exactly one Task configures Agent edge.');
  if (edgeCount(canvas, 'supplies', 'environment', 'agent') !== 1) errors.push('Agent canvas requires exactly one Environment supplies Agent edge.');
  if (edgeCount(canvas, 'supplies', 'model', 'agent') !== 1) errors.push('Agent canvas requires exactly one Model supplies Agent edge.');
  if (edgeCount(canvas, 'expects', 'agent', 'outputContract') !== 1) errors.push('Agent canvas requires exactly one Agent expects Output Contract edge.');

  return { valid: errors.length === 0, errors: [...new Set(errors)] };
}

function nodeOf(canvas: AgentCanvasDocument, kind: AgentNodeKind): AgentCanvasNode {
  return canvas.nodes.find((node) => node.kind === kind) as AgentCanvasNode;
}

export function compileAgentCanvas(canvas: AgentCanvasDocument): AgentCanvasCompileResult {
  const validation = validateAgentCanvas(canvas);
  if (!validation.valid) return { valid: false, errors: validation.errors };

  const task = nodeOf(canvas, 'task');
  const agent = nodeOf(canvas, 'agent');
  const model = nodeOf(canvas, 'model');
  const environment = nodeOf(canvas, 'environment');
  const outputContract = nodeOf(canvas, 'outputContract');
  const config = (node: AgentCanvasNode) => node.config;
  const skills = canvas.nodes.filter((node) => node.kind === 'skill');
  const inputMounts = canvas.nodes.filter((node) => node.kind === 'inputMount');
  const capabilities = canvas.nodes.filter((node) => node.kind === 'capability');
  const requiredFiles = config(outputContract).requiredFiles;

  const plan: CompiledAgentCanvas = {
    schemaVersion: AGENT_CANVAS_SCHEMA_VERSION,
    task: {
      id: task.id,
      brief: String(config(task).brief),
      profileRef: config(task).profileRef == null ? null : String(config(task).profileRef),
    },
    agent: {
      id: agent.id,
      instructions: String(config(agent).instructions),
      runtime: 'pi',
      policyVersion: String(config(agent).policyVersion),
    },
    model: {
      id: model.id,
      provider: String(config(model).provider),
      modelId: String(config(model).modelId),
      modelVersion: String(config(model).modelVersion),
    },
    skillRefs: skills.map((node) => ({
      id: node.id,
      kind: 'declarative',
      componentId: String(config(node).skillId),
      versionId: String(config(node).versionId),
      contentDigest: String(config(node).contentDigest),
    })),
    environment: {
      id: environment.id,
      templateId: String(config(environment).templateId),
      versionId: String(config(environment).versionId),
      contentDigest: String(config(environment).contentDigest),
      networkMode: 'disabled',
    },
    inputMounts: inputMounts.map((node) => ({
      id: node.id,
      mountId: String(config(node).mountId),
      sourceKind: String(config(node).sourceKind),
      readOnly: true,
    })),
    requestedCapabilities: capabilities.map((node) => ({
      id: node.id,
      capabilityId: String(config(node).capabilityId) as ApprovedCapabilityId,
      permission: String(config(node).permission) as ApprovedCapabilityPermission,
    })),
    outputContract: {
      id: outputContract.id,
      format: String(config(outputContract).format),
      entrypoint: String(config(outputContract).entrypoint),
      requiredFiles: Array.isArray(requiredFiles) ? requiredFiles.map(String) : [],
    },
  };

  return {
    valid: true,
    plan,
    semanticJson: serializeAgentCanvas(canvas),
  };
}
