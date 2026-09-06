import type { Constraints, Workflow } from './types.ts';
import { AppError, ERROR_CODES, ensure, type ErrorCode } from './errors.ts';

export const RUNTIME_KINDS = ['dag', 'pi'] as const;
export type RuntimeKind = (typeof RUNTIME_KINDS)[number];

/** This PoC authorizes calculator only. Extra tools are a policy denial, not a silent skip. */
export const PI_ALLOWED_TOOLS = ['calculator'] as const;
export type PiAllowedToolId = (typeof PI_ALLOWED_TOOLS)[number];
const PI_ALLOWED_TOOL_SET: ReadonlySet<string> = new Set(PI_ALLOWED_TOOLS);

export const RUNTIME_EVENT_TYPES = [
  'started',
  'progress',
  'tool_started',
  'tool_finished',
  'usage',
  'completed',
  'failed',
  'cancelled'
] as const;
export type RuntimeEventType = (typeof RUNTIME_EVENT_TYPES)[number];

export const RUNTIME_EVENT_LIMITS = Object.freeze({
  maxEvents: 256,
  maxEventBytes: 4096,
  maxOutputChars: 8000,
  maxMessageChars: 400
});

export const RUNTIME_TASK_LIMITS = Object.freeze({
  maxSteps: 32,
  maxToolCalls: 32,
  maxInstructionsChars: 8000,
  maxVersionChars: 80,
  maxRunIdChars: 80
});

export interface ExecutionIdentity {
  runtime: RuntimeKind;
  adapterVersion: string;
  policyVersion: string;
  modelVersion?: string;
  toolVersion?: string;
  skillVersion?: string;
}

export interface PiAgentTask {
  instructions: string;
  tools: readonly PiAllowedToolId[];
  maxSteps: number;
  maxToolCalls: number;
}

/**
 * DAG graphs and Pi tasks are disjoint recipes. There is no converter:
 * a workflow cannot be executed as a Pi task, and a Pi task cannot be
 * executed as a DAG.
 */
export type RunDefinition =
  | { kind: 'dag'; workflow: Workflow }
  | { kind: 'pi'; task: PiAgentTask };

type RuntimeEventBase = {
  runId: string;
  sequence: number;
};

export type RuntimeEvent =
  | (RuntimeEventBase & { type: 'started' })
  | (RuntimeEventBase & { type: 'progress'; completed: number; total: number })
  | (RuntimeEventBase & { type: 'tool_started'; toolId: string })
  | (RuntimeEventBase & { type: 'tool_finished'; toolId: string; ok: boolean })
  | (RuntimeEventBase & { type: 'usage'; inputTokens: number; outputTokens: number })
  | (RuntimeEventBase & { type: 'completed'; output: string })
  | (RuntimeEventBase & { type: 'failed'; code: ErrorCode; message: string })
  | (RuntimeEventBase & { type: 'cancelled' });

/**
 * Opaque handles are injected by the server. They must never carry API keys,
 * credentials, cookies, or a Repository.
 */
export type OpaqueModelHandle = {
  readonly __opaque: 'model';
};

export type OpaqueToolHandle = {
  readonly __opaque: 'tool';
};

export interface AuthorizedRunContext {
  readonly runId: string;
  readonly identity: ExecutionIdentity;
  readonly definition: RunDefinition;
  readonly input: string;
  readonly constraints: Constraints;
  readonly signal: AbortSignal;
  readonly model: OpaqueModelHandle;
  readonly tools: OpaqueToolHandle;
}

export interface RuntimeAdapter {
  readonly kind: RuntimeKind;
  execute(context: AuthorizedRunContext): AsyncIterable<RuntimeEvent>;
}

const POLICY_DENIED = ERROR_CODES.RUNTIME_POLICY_DENIED;
const GENERIC_POLICY_MESSAGE = 'This run is not allowed by the current runtime policy.';
const INCOMPLETE_IDENTITY_MESSAGE = 'Runtime identity is incomplete.';
const INVALID_EVENT_MESSAGE = 'Runtime event is invalid.';
const ERROR_CODE_SET: ReadonlySet<string> = new Set(Object.values(ERROR_CODES));

