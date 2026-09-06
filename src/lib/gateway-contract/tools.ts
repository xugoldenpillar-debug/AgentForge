import type { GatewayJsonSchema, GatewayMessage, GatewayTool, GatewayToolCall } from './types.ts';
import { finite, identifier, list, literal, record, reject, text } from './validation.ts';

function functionName(value: unknown): string {
  const name = text(value, 64);
  if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(name)) reject();
  return name;
}

function jsonSchema(value: unknown, depth = 0, budget = { nodes: 0 }): GatewayJsonSchema {
  if (depth > 8 || ++budget.nodes > 256) reject();
  const object = record(value, ['type', 'description', 'properties', 'required', 'additionalProperties', 'items', 'enum'], ['description', 'properties', 'required', 'additionalProperties', 'items', 'enum']);
  const type = object.type;
  if (type !== 'object' && type !== 'array' && type !== 'string' && type !== 'number'
    && type !== 'integer' && type !== 'boolean' && type !== 'null') reject();
  const schema: GatewayJsonSchema = { type };
  if (Object.hasOwn(object, 'description')) schema.description = text(object.description, 4096);
  if (Object.hasOwn(object, 'properties')) {
    if (type !== 'object' || typeof object.properties !== 'object' || object.properties === null) reject();
    const keys = Object.keys(object.properties);
    if (keys.length > 64) reject();
    const properties = record(object.properties, keys);
    schema.properties = Object.fromEntries(keys.map((key) => {
      if (!/^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(key) || ['__proto__', 'constructor', 'prototype'].includes(key)) reject();
      return [key, jsonSchema(properties[key], depth + 1, budget)];
    }));
  }
  if (Object.hasOwn(object, 'required')) {
    if (type !== 'object') reject();
    schema.required = list(object.required, 64).map((key) => {
      const name = text(key, 64);
      if (!schema.properties || !Object.hasOwn(schema.properties, name)) reject();
      return name;
    });
    if (new Set(schema.required).size !== schema.required.length) reject();
  }
  if (Object.hasOwn(object, 'additionalProperties')) {
    if (type !== 'object') reject();
    schema.additionalProperties = literal(object.additionalProperties, false);
  }
  if (Object.hasOwn(object, 'items')) {
    if (type !== 'array') reject();
    schema.items = jsonSchema(object.items, depth + 1, budget);
  }
  if (type === 'array' && !schema.items) reject();
  if (Object.hasOwn(object, 'enum')) {
    schema.enum = list(object.enum, 64).map((entry) => {
      if (typeof entry === 'string' && type === 'string') return text(entry, 4096);
      if (typeof entry === 'number' && (type === 'number' || (type === 'integer' && Number.isSafeInteger(entry)))) {
        if (!Number.isFinite(entry)) reject();
        // JSON schema enums may contain negative numbers.
        finite(Math.abs(entry));
        return entry;
      }
      if (typeof entry === 'boolean' && type === 'boolean') return entry;
      if (entry === null && type === 'null') return entry;
      reject();
    });
    if (!schema.enum.length || new Set(schema.enum).size !== schema.enum.length) reject();
  }
  return schema;
}

export function parseTools(value: unknown): GatewayTool[] {
  const tools = list(value, 16).map((entry): GatewayTool => {
    const tool = record(entry, ['type', 'function']);
    const fn = record(tool.function, ['name', 'description', 'parameters'], ['description']);
    const parameters = jsonSchema(fn.parameters);
    if (parameters.type !== 'object') reject();
    const result: GatewayTool = {
      type: literal(tool.type, 'function'),
      function: { name: functionName(fn.name), parameters },
    };
    if (Object.hasOwn(fn, 'description')) result.function.description = text(fn.description, 4096);
    return result;
  });
  if (!tools.length || new Set(tools.map((tool) => tool.function.name)).size !== tools.length) reject();
  return tools;
}

