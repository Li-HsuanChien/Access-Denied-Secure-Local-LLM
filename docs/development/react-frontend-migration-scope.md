# React frontend migration: parity execution plan

Plan approved: 2026-10-20. Execution completed: 2026-10-21. See the [acceptance record](react-migration/acceptance.md) for results, evidence, and remaining product limitations. The execution instructions and historical assessment below are retained as the approved plan.

## Binding acceptance criteria

Replace the supported frontend with React while preserving current functionality and appearance. No redesign, changed copy, new controls, or backend feature expansion. React owns every shipped screen; Svelte/SvelteKit is absent from shipped application source and the final build/runtime dependency graph.

This execution plan supersedes conflicting recommendations and estimates in the earlier assessment retained below. In particular, do not improve response presentation or unify the appearance of Chat and History. Shared renderer internals require variants that preserve each existing layout. The running application defines visual parity; PRD/SDD workflow and security invariants remain authoritative. Record pre-existing bugs/gaps separately rather than silently expanding scope or reproducing unsafe behavior.

## Staffing and coordination

Counts exclude the primary agent, who coordinates and integrates. There are **15 subagent assignments across eight sequential steps**, with a **peak of five simultaneous subagents plus the primary agent**. Reuse agents for follow-up work where appropriate. Implementation assignments include focused behavior tests. Review assignments are read-only; findings return to implementation owners.

Model allocation follows task complexity: Luna/Terra perform well-specified conversion, capture, configuration and cleanup; Sol/Astra own discovery, architectural decisions, complex interaction/state logic and acceptance judgment. Mechanical assignments consume a specification from the primary agent or a preceding analysis assignment and escalate ambiguity instead of deciding product behavior. Terra is not currently exposed in the callable subagent model list. Its exact model ID and supported effort must be verified before dispatch; do not invent an ID or silently substitute another model. Terra effort selections below are provisional until supported settings are known.

The primary agent assigns exclusive file ownership and controls shared manifests/lockfiles, routing and provider changes. No two concurrent agents edit the same file. Preserve existing uncommitted work, including start.sh. Use an isolated branch/worktree if available; otherwise use permitted staging and a recoverable baseline without discarding changes or bypassing git restrictions.

## 1. Capture the actual baseline

**2 subagents, parallel.**

| Subtask | Model | Effort |
| --- | --- | --- |
| 1A. Active-route, action, state and dependency inventory | gpt-6.1-sol | high |
| 1B. Capture fixtures/screenshots and implement the visual harness from the primary agent's specified matrix | gpt-6-luna | medium |

- Inventory `/`, `/qa`, `/c/:id`, Library, History and Settings, including direct navigation, reload, back/forward and broken/unsupported cases.
- Verify every exposed action, including composer shortcuts, suggestions, new chat, copy, editing, regeneration, branch navigation and menus. Do not infer support or exclusion from vendored source alone.
- Inventory reachable Markdown/rich-content formats and citation/source interactions.
- Capture light/dark, sidebar expanded/collapsed, desktop/narrow layouts, hover/focus/tooltips, empty/loading/error/success, long content and expanded sources. Record fonts, assets, geometry and computed styles.
- Use disposable QA data and actual routed screens. Existing AnsweringView tests exercise a fixture view rather than routed Open WebUI Chat.

**Gate:** checked route/action/state inventory, reproducible original screenshots and a separate existing-defect list. Preserve the original reference throughout migration.

## 2. Establish React foundation and contracts

**2 subagents, parallel after Step 1, with separate ownership.**

| Subtask | Model | Effort |
| --- | --- | --- |
| 2A. Scaffold React/TypeScript/Vite, route placeholders and test/build configuration from agreed contracts | gpt-6-luna | medium |
| 2B. Shared state/client/component contracts and architecture documentation | gpt-6-astra | high |

- Keep the existing Python host, loopback API, wire schemas and storage. Reuse TypeScript clients and schema checks.
- Define session/message/source contracts, preference synchronization and lifecycle behavior before parallel component work. Replace Svelte stores with React state/providers.
- 2B and the primary agent decide dependency versions, routing, content policy and state contracts. 2A implements those decisions; dependent configuration follows those decisions rather than being guessed in parallel.
- Preserve local fonts, SVGs, CSS/tokens and assets. Translate Svelte-scoped rules without changing specificity or leaking styles.
- Verify package/runtime compatibility against official documentation before pinning versions. Avoid visual-library defaults that change the baseline.
- Draft a superseding ADR and update SDD/app/frontend contributor instructions in the implementation change set. Preserve historical ADRs; framework replacement does not require new PRD scope.

