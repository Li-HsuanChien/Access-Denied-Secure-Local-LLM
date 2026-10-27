# React migration Stage 1B: original capture report

## Result

Captured the original Svelte application at actual routed URLs and kept product source, package configuration, and lockfiles read-only. The harness intercepts every browser request to `127.0.0.1:8765` and fulfills the local workflow fixture itself; it never sends API traffic to the user's host or writes to that host's data. Non-app-origin browser requests are aborted. Vite-safe staging keeps screenshots and metadata outside the watched frontend until the browser closes.

Baseline: `4dc2a06a4fc57ff393ea43ef4b75014b1458eb9b`. Browser: Chromium `151.0.7922.34`, device scale 1, reduced motion, deterministic localStorage, monotonic fixed-epoch clock, seeded suggestion ordering and UUIDs. Viewports: 1440×1000 and 390×844. The test clock advances monotonically during interactions; it does not freeze timers.

The original matrix is copied into [BASELINE-MATRIX.md](../../../app/document-qa/frontend/migration-parity/BASELINE-MATRIX.md). Harness instructions and safety boundaries are in [migration-parity/README.md](../../../app/document-qa/frontend/migration-parity/README.md).

## Captured evidence

The accepted candidate currently contains 95 uniquely named screenshot states, each with JSON metadata for route, viewport, computed geometry/styles, scroll position and Chrome performance counters (`JSHeapUsedSize` and `Nodes` among them). The index includes a SHA-256 for every screenshot and the full browser-error/block list.

- Screenshot directory: [original/screenshots](../../../app/document-qa/frontend/migration-parity/original/screenshots/)
- Metadata directory: [original/metadata](../../../app/document-qa/frontend/migration-parity/original/metadata/)
- Capture index SHA-256: `560ed579f85718b5cc71f9569fd0eb6cde4d7ae92850ee38f1f75e581aa422b1`
- Independent fresh-context empty-state repeat SHA-256: `6b443db414b9e4478e263ebe29038b0cd30c499b2a82e77b1f87d82139b09659`; it matches the initial `chat-empty-light-1440` screenshot byte-for-byte. All 95 on-disk PNG hashes were checked against the index; names are unique.
- `blockedRequests`: 0.

Evidence includes empty chat in both themes at desktop and narrow widths; an expanded and collapsed sidebar; multiline draft with content verified before and after screenshot; suggestion hover/focus; answer, pending, source-expanded and citation-detail states; request, history-save and insufficient-evidence failures; rich Markdown at top/middle/bottom and a separate long response at top/bottom; library initial/selected/review/confirmation/progress/success/cancel/failure/rollback; history empty/pending/settled/list/open/source/persistence/delete/clear/failure; settings default/updated/persistence-off/degraded/error; and root plus `/c/baseline-session` routes. Every actual screenshot is in `original/screenshots`; the JSON records carry the matching digest.

Rich-format capture uses a schema-valid response injected through the real `answering.ask` route. The visible samples include semantic Markdown, task lists, table, Python/JSON code editors, Mermaid, Vega/Vega-Lite charts, KaTeX, colon fence, warning alert, multiline details, local/external/unsafe link behavior, blocked image/iframe and inert script text. Renderer counter fields are diagnostic queries scoped to the last Markdown node and do not account for all renderer components; use the screenshots and the routed inventory's detailed observations for code/Mermaid/HTML preview behavior. In particular, a zero in a selector-specific counter is not evidence that the format is absent.

## Browser diagnostics

The capture records 77 browser console/page errors from the original app and the intentionally failing fixtures. They are evidence, not filtered out of the baseline:

- 56 failed model-profile-image/auth requests with 404s, consistent with local mode still attempting upstream Open WebUI resources.
- 9 JSON parse errors from the unsupported `/c/baseline-session` upstream chat lookup, whose local route falls back to HTML and then redirects to `/`.
- 5 fixture-driven 503 failures and 1 fixture-driven 500 publication failure.
- 2 CSP blocks for the fixture's remote image and 2 CSP blocks for its iframe.
- 2 localStorage access page errors during renderer artifact-preview lifecycle.

No outbound remote request escaped Playwright interception. The harness does not suppress these baseline errors.

## Reachability notes and narrow exceptions

- `/c/baseline-session` does not resolve to a persisted local conversation: it attempts an upstream chat lookup, logs the HTML-as-JSON parse failure, and lands on `/`. This is a pre-existing limitation (B03 in [existing defects](existing-defects.md)). Root and `/c` captures retain their actual resulting screens.
- History has no loading layout. While the two history reads were delayed, the visible page already showed the empty state; after both requests settled, the same state remained. The pending/settled screenshots have identical pixels by design and document the absence of a loading indicator (B13).
- Clear-history confirmation is a native browser dialog, which cannot be represented as a page screenshot. The harness accepts the actual `confirm()` dialog and captures the completed clear state. Deleting one row is immediate on the original UI.
- The rich Python block visibly exposes `Run`; it was not clicked. 1A observed that it attempts to initialize an unavailable Pyodide runtime. React must omit execution under the approved no-code-execution boundary (B01).
- The original external Markdown link remains an active HTTPS anchor; it was inspected but not opened. React strips the external destination under the approved safety exception (B10).
- The original cosmetic Stop and overlapping Send now behavior remain visible in baseline; 1A measured overlapping requests. React must omit Stop/Send now dispatch while preserving serialized queue behavior (B16).
- Source detail shows the quote and page label but has no source PDF page/highlight operation (B02). Existing source inventory and routed source-modal screenshot record that gap.
- Settings' header and Settings checkbox can disagree while the page stays mounted (B07). This state is noted in 1A inventory; the Stage 1B captures show default, saved and persistence-off settings states.
- Audio/video and structured tool output, keyboard shortcuts/back-forward navigation, and tooltips beyond the exercised suggestion hover/focus were not qualified in this screenshot pass. Do not infer support or lack of support from these captures.

The [existing-defects ledger](existing-defects.md) records the observations and the approved narrow migration exceptions. This report adds no product requirements.

## Validation and freeze

Ran `node --check` on the harness and `node app/document-qa/frontend/migration-parity/fixtures/validate-answer-fixtures.mjs`. Answer, rich, long and insufficient-evidence payloads validate against the backend `answer.schema.json`; the fixture validator also confirms publish/rollback active-version state.

Primary reviewer accepted this evidence and wrote `original/ACCEPTED.json` with index SHA-256 `560ed579f85718b5cc71f9569fd0eb6cde4d7ae92850ee38f1f75e581aa422b1`. The accepted original directory is now immutable. Capture React or any later repeat run to a separate `BASELINE_OUTPUT_ROOT`.
