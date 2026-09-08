import { AppError, ERROR_CODES, ensure } from '../shared/errors.ts';
import { parseProviderProtocol } from '../shared/provider-protocol.ts';
import { normalizeProviderBaseUrl, type ProviderDiscoveryInput, type ProviderModelsResult } from '../shared/provider-models.ts';
import { validateProviderUrl } from './url-policy.ts';

export interface ModelDiscoveryOptions {
  allowedHosts: string[];
  /** Production injects safeProviderFetch, never an unrestricted HTTP client. */
  createFetch: (baseUrl: string) => typeof fetch;
  signal?: AbortSignal;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function parseProviderDiscoveryInput(body: Record<string, unknown>): ProviderDiscoveryInput {
  ensure(Object.keys(body).every((key) => ['protocol', 'baseUrl', 'apiKey'].includes(key)),
    'Invalid model discovery fields.', 400, ERROR_CODES.PROVIDER_CONFIGURATION_INVALID);
  const protocol = parseProviderProtocol(body.protocol);
  ensure(typeof body.baseUrl === 'string' && body.baseUrl.length <= 300,
    'Invalid provider base URL.', 400, ERROR_CODES.PROVIDER_CONFIGURATION_INVALID);
  ensure(typeof body.apiKey === 'string' && body.apiKey.trim().length >= 16 && body.apiKey.length <= 512 && !/[\r\n]/u.test(body.apiKey),
    'Invalid provider API key.', 400, ERROR_CODES.PROVIDER_CONFIGURATION_INVALID);
  let baseUrl: string;
  try { baseUrl = normalizeProviderBaseUrl(body.baseUrl, protocol); }
  catch { throw new AppError('Invalid provider base URL.', 400, ERROR_CODES.PROVIDER_CONFIGURATION_INVALID); }
  return { protocol, baseUrl, apiKey: body.apiKey.trim() };
}

/** List only. This endpoint never performs generation, persists keys, or trusts upstream URLs. */
export async function discoverProviderModels(input: ProviderDiscoveryInput, options: ModelDiscoveryOptions): Promise<ProviderModelsResult> {
  const base = validateProviderUrl(input.baseUrl, options.allowedHosts);
  const request = options.createFetch(base.href);
  const signal = AbortSignal.any([AbortSignal.timeout(15_000), ...(options.signal ? [options.signal] : [])]);
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (input.protocol === 'anthropic-messages') {
    headers['x-api-key'] = input.apiKey;
    headers['anthropic-version'] = '2023-06-01';
  } else if (input.protocol === 'google-generative-ai') {
    headers['x-goog-api-key'] = input.apiKey;
  } else {
    headers.Authorization = `Bearer ${input.apiKey}`;
  }
  const models = new Map<string, { id: string; name: string }>();
  const cursors = new Set<string>();
  let cursor = '';
  let truncated = false;
  try {
    for (let page = 0; page < 5; page += 1) {
      const url = new URL(`${base.href.replace(/\/$/, '')}/models`);
      if (input.protocol === 'anthropic-messages') {
        url.searchParams.set('limit', '100');
        if (cursor) url.searchParams.set('after_id', cursor);
      } else if (input.protocol === 'google-generative-ai') {
        url.searchParams.set('pageSize', '100');
        if (cursor) url.searchParams.set('pageToken', cursor);
      }
      const response = await request(url, { method: 'GET', headers, signal, cache: 'no-store', redirect: 'error' });
      if (!response.ok) {
        await response.body?.cancel();
        throw new AppError('The provider could not list models. Check the protocol, URL and API key, or enter a model ID manually.',
          502, ERROR_CODES.PROVIDER_RESPONSE_INVALID);
      }
      // Bound even injected transports; do not reflect the upstream body in errors.
      const reader = response.body?.getReader();
      ensure(reader, 'Invalid model list response.', 502, ERROR_CODES.PROVIDER_RESPONSE_INVALID);
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 2 * 1024 * 1024) {
          await reader.cancel();
          throw new AppError('Model list is too large.', 502, ERROR_CODES.PROVIDER_RESPONSE_INVALID);
        }
        chunks.push(value);
      }
      const data: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      ensure(record(data), 'Invalid model list response.', 502, ERROR_CODES.PROVIDER_RESPONSE_INVALID);
      const entries = input.protocol === 'google-generative-ai' ? data.models : data.data;
      ensure(Array.isArray(entries), 'Invalid model list response.', 502, ERROR_CODES.PROVIDER_RESPONSE_INVALID);
      for (const entry of entries) {
        if (!record(entry)) continue;
        if (input.protocol === 'google-generative-ai' && Array.isArray(entry.supportedGenerationMethods) &&
            !entry.supportedGenerationMethods.includes('generateContent')) continue;
        const rawId = input.protocol === 'google-generative-ai' ? entry.name : entry.id;
        if (typeof rawId !== 'string') continue;
        const id = (input.protocol === 'google-generative-ai' ? rawId.replace(/^models\//, '') : rawId).trim();
        if (!id || id.length > 160 || /[\u0000-\u0020\u007f]/u.test(id)) continue;
        const label = entry.display_name ?? entry.displayName ?? entry.name;
        if (!models.has(id) && models.size >= 1000) { truncated = true; break; }
        models.set(id, { id, name: typeof label === 'string' ? label.slice(0, 200) : id });
      }
      const nextCursor = input.protocol === 'google-generative-ai'
        ? data.nextPageToken
        : input.protocol === 'anthropic-messages' && data.has_more === true ? data.last_id : undefined;
      if (input.protocol === 'anthropic-messages' && data.has_more === true) {
        ensure(typeof nextCursor === 'string' && nextCursor.length > 0,
          'Invalid model list pagination.', 502, ERROR_CODES.PROVIDER_RESPONSE_INVALID);
      }
      if (!nextCursor) break;
      ensure(typeof nextCursor === 'string' && nextCursor.length <= 2048 && !cursors.has(nextCursor),
        'Invalid model list pagination.', 502, ERROR_CODES.PROVIDER_RESPONSE_INVALID);
      cursors.add(nextCursor);
      cursor = nextCursor;
      if (page === 4 || models.size >= 1000) { truncated = true; break; }
    }
    return { models: [...models.values()].sort((a, b) => a.id.localeCompare(b.id)), truncated };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(signal.aborted ? 'Model discovery timed out or was cancelled.' : 'Unable to retrieve models from this provider.',
      502, ERROR_CODES.PROVIDER_RESPONSE_INVALID);
  }
}
