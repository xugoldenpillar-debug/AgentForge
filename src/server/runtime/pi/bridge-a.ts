import { AppError, ERROR_CODES, ensure } from '../../../shared/errors.ts';
import { resolveOfficialProviderOffering } from '../../../lib/ai/provider-registry.ts';
import type { ControlledStreamChunk, ControlledStreamFn } from './stream-fn.ts';

export type BridgeAWire = {
  method: string;
  pathname: string;
  model: unknown;
  thinking: unknown;
  maxTokens: unknown;
  stream: unknown;
  toolCount: number;
};

export type BridgeAConfig = {
  apiKey: string;
  baseUrl: string;
  modelId: string;
  maxTokens: number;
  temperature?: number;
  providerFetch?: typeof fetch;
  onWire?: (wire: BridgeAWire) => void;
  streamIdleTimeoutMs?: number;
  streamAbsoluteTimeoutMs?: number;
};

const UNAVAILABLE = 'This runtime is not available in the current environment.';
const FLASH_MAX_TOKENS = 128;
const STREAM_IDLE_TIMEOUT_MS = 60_000;
const STREAM_ABSOLUTE_TIMEOUT_MS = 10 * 60_000;

function officialBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AppError(
      'Unsupported official DeepSeek endpoint.',
      400,
      ERROR_CODES.PROVIDER_CONFIGURATION_INVALID
    );
  }
  ensure(
    url.hostname === 'api.deepseek.com'
      && url.protocol === 'https:'
      && !url.username && !url.password && !url.search && !url.hash
      && (!url.port || url.port === '443')
      && ['/', '/v1', '/v1/'].includes(url.pathname),
    'Unsupported official DeepSeek endpoint.',
    400,
    ERROR_CODES.PROVIDER_CONFIGURATION_INVALID
  );
  return 'https://api.deepseek.com';
}

type StreamWatchdog = {
  signal: AbortSignal;
  markChunk: () => void;
  dispose: () => void;
};

function createStreamWatchdog(
  externalSignal?: AbortSignal,
  idleTimeoutMs = STREAM_IDLE_TIMEOUT_MS,
  absoluteTimeoutMs = STREAM_ABSOLUTE_TIMEOUT_MS,
): StreamWatchdog {
  const controller = new AbortController();
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let absoluteTimer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  const abort = (): void => {
    if (!controller.signal.aborted) controller.abort();
  };
  const markChunk = (): void => {
    if (disposed || controller.signal.aborted) return;
    if (idleTimer !== undefined) clearTimeout(idleTimer);
    idleTimer = setTimeout(abort, idleTimeoutMs);
  };
  const onExternalAbort = (): void => { abort(); };

  if (externalSignal?.aborted) abort();
  else externalSignal?.addEventListener('abort', onExternalAbort, { once: true });
  if (!controller.signal.aborted) {
    absoluteTimer = setTimeout(abort, absoluteTimeoutMs);
    markChunk();
  }

  return {
    signal: controller.signal,
    markChunk,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      if (idleTimer !== undefined) clearTimeout(idleTimer);
      if (absoluteTimer !== undefined) clearTimeout(absoluteTimer);
      externalSignal?.removeEventListener('abort', onExternalAbort);
    }
  };
}

function textFromContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (part && typeof part === 'object' && 'text' in part && typeof part.text === 'string') {
        return part.text;
      }
      return '';
    })
    .join('');
}

function openaiMessages(context: unknown): Array<Record<string, unknown>> {
  const record = context && typeof context === 'object' ? context as Record<string, unknown> : {};
  const messages: Array<Record<string, unknown>> = [];
  const systemPrompt = typeof record.systemPrompt === 'string' ? record.systemPrompt : '';
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  const incoming = Array.isArray(record.messages) ? record.messages : [];
  for (const item of incoming) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    if (row.role === 'user') {
      messages.push({ role: 'user', content: textFromContent(row.content) });
    } else if (row.role === 'assistant') {
      messages.push({ role: 'assistant', content: textFromContent(row.content) });
    } else if (row.role === 'toolResult') {
      messages.push({
        role: 'tool',
        tool_call_id: row.toolCallId,
        content: textFromContent(row.content)
      });
    }
  }
  if (messages.length === 0) {
    throw new AppError(UNAVAILABLE, 503, ERROR_CODES.RUNTIME_UNAVAILABLE);
  }
  return messages;
}

