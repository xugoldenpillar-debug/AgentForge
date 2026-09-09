# Artifact Arena reusable Creation Challenges

The launch examples (pelican on a bicycle and Qin Shi Huang riding a polar bear) are seed data for a reusable Creation Challenge lane. New challenges do not require a runtime code change.

## Challenge lifecycle

1. A signed-in user submits `POST /api/arena/challenge-applications` with a versioned material object (`slug`, bilingual title, bilingual prompt) and a rights/permission declaration.
2. Reviewers use `POST /api/arena/admin/challenge-applications/:id/review`.
3. Approval atomically creates a published `animation_challenges` row and immutable `animation_challenge_versions` v1 row.
4. `GET /api/arena/animation-challenges` discovers it automatically.
5. CreationRun resolves the selected version from the repository and verifies its content digest and published parent before execution.

The `animation_*` database names remain for backwards compatibility; semantically they are the reusable HTML/SVG Creation Challenge catalog.

## Skills

Creation Agent Builds may pin reviewed `instruction-skill` component releases. A run re-checks every pinned component/version/digest against an active public release when it is scheduled and again immediately before execution. Skill instructions are injected into the Pi creation system prompt. Executable capabilities and workflow recipes remain disabled in this lane.

## Reproducibility / public provenance

Each new Creation evaluation snapshot freezes safe public provenance alongside the existing private credential authorization:

- exact model id;
- provider class (`official` or `custom`), canonical provider id and host, and API protocol;
- Pi adapter, policy, and system-prompt version;
- loaded Skill component/version/digest plus public name/description;
- challenge version;
- captured timestamp.

Secrets, credential ids, provider request ids, storage keys and private component material are never part of the public projection. Published results additionally resolve the immutable Build instructions and Creation Brief prompt, so a viewer can see the prompt context that produced the HTML.

## Ranking and official API gallery

`GET /api/arena/showcase/creation-leaderboard?roundId=...&comparatorKey=...&policyVersion=...` wraps the existing pairwise community leaderboard. Every row contains `provenance` when it was produced by the new snapshot contract.

The response also contains `officialSections`, grouped by `providerId:modelId`. This is deliberately a projection of the same scored rows rather than a separate scoring algorithm: people can inspect outputs made with the same official API/model while preserving the community ranking semantics.

Known official hosts are classified server-side (OpenAI, Anthropic, Google Generative AI, DeepSeek). Other endpoints are shown as custom and are never allowed to claim an official section merely from user-supplied labels.

## Compatibility

Existing published artifacts remain readable. Older CreationRuns created before public provenance snapshots return `provenance: null`; they are not guessed into an official-provider bucket.
