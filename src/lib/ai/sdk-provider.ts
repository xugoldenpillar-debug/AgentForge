import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { parseProviderProtocol } from '../../shared/provider-protocol.ts';
import {
  APICallError,
  InvalidResponseDataError,
  JSONParseError,
  NoContentGeneratedError,
  NoOutputGeneratedError,
  RetryError,
  TypeValidationError,
  generateText,
  stepCountIs,
  type LanguageModel,
} from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createGateway } from '@ai-sdk/gateway';
import { ProviderResultUnknownError, type AIProvider, type AIRequest, type AIResult } from './types.ts';
import type { Credential } from '../../shared/types.ts';
import type { Pricing } from '../scoring/index.ts';
import { calculateCost } from '../scoring/index.ts';
import { AppError, ensure, ERROR_CODES } from '../../shared/errors.ts';
import { safeProviderFetch } from './safe-fetch.ts';
import { sdkTools } from './sdk-tools.ts';

class SDKProvider implements AIProvider {
  id: string;
  pricing: Pricing;
  private model: (id: string) => LanguageModel;
  private secret: string;

  constructor(
    id: string,
    model: (id: string) => LanguageModel,
    pricing: Pricing,
    secret: string,
  ) {
    this.id = id;
    this.model = model;
    this.pricing = pricing;
    this.secret = secret;
  }

  async execute(r: AIRequest): Promise<AIResult> {
    const start = performance.now();
    let calls = 0;
    try {
      const tools = sdkTools(r.tools, () => {
        ensure(calls < r.remainingToolCalls, 'Tool-call budget exceeded.', 400, ERROR_CODES.BUDGET_EXCEEDED);
        calls++;
      });
      const result = await generateText({
        model: this.model(r.model),
        system: r.systemPrompt,
        prompt: r.userPrompt,
        tools,
        maxOutputTokens: r.maxTokens,
        temperature: r.temperature,
        maxRetries: 0,
        stopWhen: stepCountIs(Math.min(6, r.remainingToolCalls + 1)),
        abortSignal: AbortSignal.any([AbortSignal.timeout(30000), ...(r.signal ? [r.signal] : [])]),
        experimental_telemetry: { isEnabled: false },
        prepareStep: async ({ steps, messages }) => {
          const used = steps.reduce((n, s) => n + (s.usage.inputTokens || 0) + (s.usage.outputTokens || 0), 0);
          const inputUpper = Buffer.byteLength(JSON.stringify(messages) + r.systemPrompt, 'utf8') + (r.tools.length ? 1200 : 0);
          const maxOutputTokens = Math.min(r.maxTokens, r.remainingTokens - used - inputUpper);
          ensure(maxOutputTokens >= 16, 'Energy budget exceeded between model steps.', 400, ERROR_CODES.BUDGET_EXCEEDED);
          const spent = steps.reduce((n, s) => n + (calculateCost(s.usage.inputTokens || 0, s.usage.outputTokens || 0, this.pricing) || 0), 0);
          const reserve = calculateCost(inputUpper, maxOutputTokens, this.pricing);
          ensure(reserve === null || reserve + spent <= r.remainingCost, 'Cost budget exceeded between model steps.', 400, ERROR_CODES.BUDGET_EXCEEDED);
          return { maxOutputTokens, ...(calls >= r.remainingToolCalls ? { activeTools: [] } : {}) };
        },
      });
      const usage = result.totalUsage as unknown as {
        inputTokens?: number;
        outputTokens?: number;
        reasoningTokens?: number;
        outputTokenDetails?: { reasoningTokens?: number };
      };
      const estimated = usage.inputTokens === undefined || usage.outputTokens === undefined;
      const inputTokens = usage.inputTokens ?? Math.ceil((r.systemPrompt.length + r.userPrompt.length) / 4);
      const outputTokens = usage.outputTokens ?? Math.ceil(result.text.length / 4);
      const reportedReasoning = usage.outputTokenDetails?.reasoningTokens ?? usage.reasoningTokens ?? 0;
      const reasoningTokens = Math.min(outputTokens, reportedReasoning);
      const text = this.secret ? result.text.replaceAll(this.secret, '[credential redacted]') : result.text;
      return {
        text, inputTokens, outputTokens, reasoningTokens, toolCalls: calls,
        latency: performance.now() - start,
        cost: estimated ? null : calculateCost(inputTokens, outputTokens, this.pricing),
        estimated,
      };
    } catch (error) {
      throw classifyProviderError(error);
    }
  }
}