**Gate:** React starts locally and builds static assets, retained client tests pass, interfaces and file ownership are fixed, and the original remains available for comparison.

## 3. Port all active screens

**5 subagents, parallel after Step 2.**

| Subtask and ownership | Model | Effort |
| --- | --- | --- |
| 3A. Faithful shell/sidebar markup and CSS conversion using specified navigation/theme/provider contracts | Terra (requested; callable ID unavailable) | Medium requested; verify support |
| 3B. Chat controller/composer, session state, message actions, focus/scroll and history-save integration | gpt-6.1-sol | xhigh |
| 3C. Response Markdown, message chrome, citations/source panels and rendering tests | gpt-6.1-sol | xhigh |
| 3D. Library markup/style conversion and existing client wiring against specified publication/poll/cancel lifecycle | gpt-6-luna | high |
| 3E. History and Settings, including current saved-answer appearance, persistence and preferences | gpt-6-luna | high |

- Match markup structure, layout, copy, icons, typography, spacing, borders, colors, animations, tooltips and breakpoints.
- Preserve current supported behavior across navigation, keyboard/IME interactions, accessibility labels, announcements and focus.
- Keep workflow decisions in Python and library-specific presentation types out of persistent records.
- The primary agent and 2B define shell/provider and Library lifecycle behavior before 3A/3D execute. Sol owns cross-feature race/cancellation analysis in Step 4; mechanical port owners escalate unclear semantics rather than redesigning them.
- Chat and History may share internals but retain their distinct current presentation.
- Each owner implements focused tests and compares their screens with original fixtures/screenshots. Preserve provenance notices for reused materials.

**Gate:** all inventoried supported actions are implemented, focused tests pass, and preliminary visual comparisons identify only tracked integration issues.

## 4. Integrate complete workflows

**1 subagent plus primary-agent integration.**

| Subtask | Model | Effort |
| --- | --- | --- |
| 4A. Routes/providers, real-client integration, cross-feature lifecycle and routed tests | gpt-6.1-sol | xhigh |

- Exercise all four workflows against the deterministic Python host with controlled failure fixtures.
- Verify duplicate submission protection, late completions, navigation/remount, preference synchronization and current-session behavior.
- Preserve answers on history-save failure; open existing records without storage migration.
- Keep publication request identity and cancellation truthful. Unmounting or aborting a fetch is not backend cancellation.
- Match baseline routing, new-chat and reload behavior, including deliberate treatment of `/c/:id` without inventing resumable backend threads.

**Gate:** complete existing workflows function through the unchanged API, with no data loss or new backend capability.

## 5. Verify behavior and appearance independently

**2 subagents, parallel.**

| Subtask | Model | Effort |
| --- | --- | --- |
| 5A. Behavior, persistence, accessibility, untrusted rendering and offline verification | gpt-6-astra | high |
| 5B. Original-versus-React visual comparisons and interaction-state review | gpt-6.1-sol | high |

- Use identical fixtures, browser version, viewport, device scale, theme and fonts. Freeze clocks/IDs and settle animations for screenshots; check motion/scroll/focus separately.
- Mask only identified nondeterministic content. Never mask a changed interface region or regenerate original baselines to conceal drift.
- Require no unexplained visual differences. Only narrowly documented rasterization noise may be tolerated; layout, typography, color, copy and icon differences fail.
- Run retained transport/schema tests, routed React/host tests, full type checking and production build.
- Verify hostile document/model text cannot execute code or fetch remote assets; assets work disconnected and requests/listeners remain local.
- Return failures to owners and repeat affected checks. Compare representative long-content behavior without claiming full hardware qualification.

**Gate:** no unresolved functional regressions or visual changes.

## 6. Remove Svelte and cut over startup/build paths

**2 subagents, parallel with exclusive ownership.**

| Subtask | Model | Effort |
| --- | --- | --- |
| 6A. Execute reviewed source/dependency/configuration removal list and regenerate lockfile/build | Terra (requested; callable ID unavailable) | Medium requested; verify support |
| 6B. Apply specified launcher changes, command/documentation updates and provenance retention | gpt-6-luna | medium |

