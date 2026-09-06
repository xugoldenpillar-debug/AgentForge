# Official Provider Registry

- Verification date: **2026-09-06**
- Scope: Phase 0.1 evidence and Phase 1.2 Official DeepSeek Registry
- Network activity used for verification: public documentation reads only
- Paid model calls: none during initial documentation verification; subsequent authorized application test is recorded separately below.

## Registered offering

The initial registry is deliberately fail-closed and contains exactly one offering:

| Field | Registered value |
| --- | --- |
| Provider | `deepseek` |
| OpenAI-format canonical Base URL | `https://api.deepseek.com` |
| Model ID | `deepseek-v4-flash` |
| Documented model version on the verification date | `DeepSeek-V4-Flash-0731` |
| Thinking | disabled only |
| JSON Output | supported |
| Tool Calls | supported |
| Maximum output | `384K` tokens (`384_000` in the registry) |

`deepseek-v4-flash` is a moving provider alias. DeepSeek documents that the alias currently maps to `DeepSeek-V4-Flash-0731`, but this is not proof of immutable upstream weights. Benchmark Profiles and Seasons must still provide AgentForge's version and drift boundaries.

DeepSeek documents thinking as enabled by default. AgentForge therefore does not rely on omission: the registered offering represents only an explicit non-thinking request (`thinking.type = disabled` at a future provider adapter boundary). Thinking mode is not registered, even though the upstream model supports it.

`maxOutputTokens: 384_000` records the documented upstream capability ceiling only. It is not an AgentForge default, entitlement, or per-run token allowance. Benchmark Profiles, challenge constraints, Workflow energy/token budgets, request-size controls, and provider adapter limits must impose their own equal or tighter bounds; callers must use the smallest applicable bound.

The registry now also gates the existing BYOK SDK adapter for official DeepSeek
endpoints. The adapter sends explicit non-thinking parameters and rejects unsupported
models/paths or missing/invalid usage. This remains the existing BYOK trust tier,
not a Verified Gateway. Credential `/models` preflight and Official/Custom API
separation remain pending. See `docs/verification/deepseek-app-live-2026-09-06.md`
for the authorized four-case live run and its limits.

The Registry intentionally contains no live provider prices. DeepSeek states that prices may change, and the current pricing page uses peak/off-peak rates. Ranked Benchmark Cost belongs to an immutable Benchmark Profile, not this Registry; actual platform spend belongs to execution receipts and budget controls.

## Capability and usage evidence

The following capabilities were confirmed from DeepSeek's official documentation on 2026-09-06:

- The Quick Start and Models API list `deepseek-v4-flash` as a current model and the OpenAI-format Base URL as `https://api.deepseek.com`.
- Models & Pricing identifies the current alias target as `DeepSeek-V4-Flash-0731`, lists a 1M context length, a maximum 384K output, JSON Output, and Tool Calls.
- Chat Completions accepts `thinking.type` values `enabled` and `disabled`; thinking defaults to enabled, so non-thinking must be explicit.
- JSON Output uses `response_format: { "type": "json_object" }`. The prompt must also request JSON, and callers must still handle truncation or occasional empty content.
- Tool Calls are documented for non-thinking mode. Strict tool-schema mode is Beta and requires the `/beta` endpoint, so strict mode is **not** part of this registered offering.
- Non-stream Chat Completions usage includes required `prompt_tokens`, `completion_tokens`, `total_tokens`, `prompt_cache_hit_tokens`, and `prompt_cache_miss_tokens`. `completion_tokens_details.reasoning_tokens` is documented as an optional nested detail. For this non-thinking offering, AgentForge must accept reasoning tokens only when absent or zero; a positive value is a fail-closed mismatch.

## Official sources

All URLs below are DeepSeek official documentation and were checked on 2026-09-06:

1. Quick Start: https://api-docs.deepseek.com/
2. Models & Pricing: https://api-docs.deepseek.com/quick_start/pricing
3. Lists Models: https://api-docs.deepseek.com/api/list-models/
4. Chat Completions API: https://api-docs.deepseek.com/api/create-chat-completion/
5. Thinking Mode: https://api-docs.deepseek.com/guides/thinking_mode/
6. JSON Output: https://api-docs.deepseek.com/guides/json_mode/
7. Tool Calls: https://api-docs.deepseek.com/guides/tool_calls/

The Models API provides availability metadata, not detailed capability or immutable-version proof. A future credential validation request to `/models` therefore confirms key access and current model visibility only; it must not dynamically expand the Registry.

## Security and API boundary

`src/lib/ai/provider-registry.ts` is a code-controlled, runtime-frozen allowlist. Its public listing omits the canonical Base URL and all pricing fields. Server resolution accepts exactly these client-selection fields:

```json
{
  "providerId": "deepseek",
  "modelId": "deepseek-v4-flash",
  "thinking": false
}
```

Missing fields, extra fields, client-provided URLs, client-provided prices, unknown providers, unknown models, and thinking-enabled selections are rejected synchronously. Callers must resolve the offering before DNS lookup or any other external request. Registry resolution never performs network I/O.

Updating an offering requires a reviewed source change plus updated evidence and native Node regression tests. Runtime responses, `/models`, user input, environment variables, and database rows must never mutate or extend this allowlist.
