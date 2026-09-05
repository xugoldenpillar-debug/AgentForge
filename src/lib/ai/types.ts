import type { Config, Metrics, ToolId } from '../../shared/types.ts';
import type { Pricing } from '../scoring/index.ts';
export interface AIRequest {
  model: string; systemPrompt: string; userPrompt: string; tools: ToolId[]; maxTokens: number;
  temperature: number; remainingTokens: number; remainingToolCalls: number; remainingCost: number;
  signal?: AbortSignal;
}
export interface AIResult extends Metrics { text: string }
export interface AIProvider { readonly id: string; readonly pricing: Pricing; execute(request: AIRequest): Promise<AIResult> }
export interface ResolvedProvider { provider: AIProvider; model: string }
export type ProviderResolver = (config:Config) => Promise<ResolvedProvider>;
