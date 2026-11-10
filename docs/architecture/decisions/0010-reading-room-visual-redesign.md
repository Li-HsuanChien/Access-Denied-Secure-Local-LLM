# ADR 0010: Reading-room visual redesign replaces Open WebUI presentation parity

- **Status:** Accepted, 2026-11-10.
- **Partially supersedes:** the visual presentation-parity clause of [ADR 0004](0004-react-frontend-parity.md) (preserving the observed Open WebUI interface and "no redesigned UI" in its rulings). ADR 0004's React framework, provider/coordinator, safety and rich-renderer rulings remain in effect. [ADR 0003](0003-research-workspace-personality.md) still applies: its evidence-led voice is carried forward with new tokens.
- **Scope:** Frontend presentation only. No PRD product scope, Python host operation, wire schema, storage, model workflow or desktop platform change.

## Context

The React frontend preserved the pinned Open WebUI v0.11.4 presentation, which is generic chat styling that does not show where information comes from. A standalone, review-only prototype ("reading room") was built at `app/document-qa/frontend/prototypes/ui-revamp/` and reviewed. Its README describes the design direction and walkthrough, and has a table separating what is real in production today from what the prototype simulates. The user approved adopting the design on the existing host contracts.

## Decision

Replace the Open WebUI-parity presentation with the reading-room design system. Port the prototype's code into the production feature folders; production code never imports from `prototypes/`, and the prototype stays in place unchanged for reference.

- **Tokens and purpose colors.** The `personality` feature holds light and dark tokens: warm paper surfaces and ink text, plus three colors that each mean one thing. Evergreen marks document-backed answers, primary actions and citations. Indigo marks general knowledge. Saffron marks the original source, as the quote rule and PDF highlight. Colour never carries meaning alone. The legacy `--workspace-*` alias tokens and the `.workspace-page`/`.workspace-switch` styles were removed once nothing used them.
- **Typography.** Bundled Inter for the interface. Headings and original source quotes use the system serif, so quotes read as printed source text, apart from the assistant's own words. No remote fonts.
- **Shared UI kit.** `src/lib/features/design-system/react/` holds the primitives, overlays (popover, dialog, confirm dialog, menu), toasts and icons. Its overlays follow WAI-ARIA focus, Escape and inert behavior.
- **Shell and surfaces.** The shell has a date-grouped sidebar with Search chats, Library and Settings, a top bar with a readiness pill and popover, and a drawer below 860px. Cited PDFs open in a document viewer slot: a side panel at 1180px and wider, a full-screen dialog below that.

Behaviour decisions bound to existing contracts:

1. **Answer progress.** The host returns one result per question. The UI shows one honest pending status ("Working on your answer…") and no invented searching, reading or writing phases. There is no Stop button, because the frontend contract has no answer cancellation.
2. **Publication progress.** The Library shows exactly the progress, status and cancel behavior the existing Library coordinator supports. It adds no phases or capabilities.
3. **History search.** Search chats filters client-side over data the History interface already returns (titles, plus any loaded content). There is no new host operation.
4. **Theme.** Follows `prefers-color-scheme` by default. A System/Light/Dark choice in Settings uses the app's existing `localStorage.theme` frontend preference, falling back to memory when storage fails. It is a presentation preference only; no host setting or new storage layer is added.

## Open WebUI branding obligation

The frontend is distributed under the Open WebUI License, which prohibits altering, removing, obscuring or replacing Open WebUI branding. The redesign meets this as follows:

- A visible "Built on Open WebUI" credit with the Open WebUI logo (`static/favicon.png`) appears in the sidebar footer and on the Settings/About surface, using one shared `OpenWebUiCredit` component.
- `LICENSE`, `LICENSE_HISTORY`, `LICENSE_NOTICE`, `UPSTREAM.md`, `static/BRANDING.md` and the Open WebUI branding assets are not modified, moved or deleted.
- Provenance for translated components and assets is preserved as before.

## Consequences

- The UI no longer matches the frozen Open WebUI screenshots. Those screenshots and the [migration acceptance record](../../development/react-migration/acceptance.md) remain historical evidence of the React migration. They are not acceptance criteria for the new design. Tests assert the new markup and copy while keeping every behavioral, security and accessibility check.
- Some Open WebUI shell features were removed: swipe-to-open, the draggable sidebar width and the collapsed icon rail. The drawer breakpoint moved from 768px to 860px.
- New provider hooks `useHealth()` and `useDocumentViewer()` and the `health`/`documentViewer` `AppRuntime` fields support the shell and viewer. They read only existing host routes.
- Product invariants are unchanged: one answer with one basis label, the quote-first citation pop-up with the PDF loaded only on Show document page, hardened pdf.js without iframes, sanitized rich rendering, one question at a time, temporary-chat privacy, Library review and confirmation, offline and loopback only, and the accessibility requirements in SDD §7.4.
- Risk: the reading-room look replaces the Open WebUI visual identity while keeping its name and logo visible. If the license owner reads the clause as covering the whole visual presentation, the credit's placement or the design must be revisited.
- Real answer-progress events, real publication phases and host-side full-text history search remain possible future work. Each needs a host contract change and its own decision.
