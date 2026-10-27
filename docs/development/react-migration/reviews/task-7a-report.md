# Stage 7A independent complete-change review

Date: 2026-10-20. Baseline: `4dc2a06a4fc57ff393ea43ef4b75014b1458eb9b`; working branch `refactor/react`. Reviewed the complete uncommitted migration using `/private/tmp/react-stage7-final-review-package`, its tracked deletions and complete untracked inventory, active source, original source from Git, PRD/SDD/ADR0004/contracts, the stage ledger and durable stage4–6 evidence. Production probes used preview4177 and intercepted every8765 request; no user host/data writes. No implementation edits, commits or subagents. This report is the sole repository write by this reviewer.

## Acceptance recommendation

**Request changes.** Two confirmed regressions remain: F7A1 is a resource trust-boundary failure before Mermaid output sanitization; F7A2 maps code Save to the wrong source fence after nested code. Both require owner corrections and focused independent re-review on rebuilt production assets. No additional concrete P1/P2 regression was found in the reviewed state, persistence, routing, launcher, cleanup or visual evidence. Existing safety exceptions and specifically supported visual classifications are accepted only within their recorded bounds.

## F7A1 — P1: Reject resource-bearing Mermaid metadata before rendering

Location: `app/document-qa/frontend/src/lib/features/answer-renderer/react/Diagrams.tsx:38–42`, with incomplete preflight at `security.ts:194–200`.

`assertSafeMermaid` rejects HTML images, URL CSS, click directives and config, but accepts the flowchart node image metadata introduced by the retained Mermaid version. Calling `mermaid.render` is already resource-capable: Mermaid11.15.0's `imageSquare` constructs `new Image()` and assigns `node.img` to `.src` before it returns SVG. Sanitizing the returned SVG therefore happens after a fetch. The parent CSP permits same-origin resources, so this is an actual arbitrary local resource request, not merely a string surviving in an inert artifact.