function policyDenied(message: string): never {
  throw new AppError(message, 400, POLICY_DENIED);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function ownStringKeys(value: object): string[] {
  const keys = Reflect.ownKeys(value);
  ensure(keys.every((key) => typeof key === 'string'), GENERIC_POLICY_MESSAGE, 400, POLICY_DENIED);
  return keys as string[];
}

function requireObject(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
  message = GENERIC_POLICY_MESSAGE
): Record<string, unknown> {
  if (!isPlainObject(value)) policyDenied(message);
  const allowed = new Set<string>([...required, ...optional]);
  for (const key of ownStringKeys(value)) {
    if (!allowed.has(key)) policyDenied(message);
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) policyDenied(message);
  }
  return value;
}

function requireNonEmptyString(value: unknown, maxChars: number, message: string): string {
  ensure(typeof value === 'string' && value.trim().length > 0 && value.length <= maxChars, message, 400, POLICY_DENIED);
  return value;
}

function requireNonNegativeInteger(value: unknown, message: string): number {
  ensure(typeof value === 'number' && Number.isInteger(value) && value >= 0 && Number.isFinite(value), message, 400, POLICY_DENIED);
  return value;
}

function requireBoundedInteger(value: unknown, min: number, max: number, message: string): number {
  ensure(
    typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max,
    message,
    400,
    POLICY_DENIED
  );
  return value;
}

function isPiAllowedToolId(value: unknown): value is PiAllowedToolId {
  return typeof value === 'string' && PI_ALLOWED_TOOL_SET.has(value);
}

function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && ERROR_CODE_SET.has(value);
}

function looksLikeWorkflow(value: unknown): boolean {
  return isPlainObject(value) && Array.isArray(value.nodes) && Array.isArray(value.edges);
}

function looksLikePiTask(value: unknown): boolean {
  return isPlainObject(value)
    && typeof value.instructions === 'string'
    && Array.isArray(value.tools)
    && !Array.isArray(value.nodes)
    && !Array.isArray(value.edges);
}

function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

export function isDagRunDefinition(definition: RunDefinition): definition is { kind: 'dag'; workflow: Workflow } {
  return definition.kind === 'dag';
}

export function isPiRunDefinition(definition: RunDefinition): definition is { kind: 'pi'; task: PiAgentTask } {
  return definition.kind === 'pi';
}

export function validateExecutionIdentity(value: unknown): ExecutionIdentity {
  if (!isPlainObject(value)) policyDenied(INCOMPLETE_IDENTITY_MESSAGE);
  for (const key of ['runtime', 'adapterVersion', 'policyVersion'] as const) {
    if (!Object.hasOwn(value, key) || value[key] === undefined || value[key] === null || value[key] === '') {
      policyDenied(INCOMPLETE_IDENTITY_MESSAGE);
    }
  }
  const object = requireObject(
    value,
    ['runtime', 'adapterVersion', 'policyVersion'],
    ['modelVersion', 'toolVersion', 'skillVersion'],
    INCOMPLETE_IDENTITY_MESSAGE
  );
  const runtime = object.runtime;
  ensure(runtime === 'dag' || runtime === 'pi', INCOMPLETE_IDENTITY_MESSAGE, 400, POLICY_DENIED);
  const identity: ExecutionIdentity = {
    runtime,
    adapterVersion: requireNonEmptyString(object.adapterVersion, RUNTIME_TASK_LIMITS.maxVersionChars, INCOMPLETE_IDENTITY_MESSAGE),
    policyVersion: requireNonEmptyString(object.policyVersion, RUNTIME_TASK_LIMITS.maxVersionChars, INCOMPLETE_IDENTITY_MESSAGE)
  };
  if (object.modelVersion !== undefined) {
    identity.modelVersion = requireNonEmptyString(object.modelVersion, RUNTIME_TASK_LIMITS.maxVersionChars, INCOMPLETE_IDENTITY_MESSAGE);
  }
  if (object.toolVersion !== undefined) {
    identity.toolVersion = requireNonEmptyString(object.toolVersion, RUNTIME_TASK_LIMITS.maxVersionChars, INCOMPLETE_IDENTITY_MESSAGE);
  }
  if (object.skillVersion !== undefined) {
    identity.skillVersion = requireNonEmptyString(object.skillVersion, RUNTIME_TASK_LIMITS.maxVersionChars, INCOMPLETE_IDENTITY_MESSAGE);
  }
  return identity;
}

