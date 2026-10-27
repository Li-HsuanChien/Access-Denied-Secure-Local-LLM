# Stage 5A scoped independent re-review

2026-10-20. **Original F5A-1, F5A-2 and F5A-3 are resolved in the current production build. Stage5A remains open because the extended drawer check confirmed a new P2 draft-preservation finding, F5A-4.** Overall visual acceptance remains5B's separate judgment.

Review is read-only apart from this authorized report and temporary probe/evidence files. No implementation changes, baseline edits, commits, subagents, new listeners or real host operations. Sources were frozen by primary. Reviewed current code, owner reports `task-5-renderer-fix-report.md`, `task-2b-locale-followup.md`, `task-3a-locale-followup.md`, latest3B appendix/progress, and the complete uncommitted snapshot `/private/tmp/react-stage5-round2-review-package/`. This snapshot includes the final Mermaid-root selector and long-drawer wrapper/caret fixes. Primary confirmed the fresh production build before browser verification.

## F5A-1 · resolved · escaped SVG resource attributes

`security.ts` now rejects CSS escapes in SVG attribute values before DOM insertion, parses resource-capable presentation attributes as CSS and applies the existing safe value policy. Mounted SVG, artifact Download and panzoom Download as SVG use the same sanitizer. Legitimate literal local gradient references remain.

Independent production observations:

- The **exact original** escaped fill/filter reproduction now produces zero resource requests, zero blocked requests and zero page errors.
- An expanded independent payload adds escaped function identifiers in style, an HTML-entity-encoded backslash in a presentation attribute, external literal stroke URLs, external use references and script, alongside a local green gradient.
- The actual Preview control mounts sanitized SVG without canary/external/script content. Both actual download controls were clicked; both exported SVG files were read and independently asserted free of the hostile markup. Mounted and exported SVG retain `#paint` and green gradient stop.
- Existing complete updated renderer browser suite passes against the production artifact, including chart/math/code actions, HTML sandbox, hostile chart/expression/config cases, SVG panzoom/reset and the new escape/export assertions.

Evidence: `/private/tmp/react-stage5a-round2/probe.json` (`svg-escaped-resources`); `/private/tmp/react-stage5a-extended-round2/probe.json` (`svg-escaped-mount-and-both-exports`), `artifact.svg`, `diagram.svg`; `/private/tmp/react-stage5a-production-round2/actions.json`. No canary request was permitted through the route interception; a regression would be recorded and aborted before application asset routing.

## F5A-2 · resolved · active locale detection and translated controls

Actual paired original/production browser cases now agree on:

| Case | Both original and React |
| --- | --- |
| Query `/qa?lang=fr-FR`, browser en-US | `html.lang=fr-FR`; stored locale fr-FR; Nouvelle conversation, conversation temporaire, Suggéré |
| Stored locale de-DE | `html.lang=de-DE`; retains stored de-DE; Neuer Chat, Temporärer Chat, Vorgeschlagen; answer source `1 Quelle` |
| Browser fr-FR, no query/storage | `html.lang=fr-FR`; caches fr-FR; same French native controls |

All six locale cases have zero page errors and zero blocked/unexpected requests. Product-owned English copy, seeded prompt text and model names remain English as in the original. Random suggestion permutation is not compared as deterministic content. No original screenshot was changed.

Source review confirms a private React i18next instance with original detector precedence/cache/fallback/interpolation options, bundled-catalog-only lookup, language attribute updates and subscription. No Svelte store import or arbitrary detected-language network URL enters the React path. Focused tests additionally cover query/storage precedence, base French/unsupported-locale fallback, interpolation, resource failures and live hook consistency. Final cleanup must retain these catalog assets and the existing i18next/detector/backend dependencies.

Evidence: `/private/tmp/react-stage5a-round2/probe.json` and locale screenshots. Production catalog modules were served directly from build files, establishing local asset availability for these exercised languages.

## F5A-3 · resolved · viewport drawer, global Escape and long wrapping

The drawer portal now sits under body outside transformed Chat ancestors. Actual paired production observations:

- Desktop full modal dimensions1440×1000; narrow full modal390×844.
- Long desktop editor rect `(16,56,1408,948)` and narrow rect `(16,56,358,792)` exactly match original.
- A long repeated sentence containing multiple spaces wraps identically: middle paragraph height105px desktop and446.25px narrow in both.
- Independent long desktop and narrow paired screenshots have **zero changed RGBA pixels**, with no masks or tolerance.
- Initial focus is in the expanded editor, and range text up to the caret equals the full draft textContent in both: caret begins at the draft end. Typing `!` appends at the end.
- Escape while the Close button is focused closes both original and React. React returns focus to the main composer and preserves the long draft plus edit exactly; no page error or host request.
- The original emits its existing `a.valueOf is not a function` RichTextInput exception on close in these fresh runs and leaves body focused. Its rendered `innerText` includes paragraph spacing; these original defects were not required in React or interpreted as new React failures.

No custom End shortcut was introduced. Focused Composer tests exercise native Home/End/IME propagation, top-modal-only Escape and body-scroll cleanup. No new focus trap was added.

Evidence: `/private/tmp/react-stage5a-extended-round2/probe.json`, `long-desktop-{5173,5176}.png`, `long-narrow-{5173,5176}.png`; exact-pixel comparison using Pillow on RGBA values found0 differing pixels in each pair. Short original Escape reproduction also passes in `/private/tmp/react-stage5a-round2/probe.json`.

