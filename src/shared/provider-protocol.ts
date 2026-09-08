import { ensure, ERROR_CODES } from './errors.ts';

export const PROVIDER_PROTOCOLS = [
  'openai-chat', 'openai-responses', 'anthropic-messages', 'google-generative-ai',
] as const;
export type ProviderProtocol = typeof PROVIDER_PROTOCOLS[number];

export const PROVIDER_FIELD_LIMITS = Object.freeze({
  name: 60,
  baseUrl: 300,
  modelId: 160,
  apiKey: 2048,
});

/** Omitted protocol means the historical Chat Completions contract, never auto-detection. */
export function parseProviderProtocol(value: unknown): ProviderProtocol {
  if (value === undefined) return 'openai-chat';
  ensure(typeof value === 'string' && PROVIDER_PROTOCOLS.some(protocol => protocol === value),
    'Unsupported provider protocol.', 400, ERROR_CODES.PROVIDER_CONFIGURATION_INVALID);
  return value as ProviderProtocol;
}

export const PROVIDER_PROTOCOL_BASE_URLS: Readonly<Record<ProviderProtocol, string>> = Object.freeze({
  'openai-chat': 'https://api.openai.com/v1',
  'openai-responses': 'https://api.openai.com/v1',
  'anthropic-messages': 'https://api.anthropic.com/v1',
  'google-generative-ai': 'https://generativelanguage.googleapis.com/v1beta',
});
