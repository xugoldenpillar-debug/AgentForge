# Agent Builder: model discovery and private Skills

## Behavior / 功能说明

The `/agent-builder` creation flow now supports discovering models before saving an encrypted credential, importing a private instruction Skill directly from a file, selecting immutable Skill versions, and loading those instructions through the production Creation executor into Pi.

Model discovery is an authenticated `POST /api/arena/providers/models` carrying `{ protocol, baseUrl, apiKey }`. The server makes a **GET** to the provider's model-list endpoint. The browser never sends keys in URLs, local storage, or directly to a provider. `GET /api/arena/providers/:credentialId/models` uses an existing owner-scoped encrypted credential. Neither route performs generation or saves a transient key. OpenAI Chat/Responses, Anthropic Messages, and Gemini have explicit authentication and response mappings. Anthropic and Gemini pagination is bounded to five pages, 1,000 models, 2 MiB per response, and a 15-second request deadline. Unsupported endpoints retain manual exact-model-ID entry. Provider roots and pasted generation endpoints are normalized without changing their host or discarding security-sensitive query/userinfo fields. Existing allowlists, public-IP DNS checks, path confinement and redirect rejection remain in force.

`POST /api/arena/agent-skills` accepts `{ fileName, content }`. Supported UTF-8 files are `SKILL.md`, `.md`, `.markdown`, `.txt`, and a self-contained `instruction-skill` JSON definition. Markdown front matter supports simple `name`/`description` metadata; it is **not** an executable YAML loader. The file limit is 64 KiB; a Build can select at most 16 Skills with a combined 64 KiB instruction budget. ZIP archives, executable packages, binary text, traversal filenames, arbitrary fields and external dependencies are rejected. Imported files become private Community component drafts with frozen versions and audit events, not public releases. Re-importing the same normalized definition reuses its existing owner version.

`GET /api/arena/agent-skills` exposes only the owner's eligible frozen instruction versions and bounded previews. Selection stores `{ componentId, versionId, contentDigest, kind: 'declarative' }` in the Build, never a browser-provided instruction body or file path. The authoritative resolver, run scheduler, and worker verify ownership, digest integrity, eligibility and revocation. The worker supplies the resolved text as `skillInstructions` to Pi and revalidates it at invocation/tool/finalization boundaries. Changing a draft never changes a frozen Skill. Uploading a Skill does not grant shell, network, host filesystem, package installation, additional tools, or permission to weaken artifact sanitization.

UI improvements include searchable model/Skill lists, key visibility control and clearing after save, file preview before import, automatic selection, removal, error/empty/loading states, bilingual messages, mobile layout, keyboard focus, reduced-motion support, owner-scoped bounded local draft recovery, safe storage failures, save-before-run checks, duplicate-action guards, stable retry idempotency keys, polling backoff, stale-response protection, expired-ballot checks and reset confirmation. API keys are never part of the persisted session. Existing unscoped v2 session data is deliberately not restored across identities.

## 中文摘要

模型列表由服务端使用 GET 获取，支持搜索选择和手动填写。Skill 文件导入后保存为私有不可变版本，勾选后随 Build 保存，由 Worker 校验后加载到 Pi 的真实请求。单文件及所选指令总量上限为 64 KiB，最多 16 个 Skill。不执行上传脚本，不授予额外工具或网络权限。草稿按账号隔离，未保存的修改不能误运行旧版本。没有数据库迁移，没有生产部署，没有付费模型调用。

## Compatibility and validation

No database schema/migration or production dependency change is required: existing component/version and Build JSON storage is reused. Both UI and worker must deploy together for Skill-enabled Builds. Old Builds with `skillRefs: []` remain valid. Existing worker images still need the approved Pi/EF/sandbox configuration; this patch does not enable production gates or deploy anything.

- `pnpm typecheck`
- `pnpm test` (full Git history and Node >=22.19 are needed for the existing history audit/Pi tests)
- `pnpm test:pi-runtime`, `pnpm test:provider-sdk`, `pnpm test:deploy`
- Existing PostgreSQL migration, CAS, evaluation and Next.js smoke matrix
- `scripts/agent-builder-browser.mjs`: real Next.js, Better Auth and PostgreSQL, with model discovery responses and availability indicators explicitly intercepted. It verifies upload/save/restore and desktop/mobile screenshots, not real-model or gVisor execution. It refuses remote or implicit-port targets and generation requests.

Browser checks use the pinned Playwright library installed into a disposable CI tools directory, not the production dependency tree. Run with an explicit `BUILDER_BROWSER_BASE_URL`, `PLAYWRIGHT_MODULE` and optional `BUILDER_BROWSER_OUTPUT`. Screenshots and `report.json` are validation evidence, not a production security certification.