export function validatePiAgentTask(value: unknown): PiAgentTask {
  if (looksLikeWorkflow(value)) policyDenied('A workflow graph cannot be used as a Pi task.');
  const object = requireObject(value, ['instructions', 'tools', 'maxSteps', 'maxToolCalls']);
  const instructions = object.instructions;
  ensure(
    typeof instructions === 'string' && instructions.trim().length > 0,
    'Pi tasks require instructions.',
    400,
    POLICY_DENIED
  );
  ensure(instructions.length <= RUNTIME_TASK_LIMITS.maxInstructionsChars, GENERIC_POLICY_MESSAGE, 400, POLICY_DENIED);
  ensure(Array.isArray(object.tools), 'This runtime policy allows only the calculator tool.', 400, POLICY_DENIED);
  const tools: PiAllowedToolId[] = [];
  const seen = new Set<string>();
  for (const tool of object.tools) {
    if (!isPiAllowedToolId(tool) || seen.has(tool)) {
      policyDenied('This runtime policy allows only the calculator tool.');
    }
    seen.add(tool);
    tools.push(tool);
  }
  return {
    instructions,
    tools,
    maxSteps: requireBoundedInteger(object.maxSteps, 1, RUNTIME_TASK_LIMITS.maxSteps, GENERIC_POLICY_MESSAGE),
    maxToolCalls: requireBoundedInteger(object.maxToolCalls, 0, RUNTIME_TASK_LIMITS.maxToolCalls, GENERIC_POLICY_MESSAGE)
  };
}

function validateDagWorkflowShape(value: unknown): Workflow {
  if (looksLikePiTask(value)) policyDenied('A Pi task cannot be used as a workflow graph.');
  const object = requireObject(value, ['nodes', 'edges']);
  ensure(Array.isArray(object.nodes) && Array.isArray(object.edges), GENERIC_POLICY_MESSAGE, 400, POLICY_DENIED);
  // Node/edge graph rules stay in src/lib/workflow. This only keeps recipe kinds disjoint.
  return {
    nodes: object.nodes,
    edges: object.edges
  } as Workflow;
}

export function validateRunDefinition(value: unknown): RunDefinition {
  if (!isPlainObject(value) || (value.kind !== 'dag' && value.kind !== 'pi')) {
    policyDenied(GENERIC_POLICY_MESSAGE);
  }
  if (value.kind === 'dag') {
    const object = requireObject(value, ['kind', 'workflow']);
    return { kind: 'dag', workflow: validateDagWorkflowShape(object.workflow) };
  }
  const object = requireObject(value, ['kind', 'task']);
  return { kind: 'pi', task: validatePiAgentTask(object.task) };
}

function requireRunId(value: unknown): string {
  return requireNonEmptyString(value, RUNTIME_TASK_LIMITS.maxRunIdChars, INVALID_EVENT_MESSAGE);
}

function requireSequence(value: unknown): number {
  return requireNonNegativeInteger(value, INVALID_EVENT_MESSAGE);
}

