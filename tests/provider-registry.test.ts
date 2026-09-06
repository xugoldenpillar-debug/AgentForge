import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OFFICIAL_PROVIDER_REGISTRY,
  PROVIDER_REGISTRY_SOURCE_URLS,
  PROVIDER_REGISTRY_VERIFIED_ON,
  ProviderRegistryError,
  listOfficialProviderOfferings,
  resolveOfficialProviderOffering,
} from '../src/lib/ai/provider-registry.ts';

const officialSelection = {
  providerId: 'deepseek',
  modelId: 'deepseek-v4-flash',
  thinking: false,
};

test('registry exposes exactly one public non-thinking DeepSeek offering', () => {
  const offerings = listOfficialProviderOfferings();

  assert.equal(PROVIDER_REGISTRY_VERIFIED_ON, '2026-09-06');
  assert(PROVIDER_REGISTRY_SOURCE_URLS.length >= 6);
  assert.equal(offerings.length, 1);
  assert.deepEqual(offerings[0], {
    offeringId: 'deepseek/deepseek-v4-flash/nonthinking',
    providerId: 'deepseek',
    providerName: 'DeepSeek',
    modelId: 'deepseek-v4-flash',
    documentedModelVersion: 'DeepSeek-V4-Flash-0731',
    thinking: false,
    capabilities: {
      jsonOutput: true,
      toolCalls: true,
      maxOutputTokens: 384_000,
    },
    usage: {
      requiredFields: [
        'prompt_tokens',
        'completion_tokens',
        'total_tokens',
        'prompt_cache_hit_tokens',
        'prompt_cache_miss_tokens',
      ],
      optionalFields: [
        'completion_tokens_details.reasoning_tokens',
      ],
      nonThinkingReasoningTokens: 'zero-or-absent',
    },
  });
  assert.equal(Object.hasOwn(offerings[0], 'officialBaseUrl'), false);
  assert.equal(Object.hasOwn(offerings[0], 'price'), false);
  assert.equal(Object.hasOwn(offerings[0], 'inputPrice'), false);
  assert.equal(Object.hasOwn(offerings[0], 'outputPrice'), false);
});

test('server resolution supplies only the canonical DeepSeek endpoint', () => {
  const offering = resolveOfficialProviderOffering(officialSelection);

  assert.equal(offering.officialBaseUrl, 'https://api.deepseek.com');
  assert.equal(
    OFFICIAL_PROVIDER_REGISTRY.deepseek.officialBaseUrl,
    offering.officialBaseUrl,
  );
  assert.strictEqual(
    offering,
    resolveOfficialProviderOffering(officialSelection),
  );
});

test('registry and all returned nested data are immutable at runtime', () => {
  const offerings = listOfficialProviderOfferings();
  const offering = resolveOfficialProviderOffering(officialSelection);

  assert(Object.isFrozen(OFFICIAL_PROVIDER_REGISTRY));
  assert(Object.isFrozen(OFFICIAL_PROVIDER_REGISTRY.deepseek));
  assert(Object.isFrozen(OFFICIAL_PROVIDER_REGISTRY.deepseek.allowedModels));
  assert(Object.isFrozen(
    OFFICIAL_PROVIDER_REGISTRY.deepseek.allowedModels['deepseek-v4-flash'],
  ));
  assert(Object.isFrozen(
    OFFICIAL_PROVIDER_REGISTRY.deepseek.allowedModels['deepseek-v4-flash'].thinking,
  ));
  assert(Object.isFrozen(offerings));
  assert(Object.isFrozen(offering));
  assert(Object.isFrozen(offering.capabilities));
  assert(Object.isFrozen(offering.usage));
  assert(Object.isFrozen(offering.usage.requiredFields));
  assert(Object.isFrozen(offering.usage.optionalFields));
  assert.equal(Reflect.set(offering, 'modelId', 'deepseek-v4-pro'), false);
  assert.equal(
    Reflect.set(offering.capabilities, 'toolCalls', false),
    false,
  );
  assert.equal(offering.modelId, 'deepseek-v4-flash');
  assert.equal(offering.capabilities.toolCalls, true);
});

test('unknown providers, models, and thinking mode fail closed', () => {
  assertRegistryError(
    () => resolveOfficialProviderOffering({
      ...officialSelection,
      providerId: 'other',
    }),
    'unknown-provider',
  );
  assertRegistryError(
    () => resolveOfficialProviderOffering({
      ...officialSelection,
      modelId: 'deepseek-v4-pro',
    }),
    'unknown-model',
  );
  assertRegistryError(
    () => resolveOfficialProviderOffering({
      ...officialSelection,
      thinking: true,
    }),
    'unsupported-thinking-mode',
  );
});

test('client-controlled URLs, prices, and malformed selections are rejected', () => {
  const invalidSelections = [
    null,
    [],
    {},
    { providerId: 'deepseek', modelId: 'deepseek-v4-flash' },
    { ...officialSelection, baseUrl: 'https://example.com' },
    { ...officialSelection, officialBaseUrl: 'https://example.com' },
    { ...officialSelection, inputPrice: 0 },
    { ...officialSelection, outputPrice: 0 },
    { ...officialSelection, price: 0 },
  ];

  for (const selection of invalidSelections) {
    assertRegistryError(
      () => resolveOfficialProviderOffering(selection),
      'invalid-selection',
    );
  }
});

test('unsupported offerings are rejected synchronously before network work', () => {
  let networkCalls = 0;

  assert.throws(() => {
    const offering = resolveOfficialProviderOffering({
      providerId: 'deepseek',
      modelId: 'unregistered-model',
      thinking: false,
    });
    networkCalls += 1;
    return offering;
  }, ProviderRegistryError);

  assert.equal(networkCalls, 0);
});

function assertRegistryError(
  operation: () => unknown,
  code: ProviderRegistryError['code'],
): void {
  assert.throws(operation, (error: unknown) => {
    assert(error instanceof ProviderRegistryError);
    assert.equal(error.code, code);
    return true;
  });
}
