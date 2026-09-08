export const CREATION_PROVENANCE_VERSION = 1 as const;

export type CreationProviderClass = 'official' | 'custom';

export interface PublicCreationSkillRef {
  readonly componentId: string;
  readonly versionId: string;
  readonly contentDigest: string;
  readonly name: string;
  readonly description: string;
}

/**
 * Reproducibility metadata for a published CreationRun. This projection is
 * intentionally safe for public pages: it never contains a credential id,
 * secret, provider request id, private attachment, or sandbox/storage handle.
 * Prompt text comes only from immutable Build/Brief versions.
 */
export interface PublicCreationProvenance {
  readonly schemaVersion: typeof CREATION_PROVENANCE_VERSION;
  readonly challenge: {
    readonly challengeId: string;
    readonly challengeVersionId: string;
    readonly title: string;
    readonly prompt: string;
    readonly outputPolicyVersion: string;
  };
  readonly model: {
    readonly modelId: string;
    readonly providerClass: CreationProviderClass;
    readonly providerId: string;
    readonly providerHost: string;
    readonly protocol: string;
  };
  readonly runtime: {
    readonly kind: 'pi';
    readonly adapterVersion: string;
    readonly policyVersion: string;
    readonly systemPromptVersion: string;
  };
  readonly skills: readonly PublicCreationSkillRef[];
  readonly prompts: {
    readonly agentInstructions: string;
    readonly challengeInstructions: string;
  };
  readonly capturedAt: string;
}
