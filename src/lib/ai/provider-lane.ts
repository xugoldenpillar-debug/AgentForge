import type { Tier } from '../../shared/types.ts';

export interface PlatformLanePricing {
  readonly inputPrice: number | null;
  readonly outputPrice: number | null;
}

/** Existing lane policy only; does not authorize a provider or instantiate one. */
export function classifyProviderLane(
  credentialId: string,
  platform?: PlatformLanePricing
): Tier {
  if (credentialId === 'demo') return 'demo';
  if (credentialId === 'platform' && platform &&
      platform.inputPrice !== null && platform.outputPrice !== null) {
    return 'verified';
  }
  return 'byok';
}