function classifyProviderError(error: unknown): never {
  if (error instanceof AppError) throw error;

  const errors = RetryError.isInstance(error) ? error.errors : [error];
  if (errors.some(isKnownResponseError)) {
    throw new AppError(
      'The provider returned an invalid response.',
      502,
      ERROR_CODES.PROVIDER_RESPONSE_INVALID,
    );
  }

  const statuses = errors.flatMap((candidate) => {
    const status = providerHttpStatus(candidate);
    return status === null ? [] : [status];
  });
  if (statuses.some((status) => status === 401 || status === 403)) {
    throw new AppError(
      'The provider rejected the configured credential.',
      502,
      ERROR_CODES.PROVIDER_AUTHENTICATION_FAILED,
    );
  }
  if (statuses.some(isProviderRequestInvalidStatus)) {
    throw new AppError(
      'The provider rejected the request shape, endpoint, or model.',
      502,
      ERROR_CODES.PROVIDER_REQUEST_INVALID,
    );
  }
  if (statuses.length > 0) {
    throw new AppError(
      'The provider request failed.',
      502,
      ERROR_CODES.PROVIDER_REQUEST_FAILED,
    );
  }
  throw new ProviderResultUnknownError();
}

function providerHttpStatus(error: unknown): number | null {
  if (!APICallError.isInstance(error) || !Number.isInteger(error.statusCode)) return null;
  const status = error.statusCode!;
  return status < 200 || status >= 300 ? status : null;
}

function isProviderRequestInvalidStatus(status: number): boolean {
  return status === 400
    || status === 404
    || status === 405
    || status === 409
    || status === 415
    || status === 422;
}

function isKnownResponseError(error: unknown): boolean {
  return (APICallError.isInstance(error)
      && Number.isInteger(error.statusCode)
      && error.statusCode! >= 200
      && error.statusCode! < 300)
    || InvalidResponseDataError.isInstance(error)
    || JSONParseError.isInstance(error)
    || NoContentGeneratedError.isInstance(error)
    || NoOutputGeneratedError.isInstance(error)
    || TypeValidationError.isInstance(error);
}

export function byokProvider(credential: Credential, key: string): AIProvider {
  const protocol = parseProviderProtocol(credential.protocol);
  const baseURL = credential.baseUrl;
  const settings = { baseURL, apiKey: key, fetch: safeProviderFetch(baseURL) };
  let model: (id: string) => LanguageModel;
  switch (protocol) {
    case 'openai-chat': {
      const provider = createOpenAICompatible({ name: 'byok', ...settings });
      model = id => provider(id);
      break;
    }
    case 'openai-responses': {
      const provider = createOpenAI(settings);
      model = id => provider.responses(id);
      break;
    }
    case 'anthropic-messages': {
      const provider = createAnthropic(settings);
      model = id => provider(id);
      break;
    }
    case 'google-generative-ai': {
      const provider = createGoogleGenerativeAI(settings);
      model = id => provider(id);
      break;
    }
  }
  return new SDKProvider(
    credential.id, model,
    { inputPrice: credential.inputPrice, outputPrice: credential.outputPrice }, key,
  );
}

export function gatewayProvider(key: string, pricing: Pricing): AIProvider {
  const gateway = createGateway({ apiKey: key });
  return new SDKProvider('platform', id => gateway(id), pricing, key);
}