- Remove all shipped Svelte components/stores and SvelteKit build/runtime dependencies, obsolete tests and unused upstream assets. Keep CSS/assets still needed for parity.
- The primary agent/Sol determine the safe removal list, launcher upgrade behavior and notice-retention requirements before 6A/6B execute. These assignments apply and verify a concrete specification, not make dependency or attribution decisions independently.
- Preserve supported commands such as `dev:qa` and loopback ports. Fix stale dependency detection: the launcher currently skips install whenever node_modules exists.
- Verify clean installation and upgrade from an existing checkout. Preserve unrelated edits, especially start.sh.
- Retain applicable notices for reused code/assets; replacing components does not automatically eliminate attribution obligations.
- Test the final static build and direct-route refresh, then repeat necessary offline and visual smoke checks after cleanup.

**Gate:** documented commands run React on fresh and existing checkouts; the shipped graph has no Svelte and visual parity still holds.

## 7. Independent final review

**1 subagent, read-only, independent of main implementation.**

| Subtask | Model | Effort |
| --- | --- | --- |
| 7A. Complete-diff, original-baseline, parity-evidence and architecture review | gpt-6-astra | xhigh |

Challenge missing actions, untested states, concealed visual changes, leftover framework dependencies and unsupported completion claims. Resolve parity/security findings with their implementation owners. Smoke-test the real local model if weights and a published collection are available; clearly distinguish deterministic evidence from real-model evidence.

**Gate:** findings resolved and necessary checks pass. Missing required evidence must be disclosed rather than reported as full acceptance.

## 8. Handoff

**0 subagents. Primary agent owns final acceptance and delivery.**

Deliver the migrated source, updated developer/architecture docs, relevant tests, comparison evidence and launch instructions. Report checks run and any pre-existing limitations. Leave a reviewable change set without implying a commit, merge, deployment or desktop release occurred.

## Boundaries and scheduling

No redesign, new answer presentation, streaming, live answering stages, model-reasoning UI, new answer cancellation, multi-turn context, durable conversation threading, source-page API, or Tauri/release implementation. Source-page rendering and packaged desktop acceptance remain existing product gaps outside this migration.

Do not select a new UI component library simply because React makes it available. Future customization begins after parity acceptance.

The dependency order is 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8. Baseline capture, integration and verification cannot be removed by increasing parallelism. Earlier estimates assumed looser visual reuse and are superseded; refine effort after Step 1 inventories the actual reachable chat actions and renderer complexity.

---

## Earlier assessment (historical; superseded wherever it conflicts with the plan above)

Date: 2026-10-20

Status: planning scope. The user selected React as the preferred direction; this document does not change the currently implemented architecture. Update the SDD and add a superseding ADR with the implementation.

## Outcome

Replace the Open WebUI/Svelte frontend with a product-owned React interface for Chat, Library, History, and Settings. Enable React component libraries and custom answer presentation while preserving the existing Python workflow authority, structured answers, local persistence, and offline operation.

This is a replacement of the supported frontend workflows, not a translation of all vendored Open WebUI source. Completion means React owns the production interface and Svelte is no longer a runtime or build dependency.

## Evidence and current boundaries

- `frontend/UPSTREAM.md` records Open WebUI v0.11.4 and the local integration. There are 627 Svelte source files and no JSX/TSX source files; many upstream features are inactive.
- `/`, `/qa`, and `/c/[id]` mount upstream `Chat.svelte`. The root layout initializes local Svelte stores, navigation, readiness, and preferences.
- `Chat.svelte` sends only the latest question and general-knowledge preference through `createOpenWebUIAnsweringAdapter`. It converts the completed answer to Markdown and Open WebUI citation objects.
- Answering, Library, History, and Settings clients are framework-independent TypeScript. `preferencesStore.ts` is Svelte-specific and must be replaced.
- The backend-owned answer schema includes evidence, page coordinates, model metadata, collection version, and timings that the current frontend `Answer` type does not fully describe. Align frontend types with that schema without changing the wire format.
- `AnsweringView.test.js` exercises a separate feature fixture, not the routed Open WebUI Chat. New UI tests must exercise the shipped React components.
- `backend/dev_host.py` currently uses `ThreadingHTTPServer`. The SDD describes a future FastAPI/Open WebUI host; replacing or productionizing the host is not required for this frontend migration.
- `app/desktop/` and release assembly are scaffolds. This migration can produce a static frontend suitable for future Tauri integration, but cannot certify a packaged desktop product.
- `launch.py` starts `npm run dev:qa` and currently skips dependency installation whenever `node_modules` exists. The migration needs a reliable stale-dependency check or an explicit reinstall path.

