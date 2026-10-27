# Stage 7 renderer correction wave

Date: 2026-10-20. Owner: renderer. Scope: the two findings in `task-7a-report.md`; changes limited to `app/document-qa/frontend/src/lib/features/answer-renderer/react/`. No shared modules, manifests, providers, originals, goldens, host data or build outputs were changed. No commits or subagents.

## F7A1 — Mermaid resource preflight

Confirmed in the pinned Mermaid11.15 source: flowchart metadata is decoded by `js-yaml` with JSON_SCHEMA into `vertex.img`; the image shape sets `new Image().src` during layout, before SVG sanitization. The lexical source guard alone could not recognize YAML-escaped keys or values.

`Diagrams.tsx` now runs the actual bundled `mermaidAPI.getDiagramFromText` under the existing serialized, application-owned strict configuration. It checks parsed vertices for image resources before calling `mermaid.render` or creating rendering DOM. All truthy image metadata is rejected regardless of resource scheme or shape spelling; local paths, fragments and data/blob resources cannot preload either. Existing lexical configuration/click/CSS guards and final SVG sanitization remain active. Safe labels/shapes are neither rewritten nor rejected wholesale. A failed preflight does not poison the next safe queued render.

`diagram.test.ts` uses the real Mermaid/YAML parser to prove each adversarial fixture is accepted as an image vertex, then spies at the render boundary to prove drawing is never called. Eleven valid cases cover plain/single-/double-quoted keys, Unicode `\\u`/`\\U` and `\\x` escaped keys, escaped values, multiline folded YAML, same-origin/relative/parent-relative/protocol-relative/file/data/blob/fragment resources. The reported plain resource and eight initial variants first failed by resolving/rendering rather than rejecting; all now reject before draw. Safe rect metadata renders successfully immediately after an unsafe operation.

## F7A2 — Root lexical fence save mapping

Confirmed the renderer's flattened ordinal disagreed with its source regex. The former counted nested fences; the latter could also treat list-indented fences as root and required an incorrectly matching closing indentation.

`ChatAnswer.tsx` now assigns persistent fence ordinals only to the actual root token array. Nested quote/list/alert/writing/details code editors retain their own editable value and Saved feedback but do not call the whole-message save callback, matching the original recursive Markdown contract. Root Save still delegates only the rewritten transient Markdown; immutable Answer/history/source metadata is untouched.

`markdown.ts` captures exact consumed root fence positions from an isolated lexer with the unchanged baseline extensions. It records tokenizer consumption at root depth, rather than flattening nested tokens or searching for matching code text. This also avoids identical fence text inside omitted link-definition titles. A coordinate map accounts for Marked's newline/leading-tab normalization, retaining original surrounding CRLF/tabs and source spelling. Opening/closing fences retain their original independent legal indentation; repeated and unfinished fences remain distinguishable. `isFencedCode` uses Marked's fenced-versus-indented token distinction consistently in mapping and rendering.

New regressions cover quote/list fences before and between repeated root fences, both root rewrite directions, independent legal closing indentation, fence-looking indented code, unfinished root fences, CRLF/tabs, and identical fenced text in a skipped link definition. A real CodeMirror component test edits/saves quoted and listed blocks, proves no parent save occurs or unrelated editor changes, then edits/saves the root block and checks the exact whole-message callback. The original implementation failed three location tests and the nested-save component assertion. An intermediate monotonic raw-token lookup failed the skipped-definition adversary and was replaced with consumed lexer spans; that regression now passes.

## Files and verification

Changed files: `Diagrams.tsx`, `ChatAnswer.tsx`, `markdown.ts`, `diagram.test.ts`, `content.test.ts`, `renderer.test.tsx`. Scoped Prettier ran on these six files only. React review: no new components/hooks, markup layout, focus handling, effect ownership or third-party dependency changes; Mermaid remains lazily imported and serialized, and message callbacks remain the public mutation seam.

Final commands, from `app/document-qa/frontend`:

```text
npm run test:frontend -- src/lib/features/answer-renderer/react
  38/38 passed, 6 files (20:58:00 final run)
npm run check
  tsc --noEmit, exit 0
```

The focused run includes all existing renderer safety/locale/motion/parity cases. One intermediate test-only issue used an unavailable Vitest matcher, and an intermediate tokenizer clone retained bound baseline wrappers; both were corrected before the final successful runs. No failed intermediate output is presented as acceptance.

## Production handoff

Owned implementation/tests are stable and ready for the primary's final asset build. No build or browser probe was run against stale preview4177 by this owner. Actual browser zero-canary and whole-message Copy/branch persistence checks must be repeated by the independent reviewer on the primary's rebuilt production assets using the reported probes. Existing pre-fix evidence is `/private/tmp/react-stage7a-mermaid-probe.{mjs,json}` and `/private/tmp/react-stage7a-fence-probe.{mjs,json}`. This report claims focused implementation readiness, not independent production closure or a new visual waiver.
