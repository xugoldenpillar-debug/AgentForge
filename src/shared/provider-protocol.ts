import { ensure, ERROR_CODES } from './errors.ts';
import type { MessageKey } from './i18n/types.ts';

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

export interface ProviderFormValues {
  readonly name: string;
  readonly baseUrl: string;
  readonly modelId: string;
  readonly apiKey: string;
}

export interface ProviderFormIssue {
  readonly field: keyof ProviderFormValues;
  readonly message: string;
}

/**
 * Accept the common copy-paste form where a provider documents the complete
 * request endpoint. SDK adapters append these protocol paths themselves, so
 * credentials persist the corresponding base URL instead.
 */
export function normalizeProviderBaseUrl(protocol: ProviderProtocol, value: string): string {
  const trimmed = value.trim().replace(/\/+$/u, '');
  const suffix = protocol === 'openai-chat'
    ? '/chat/completions'
    : protocol === 'openai-responses'
      ? '/responses'
      : protocol === 'anthropic-messages'
        ? '/messages'
        : null;
  if (!suffix || !trimmed.toLowerCase().endsWith(suffix)) return trimmed;
  return trimmed.slice(0, -suffix.length).replace(/\/+$/u, '');
}

export function validateProviderFormValues(
  values: ProviderFormValues,
  t: (key: MessageKey) => string,
): ProviderFormIssue | null {
  const name = values.name.trim();
  const baseUrl = values.baseUrl.trim();
  const modelId = values.modelId.trim();
  const apiKey = values.apiKey.trim();
  if (!name) return { field: 'name', message: t('artifactArena.providerValidation.nameRequired') };
  if (name.length > PROVIDER_FIELD_LIMITS.name) {
    return { field: 'name', message: t('artifactArena.providerValidation.nameTooLong') };
  }
  if (!baseUrl || baseUrl.length > PROVIDER_FIELD_LIMITS.baseUrl) {
    return { field: 'baseUrl', message: t('artifactArena.providerValidation.baseUrlInvalid') };
  }
  try {
    const parsed = new URL(baseUrl);
    if (parsed.protocol !== 'https:'
      || !parsed.hostname
      || parsed.username
      || parsed.password
      || parsed.search
      || parsed.hash) {
      return { field: 'baseUrl', message: t('artifactArena.providerValidation.baseUrlInvalid') };
    }
  } catch {
    return { field: 'baseUrl', message: t('artifactArena.providerValidation.baseUrlInvalid') };
  }
  if (!modelId) return { field: 'modelId', message: t('artifactArena.providerValidation.modelRequired') };
  if (modelId.length > PROVIDER_FIELD_LIMITS.modelId) {
    return { field: 'modelId', message: t('artifactArena.providerValidation.modelTooLong') };
  }
  if (!apiKey) return { field: 'apiKey', message: t('artifactArena.providerValidation.apiKeyRequired') };
  if (apiKey.length > PROVIDER_FIELD_LIMITS.apiKey) {
    return { field: 'apiKey', message: t('artifactArena.providerValidation.apiKeyTooLong') };
  }
  return null;
}
