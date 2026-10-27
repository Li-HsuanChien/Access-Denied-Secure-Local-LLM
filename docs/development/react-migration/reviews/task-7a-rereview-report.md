# Stage 7A independent scoped re-review

Date: 2026-10-21. Reviewed `/private/tmp/react-stage7-fixed-review-package` and the six renderer files changed since the complete-change review. Production source/config remained frozen. All browser operations used rebuilt preview4177 with every8765 API call intercepted by disposable fixtures. No user host/data writes, source edits, commits or subagents. This report is the only repository write in this re-review.

## Verdict

**ACCEPT Stage7A. F7A1 and F7A2 are closed.** The independent production reproductions now pass, the focused renderer suite passes, and the scoped fix review found no new actionable regression. Combined with `task-7a-report.md`, no complete-change-review finding remains open. Primary owns final handoff and integration/visual evidence consolidation; this acceptance does not broaden the documented product or hardware qualification scope.

## F7A1 closure: parsed Mermaid image resources rejected before draw

The fix invokes the pinned Mermaid parser under the same serialized strict application configuration, examines parsed flowchart vertices, and rejects any truthy `img` before calling `mermaid.render`. The source's YAML decoding therefore cannot bypass the guard with quoting, escaped keys/values or folded metadata. The unchanged lexical config/click/CSS guard and post-render SVG sanitizer remain in place. Inspection of pinned Mermaid confirms its resource-loading image shape derives from the same parsed `vertex.img` field checked by the guard. Safe diagrams without that field follow the existing draw/sanitize path.

Independent browser check on the final production build passed all11 valid hostile forms in one answer:

- Plain original same-origin URL.
- Double-quoted key with absolute local path.
- Single-quoted key with parent-relative path.
- Unicode-escaped key and URL value.
- Hex-escaped key.
- Long-Unicode-escaped key and file resource.
- Protocol-relative external resource.
- Local fragment resource.
- Data resource.
- Blob resource.
- Multiline folded YAML image metadata.

All11 produced the explicit `External diagram resources are disabled` preflight error; none made a canary request. The canary routing hook remained active and would fulfill an attempted request with benign in-memory SVG, so a successful fetch could not be concealed as a network failure. Three safe diagrams in the same serialized rendering sequence then rendered successfully: ordinary flowchart, supported rectangle metadata, and sequence diagram. Zero page errors and zero unexpected/blocked requests occurred.

This closes the demonstrated pre-sanitization resource failure. It is a scoped hostile-input verification, not a proof of all future Mermaid versions or arbitrary parser vulnerabilities.

## F7A2 closure: root Save locations and nested editor state

The renderer now grants whole-message Save only to fences in its root token array. Nested code keeps local editor/Saved state without calling the parent callback, matching the baseline recursive Markdown behavior. `markdown.ts` obtains consumed root token positions from a separate instance of the unchanged configured lexer, including skipped link-definition spans; its newline/tab offset map preserves surrounding source spelling. The renderer and location mapper share the fenced/indented-code distinction. There is no change to immutable answer/history data or the public message mutation seam.

Independent production browser sequence used quoted code, listed code, two identical root fences and another quoted block between the roots:

1. Edited and saved all three nested blocks. Whole-message Copy remained exactly unchanged; neither root editor changed.
2. Edited and saved each repeated root independently. Whole-message Copy exactly matched the expected original text with only those two root bodies replaced.
3. Regenerated to create another assistant branch and selected Previous message. Both root edits persisted; nested editors returned to their original source, as expected for local-only edits. Whole-message Copy still matched exactly.
4. Verified the initial persisted answer retained the original document claim. Local edits caused no history saves; initial answer and regeneration each produced one save.

Zero page errors and unexpected/blocked requests occurred. Both original failure directions are closed: root Save no longer silently drops the edit, and nested Save no longer rewrites an unrelated root block.

## Independently executed verification

- `npm run test:frontend -- src/lib/features/answer-renderer/react`:38/38 tests passed in6 files. Includes all existing renderer tests and new semantic metadata/source-span regressions.
- `node /private/tmp/react-stage7a-rereview.mjs`:PASS, two scoped scenario groups with the eleven malicious cases/three safe diagram controls and nested/root Save/copy/revisit sequence described above.
- Compared review-package untracked hashes: production/source-test changes since the first complete review are exactly `Diagrams.tsx`, `ChatAnswer.tsx`, `markdown.ts`, `diagram.test.ts`, `content.test.ts`, `renderer.test.tsx`. Reviewed each changed implementation and the focused tests.

The browser probe's first run timed out because its selector counted diagram control icons along with rendered diagram SVGs. The selector was corrected to `.renderer-panzoom > svg`, and the complete probe was rerun successfully. No product change was involved and the discarded run is not acceptance evidence.

## Evidence and limits

- Executed probe: `/private/tmp/react-stage7a-rereview.mjs`.
- Result, exact payloads, loaded production script URL, copied content and branch-revisit observations: `/private/tmp/react-stage7a-rereview.json`.
- Previous failing probes remain separate: `/private/tmp/react-stage7a-{mermaid,fence}-probe.{mjs,json}`.
- All browser contexts/processes from this re-review are closed.

Primary separately reports final strict TypeScript,177 frontend tests,11 launcher tests, rebuilt production output, eleven routed fixture scenarios, actual disposable-host workflows and the repeated genuine local-model smoke. The visual reviewer owns the affected safe rich-content comparison. These are separate evidence streams; they were not silently represented as rerun by this reviewer. The earlier complete review's unchanged architecture, launcher, graph, provenance and immutable visual-evidence checks remain applicable. No Tauri/signed-release, source-page, visual-answering, streaming/cancellation, durable-thread, physically disconnected-machine or8GB reference-hardware qualification is implied.