Repository paths above are relative to `app/document-qa/` unless qualified otherwise. Counts are inspection snapshots, not ongoing requirements.

## Proposed architecture

Use React, TypeScript, and Vite for a client-rendered static application in the existing `app/document-qa/frontend/` workspace. Keep product code under `src/lib/features/<feature>/`; add thin application entry, route, provider, and shell modules. Keep the same loopback host and versioned operations.

- React owns routes, the shell, local interaction state, and rendering.
- Existing clients own HTTP requests and response validation. Preserve destination restrictions, omitted credentials, redirect rejection, and request IDs.
- Python owns retrieval, generation, citation validation, publication, and persistence decisions.
- Render the validated structured answer directly. Share one answer renderer between Chat and History.
- Keep a small presentation boundary between domain data and any chosen React chat library. Library-specific message types must not become persistent records or backend contracts.
- Use existing design tokens, presentation copy, and locally bundled assets where appropriate. Consolidate styling and avoid retaining the full upstream stylesheet/component graph.
- Start with simple React state/context for preferences and session state. Select additional state, routing, component, Markdown, and animation packages based on actual requirements and the user's intended libraries.
- Bundle assets locally. No browser API keys, remote fonts, telemetry, runtime downloads, or direct browser-to-model requests.

## Base migration scope

| Workstream | Deliverables | Completion check |
| --- | --- | --- |
| Foundation | React/TS/Vite entry, route handling, providers, static build, full frontend type checking, loopback dev/preview, test setup | Dev server and static preview load all supported routes; `/qa` remains usable |
| Application shell | Sidebar, Chat/Library/History/Settings destinations, readiness, theme behavior, responsive layout, keyboard focus | Navigation works by mouse and keyboard; unavailable host/model states are actionable |
| Chat | Composer, current-session transcript, new chat, pending state, safe retry, scrolling, answer rendering, history-save feedback | One question in flight; Enter submits, Shift+Enter inserts a line, IME composition does not submit; failures retain the question |
| Structured answers | Document claims and citations, general knowledge label, limitations, warnings, failed/insufficient states, expandable source passages | Citation references resolve to the validated payload; general knowledge is never presented as document evidence |
| Library | Multi-PDF review, rejection reasons, accepted-remainder confirmation, publication progress, cancel/restart, versions, rollback | Existing workflow invariants hold through the actual React screen |
| History | List/open/delete/clear saved records, persistence preference, model/collection metadata, shared answer renderer | Existing saved records remain readable; disabling persistence stops new saves; save failure preserves the current answer |
| Settings | Persisted general-knowledge preference, shared persistence setting, readiness | Shell and Chat reflect successful setting changes consistently |
| Cutover | Remove Svelte and unused upstream components/dependencies, update launcher/setup/docs, retain applicable attribution | Existing run commands work with a clean install and an existing checkout; no inactive upstream API calls remain |

Include useful basic interactions such as copying answer text and retrying a failed request. Do not promise upstream branching, editing, voice, exports, tools, or model management merely because source files exist for them. Inventory currently usable actions at the start of implementation and record explicit treatment for each.

Session state should survive navigation among application views during the current run. This does not imply durable conversation threads or that previous turns are supplied to the model. Handle `/c/:id` deliberately: resolve only supported session identifiers or redirect with clear behavior; do not call removed upstream chat endpoints.

If Library publication continues after navigating away, maintain its request ID and status outside the page component so progress and cancellation remain reachable on return. A frontend unmount or aborted fetch must not be represented as backend cancellation.

## Separate enhancements and pre-existing gaps

| Capability | Current state | Additional scope |
| --- | --- | --- |
| Real answering stages | One completed HTTP result; no answering progress events | Emit request-scoped workflow stages and transport through polling or streaming; show only actual reported stages |
| Token streaming | Gateway supports streaming; QA runtime adapter explicitly requests `stream: false` | Extend runtime/workflow/host/client contracts and define how provisional output relates to citation validation and corrective generation |
| Model reasoning display | No reasoning field in the answering contract | Evaluate selected model/runtime output and define an optional, separate presentation contract; a UI library does not supply reasoning data |
| Answer cancellation | No supported answering cancellation operation | Cooperative runtime/workflow cancellation, cleanup, request identity, and lock-release behavior; hiding a response is insufficient |
| Multi-turn conversations | Current requests contain only the latest question; saved History records are individual answers | Conversation identity, context budgeting, retrieval semantics, persistence migration, and evaluation |
| Source-page images/highlighting | SDD requires them; current UI exposes source passages and the host has no source-page retrieval endpoint | Authorized local source-page access, collection-version handling, rendering/cache, coordinate overlays, and missing-source behavior |
| Packaged desktop | Tauri and release assembly are scaffolds | Lifecycle, packaging, desktop routing/CSP, and disconnected acceptance on all supported platforms |

