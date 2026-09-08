import assert from 'node:assert/strict';
import test from 'node:test';
import type { Credential } from '../src/shared/types.ts';
import { creationProviderProvenance } from '../src/server/creation/provider-provenance.ts';

function credential(baseUrl: string, protocol: Credential['protocol']): Credential {
  return { baseUrl, protocol } as Credential;
}

test('classifies canonical official provider host and protocol pairs', () => {
  assert.deepEqual(creationProviderProvenance(credential('https://api.openai.com/v1', 'openai-responses')), {
    providerClass: 'official', providerId: 'openai', providerHost: 'api.openai.com', protocol: 'openai-responses',
  });
  assert.deepEqual(creationProviderProvenance(credential('https://api.anthropic.com', 'anthropic-messages')), {
    providerClass: 'official', providerId: 'anthropic', providerHost: 'api.anthropic.com', protocol: 'anthropic-messages',
  });
  assert.deepEqual(creationProviderProvenance(credential('https://generativelanguage.googleapis.com', 'google-generative-ai')), {
    providerClass: 'official', providerId: 'google', providerHost: 'generativelanguage.googleapis.com', protocol: 'google-generative-ai',
  });
});

test('does not grant official status from hostname alone', () => {
  assert.equal(
    creationProviderProvenance(credential('https://api.openai.com/v1', 'anthropic-messages')).providerClass,
    'custom',
  );
  assert.equal(
    creationProviderProvenance(credential('https://proxy.example.com/v1', 'openai-responses')).providerClass,
    'custom',
  );
});
