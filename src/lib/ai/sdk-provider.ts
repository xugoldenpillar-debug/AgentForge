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
  streamText,
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

export interface ProviderRequestTiming {
  idleTimeoutMs: number;
  absoluteTimeoutMs: number;
}

const DEFAULT_PROVIDER_REQUEST_TIMING: ProviderRequestTiming = {
  idleTimeoutMs: 60_000,
  absoluteTimeoutMs: 10 * 60_000,
};

function createStreamWatchdog(
  externalSignal: AbortSignal | undefined,
  timing: ProviderRequestTiming,
): { signal: AbortSignal; noteProgress: () => void; dispose: () => void } {
  const idleController = new AbortController();
  const absoluteController = new AbortController();
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const absoluteTimer = setTimeout(() => {
    absoluteController.abort(new Error('Provider stream exceeded the absolute time limit.'));
  }, timing.absoluteTimeoutMs);

  const noteProgress = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      idleController.abort(new Error('Provider stream stopped making progress.'));
    }, timing.idleTimeoutMs);
  };
  noteProgress();

  const signals = [idleController.signal, absoluteController.signal];
  if (externalSignal) signals.push(externalSignal);
  return {
    signal: AbortSignal.any(signals),
    noteProgress,
    dispose: () => {
      if (idleTimer) clearTimeout(idleTimer);
      clearTimeout(absoluteTimer);
    },
  };
}

class SDKProvider implements AIProvider {
  id: string;
  pricing: Pricing;
  private model: (id: string) => LanguageModel;
  private secret: string;
  private timing: ProviderRequestTiming;

  constructor(
    id: string,
    model: (id: string) => LanguageModel,
    pricing: Pricing,
    secret: string,
    timing: ProviderRequestTiming = DEFAULT_PROVIDER_REQUEST_TIMING,
  ) {
    this.id = id;
    this.model = model;
    this.pricing = pricing;
    this.secret = secret;
    this.timing = timing;
  }

  async execute(r: AIRequest): Promise<AIResult> {
    const start = performance.now();
    let calls = 0;
    try {
      const tools = sdkTools(r.tools, () => {
        ensure(calls < r.remainingToolCalls, 'Tool-call budget exceeded.', 400, ERROR_CODES.BUDGET_EXCEEDED);
        calls++;
      });
      const watchdog = createStreamWatchdog(r.signal, this.timing);
      let result: ReturnType<typeof streamText>;
      let rawText: string;
      let usage: {
        inputTokens?: number;
        outputTokens?: number;
        reasoningTokens?: number;
        outputTokenDetails?: { reasoningTokens?: number };
      };
      try {
        result = streamText({
          model: this.model(r.model),
          system: r.systemPrompt,
          prompt: r.userPrompt,
          tools,
          maxOutputTokens: r.maxTokens,
          temperature: r.temperature,
          maxRetries: 0,
          stopWhen: stepCountIs(Math.min(6, r.remainingToolCalls + 1)),
          abortSignal: watchdog.signal,
          experimental_telemetry: { isEnabled: false },
          // The full stream below surfaces errors without the SDK's default console logging.
          onError: () => {},
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
        for await (const part of result.fullStream) {
          watchdog.noteProgress();
          if (part.type === 'error') throw part.error;
        }
        [rawText, usage] = await Promise.all([
          result.text,
          result.totalUsage as PromiseLike<typeof usage>,
        ]);
      } catch (error) {
        if (watchdog.signal.aborted) throw new ProviderResultUnknownError();
        throw error;
      } finally {
        watchdog.dispose();
      }
      const estimated = usage.inputTokens === undefined || usage.outputTokens === undefined;
      const inputTokens = usage.inputTokens ?? Math.ceil((r.systemPrompt.length + r.userPrompt.length) / 4);
      const outputTokens = usage.outputTokens ?? Math.ceil(rawText.length / 4);
      const reportedReasoning = usage.outputTokenDetails?.reasoningTokens ?? usage.reasoningTokens ?? 0;
      const reasoningTokens = Math.min(outputTokens, reportedReasoning);
      const text = this.secret ? rawText.replaceAll(this.secret, '[credential redacted]') : rawText;
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

export function byokProvider(
  credential: Credential,
  key: string,
  timing: ProviderRequestTiming = DEFAULT_PROVIDER_REQUEST_TIMING,
): AIProvider {
  const protocol = parseProviderProtocol(credential.protocol);
  const baseURL = credential.baseUrl;
  const settings = { baseURL, apiKey: key, fetch: safeProviderFetch(baseURL) };
  let model: (id: string) => LanguageModel;
  switch (protocol) {
    case 'openai-chat': {
      const provider = createOpenAICompatible({ name: 'byok', ...settings, includeUsage: true });
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
    { inputPrice: credential.inputPrice, outputPrice: credential.outputPrice }, key, timing,
  );
}

export function gatewayProvider(key: string, pricing: Pricing): AIProvider {
  const gateway = createGateway({ apiKey: key });
  return new SDKProvider('platform', id => gateway(id), pricing, key);
}
