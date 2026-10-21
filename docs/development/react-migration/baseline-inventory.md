# React migration: original active UI inventory

Baseline: `4dc2a06a4fc57ff393ea43ef4b75014b1458eb9b`, inspected 2026-10-20. Product source was read only. This document inventories the running original, including defects; it does not approve additional product behavior. Requirements remain PRD and SDD §§4, 6–10, 13, plus the approved migration scope.

## Evidence and reproducibility

Actual routed Svelte screens were exercised with Playwright Chromium **151.0.7922.34**, executable `chromium-1234`, viewport 1440×1000, device scale 1, reduced motion. Workflow requests to `127.0.0.1:8765` were intercepted before transport and fulfilled with isolated deterministic wire-shaped fixtures. No requests reached the user's existing host. Remote requests were aborted; the tested normal chat/navigation fixtures recorded no remote requests. Rich content probes additionally exercised the page CSP. These behavior probes used real clock/UUIDs; frozen-clock screenshot references belong to the separate `migration-parity` harness, not these probes.

The inspected working directory was `/Users/evansinocchi/Desktop/Projects/Access-Denied-Secure-Local-LLM`; its HEAD was checked explicitly. Browser evidence used the actual `Chat.svelte` under the shared `desktop-shell`; it did not use `AnsweringView.svelte`. A valid answer schema was adapted from `fixtureAnsweringClient.ts`, preserving the request ID and full citation metadata. Fixtures demonstrate presentation and transport behavior, not model quality or backend validation.

Legend: **Observed** means exercised in the real routed browser with isolated host state. **Source** means reachable implementation traced but the action/outcome has not independently been exercised here. See `existing-defects.md` for baseline exceptions. The capture harness supplies visual state evidence across both themes and sizes.

## Active route and navigation map

| Surface | Actual implementation and host operations | Observed direct/reload/navigation behavior |
| --- | --- | --- |
| `/` | Thin route → native Open WebUI `Chat.svelte`; answering adapter → `answering.ask` then best-effort `history.save` | Direct load works, same empty chat as `/qa`. Sending a question leaves URL `/`. New Chat link clears active conversation. |
| `/qa` | Same native Chat component; not fixture `AnsweringView` | Direct load works. Suggestions, composer, answers, source panel, edits, regeneration and branches are reachable. URL remains `/qa` during temporary chat. Reload clears current messages and a typed draft. Leaving for History and returning via Back produces a new empty chat; Forward returns History. |
| `/c/:id` | `Chat chatIdProp`; upstream `getChatById`, not `history.open` | `/c/baseline-session` attempts `/api/v1/chats/baseline-session`, receives Vite HTML instead of JSON, logs parse error and redirects `/`. Reload after redirect is a normal root chat. No supported native persistent-chat restore was observed. |
| `/library` | Thin route → `LibraryView`; `library.versions/review/publish/status/cancel/rollback` | Direct load works; local file selection/review/publication state belongs to mounted view and is discarded on navigation/reload. |
| `/history` | Thin route → `HistoryView`; `history.list/enabled/open/delete/clear/set_enabled` | Direct load works. Opens saved answer in place, not `/c/:id`; selected answer and expanded details are mount-local. |
| `/settings` | Thin route → `SettingsView`; `settings.get/update`, `history.enabled/set_enabled`, health | Direct load works. Preferences persist through host; readiness is fetched. Header and Settings issue independent health reads. |

Layout mounts on all routes: native Sidebar, health/status header, general-knowledge switch, Refresh. Mount reads `/health` then `settings.get`. There is no upstream session/socket bootstrap. Sidebar `localMode` skips upstream chat lists and renders New Chat, Library, History, Settings. New Chat always targets `/`; same-root link activation resets Chat through page subscription. Desktop collapse is persisted in `localStorage.sidebar`; mobile uses overlay and closes after navigation (390×844 Open sidebar → Library observed; Close Sidebar becomes Open Sidebar). Theme is read from `localStorage.theme` (`light`, `dark`, `system`) and system media query; no product theme picker is exposed. Mobile breakpoint is 768px; feature page padding breakpoint is 700px.

## Exposed chat actions

