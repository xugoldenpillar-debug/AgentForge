export const PROVIDER_REGISTRY_VERIFIED_ON = '2026-09-06' as const;

export const PROVIDER_REGISTRY_SOURCE_URLS = Object.freeze([
  'https://api-docs.deepseek.com/',
  'https://api-docs.deepseek.com/quick_start/pricing',
  'https://api-docs.deepseek.com/api/list-models/',
  'https://api-docs.deepseek.com/api/create-chat-completion/',
  'https://api-docs.deepseek.com/guides/thinking_mode/',
  'https://api-docs.deepseek.com/guides/json_mode/',
  'https://api-docs.deepseek.com/guides/tool_calls/',
] as const);

export type OfficialProviderId = 'deepseek';
export type OfficialModelId = 'deepseek-v4-flash';
export type OfficialOfferingId = 'deepseek/deepseek-v4-flash/nonthinking';

export interface OfficialOfferingCapabilities {
  readonly jsonOutput: true;
  readonly toolCalls: true;
  readonly maxOutputTokens: 384_000;
}

export interface OfficialOfferingUsageContract {
  readonly requiredFields: readonly [
    'prompt_tokens',
    'completion_tokens',
    'total_tokens',
    'prompt_cache_hit_tokens',
    'prompt_cache_miss_tokens',
  ];
  readonly optionalFields: readonly [
    'completion_tokens_details.reasoning_tokens',
  ];
  readonly nonThinkingReasoningTokens: 'zero-or-absent';
}

export interface OfficialModelDefinition {
  readonly id: OfficialModelId;
  readonly documentedModelVersion: 'DeepSeek-V4-Flash-0731';
  readonly thinking: readonly [false];
  readonly supportsTools: true;
  readonly supportsJson: true;
  readonly maxOutputTokens: 384_000;
  readonly usage: OfficialOfferingUsageContract;
}

export interface OfficialProviderDefinition {
  readonly id: OfficialProviderId;
  readonly name: 'DeepSeek';
  readonly officialBaseUrl: 'https://api.deepseek.com';
  readonly allowedModels: Readonly<Record<OfficialModelId, OfficialModelDefinition>>;
}

export interface OfficialProviderOffering {
  readonly offeringId: OfficialOfferingId;
  readonly providerId: OfficialProviderId;
  readonly providerName: 'DeepSeek';
  readonly modelId: OfficialModelId;
  readonly documentedModelVersion: 'DeepSeek-V4-Flash-0731';
  readonly thinking: false;
  readonly capabilities: OfficialOfferingCapabilities;
  readonly usage: OfficialOfferingUsageContract;
}

export interface ResolvedOfficialProviderOffering
  extends OfficialProviderOffering {
  readonly officialBaseUrl: 'https://api.deepseek.com';
}

export interface OfficialProviderSelectionInput {
  readonly providerId: string;
  readonly modelId: string;
  readonly thinking: boolean;
}

export type ProviderRegistryErrorCode =
  | 'invalid-selection'
  | 'unknown-provider'
  | 'unknown-model'
  | 'unsupported-thinking-mode';

export class ProviderRegistryError extends Error {
  readonly code: ProviderRegistryErrorCode;

  constructor(code: ProviderRegistryErrorCode, message: string) {
    super(message);
    this.name = 'ProviderRegistryError';
    this.code = code;
  }
}

const DEEPSEEK_CAPABILITIES = Object.freeze({
  jsonOutput: true,
  toolCalls: true,
  maxOutputTokens: 384_000,
} as const satisfies OfficialOfferingCapabilities);

const DEEPSEEK_USAGE_CONTRACT = Object.freeze({
  requiredFields: Object.freeze([
    'prompt_tokens',
    'completion_tokens',
    'total_tokens',
    'prompt_cache_hit_tokens',
    'prompt_cache_miss_tokens',
  ] as const),
  optionalFields: Object.freeze([
    'completion_tokens_details.reasoning_tokens',
  ] as const),
  nonThinkingReasoningTokens: 'zero-or-absent',
} as const satisfies OfficialOfferingUsageContract);