## F5A-4 · P2 · blank paragraph duplicated entering expanded input

**New confirmed finding; unresolved in the reviewed production build.**

Locations: `app/document-qa/frontend/src/lib/features/answering/react/Composer.tsx` main editor `onInput` (stores browser `innerText`); `ExpandedInputDrawer.tsx:22–30` (splits that string into paragraph nodes), and its `onInput` paragraph serialization.

Real keyboard reproduction, no injected editor HTML or fixture-only draft override:

1. On `/qa`, type `first`.
2. Press Shift+Enter twice.
3. Type `third`.
4. Click **Expand input**.

Original main editor and drawer have three paragraphs: first / empty / third. Original drawer third paragraph starts at y116.5. React main editor is `first<div><br></div><div>third</div>`; Chromium's rendered `innerText` is `first\n\n\nthird`. Composer stores those three line separators as the semantic draft. The drawer splits them into **four** paragraphs: first / empty / empty / third, moving third to y146.75. The extra line appears at the main-editor→draft→drawer boundary. It also reproduces with initial `fill('first\n\nthird')`, but the keyboard reproduction removes reliance on fill semantics.

Typing `!` in that drawer and closing updates React main composer to the text node `first\n\n\n\n\nthird!`, showing that the drawer's `innerText`-per-paragraph mapping can further convert rendered paragraph spacing into literal line separators. The original main editor preserves its three paragraph nodes after the same edit. Compare DOM structure/geometry and semantically serialize paragraph breaks; comparing whole-element `innerText` alone would incorrectly treat the original's CSS paragraph spacing as draft data.

Smallest correction: preserve semantic user line/paragraph breaks across both editable DOM→draft boundaries; do not use rendered layout line separators as the authoritative draft. Keep safe plain-text insertion, normal typing, Shift+Enter, blank paragraphs, wrapping, caret/IME and no accidental submit. Add an actual browser keyboard regression because current Composer unit helper directly sets `textContent` and cannot reproduce Chromium `innerText` behavior.

Evidence: `/private/tmp/react-stage5a-blank-keyboard/probe.json`, `keyboard-{5173,5176}.png`; executable reproduction `/private/tmp/stage5a-blank-keyboard.mjs`. All React operations have zero errors/blocked requests. Primary and Chat owner were notified directly; owner acknowledged the scoped serialization fix and is waiting for primary's source-freeze release.

## Commands and evidence boundaries

Full Chrome executable remains `/Users/evansinocchi/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`; version151.0.7922.34. Explicit executable, DPR1, reduced motion, America/New_York, identical paired viewports/locale. Browser permission escalation succeeded; no rejection.

All production assets are fulfilled by the probe from `build-react` on disk; there is no actual production frontend server/socket. Original5173 remains the comparison server. Every8765 request is intercepted into the established in-memory fixture responder; user8765/5174/gateway8080 are untouched. All other origins and canary paths are aborted. These checks demonstrate local production asset closure for exercised formats/locales; they are not system-level egress or packaged-Tauri qualification.

| Independent command | Result |
| --- | --- |
| `RENDERER_ORIGIN=http://127.0.0.1:5186 RENDERER_OUTPUT_ROOT=/private/tmp/react-stage5a-production-round2 node /private/tmp/stage5a-production-renderer-round2.mjs` | Complete updated portable renderer suite passed. Temporary adapter differs only in import paths and local-build asset fulfillment. |
| `node /private/tmp/stage5a-probe-round2.mjs` | Exact original locale/Escape/SVG reproductions completed; findings1–3 fixed. |
| `node /private/tmp/stage5a-extended-round2.mjs` | Long desktop/narrow geometry/wrap/caret/edit and expanded hostile mounted/both-export SVG assertions passed; blank-paragraph discrepancy recorded. |
| `node /private/tmp/stage5a-blank-keyboard.mjs` | Confirms F5A-4 via normal keyboard entry. |
| `npm run test:react -- src/react/i18n/bridge.test.tsx src/lib/features/answering/react/ExpandedInputDrawer.test.tsx src/lib/features/answer-renderer/react/security.test.ts src/lib/features/answer-renderer/react/diagram.test.ts src/lib/features/answer-renderer/react/locale.test.tsx` |17tests/4files passed. The supplied drawer filename does not exist and was not counted as tested; corrected follow-up below runs its actual owning suite. |
| `npm run test:react -- src/lib/features/answering/react/Composer.test.tsx src/lib/features/answering/react/ChatLocale.test.tsx` |11tests/2files passed, including all actual drawer tests. |

Primary's fresh combined115/115, strict checking and26.90s build results are supporting evidence in `/private/tmp/react-stage5-round2-*.log`; they were not re-run and relabeled as independent checks. The final build's only reported advisory is chunk size. Original retained/host/whole-suite results from initial5A and Stage4 remain in their reports; this scoped re-review did not repeat unaffected service/workflow checks.

**Next gate:** owner fixes F5A-4; rebuild and repeat actual keyboard blank-line editing/round-tripping plus affected drawer tests. Keep1–3 closure unless the next source changes affect their boundaries. Full visual/motion acceptance remains5B, and final dependency cleanup/production recapture/real-model/desktop qualifications remain later stages.
