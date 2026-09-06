import { safeError, ERROR_CODES } from '../../../shared/errors.ts';
import {
  RUNTIME_EVENT_LIMITS,
  validateRuntimeEvent,
  type RuntimeEvent
} from '../../../shared/runtime-contract.ts';

export type PiEventMapState = {
  runId: string;
  sequence: number;
  maxSteps: number;
  turnsCompleted: number;
  output: string;
};

const GENERIC_FAILURE = 'The request could not be completed. Check your configuration and try again.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function redactRuntimeMessage(message: string): string {
  if (message.includes('sk-')) return GENERIC_FAILURE;
  return message;
}

export function toFailedRuntimeEvent(error: unknown, runId: string, sequence: number): RuntimeEvent {
  const safe = safeError(error);
  let message = redactRuntimeMessage(safe.message);
  if (message.length === 0) message = GENERIC_FAILURE;
  if (message.length > RUNTIME_EVENT_LIMITS.maxMessageChars) {
    message = message.slice(0, RUNTIME_EVENT_LIMITS.maxMessageChars);
  }
  return validateRuntimeEvent({
    type: 'failed',
    runId,
    sequence,
    code: safe.code,
    message
  });
}

function truncateOutput(output: string): string {
  let trimmed = output.length > RUNTIME_EVENT_LIMITS.maxOutputChars
    ? output.slice(0, RUNTIME_EVENT_LIMITS.maxOutputChars)
    : output;
  while (trimmed.length > 0) {
    const encoded = JSON.stringify({
      type: 'completed',
      runId: 'run',
      sequence: 0,
      output: trimmed
    });
    if (new TextEncoder().encode(encoded).byteLength <= RUNTIME_EVENT_LIMITS.maxEventBytes) {
      return trimmed;
    }
    trimmed = trimmed.slice(0, Math.max(0, trimmed.length - 64));
  }
  return '';
}

export function boundRuntimeEvent(event: RuntimeEvent): RuntimeEvent {
  try {
    return validateRuntimeEvent(event);
  } catch (error) {
    if (event.type === 'completed') {
      const stripped: RuntimeEvent = {
        type: 'completed',
        runId: event.runId,
        sequence: event.sequence,
        output: truncateOutput(event.output)
      };
      try {
        return validateRuntimeEvent(stripped);
      } catch {
        return toFailedRuntimeEvent(error, event.runId, event.sequence);
      }
    }
    return toFailedRuntimeEvent(error, event.runId, event.sequence);
  }
}

function toolIdFrom(event: Record<string, unknown>): string | undefined {
  const raw = event.toolName ?? event.toolId;
  if (typeof raw !== 'string' || raw.trim().length === 0) return undefined;
  if (raw.length > 80) return raw.slice(0, 80);
  return raw;
}

function assistantContent(message: unknown): string {
  if (!isRecord(message) || message.role !== 'assistant') return '';
  if (typeof message.content === 'string') return message.content;
  if (!Array.isArray(message.content)) return '';
  return message.content
    .map((part) => {
      if (isRecord(part) && part.type === 'text' && typeof part.text === 'string') return part.text;
      return '';
    })
    .join('');
}

export function mapPiLikeEvent(event: unknown, state: PiEventMapState): RuntimeEvent | undefined {
  if (!isRecord(event) || typeof event.type !== 'string') return undefined;
  const type = event.type;
  if (
    type === 'message_update'
    || type === 'message_start'
    || type === 'agent_start'
    || type === 'agent_end'
    || type === 'tool_execution_update'
    || type === 'assistantMessageEvent'
  ) {
    return undefined;
  }
  if (type === 'tool_execution_start') {
    const toolId = toolIdFrom(event);
    if (!toolId) return undefined;
    return boundRuntimeEvent({
      type: 'tool_started',
      runId: state.runId,
      sequence: state.sequence++,
      toolId
    });
  }
  if (type === 'tool_execution_end') {
    const toolId = toolIdFrom(event);
    if (!toolId) return undefined;
    return boundRuntimeEvent({
      type: 'tool_finished',
      runId: state.runId,
      sequence: state.sequence++,
      toolId,
      ok: event.isError !== true
    });
  }
  if (type === 'message_end') {
    const content = assistantContent(event.message);
    if (content) state.output += content;
    return undefined;
  }
  if (type === 'turn_end') {
    state.turnsCompleted += 1;
    const total = Math.max(1, state.maxSteps);
    const completed = Math.min(state.turnsCompleted, total);
    return boundRuntimeEvent({
      type: 'progress',
      runId: state.runId,
      sequence: state.sequence++,
      completed,
      total
    });
  }
  return undefined;
}
