---
status: accepted
---

# Separate official BYOK from verified execution

AgentForge will not treat an official provider Base URL as sufficient proof of fair execution. Builder-supplied credentials will call supported vendors directly and compete only in an Official BYOK lane, while the certified leaderboard will accept only platform-sponsored runs executed under a versioned Benchmark Profile; the initial official BYOK provider is DeepSeek. Administrator or invited-developer custom endpoints remain experimental and cannot receive hidden evaluations or create ranked submissions. This separation preserves user choice and promotional free usage without mixing results whose execution chains have different levels of platform control.

## Consequences

Platform service credentials and configuration are not user credentials, Trust Lanes remain mutually exclusive, and benchmark identity must include the Benchmark Profile and evaluation/scoring versions. Platform configuration begins as encrypted database state and is intended to move to a secret manager for production operations.
