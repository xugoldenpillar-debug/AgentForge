import type { GatewayErrorCode } from './types.ts';

export const GATEWAY_LIMITS = Object.freeze({
  jsonBytes: 1_048_576,
  textBytes: 262_144,
  messages: 64,
  profiles: 128,
  identifierBytes: 160,
  maxOutputTokens: 65_536,
  timestampSkewMs: 300_000,
});

/** Intentionally carries neither rejected values nor an upstream error cause. */
export class GatewayContractError extends Error {
  readonly code: GatewayErrorCode;

  constructor(code: GatewayErrorCode = 'PROTOCOL_MISMATCH') {
    super(`Gateway contract rejected: ${code}`);
    this.name = 'GatewayContractError';
    this.code = code;
  }
}

export function reject(code?: GatewayErrorCode): never {
  throw new GatewayContractError(code);
}

export function record(value: unknown, keys: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) reject();
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) reject();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !keys.includes(key) || !('value' in descriptors[key]!)) reject();
  }
  for (const key of keys) {
    if (!optional.includes(key) && !Object.hasOwn(value, key)) reject();
  }
  return value as Record<string, unknown>;
}

export function text(value: unknown, maxBytes: number = GATEWAY_LIMITS.textBytes): string {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > maxBytes) reject();
  return value;
}

export function identifier(value: unknown): string {
  const result = text(value, GATEWAY_LIMITS.identifierBytes);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(result)) reject();
  return result;
}

export function uuid(value: unknown): string {
  const result = text(value, 36);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(result)) reject();
  return result;
}

export function digest(value: unknown): string {
  const result = text(value, 71);
  if (!/^sha256:[0-9a-f]{64}$/.test(result)) reject();
  return result;
}

export function integer(value: unknown, maximum = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || Object.is(value, -0) || value > maximum) reject();
  return value;
}

export function finite(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || Object.is(value, -0)) reject();
  return value;
}

export function literal<T extends string | number | boolean>(value: unknown, expected: T): T {
  if (value !== expected) reject();
  return expected;
}

export function list(value: unknown, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) reject();
  // Reject sparse arrays and custom/accessor properties, just like JSON arrays.
  if (Reflect.ownKeys(value).length !== value.length + 1) reject();
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !('value' in descriptor)) reject();
  }
  return value;
}

/** Apply before JSON.parse; network readers must ALSO enforce this while streaming. */
export function parseGatewayJson(body: string | Uint8Array): unknown {
  if ((typeof body === 'string' ? Buffer.byteLength(body, 'utf8') : body.byteLength) > GATEWAY_LIMITS.jsonBytes) {
    reject('PAYLOAD_TOO_LARGE');
  }
  try {
    const source = typeof body === 'string' ? body : new TextDecoder('utf-8', { fatal: true }).decode(body);
    return JSON.parse(source) as unknown;
  } catch {
    reject();
  }
}

/** Call only after structural validation has removed accessors and unknown keys. */
export function bounded<T>(value: T): T {
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > GATEWAY_LIMITS.jsonBytes) reject('PAYLOAD_TOO_LARGE');
  return value;
}
