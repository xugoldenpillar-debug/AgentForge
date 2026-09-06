---
status: accepted
---

# Deploy the platform model gateway separately

The Platform Model Gateway will live in a private project and deployment rather than inside the public AgentForge application. This adds operational overhead, but isolates the DeepSeek credential, request policy, logs and emergency budget fuse from the application that owns workflows, hidden evaluations and leaderboard writes; AgentForge keeps only the shared contract, client, receipt validator and Fake Gateway.

## Consequences

The two deployments require explicit protocol compatibility, secret rotation and staged rollout. The gateway cannot read complete Evaluation Suites, judge results or write submissions, and the public repository cannot contain its production secrets or private deployment configuration.
