import type { Credential } from '../../shared/types.ts';
import type { CreationProviderClass } from '../../shared/creation-provenance.ts';

export interface CreationProviderProvenance {
  readonly providerClass: CreationProviderClass;
  readonly providerId: string;
  readonly providerHost: string;
  readonly protocol: string;
}

const OFFICIAL_HOSTS: Readonly<Record<string, { providerId: string; protocols: readonly string[] }>> = Object.freeze({
  'api.openai.com': { providerId: 'openai', protocols: ['openai-chat', 'openai-responses'] },
  'api.anthropic.com': { providerId: 'anthropic', protocols: ['anthropic-messages'] },
  'generativelanguage.googleapis.com': { providerId: 'google', protocols: ['google-generative-ai'] },
  'api.deepseek.com': { providerId: 'deepseek', protocols: ['openai-chat'] },
});

/** Provider identity is derived from the endpoint + protocol, never a user label or credential id. */
export function creationProviderProvenance(credential: Credential): CreationProviderProvenance {
  let host = 'invalid';
  try { host = new URL(credential.baseUrl).hostname.toLowerCase(); } catch { /* validation happens earlier */ }
  const candidate = OFFICIAL_HOSTS[host];
  const official = candidate?.protocols.includes(credential.protocol) === true;
  return Object.freeze({
    providerClass: official ? 'official' : 'custom',
    providerId: official ? candidate.providerId : 'custom',
    providerHost: host,
    protocol: credential.protocol,
  });
}