| Action | Baseline result / state ownership | Evidence |
| --- | --- | --- |
| Three suggestions | Clicking submits the partial prompt immediately, e.g. `Summarize the key points of`; it does not merely prefill. Suggestion order is shuffled on fresh initialization. | Observed |
| Composer | Editable `div#chat-input` with accessible label; empty send is disabled. Enter submits; Shift+Enter inserts newline. Rendered send button has no accessible name. | Observed |
| Multi-turn send | Each local request carries only latest user content plus `general_knowledge`; prior turns are visible in UI but are not sent as conversation context to the QA workflow. | Observed wire requests + source |
| In-flight second send / Stop | Delayed first answer exposes Stop. Enter with second question adds visible queued item (Send now/Edit/Delete), then it runs after the first answer. Stop immediately removes loading UI but original result still arrives and saves; no local cancellation operation is sent. | Observed delayed wire fixtures |
| Queue Edit/Delete | Edit removes queued item and restores its text into composer; Delete removes queued item without sending it. Both observed during delayed first request. | Observed |
| Queued Send now | Clicking Send now starts the second local request before the first settles (809ms apart in3500ms delayed fixture), despite absent cancellation. This violates frontend serialization; React must serialize requests. | Observed request timeline; safety exception |
| IME composition | Simulated compositionstart + Japanese text + composing Enter (`keyCode229`, `isComposing:true`) sends nothing; compositionend then ordinary Enter sends exactly one Japanese question. This verifies browser event handling, not an installed OS IME. | Observed event simulation |
| User Copy | Copies user question exactly; clipboard was `safe action probe`. | Observed clipboard |
| Assistant Copy | Copies Markdown content including semantic headings and `[^S1]`; source metadata is separate. | Observed clipboard |
| Chat actions → Copy | Only visible chat-menu action in local temporary mode; copies active conversation text with `### USER` / `### ASSISTANT` and answer Markdown. | Observed clipboard |
| User Edit | Opens textarea with Save, Cancel, Send. Send creates sibling user branch, sends edited question and saves new returned answer; navigation shows `2/2`. Cancel discards textarea changes. Save updates user display without another QA request. | Observed |
| Assistant Edit | Opens textarea with Save As Copy, Cancel, Save. Save changes active display content without calling workflow/history; original stored answer remains unchanged. Save As Copy creates a new assistant sibling containing the user-edited display text, without QA/history calls. | Save and Save As Copy observed |
| Regenerate | Menu: Suggest a change input/Submit suggestion, Try Again, Add Details, More Concise. Regeneration makes sibling assistant response. Add Details still sends original question without revision instruction. | Observed Try Again, Add Details, More Concise, custom suggestion and wire payload |
| Branch navigation | Previous/Next assistant response switches `1/2`↔`2/2`. User edit also yields sibling user branch. Double-click numeric index opens number input; entering1 and Enter returns original assistant branch. | Previous/Next and numeric index observed |
| Delete response | Exposed after creating response siblings; dialog asks Delete message? Cancel preserves4/4; Confirm removes current sibling and shows3/3. User-message deletion is permission-hidden. | Observed Cancel and Confirm |
| Model picker | Shows the single seeded Document Assistant. Empty-chat picker exposes Set as default; selected local model remains the only choice. | Observed |
| Model info | Empty-view OI button is `aria-hidden=true` for one model; clicking selects the already-selected model index and leaves UI unchanged. No model-info dialog exists on this local path. | Observed click/no-op |
| New Chat link | Clears current temporary session and returns `/`. Existing saved individual answers remain in History. | Observed |
| Advertised `⌘⇧O` | Shortcut hint is visible, but pressing it after an answer leaves the conversation intact. The active root layout does not mount the upstream global shortcut dispatcher. | Observed; defect |
| Scroll to bottom | After scrolling a long response to top, click smoothly returns messages container to its maximum scrollTop (1385 of1386px). | Observed endpoint |
| Disabled workflows | Attachment input menu is CSS-hidden; uploads, web search, tools, channels, notes, account, calls, dictation, TTS, continue response and chat import/export are feature/permission-hidden. | Browser exposed controls + layout source |

Typing `/status` then Enter exposed the native status panel; `/model` exposed the single-model picker. Slash suggestions can consume Enter before a raw command is submitted: `/compact` and `/fork` probes left composer text/suggestion UI rather than demonstrating completed actions. Source `submitHandler` separately recognizes `/status`, `/model [id]`, `/compact` and `/fork`; compaction is disabled and fork is permission-denied. Those latter handlers are source-traced, not verified command outcomes. Do not infer that the vendored slash-command catalog is supported.

## Reachable answer and rich-content formats

The workflow formatter turns structured answers into Markdown: status blockquotes, `### From your documents`, claims plus superscript references, labeled general knowledge and its italic notice, `### Limits and uncertainty`, bullet limitations, warning blockquote. It does not expose timing/model/collection metadata in the native chat answer. Citation records are translated to native Open WebUI source metadata separately.

The following were injected through a valid answer field and observed on `/qa`, not through fixture-only component mounting:

