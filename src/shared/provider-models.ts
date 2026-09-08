import type { ProviderProtocol } from './provider-protocol.ts';

export interface ProviderModel {
  id: string;
  name: string;
}

export interface ProviderModelsResult {
  models: ProviderModel[];
  truncated: boolean;
}

export interface ProviderDiscoveryInput {
  protocol: ProviderProtocol;
  baseUrl: string;
  apiKey: string;
}

/** Accept a base URL or a pasted generation endpoint, without changing its host. */
export function normalizeProviderBaseUrl(raw: string, protocol: ProviderProtocol): string {
  const url = new URL(raw.trim());
  if (protocol === 'google-generative-ai') {
    url.pathname = url.pathname.replace(/\/models\/[^/]+:(?:streamGenerateContent|generateContent)\/?$/, '');
  }
  url.pathname = url.pathname.replace(/\/+$/, '').replace(/\/(?:chat\/completions|responses|messages|models)$/, '');
  if (!url.pathname || url.pathname === '/') {
    url.pathname = protocol === 'google-generative-ai' ? '/v1beta' : '/v1';
  }
  return url.toString().replace(/\/$/, '');
}
