# Shared client-side localization for both frontends

AgentForge will use one internal message source with thin React and portable adapters, rather than a Next.js-only i18n dependency or server-localized DTOs. Display Language is a local client preference with no locale URL segment; stable IDs and English server values remain the fallback so language switching is immediate, the dependency-free portable runtime remains viable, and Workflow or scoring semantics cannot change with presentation language.
