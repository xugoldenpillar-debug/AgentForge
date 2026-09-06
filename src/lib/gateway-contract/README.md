# AgentForge private Gateway protocol v1

This directory is the standalone, dependency-free Node contract shared with the
future private gateway. It implements design sections 5.1–5.4 and the receipt
validation portion of Phase 5.3. It does **not** implement a gateway, HTTP client,
upstream adapter, replay store, worker, billing ledger or production acceptance.
Portable can import/test this code without installing dependencies; this does not
enable real model execution in Portable.

## Entrypoints

- `index.ts`: strict runtime parsers and TypeScript exports. Imports only this
  directory and Node crypto. Uses explicit `.ts` paths compatible with native
  type stripping. Validators return fresh, validated structures.
- `zod.ts`: **optional** Zod companion; never re-exported by the native entrypoint.
  Its transforms delegate to the same parsers, rejecting rather than stripping
  unknown keys. Header and request schema factories require a clock and trusted
  alias/capabilities. Do not log Zod input objects or error objects with inputs.
- `../ai/execution-receipt.ts`: trusted invocation binding, safe receipt projection,
  text-only and tool-aware execution-result validation, status reconciliation.

All parse failures use bounded fixed `GatewayContractError` codes without input,
upstream error message, rejected field value, headers or cause. The wire error
shape is only `{error: {code, request_id}}`. Raw provider errors must be mapped
by the future adapter to this allowlist, never forwarded.

## This is NOT the raw DeepSeek/OpenAI response schema

The private gateway must normalize its upstream response into this strict
platform envelope. `model` is the frozen profile **alias**, `id` echoes the exact
UUID request header, and provider/model identities live in `agentforge` metadata.
Raw upstream `id`, `object`, `created`, `total_tokens`, reasoning text and provider
extensions are not accepted. This avoids silent receipt downgrades and upstream
error/hidden-data exposure. The JSON envelope shown in the design is not an
invitation to pass through arbitrary OpenAI-compatible fields.

Requests always require temperature 0, stream false, a positive bounded
`max_tokens`, and `thinking: {type: 'disabled'}`. Tool and JSON support must be
explicitly enabled by **trusted frozen Profile capabilities**, passed separately
from request data. Discovery remains the exact design's alias-list shape;
capability flags are local profile policy, not extra untrusted discovery fields.
Defaults disable both features.

Supported optional structures:

- `response_format: {type: 'json_object'}`. Tool-aware result validation requires
  an object-shaped JSON text result when no tool call is returned.
- Up to 16 function tools with name, optional description and bounded parameters.
- Parameters use a strict recursive JSON Schema subset: type, description,
  properties, required, additionalProperties=false, items, primitive enums.
  No `$ref`, external schema resolution or arbitrary extension keywords. Maximum
  depth 8, 256 schema nodes and 64 properties per object.
- `tool_choice`: auto / none / required. Function selection by object, parallel
  control fields and other provider options are intentionally not part of v1.
- Assistant tool calls, tool-result messages with exact call ID pairing, and
  `finish_reason: 'tool_calls'`. Tool names must match those actually sent.
  Tool instructions are returned, **never executed** by these validators. The
  result validator parses arguments as a JSON object and validates the declared
  supported schema subset recursively (types, required properties, arrays,
  enums and additionalProperties=false). Integer values must be safe integers;
  numbers must be finite. Undeclared properties follow JSON Schema semantics:
  they are rejected when additionalProperties=false; declare that flag on each
  object that must be closed. Argument validation is bounded to depth 16 and
  4096 visited schema values, in addition to the 64 KiB argument-string limit.
  Response call IDs cannot reuse any assistant call ID in the sent history.
  The downstream restricted tool executor must still enforce business-specific
  semantics, authorization, budgets and safe execution; schema validity alone
  is not permission to execute a tool.

## Binding and persistence

`deriveGatewayIdempotencyKey` hashes a fixed-position JSON tuple with a versioned
namespace and exactly runId, caseId, nodeId, invocationIndex, profileVersion and
replicaIndex. Unknown context keys (including prompts) are rejected. The header
contains `sha256:<64 lowercase hex>`; receipt `idempotency_key_hash` is a second
SHA-256 of that exact transmitted header string. Both peers must use this same
algorithm. No prompt or output is used in the key.

Callers provide a trusted `ExecutionReceiptExpectation`, frozen before network
execution, and validate headers/body with `validateGatewayRequest`.
`validateExecutionReceipt` binds ID, alias, every invocation-context field via
its digest, profile version and gateway-config version. Provider/model,
non-thinking status, usage and spend are mandatory and never estimated.

Token counts must be nonnegative safe integers. Cache hit + miss must equal
prompt usage; total prompt + completion must remain safely representable.
Reasoning tokens may only be absent or zero. Spend/latency must be finite and
nonnegative; fractional values are accepted. Output usage is checked against
sent `max_tokens` by execution-result validators.

Only `ValidatedExecutionReceipt` is a safe audit-persistence projection. It
contains context IDs, usage and metadata, not choices/messages/credentials.
Text/tool-aware execution results contain private model output and must go only
to the restricted workflow evaluation path, never generic logs or public APIs.

Empty completion `choices` can be parsed for receipt-only audit but both
execution-result validators reject it. The explicit idempotency status schema
provides `pending`, `completed` (required execution metadata) and `failed`
(allowlisted error, optional execution metadata) variants. Execution metadata
has no choices, and terminal statuses cannot parse as model completions.
`validateGatewayIdempotencyStatus` additionally binds status and nested evidence
to the frozen invocation. A completed metadata-only status does not authorize
retry or recover the missing model body: future reconciliation must mark a lost
paid result failed-chargeable per design. A failed status without evidence does
not itself prove the upstream was never called.

## Adapter responsibilities and limits

Headers parsers accept an explicit lowercase protocol-only projection. The HTTP
adapter must reject duplicate protocol headers **before** projecting; ordinary
transport headers are not part of this object. Bearer syntax, UUID and canonical
Unix-millisecond timestamp are checked with a ±5-minute skew. Replay uniqueness,
authenticating the actual token, request cancellation, deadlines, HMAC/mTLS,
config circuit breaking and privacy-safe logging belong to future integration.

Limits are hard protocol ceilings, not spend authorization: JSON 1 MiB, each
text 256 KiB, 64 messages, 128 discovery aliases, 160-byte identifiers and 65,536
output tokens. Profile output limits can be lower. `parseGatewayJson` rejects
oversize encoded bodies and invalid UTF-8; request/completion parsers also bound
the serialized result. The network reader must cap bytes **while reading** and
apply a timeout; checking only after buffering is insufficient. JavaScript
JSON.parse uses last-key-wins for duplicate JSON member names; transport peers
must not generate duplicate members. This package does not claim a duplicate
JSON-key detection layer or upstream version attestation.

## Verification

Run the native contract tests with Node type stripping; when Zod is absent only
the isolated companion test skips. Full source strict TypeScript checking is
also required when dependencies are installed. All examples/tests use synthetic
local data, not network calls or paid model evidence.