async function readSseText(
  response: Response,
  signal: AbortSignal | undefined,
  onChunk?: () => void
): Promise<{ text: string; usage?: { inputTokens: number; outputTokens: number; reasoningTokens: number } }> {
  ensure(response.body !== null, 'Official provider returned invalid token usage.', 502, ERROR_CODES.PROVIDER_RESPONSE_INVALID);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let afterCr = false;
  let dataLines: string[] = [];
  let text = '';
  let usage: { inputTokens: number; outputTokens: number; reasoningTokens: number } | undefined;
  let finished = false;
  let cancellation: Promise<void> | undefined;
  const cancel = (): Promise<void> => {
    // Cleanup failure must not replace the original provider/abort failure.
    cancellation ??= reader.cancel().catch(() => undefined);
    return cancellation;
  };
  const onAbort = (): void => { void cancel(); };
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    while (true) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) {
        finished = true;
        break;
      }
      onChunk?.();
      // SSE dispatches at a blank line, not EOF or each individual data line.
      for (const character of decoder.decode(value, { stream: true })) {
        if (afterCr && character === '\n') {
          afterCr = false;
          continue;
        }
        afterCr = character === '\r';
        if (character !== '\r' && character !== '\n') {
          buffer += character;
          continue;
        }
        const line = buffer;
        buffer = '';
        if (line !== '') {
          if (line === 'data') dataLines.push('');
          else if (line.startsWith('data:')) {
            const value = line.slice(5);
            dataLines.push(value.startsWith(' ') ? value.slice(1) : value);
          }
          continue;
        }
        const data = dataLines.join('\n');
        dataLines = [];
        if (data === '[DONE]') return { text, usage };
        if (!data) continue;
        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(data) as Record<string, unknown>;
        } catch {
          continue;
        }
        if (!parsed || typeof parsed !== 'object') continue;
        const choices = Array.isArray(parsed.choices) ? parsed.choices : [];
        for (const choice of choices) {
          if (!choice || typeof choice !== 'object') continue;
          const delta = (choice as { delta?: { content?: unknown } }).delta;
          if (delta && typeof delta.content === 'string') text += delta.content;
        }
        const rawUsage = parsed.usage;
        if (rawUsage && typeof rawUsage === 'object') {
          const row = rawUsage as Record<string, unknown>;
          const details = row.completion_tokens_details && typeof row.completion_tokens_details === 'object'
            ? row.completion_tokens_details as Record<string, unknown>
            : {};
          usage = {
            inputTokens: Number(row.prompt_tokens),
            outputTokens: Number(row.completion_tokens),
            reasoningTokens: Number(details.reasoning_tokens ?? 0)
          };
        }
      }
    }
    return { text, usage };
  } finally {
    signal?.removeEventListener('abort', onAbort);
    if (!finished) await cancel();
    reader.releaseLock();
  }
}

/**
 * Bridge A: Pi streamFn adapted onto AgentForge model egress.
 * Reuses official Flash URL policy, safe fetch, timeout, size cap, thinking=disabled, and usage checks.
 */
export function createBridgeAStreamFn(config?: BridgeAConfig): ControlledStreamFn {
  if (!config) {
    throw new AppError(UNAVAILABLE, 503, ERROR_CODES.RUNTIME_UNAVAILABLE);
  }
  const baseUrl = officialBaseUrl(config.baseUrl);
  try {
    resolveOfficialProviderOffering({
      providerId: 'deepseek',
      modelId: config.modelId,
      thinking: false
    });
  } catch {
    throw new AppError(
      'Unsupported official DeepSeek model.',
      400,
      ERROR_CODES.PROVIDER_CONFIGURATION_INVALID
    );
  }
  const maxTokens = Math.min(Math.max(16, Math.floor(config.maxTokens)), FLASH_MAX_TOKENS);

  return async function bridgeAStream(_model, context, options) {
    const providerFetch = config.providerFetch ?? (
      await import('../../../lib/ai/safe-fetch.ts')
    ).safeProviderFetch(baseUrl);
    const messages = openaiMessages(context);
    const body = {
      model: config.modelId,
      messages,
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: maxTokens,
      temperature: config.temperature ?? 0,
      thinking: { type: 'disabled' }
    };
    config.onWire?.({
      method: 'POST',
      pathname: '/chat/completions',
      model: body.model,
      thinking: body.thinking,
      maxTokens: body.max_tokens,
      stream: body.stream,
      toolCount: 0
    });

    const watchdog = createStreamWatchdog(
      options?.signal,
      config.streamIdleTimeoutMs,
      config.streamAbsoluteTimeoutMs,
    );
    const signal = watchdog.signal;
    try {
      const response = await providerFetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${config.apiKey}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify(body),
        signal
      });

      if (!response.ok) {
        // Rejected response bodies must not retain a pooled provider connection.
        await response.body?.cancel().catch(() => undefined);
        throw new AppError(
          'Model request failed. Check the provider, model, network and account balance.',
          502,
          ERROR_CODES.PROVIDER_REQUEST_FAILED
        );
      }

      const streamed = await readSseText(response, signal, watchdog.markChunk);
      signal.throwIfAborted();
      const usage = streamed.usage;
      ensure(
        usage !== undefined
          && Number.isSafeInteger(usage.inputTokens) && usage.inputTokens >= 0
          && Number.isSafeInteger(usage.outputTokens) && usage.outputTokens >= 0,
        'Official provider returned invalid token usage.',
        502,
        ERROR_CODES.PROVIDER_RESPONSE_INVALID
      );
      ensure(
        usage.reasoningTokens === 0,
        'Official non-thinking response contained reasoning usage.',
        502,
        ERROR_CODES.PROVIDER_RESPONSE_INVALID
      );

      return (async function* chunks(): AsyncGenerator<ControlledStreamChunk> {
        if (streamed.text) yield { type: 'text_delta', text: streamed.text };
        yield { type: 'usage', inputTokens: usage.inputTokens, outputTokens: usage.outputTokens };
      })();
    } catch (error) {
      if (options?.signal?.aborted) {
        return (async function* aborted(): AsyncGenerator<ControlledStreamChunk> {
          yield { type: 'aborted' };
        })();
      }
      if (error instanceof AppError) throw error;
      throw new AppError(
        'Model request failed. Check the provider, model, network and account balance.',
        502,
        ERROR_CODES.PROVIDER_REQUEST_FAILED
      );
    } finally {
      watchdog.dispose();
    }
  };
}
