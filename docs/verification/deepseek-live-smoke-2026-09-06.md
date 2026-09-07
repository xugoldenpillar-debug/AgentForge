> **历史验证记录 / Historical verification record：** 本文记录 2026-09-06 的一次授权官方 Flash smoke，不代表当前运行、持续可用性、真实账单或生产验收。

# DeepSeek Flash live API smoke — 2026-09-06

## Authorization and scope

The user explicitly authorized a first real Flash-model test using their supplied
credential. Executed only two non-streaming requests to the official
`https://api.deepseek.com/chat/completions` endpoint, with redirects rejected,
60-second request timeout, no retries, `thinking.type=disabled` and
`max_tokens=128` per request. No credential was saved to project files or this report.
Only synthetic, non-sensitive prompts were sent. No benchmark fixtures were sent.

## Observed results

| Check | HTTP | Returned model | Finish | Prompt tokens | Completion tokens | Total tokens | Wall time | Assertion |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Exact text response | 200 | deepseek-v4-flash | stop | 13 | 5 | 18 | 541 ms | passed |
| JSON extraction (`response_format=json_object`) | 200 | deepseek-v4-flash | stop | 51 | 14 | 65 | 756 ms | passed |

Text assertion: trimmed response equals `AGENTFORGE_OK`.
JSON assertion: parsed object has `name=AgentForge` and numeric `count=3`.
Both usage records reported zero cache hits and cache misses equal to prompt tokens.
Total observed usage: **83 tokens (64 input, 19 output)**. Reasoning-token detail was
absent. This does not independently prove upstream execution internals.
Actual billed amount was not retrieved; no monetary cost claim is made.

## Boundaries

This is a direct live provider API smoke, not the application SDK adapter, workflow
engine, streamed run protocol, tool-calling integration, encrypted credential storage,
Official BYOK lane or private Verified Gateway end-to-end acceptance. The application
remains in Demo mode. No ranking/submission records were created by these requests.
No fallback, retries, load test, production deployment or additional paid suite ran.

The user should rotate the credential because it was shared in conversation. The
in-memory credential binding was cleared after the requests; this is not a promise
that chat/tool history has been erased. No credential value is included here.
