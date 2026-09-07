# Challenge reference example bank

AgentForge keeps two different kinds of case data on purpose:

1. **Executable benchmark cases** live in `src/server/fixtures.ts`. Public cases are run for feedback; hidden cases are server-only and determine competitive submissions.
2. **Public reference examples** live in `src/server/case-examples.ts`. They are teaching and design material with complete expected answers and never participate in scoring.

Keeping these sets separate prevents a larger teaching library from multiplying BYOK model calls or silently changing leaderboard behavior.

## Current coverage

Each existing challenge has 16 maintained reference examples, for 48 examples total.

| Challenge | Normal | Edge | Adversarial | Security | Total |
| --- | ---: | ---: | ---: | ---: | ---: |
| Messy JSON Extractor | 6 | 4 | 3 | 3 | 16 |
| Support Ticket Router | 6 | 4 | 3 | 3 | 16 |
| Secret Keeper | 6 | 4 | 3 | 3 | 16 |
| **Total** | **18** | **12** | **9** | **9** | **48** |

Every reference example contains:

- a stable `id`;
- the target `problemId`;
- a scoring-style category (`normal`, `edge`, `adversarial`, or `security`);
- a short scenario label;
- an input;
- the complete expected answer/contract;
- notes explaining the intended behavior.

## Scenario coverage

### Messy JSON Extractor

Examples cover ordinary prose, labeled and reordered fields, punctuation and multiline input, missing values, numeric zero, distracting people, contradictory formatting requests, prompt-injection attempts, prompt-exfiltration attempts, and markup/script noise.

### Support Ticket Router

Examples cover billing, bugs, account access, refunds, general questions, priority conflicts such as refund-over-bug and account-over-bug, irrelevant narrative, label manipulation, system-style injection, markup injection, and prompt-theft attempts.

### Secret Keeper

Examples cover harmless helpfulness tasks, mixed sensitive/harmless requests, empty input, discussion of secrecy without disclosure, roleplay, debugging pretexts, authority impersonation, and encoded/obfuscated exfiltration requests.

## Safety and maintenance rules

- Never copy a hidden benchmark input or expected answer into the reference bank.
- Never place the protected challenge value in a public reference example.
- Reference examples must remain deterministic and fit the challenge's documented output contract.
- Adding reference examples must not change executable public/hidden case counts, scoring weights, leaderboard history, or provider-call budgets.
- Prefer adding materially different situations instead of shallow paraphrases.
- When adding a new challenge, add representative normal, edge, adversarial, and security examples where those categories make sense.

`tests/case-examples.test.ts` enforces the current counts, answer contracts, unique IDs, secret non-disclosure, and exact-input separation from hidden benchmark cases.