Production reproduction: return a valid answered fixture with this document claim (and a newline after the closing fence so the formatter's citation remains outside it):

````text
```mermaid
flowchart LR
 A@{ img: "http://127.0.0.1:4177/renderer-canary-image.svg", label: "Canary", pos: "t", w: 60, h: 60 }
```
````

On ordinary answer rendering, Chromium requested `/renderer-canary-image.svg`. The test intercepted and fulfilled that request with an in-memory benign SVG; it never reached the server. The diagram then rendered and its final output sanitizer removed the image, confirming that output sanitization is too late. A safe `A[Safe] --> B[Done]` control rendered with zero canary requests and zero page errors. An invalid explicit `shape: image` control failed parsing without fetching and is not the exploit.

Required outcome: prevent all resource-bearing Mermaid paths before any live rendering/preload can occur, including supported metadata spelling/quoting/whitespace forms; preserve safe original diagrams and existing sanitized exports. Keep the existing CSP as defense in depth. This finding is covered by the approved no remote/arbitrary-loopback resource boundary and has no parity waiver. It does not assert that CSP-blocked external resources successfully escaped to the internet.

Evidence: `/private/tmp/react-stage7a-mermaid-probe.mjs`, `/private/tmp/react-stage7a-mermaid-probe.json`. The first discarded fixture run lacked a final fence newline; the final JSON is the corrected run with safe control. Browser contexts are closed.

## F7A2 — P2: Keep code Save's source location aligned with the rendered block

Location: `app/document-qa/frontend/src/lib/features/answer-renderer/react/ChatAnswer.tsx:333–344`; `markdown.ts:62–68,101–108`.

The recursive renderer increments one global `fenceOrdinal` for code in blockquotes/lists as well as the root. `fenceLocations` scans raw lines beginning with at most three spaces and a fence; it does not include quote-prefixed fences and does not use the Markdown token tree. These two orderings diverge. Save can silently do nothing while displaying Saved, or rewrite a different block.

Production reproduction with this valid claim:

````text
> ```js
> const quoted = 1;
> ```

```js
const top = 2;
```
````

1. Edit the second (top-level) editor to `const edited = 11;`, click Save, then Copy the assistant message. The editor says Saved, but whole-message Copy still contains `const top = 2;`. The local editor value is not in message state and will be lost on remount/branch revisit.
2. In a fresh context, edit the first (quoted) editor to `const edited = 10;` and Save. Both displayed editors now show that edit; whole-message Copy shows the quoted original and the unrelated top-level block rewritten to `const edited = 10;`.

Both browser cases had zero errors/unexpected requests. Existing saved answer data is unaffected; the regression corrupts transient presentation state and copy output.

Baseline source establishes the intended distinction: original `MarkdownTokens.svelte:205–210` passes a root code token's raw/old/new text to ResponseMessage's message-content replacement (`ResponseMessage.svelte:869–889`). Recursive blockquote/list/details instances do not receive that `onSave` callback, so their original Save is editor-local; the root code block still saves correctly. Preserve that behavior rather than expanding nested saves or allowing them to rewrite another block. Verify repeated identical root fences, nested blocks before/between root fences, and unfinished fences.

Evidence: `/private/tmp/react-stage7a-fence-probe.mjs`, `/private/tmp/react-stage7a-fence-probe.json`. Browser contexts are closed.

## Fresh independent checks observed

- `npm run check && npm run test:frontend`: strict TypeScript passed; all160 tests in28 files passed. No source/test mutations.
- `python3 -m unittest discover -s app/desktop/tests -p 'test_launcher.py'`: all11 tests passed. These use disposable temporary directories and mocks, not an actual install.
- `npm ls --all --json`: exit0; recursively no problems and no Svelte package names. Final lock contains587 entries, with no Svelte entries; active source contains zero `.svelte` files.
- Read build inventory:554 files,45,208,321bytes, including maps. Did not rebuild under the browser freeze; build execution evidence was read from the existing final/fresh-install reports.
- LICENSE, LICENSE_HISTORY, LICENSE_NOTICE, src/app.css and src/tailwind.css compare byte-identical with baseline; start.sh retains its executable bit.
- Re-ran the immutable comparator against durable post-cleanup95 captures:54 identical,41 raw pixel differences, zero dimension mismatches/missing images. It verified the accepted original index and all95 PNG hashes. Expected exit1 reports the classified raw differences; zero tolerance and no masks remain intact. Independent report: `/private/tmp/react-stage7a-compare/comparison.json`.
- Read comparator implementation: all four RGBA channels affect the exact changed-pixel mask/count; dimensions and missing captures fail; original index and image hashes are checked; output cannot overwrite either capture directory.
- Production Mermaid and code Save browser probes described above reproduced both findings with safe controls and fully intercepted API/resource canaries.

## Reviewed architecture, scope and supporting evidence

The shared answering coordinator synchronously locks through the actual answer and one history-save attempt, retains a separate deeply frozen answer snapshot, and sends only the current question/preference. Controller disposal discards queued questions and suppresses detached graph updates. Preference writes serialize per key and invalidate stale reads. Publication retains the application-lifetime request ID, non-overlapping polling and truthful cancellation/lost-response ownership. History validates saved answers against the backend schema and protects open/list results from delete/clear races. Routing deliberately retains temporary-session reset behavior and redirects unsupported `/c/:id` without upstream APIs. No backend implementation/wire/storage change was present beyond documentation and frontend schema-type alignment.

The launcher hashes exact manifest/lock bytes, Node major, platform and architecture; checks required packages; removes old receipt before install; atomically writes a receipt only after successful npmci. Fresh and genuine legacy install durable JSON separately record actual npmci, a second no-install call and clean installed graphs. Windows command construction is retained and covered by a focused test; this is not Windows runtime execution evidence.

Read the complete95 classification/report evolution, final task5A closure and post-cleanup report. Final post-cleanup reports retain41 individually explained differences; no global tolerance or entire-interface masks were introduced. Production CSS minification/optimization is explicitly disabled following causal alpha/OKLCH evidence. Read all12 zero-difference menu comparison rows and seven zero-difference sidebar/mobile crop rows; remaining whole-frame light glyph regions are disclosed. No additional visual acceptance expansion is inferred from these counts.

Durable stage6 fixture and fresh-dev results each contain11 named scenarios; real disposable-host results distinguish the four-workflow round trip from mocked timing/failure coverage. All report zero browser errors and unexpected requests. Read asset closure evidence and documented40 actual local responses/five fixture responses; this does not prove that every possible hostile renderer input is safe, as F7A1 demonstrates.

The primary's newly completed real-model evidence under `docs/development/react-migration/evidence/stage7-real-model/` records a genuine local Qwen3-4B Q4_K_M result (`stub:false`) with local MiniLM retrieval, publication of a fictional PDF, correct factual claims/S1 page1 quote and save/reopen. One request completed in25.3s/one attempt; offline runtime/Hugging Face flags and zero browser external requests are documented. This reviewer read those artifacts but did not independently start another model run. The record explicitly says the machine was not physically disconnected and is not an8GB/model-quality qualification.

No Tauri/signed-release, source-page-image, streaming/answer-cancellation, durable-thread or reference-hardware qualification is claimed or required for this migration. Pending acceptance-file labels were known coordination status, not findings. Final handoff must incorporate this review's open findings and any subsequent closure, and maintain those scope limitations.