export function parseToolCalls(value: unknown): GatewayToolCall[] {
  const calls = list(value, 16).map((entry): GatewayToolCall => {
    const call = record(entry, ['id', 'type', 'function']);
    const fn = record(call.function, ['name', 'arguments']);
    return {
      id: identifier(call.id), type: literal(call.type, 'function'),
      function: { name: functionName(fn.name), arguments: text(fn.arguments, 65_536) },
    };
  });
  if (!calls.length || new Set(calls.map((call) => call.id)).size !== calls.length) reject();
  return calls;
}

export function parseMessage(value: unknown): GatewayMessage {
  const object = record(value, ['role', 'content', 'tool_calls', 'tool_call_id'], ['tool_calls', 'tool_call_id']);
  const role = object.role;
  if (role === 'system' || role === 'user') {
    if (Object.hasOwn(object, 'tool_calls') || Object.hasOwn(object, 'tool_call_id')) reject();
    return { role, content: text(object.content) };
  }
  if (role === 'tool') {
    if (Object.hasOwn(object, 'tool_calls')) reject();
    return { role, content: text(object.content), tool_call_id: identifier(object.tool_call_id) };
  }
  if (role !== 'assistant' || Object.hasOwn(object, 'tool_call_id')) reject();
  const message: Extract<GatewayMessage, { role: 'assistant' }> = {
    role, content: object.content === null ? null : text(object.content),
  };
  if (Object.hasOwn(object, 'tool_calls')) message.tool_calls = parseToolCalls(object.tool_calls);
  if (message.content === null && !message.tool_calls) reject();
  return message;
}

/** A tool result must answer exactly one earlier pending assistant tool call. */
export function validateToolHistory(messages: GatewayMessage[], tools: GatewayTool[]): void {
  const names = new Set(tools.map((tool) => tool.function.name));
  const seen = new Set<string>();
  const pending = new Set<string>();
  for (const message of messages) {
    if (message.role === 'tool') {
      if (!pending.delete(message.tool_call_id)) reject();
    } else {
      if (pending.size) reject();
      if (message.role === 'assistant' && message.tool_calls) {
        for (const call of message.tool_calls) {
          if (!names.has(call.function.name) || seen.has(call.id)) reject();
          seen.add(call.id);
          pending.add(call.id);
        }
      }
    }
  }
  if (pending.size) reject();
}

/** Validate arguments against an already parsed, bounded declaration. Error
 * paths intentionally contain neither argument values nor schema descriptions.
 */
export function validateToolArguments(argumentsJson: string, schema: GatewayJsonSchema): void {
  let value: unknown;
  try {
    value = JSON.parse(text(argumentsJson, 65_536)) as unknown;
  } catch {
    reject();
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) reject();
  validateSchemaValue(value, schema, 0, { nodes: 0 });
}

function validateSchemaValue(
  value: unknown,
  schema: GatewayJsonSchema,
  depth: number,
  budget: { nodes: number },
): void {
  if (depth > 16 || ++budget.nodes > 4096) reject();
  switch (schema.type) {
    case 'object': {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) reject();
      const object = value as Record<string, unknown>;
      for (const key of schema.required ?? []) {
        if (!Object.hasOwn(object, key)) reject();
      }
      for (const [key, entry] of Object.entries(object)) {
        const declared = schema.properties && Object.hasOwn(schema.properties, key)
          ? schema.properties[key]
          : undefined;
        if (declared) {
          validateSchemaValue(entry, declared, depth + 1, budget);
        } else if (schema.additionalProperties === false) {
          reject();
        }
      }
      break;
    }
    case 'array':
      if (!Array.isArray(value) || !schema.items) reject();
      for (const entry of value) validateSchemaValue(entry, schema.items, depth + 1, budget);
      break;
    case 'string':
      if (typeof value !== 'string') reject();
      break;
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) reject();
      break;
    case 'integer':
      if (typeof value !== 'number' || !Number.isSafeInteger(value)) reject();
      break;
    case 'boolean':
      if (typeof value !== 'boolean') reject();
      break;
    case 'null':
      if (value !== null) reject();
      break;
  }
  if (schema.enum && !schema.enum.some((entry) => entry === value)) reject();
}
