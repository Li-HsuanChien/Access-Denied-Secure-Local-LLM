# ADR 0004: React frontend with observed interface parity

- **Status:** Accepted, 2026-10-20; React migration accepted on 2026-10-21. See the [acceptance record](../../development/react-migration/acceptance.md) for checks, evidence, and qualification limits.
- **Supersedes:** ADR 0001's SvelteKit/frontend choice and frontend-specific implementation statements in ADRs 0002/0003. Their workflow separation, offline requirements, feature layout, visual tokens and provenance remain applicable. Historical ADRs remain unchanged.
- **Scope:** Replace the active Svelte frontend with React/TypeScript/Vite while preserving the observed interface and actions. No new PRD product scope, Python host API, wire schema, storage, model workflow or desktop platform design.

## Context

The active baseline is the pinned Open WebUI v0.11.4 Svelte application at `4dc2a06a4fc57ff393ea43ef4b75014b1458eb9b`, including the actual native chat rather than a fixture-only feature view. Stage 1 recorded route/actions/rich renderer behavior, defects and immutable accepted original screenshots. Source package presence alone is not evidence that a capability is exposed or supported. The approved migration requires visual and interaction parity except narrowly recorded safety/lifecycle corrections.

## Decision

Use React 19.2.9 and TypeScript with the existing compatible Vite 5 toolchain and local renderer/style assets. Pin React and renderer dependencies after official registry compatibility checks; see the [exact version and interface specification](../../development/react-migration/react-contracts.md). Use thin browser-history routes and feature-owned views. A small shared runtime behind React providers owns preference synchronization, single-answer request ownership, and publication identity/polling. React state replaces Svelte stores; no replacement third-party UI defaults are introduced.

Retain the existing Python development host and workflow API and the planned Tauri desktop boundary. The implemented developer host uses Python ThreadingHTTPServer; production FastAPI hosting and Tauri/release lifecycle are architecture targets/scaffolds, not capabilities completed by this migration. Reuse versioned `/v1/requests`, `/health`, loopback restrictions, backend-owned answer schema validation and workflow clients. Retain every returned answer field, independently from local presentation edits. History remains individually saved answers, not a durable chat branch graph. The frontend cannot invent PDF page rendering, model context, revision instructions, cancellation or session restoration absent from the current interfaces.

During comparison, the original used 5173 and the additive React entry used `127.0.0.1:5176` (5174 was already occupied). The final cutover now makes React canonical on 5173, with the original Svelte source retained in Git history and accepted baseline evidence retained separately. Keep applicable license/branding notices and the reused local assets; the framework replacement does not remove attribution obligations.

## Explicit behavior and safety rulings

1. Chat graph/draft/unsent queue remain temporary and reset on New Chat or route remount. An app-lifetime coordinator retains an already dispatched request and saves its original result once even if Chat leaves; a remounted Chat cannot overlap it. `/c/:id` replaces to `/` without the failing upstream lookup. Regeneration still sends only the latest question, irrespective of its displayed revision suggestion.
2. Preserve ordinary queued questions and Edit/Delete. Omit cosmetic Stop and overlapping Send now dispatch: no answer-cancellation operation exists. Host remains one-job authority. Navigation/unmount or transport abort is not cancellation.
3. Successful preference writes synchronize Header, Settings and History consumers. Failed writes retain the last confirmed state; stale initial reads cannot overwrite newer writes. This corrects baseline B07 without changing controls or copy.
4. Publication ID/progress/cancel ownership survives route navigation/remount. Accepted cancellation is a request; only host completion ends ownership. A lost response does not imply cancellation. Hard reload still loses in-memory state; no durable browser storage or recovery endpoint is added.
5. Omit model-supplied Python Run and all arbitrary code execution. Preserve code display/copy/local editing/save, Markdown, math, diagrams, inline-data Vega/Vega-Lite, table export, writing/alerts/details and inert HTML/SVG Preview. Charts use the local Vega AST interpreter and rejecting resource loader. HTML previews are sanitized and sandboxed without script/form/navigation capabilities, with a restrictive per-document CSP. SVG previews retain their inline panzoom presentation after strict SVG sanitization; no scripts, events, foreignObject or external/resource URLs.
6. External Markdown anchors retain text/style but lose navigation destinations; only supported internal app routes may navigate. Untrusted content cannot trigger remote or arbitrary loopback media/resource loads. Apply the policy to every preview/diagram/export path, not only generic Markdown HTML.

These exceptions do not authorize visual drift for safe fixtures, a redesigned UI, new controls/copy, hidden functionality, remote assets or expanded product scope. Baseline source limitations (including unavailable PDF page highlights and ignored revision instructions) remain recorded in [existing defects](../../development/react-migration/existing-defects.md).

## Ownership and verification

[React contracts](../../development/react-migration/react-contracts.md) fixes exported interfaces, provider lifetimes, named component exports and exclusive ownership for shell, chat controller, assistant chrome/renderer, Library and History/Settings. Original client tests remain; add focused tests through shared controller interfaces for races/serialization and through rendered routes for parity. Frozen original-vs-React screenshots are compared under identical data, time, theme, viewport and browser. Safe and hostile rich-content probes verify no executable model content, navigation escape or resource request. Build/start success alone does not establish parity, release security or reference-machine performance.

## Consequences

React is the canonical frontend and the active Svelte application/runtime graph has been removed from the workspace. The [migration acceptance record](../../development/react-migration/acceptance.md) documents completed production, local-resource, interaction, and environment checks. Packaged desktop, physically disconnected operation, and reference-machine qualification remain separate product acceptance work. The shared runtime prevents screen unmounts from lying about active work, but cannot recover identity after a hard reload with the unchanged API. Existing product gaps remain follow-up work rather than being silently addressed by framework replacement.