| Format | Observed rendering and interactions |
| --- | --- |
| Headings, paragraphs, emphasis/strong/strike, inline code, blockquote, rule | Native Markdown rendering. |
| Unordered/ordered/task lists | Native list rendering with task checkboxes. |
| GFM table | Real table; Copy returns raw Markdown, Export downloads BOM-prefixed quoted CSV with correct header/row data. Both controls exercised. |
| Fenced Python/JSON | CodeMirror editor with line numbers; Collapse, Copy and Save controls. Python additionally exposes Run despite intended disabled execution. |
| Code edit/Copy/Save | Editor changes from `print("baseline")` to `print("edited")`; Copy clipboard equals edited string; Save shows Saved and retains edited editor text, with no new workflow or persistence request. Save is not a download. |
| Mermaid fence | Locally rendered SVG diagram with diagram controls; no remote request recorded. Shared chart/diagram Copy, Download as SVG and Reset view were exercised on a Vega-Lite SVG: copied original spec, downloaded diagram.svg, and reset zoom transform to identity after paint. |
| Inline/block math | KaTeX DOM present (two rendered math expressions in probe). |
| Markdown local/HTTPS links | Local `/library` and external `https://example.invalid` remain anchors; external was not opened. `javascript:` link has its href removed. Same-origin links can navigate the SPA. |
| Remote Markdown image | Displays `Image unavailable` under `img-src 'self' data: blob:`. |
| HTML iframe | An iframe node is reachable but CSP `frame-src 'none'` blocks it, leaving broken embedded-content area. |
| `<script>` and simple raw `<details>` | Probe displayed literal text; script did not execute and no native details element was created for that raw one-line payload. Native extended details token syntax must not be assumed equivalent to arbitrary HTML. |
| Vega / Vega-Lite | Both fenced formats rendered real SVG charts from inline data (`svg.marks` count2). Renderer loader rejects external resource loads; no outbound request recorded. Preserve safe local chart rendering. |
| Colon fences / alerts | `:::writing{subject="Baseline note"}` renders labeled bordered panel with Copy; GFM warning blockquote renders amber WARNING alert. |
| Multiline details | `<details>\n<summary>…</summary>\n…</details>` renders native custom collapsible control; clicking expands bold detail body. This differs from literal one-line raw HTML. |
| HTML/SVG fence preview | Preview controls open the artifact pane; inert HTML renders visibly in a `srcdoc` frame. No scripts/media were used. Preview sandbox lifecycle can log origin-access errors. See report for separate-format checks and safety boundary. |
| Other vendored renderers | Audio/video and structured tool output remain unqualified. Valid string fields make renderer formats reachable; preservation decisions must use the observed contract, not package presence alone. |

**Unsafe Run exception:** a Python fence containing `print("baseline")` exposes Run. Clicking it attempts code runtime initialization and displays `STDOUT/STDERR` → `loadPyodide is not defined` on this baseline. The layout disables `enable_code_interpreter` but does not set `enable_code_execution`; CodeBlock defaults that feature to true. React must not execute model-supplied code. This is a narrow safety exception to visual/action parity, not a request to implement execution.

### Citations and sources

Observed sequence: answer shows a plain superscript `S1`; `Toggle 1 source` expands a source chip titled `QA Reference Guide · p. 2`; `View source: …` opens a modal showing title, Content, `(page 2)` and the supporting quote; Escape/Close citation modal closes it. The superscript is inert footnote text, not a link to that source. The adapter supplies quote/page metadata but no `file_id`, PDF URL, highlight rectangles or source-page render operation. Consequently on-demand PDF rendering, first-page hyperlink and passage highlighting are absent on this active route. History uses independent native `<details>` with quote and page range, not this modal.

## Library, History and Settings

| Workflow | Exposed actions / state transitions | Browser/source evidence |
| --- | --- | --- |
| Library | Choose multiple PDFs; selected count/names; Review selected files; accepted name/size and rejection reason/warning; confirmation checkbox enables publication of accepted remainder; Publish; status polling every 700ms; elapsed seconds; Cancel; Restart after failure; Refresh versions; rollback with previous version. | File select/review/unchecked+checked confirmation/progress/cancel exercised with isolated wire fixtures. Success/failure/rollback visual coverage is captured by the parity harness. Source confirms corresponding client operations. |
| History | Refresh; persistence switch; saved records with title/time/model/collection; open record in place; expand Sources quote details; row Delete; Clear all with native browser confirm; selected record clears after deletion. | Browser workflows exercised with isolated records; source confirms no single-delete confirm and no loading indicator/busy state. |
| Settings | General knowledge default; history persistence; Refresh status. Successful changes show notice; header switch uses shared store for new questions. Readiness describes model and document count. | Browser toggles/readiness observed. Settings owns a separate local checkbox value: header changes while Settings remains mounted leave its checkbox stale; observed header/Settings/history values were `[true,false,true]`. |

