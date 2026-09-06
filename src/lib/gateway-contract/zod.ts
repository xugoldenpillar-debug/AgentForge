/** Optional dependency-bearing entry point. NEVER re-export from index.ts.
 * Transforms delegate to the strict native validators so both runtimes enforce
 * exactly the same unknown-key, size, numeric and privacy constraints.
 */
import { z } from 'zod';
import type { GatewayProfileCapabilities } from './types.ts';
import {
  GatewayContractError, parseGatewayCapabilities, parseGatewayCompletion,
  parseGatewayCompletionHeaders, parseGatewayCompletionRequest, parseGatewayError,
  parseGatewayHeaders, parseGatewayInvocationContext, parseGatewayReceipt, parseGatewayUsage, parseGatewayProfileCapabilities, parseGatewayIdempotencyStatus,
} from './index.ts';

function contractSchema<T>(parse: (value: unknown) => T) {
  return z.unknown().transform((value, context): T | typeof z.NEVER => {
    try {
      return parse(value);
    } catch (error) {
      if (!(error instanceof GatewayContractError)) throw error;
      context.addIssue({ code: 'custom', message: 'Invalid gateway contract' });
      return z.NEVER;
    }
  });
}

export const gatewayCapabilitiesSchema = contractSchema(parseGatewayCapabilities);
export const gatewayCompletionSchema = contractSchema(parseGatewayCompletion);
export const gatewayReceiptSchema = contractSchema(parseGatewayReceipt);
export const gatewayUsageSchema = contractSchema(parseGatewayUsage);
export const gatewayInvocationContextSchema = contractSchema(parseGatewayInvocationContext);
export const gatewayIdempotencyStatusSchema = contractSchema(parseGatewayIdempotencyStatus);
export const gatewayProfileCapabilitiesSchema = contractSchema(parseGatewayProfileCapabilities);
export const gatewayErrorSchema = contractSchema(parseGatewayError);

// Explicit factories prevent capturing a stale clock or authorizing arbitrary aliases.
export function gatewayHeadersSchema(nowMs: number) {
  return contractSchema((value) => parseGatewayHeaders(value, nowMs));
}

export function gatewayCompletionHeadersSchema(nowMs: number) {
  return contractSchema((value) => parseGatewayCompletionHeaders(value, nowMs));
}

export function gatewayCompletionRequestSchema(expectedProfileAlias: string, capabilities?: GatewayProfileCapabilities) {
  return contractSchema((value) => parseGatewayCompletionRequest(value, expectedProfileAlias, capabilities));
}