Source-page viewing remains an existing SDD requirement. Deferring it from migration parity does not remove it from product acceptance. Likewise, replacing the frontend does not complete the unimplemented visual-answering path.

Autonomous agents, tools, web search, authentication, chat attachments, remote models, and a Node backend are outside this migration. Product-scope changes require corresponding PRD updates.

## Delivery sequence and rough effort

Estimates are focused engineering days for one developer familiar with the repository, including implementation and relevant tests. They are planning ranges, not measured commitments. They assume reuse of the current visual direction, no extensive design exploration, and no additional backend features.

| Phase | Work | Estimate |
| --- | --- | --- |
| 1 | Active-action inventory, architecture decision, React foundation, client/type reuse | 1–2 days |
| 2 | Shell and a complete Chat/answer/citation/history-save vertical slice | 2–3 days |
| 3 | Library, History, Settings, and state across navigation | 2–3 days |
| 4 | Actual-screen integration tests, accessibility/offline checks, dependency removal, launcher and documentation cutover | 2–3 days |
| Total | Base React replacement | 7–11 days |

Allow roughly 2–3 calendar weeks with review and integration buffer. Real answering-stage progress is a separate provisional 2–4 engineering days after its transport is agreed. Streaming, cancellation, reasoning, and durable conversations need their own scoped contracts before a credible estimate.

Develop on an isolated migration branch/checkpoint. Keep the existing frontend usable until the React Chat slice passes the public client/host checks. Temporary coexistence is a transition technique; do not retain two UI frameworks in the completed application. Use the previous Git revision for rollback rather than maintaining duplicate permanent frontends.

## Acceptance and verification

1. Clean installation, type checking, feature tests, static build, and static-preview route refresh succeed. Preserve documented command names where practical.
2. Test the routed React components and the shared answer renderer, not only a fixture-only view. Preserve reusable transport/schema tests and port meaningful Svelte behavior tests.
3. Run the deterministic host end to end: readiness, supported answer, insufficient evidence, degraded service, retry, settings, and history-save failure. Confirm existing stored answers still open.
4. Exercise Library review/publication, rejected-file confirmation, cancellation/restart, rollback, and navigation during publication through its public interface.
5. Check focus restoration, keyboard navigation, IME handling, status/error announcements, readable contrast, reduced motion, and narrow layouts.
6. Render adversarial document/model text safely. Do not execute HTML/scripts or load remote images/embeds from answer content. Link behavior must preserve the offline product boundary.
7. Verify the built frontend's application requests remain local, assets work disconnected, and dev/preview bind only to loopback. Broader packaged network-isolation certification remains a release task.
8. Record frontend build size and representative UI memory behavior before and after. Do not claim an 8 GB product qualification from frontend-only measurements; model and full-package qualification remain separate.
9. Smoke-test the real local model path when staged weights and a published collection are available. If unavailable, report that limit explicitly rather than treating deterministic fixtures as real-model evidence.

## Documentation and cleanup changes

- Add ADR 0004 selecting the React frontend, superseding the frontend portions of ADR 0001 and updating references from ADRs 0002/0003 without erasing their history.
- Update SDD frontend, HTTP-client, UI, testing, and packaging descriptions to distinguish implemented behavior from planned host/desktop work.
- Update frontend and app contributor instructions that currently require Svelte/Open WebUI, in the same implementation change set.
- Update repository/frontend READMEs, feature READMEs, launcher setup text/behavior, and development instructions.
- Update dependency lockfiles, remove Svelte build/test configuration, and retain license/provenance notices for any reused upstream code/assets. Do not assume replacing components automatically removes attribution obligations.
- PRD changes are unnecessary for framework replacement alone; update it if separately approved product behavior changes.

## Inputs to settle during implementation

- User's preferred React libraries and whether they supply visual primitives or impose a chat transport/state model.
- Desired visual redesign depth. The base estimate assumes reusing the current design direction while improving component structure and response presentation.
- Priority of live workflow stages versus source-page viewing after migration.

These choices do not block the architecture or workflow inventory. Before adding specific packages, verify their supported React/build versions, offline behavior, license, and transport assumptions against official documentation.