Library review sets `busy=true`, so its generic busy panel is labeled **Publication in progress** even while reviewing, with Cancel disabled until publication has a request ID. Accepted review rows contain name/size, not page counts. History/Settings have no separate loading layout or disabled busy state; before reads finish they show defaults/empty content. Errors are local strings and often persist through later successful Refresh. Neither Library nor History selections/expanded source state are URL-addressable.

## State and dependency boundaries

- **Host-owned:** collections, published version, model readiness, persisted general-knowledge default, history enabled flag, saved individual answer payloads. Operations use versioned `/v1/requests` envelopes and `/health`; no backend changes are needed for React parity.
- **Chat-owned:** message graph/current branch, draft input, active model selection, sources expansion/modal, queue, editor contents and local presentation edits. Temporary conversation graph is not persisted by native Open WebUI APIs; each returned answer is separately saved best-effort using its request ID.
- **Shell/browser-owned:** theme/localStorage, collapsed sidebar/localStorage, viewport/mobile store, i18n context. Mount seeds `local-user`, one model, temporary-enforced permissions, disabled feature arrays. No auth/session/API discovery.
- **Product clients:** answering validates loopback destination, response envelope and Ajv answer schema; other feature clients share `workflowTransport.ts`, checking request/operation/result envelope but relying on typed result casts. No React component should own retrieval/citation validation/publication rules.
- **Active frontend chain:** Svelte 5 + SvelteKit 2 + Vite 5/static adapter; Svelte stores/context/navigation; Tailwind 4 and personality CSS; bits-ui/floating-ui/tippy; i18next; native Chat/Sidebar/MessageInput/Messages; TipTap/ProseMirror composer; marked + DOMPurify; CodeMirror + highlight.js; KaTeX; Mermaid/SVG pan-zoom; Ajv; uuid; clipboard/file-saver utilities. `package-lock.json` freezes the actual graph. Vendored imports may pull broad upstream helpers even when their UI is permission-hidden.
- **Not established as active product requirements:** Azure auth, Hugging Face/MediaPipe, Kokoro, PyScript/Pyodide execution, remote/provider integrations, terminals, web tools, collaborative editors, upstream persistent chat endpoints. Package presence is not permission to preserve unsafe or dead behavior.
- **Assets and geometry:** local `Inter-Variable.ttf` and `Vazirmatn-Variable.ttf` declarations, UI Inter stack, code monospace; bundled icons and Open WebUI branding notices. CSS tokens use warm paper `#f5f4ef`, surface `#fffefa`, evergreen `#245c48`; dark paper `#191e1b`, surface `#202723`, accent `#8cc2a4`. Feature page max width 46rem; panel radius 12px, control radius 8px; desktop sidebar about 244px; status bar minimum 48px. Exact computed styles/fonts/assets and screenshot geometries are owned by parity captures. Branding/license notices remain a separate migration obligation.

## Coverage boundaries

This inventory distinguishes actual observations from source tracing. It does not certify unexercised vendored capabilities or model-generated content. The immutable original screenshot matrix and its visual state adapter must remain the reference through migration; this document must not be used to invent unreachable loading/PDF/cancellation screens. Existing unsupported/broken behavior is recorded separately so later parity failures can be classified explicitly.

## Approved narrow safety exceptions for React

The original reference captures must retain original controls and link destinations without masking them. The migration deliberately differs only at these safety boundaries: omit Python/model-supplied execution; omit cosmetic Stop and overlapping Send now dispatch; preserve ordinary queue ordering and safe Edit/Delete; strip navigation destinations from external Markdown links while retaining visible text/style; retain navigation for supported internal routes. Do not add an answering cancellation API. These are primary-agent rulings under the approved offline/one-job scope, not hidden visual baseline changes.

## Renderer evidence addendum

Concrete answer payloads, screenshots and source pointers for Vega/Vega-Lite, colon writing/alert/details and isolated HTML/SVG previews are saved in [renderer-evidence/README.md](renderer-evidence/README.md). SVG-only Preview renders a green circle in a sanitized SVG artifact pane with no iframe. HTML-only Preview visibly renders inert bold HTML in `srcdoc`; observed sandbox includes `allow-scripts allow-downloads allow-forms` and lacks same-origin. No script execution probe was run. The generic Markdown HTML sanitizer and SVG sanitizer do not establish that the separate HTML artifact path is safe for model-supplied scripts; preserve inert presentation under the approved no-execution boundary.