export function validateRuntimeEvent(value: unknown): RuntimeEvent {
  if (!isPlainObject(value)) policyDenied(INVALID_EVENT_MESSAGE);
  const encoded = JSON.stringify(value);
  ensure(utf8Bytes(encoded) <= RUNTIME_EVENT_LIMITS.maxEventBytes, INVALID_EVENT_MESSAGE, 400, POLICY_DENIED);

  const type = value.type;
  if (type === 'started') {
    requireObject(value, ['type', 'runId', 'sequence'], [], INVALID_EVENT_MESSAGE);
    return { type: 'started', runId: requireRunId(value.runId), sequence: requireSequence(value.sequence) };
  }
  if (type === 'progress') {
    requireObject(value, ['type', 'runId', 'sequence', 'completed', 'total'], [], INVALID_EVENT_MESSAGE);
    const completed = requireNonNegativeInteger(value.completed, INVALID_EVENT_MESSAGE);
    const total = requireNonNegativeInteger(value.total, INVALID_EVENT_MESSAGE);
    ensure(completed <= total, INVALID_EVENT_MESSAGE, 400, POLICY_DENIED);
    return {
      type: 'progress',
      runId: requireRunId(value.runId),
      sequence: requireSequence(value.sequence),
      completed,
      total
    };
  }
  if (type === 'tool_started') {
    requireObject(value, ['type', 'runId', 'sequence', 'toolId'], [], INVALID_EVENT_MESSAGE);
    return {
      type: 'tool_started',
      runId: requireRunId(value.runId),
      sequence: requireSequence(value.sequence),
      toolId: requireNonEmptyString(value.toolId, RUNTIME_TASK_LIMITS.maxVersionChars, INVALID_EVENT_MESSAGE)
    };
  }
  if (type === 'tool_finished') {
    requireObject(value, ['type', 'runId', 'sequence', 'toolId', 'ok'], [], INVALID_EVENT_MESSAGE);
    ensure(typeof value.ok === 'boolean', INVALID_EVENT_MESSAGE, 400, POLICY_DENIED);
    return {
      type: 'tool_finished',
      runId: requireRunId(value.runId),
      sequence: requireSequence(value.sequence),
      toolId: requireNonEmptyString(value.toolId, RUNTIME_TASK_LIMITS.maxVersionChars, INVALID_EVENT_MESSAGE),
      ok: value.ok
    };
  }
  if (type === 'usage') {
    requireObject(value, ['type', 'runId', 'sequence', 'inputTokens', 'outputTokens'], [], INVALID_EVENT_MESSAGE);
    return {
      type: 'usage',
      runId: requireRunId(value.runId),
      sequence: requireSequence(value.sequence),
      inputTokens: requireNonNegativeInteger(value.inputTokens, INVALID_EVENT_MESSAGE),
      outputTokens: requireNonNegativeInteger(value.outputTokens, INVALID_EVENT_MESSAGE)
    };
  }
  if (type === 'completed') {
    requireObject(value, ['type', 'runId', 'sequence', 'output'], [], INVALID_EVENT_MESSAGE);
    ensure(typeof value.output === 'string', INVALID_EVENT_MESSAGE, 400, POLICY_DENIED);
    ensure(value.output.length <= RUNTIME_EVENT_LIMITS.maxOutputChars, INVALID_EVENT_MESSAGE, 400, POLICY_DENIED);
    return {
      type: 'completed',
      runId: requireRunId(value.runId),
      sequence: requireSequence(value.sequence),
      output: value.output
    };
  }
  if (type === 'failed') {
    requireObject(value, ['type', 'runId', 'sequence', 'code', 'message'], [], INVALID_EVENT_MESSAGE);
    if (!isErrorCode(value.code)) policyDenied(INVALID_EVENT_MESSAGE);
    const message = value.message;
    ensure(
      typeof message === 'string' && message.length > 0 && message.length <= RUNTIME_EVENT_LIMITS.maxMessageChars,
      INVALID_EVENT_MESSAGE,
      400,
      POLICY_DENIED
    );
    return {
      type: 'failed',
      runId: requireRunId(value.runId),
      sequence: requireSequence(value.sequence),
      code: value.code,
      message
    };
  }
  if (type === 'cancelled') {
    requireObject(value, ['type', 'runId', 'sequence'], [], INVALID_EVENT_MESSAGE);
    return { type: 'cancelled', runId: requireRunId(value.runId), sequence: requireSequence(value.sequence) };
  }
  policyDenied(INVALID_EVENT_MESSAGE);
}

export function assertRuntimeEventCount(count: number): void {
  ensure(
    Number.isInteger(count) && count >= 0 && count <= RUNTIME_EVENT_LIMITS.maxEvents,
    INVALID_EVENT_MESSAGE,
    400,
    POLICY_DENIED
  );
}
