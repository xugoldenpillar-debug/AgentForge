import type { Credential } from '../../shared/types.ts';
import type { CreationProviderClass } from '../../shared/creation-provenance.ts';

export interface CreationProviderProvenance {
  readonly providerClass: CreationProviderClass;
  readonly providerId: string;
  readonly providerHost: string;
  readonly protocol: string;
}

const OFFICIAL_HOSTS: Readonly<Record<string, string>> = Object.freeze({
  'api.openai.com': 'openai',
  'api.anthropic.com': 'anthropic',
  'generativelanguage.googleapis.com': 'google',
  'api.deepseek.com': 'deepseek',
});

/** Provider identity is derived from the snapshotted endpoint, never the secret credential id. */
export function creationProviderProvenance(credential: Credential): CreationProviderProvenance {
  let host = 'invalid';
  try { host = new URL(credential.baseUrl).hostname.toLowerCase(); } catch { /* validation happens earlier */ }
  const providerId = OFFICIAL_HOSTS[host] ?? 'custom';
  return Object.freeze({
    providerClass: providerId === 'custom' ? 'custom' : 'official',
    providerId,
    providerHost: host,
    protocol: credential.protocol,
  });
}
