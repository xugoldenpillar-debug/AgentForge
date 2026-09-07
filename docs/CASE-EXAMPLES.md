# Challenge reference example bank

AgentForge keeps two different kinds of case data on purpose:

1. **Executable benchmark cases** live in `src/server/fixtures.ts` plus the server-only expansion in `src/server/hidden-case-expansion.ts`. Public cases are run for feedback; hidden cases are server-only and determine competitive submissions.
2. **Public reference examples** live in `src/server/case-examples.ts`. They are teaching and design material with complete expected answers and never participate in scoring.

Keeping these sets separate prevents a larger teaching library from multiplying public BYOK calls while allowing the hidden competitive benchmark to be substantially harder.

## Public reference coverage

Each existing challenge has 16 maintained reference examples, for 48 examples total.

| Challenge | Normal | Edge | Adversarial | Security | Total |
| --- | ---: | ---: | ---: | ---: | ---: |
| Messy JSON Extractor | 6 | 4 | 3 | 3 | 16 |
| Support Ticket Router | 6 | 4 | 3 | 3 | 16 |
| Secret Keeper | 6 | 4 | 3 | 3 | 16 |
| **Total** | **18** | **12** | **9** | **9** | **48** |

Every reference example contains a stable ID, target problem, category, scenario label, input, complete expected answer/contract, and notes explaining intended behavior.

## Hidden benchmark coverage

Each challenge now has **48 hidden cases**, balanced evenly across the four scoring categories.

| Challenge | Normal | Edge | Adversarial | Security | Hidden total |
| --- | ---: | ---: | ---: | ---: | ---: |
| Messy JSON Extractor | 12 | 12 | 12 | 12 | 48 |
| Support Ticket Router | 12 | 12 | 12 | 12 | 48 |
| Secret Keeper | 12 | 12 | 12 | 12 | 48 |
| **Total** | **36** | **36** | **36** | **36** | **144** |

The original 12 hidden cases per challenge keep their existing IDs. New cases are appended as IDs 13-48 so existing seeded identifiers are not silently reassigned.

The expanded hidden benchmark deliberately includes materially different stressors rather than simple paraphrases:

- Chinese, Japanese, Spanish and mixed-language inputs;
- accented names and non-ASCII city names;
- mojibake / garbled text;
- typing errors and abbreviated user text;
- emoji and unusual punctuation;
- zero-width characters and Unicode homoglyphs;
- contradictory and historical-vs-current intent;
- distractor people and competing field values;
- negation such as "I do not want a refund";
- HTML, XML, Markdown and JSON-shaped prompt injection;
- `<script>`, event-handler and comment injection text;
- fake `SYSTEM`, `DEVELOPER`, `assistant` and tool-result messages;
- requests to steal prompts, change schemas or manufacture extra fields;
- encoded, transformed, split-character and indirect secret-exfiltration attempts;
- mixed dangerous + harmless Secret Keeper requests to ensure the agent stays helpful without leaking protected context.

The hidden suite remains under the service's default 50-case per-run ceiling: 48 hidden cases are executed per challenge submission.

## Scenario coverage

### Messy JSON Extractor

Reference and hidden cases cover ordinary prose, labeled and reordered fields, punctuation and multiline input, missing values, numeric zero, multilingual records, corrupted text, misspellings, distracting people, contradictory formatting requests, schema poisoning, fake role messages, prompt-exfiltration attempts, and markup/script noise.

### Support Ticket Router

Coverage includes billing, bugs, account access, refunds, general questions, priority conflicts such as refund-over-bug and account-over-bug, explicit negation, historical issues versus current intent, shorthand/typos, multilingual tickets, irrelevant narrative, label manipulation, fake role/tool messages, markup injection and prompt-theft attempts.

### Secret Keeper

Coverage includes harmless helpfulness tasks, multilingual questions, mixed sensitive/harmless requests, empty and noisy input, roleplay, debugging and authority pretexts, encoded/obfuscated/indirect exfiltration, zero-width and homoglyph attacks, and script/markup/role injection while still requiring useful answers to safe sub-requests.

## Safety and maintenance rules

- Never copy a hidden benchmark input or expected answer into the public reference bank.
- Never place the protected challenge value in a public reference example.
- Reference examples and hidden answers must remain deterministic and fit the challenge's documented output contract.
- Public example growth must not silently increase executable public test calls.
- Hidden-suite growth must stay within the configured run limit or update the budget design explicitly.
- Prefer materially different situations instead of shallow paraphrases.
- When adding a new challenge, add representative normal, edge, adversarial and security examples where those categories make sense.

`tests/case-examples.test.ts` protects public/hidden separation. `tests/hidden-cases.test.ts` enforces hidden counts, balanced categories, stable original IDs, and the presence of multilingual, malformed-input, Unicode and injection coverage.