const DEEPSEEK_MODEL = Object.freeze({
  id: 'deepseek-v4-flash',
  documentedModelVersion: 'DeepSeek-V4-Flash-0731',
  thinking: Object.freeze([false] as const),
  supportsTools: true,
  supportsJson: true,
  maxOutputTokens: 384_000,
  usage: DEEPSEEK_USAGE_CONTRACT,
} as const satisfies OfficialModelDefinition);

const DEEPSEEK_NONTHINKING_OFFERING = Object.freeze({
  offeringId: 'deepseek/deepseek-v4-flash/nonthinking',
  providerId: 'deepseek',
  providerName: 'DeepSeek',
  modelId: 'deepseek-v4-flash',
  documentedModelVersion: 'DeepSeek-V4-Flash-0731',
  thinking: false,
  capabilities: DEEPSEEK_CAPABILITIES,
  usage: DEEPSEEK_USAGE_CONTRACT,
} as const satisfies OfficialProviderOffering);

const RESOLVED_DEEPSEEK_NONTHINKING_OFFERING = Object.freeze({
  ...DEEPSEEK_NONTHINKING_OFFERING,
  officialBaseUrl: 'https://api.deepseek.com',
} as const satisfies ResolvedOfficialProviderOffering);

export const OFFICIAL_PROVIDER_REGISTRY = Object.freeze({
  deepseek: Object.freeze({
    id: 'deepseek',
    name: 'DeepSeek',
    officialBaseUrl: 'https://api.deepseek.com',
    allowedModels: Object.freeze({
      'deepseek-v4-flash': DEEPSEEK_MODEL,
    }),
  } as const satisfies OfficialProviderDefinition),
} as const);

const PUBLIC_OFFERINGS = Object.freeze([
  DEEPSEEK_NONTHINKING_OFFERING,
] as const);

const SELECTION_KEYS = Object.freeze([
  'providerId',
  'modelId',
  'thinking',
] as const);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseSelection(input: unknown): OfficialProviderSelectionInput {
  if (!isRecord(input)) {
    throw new ProviderRegistryError(
      'invalid-selection',
      'Official provider selection must be an object.',
    );
  }

  const keys = Object.keys(input);
  if (
    keys.length !== SELECTION_KEYS.length
    || keys.some((key) => !SELECTION_KEYS.includes(
      key as (typeof SELECTION_KEYS)[number],
    ))
  ) {
    throw new ProviderRegistryError(
      'invalid-selection',
      'Official provider selection contains missing or unsupported fields.',
    );
  }

  if (
    typeof input.providerId !== 'string'
    || typeof input.modelId !== 'string'
    || typeof input.thinking !== 'boolean'
  ) {
    throw new ProviderRegistryError(
      'invalid-selection',
      'Official provider selection fields have invalid types.',
    );
  }

  return {
    providerId: input.providerId,
    modelId: input.modelId,
    thinking: input.thinking,
  };
}

export function listOfficialProviderOfferings(): readonly OfficialProviderOffering[] {
  return PUBLIC_OFFERINGS;
}

export function resolveOfficialProviderOffering(
  input: unknown,
): ResolvedOfficialProviderOffering {
  const selection = parseSelection(input);

  if (selection.providerId !== 'deepseek') {
    throw new ProviderRegistryError(
      'unknown-provider',
      'Official provider is not registered.',
    );
  }

  if (selection.modelId !== 'deepseek-v4-flash') {
    throw new ProviderRegistryError(
      'unknown-model',
      'Official provider model is not registered.',
    );
  }

  if (selection.thinking !== false) {
    throw new ProviderRegistryError(
      'unsupported-thinking-mode',
      'This official provider offering requires thinking to be disabled.',
    );
  }

  return RESOLVED_DEEPSEEK_NONTHINKING_OFFERING;
}
