# Shared client-side localization for both frontends

AgentForge will use one internal message source with thin React and portable adapters, rather than a Next.js-only i18n dependency or server-localized DTOs. Display Language is a local client preference with no locale URL segment; stable IDs and English server values remain the fallback so language switching is immediate, the dependency-free portable runtime remains viable, and Workflow or scoring semantics cannot change with presentation language.

## Historical scope update — 2026-09-06

Portable has been retired. Its adapter rationale above records the original decision, not an obligation to maintain a second frontend. The single Next.js application retains shared canonical values and localization boundaries.
