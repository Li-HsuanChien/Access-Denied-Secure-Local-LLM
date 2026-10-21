# Stage 5B independent visual and interaction review

Status: **accepted Stage5B after owner corrections and independent production re-review; raw differences are explicitly classified below.** Read-only review of the uncommitted implementation at base HEAD `4dc2a06a4fc57ff393ea43ef4b75014b1458eb9b`. No implementation edits, commits, subagents, original-reference edits, masks or tolerance changes were made. This report is the only repository write by this reviewer.

## Fresh full capture

After primary explicitly froze source writes and released the browser slot, the existing 95-state routed harness completed against React 5176. Full Chrome for Testing was explicitly selected through `chromium.executablePath()`, Chromium **151.0.7922.34**. Fixtures, epoch/UUID/random seed, timezone America/New_York, device scale 1, desktop1440×1000/narrow390×844, themes, font readiness and screenshot animation settling match the reference procedure. Every 8765 request was intercepted; the real user's host/data were untouched. Staging and evidence remained outside Vite's watched sources.

Commands (from repository root):

```sh
BASELINE_ORIGIN=http://127.0.0.1:5176 BASELINE_OUTPUT_ROOT=/private/tmp/react-stage5b-full node app/document-qa/frontend/migration-parity/capture.mjs
python3 app/document-qa/frontend/migration-parity/compare.py app/document-qa/frontend/migration-parity/original /private/tmp/react-stage5b-full /private/tmp/react-stage5b-comparison
node /private/tmp/react-stage5b-wrapper-probe.mjs
node /private/tmp/react-stage5b-containment-probe.mjs
node /private/tmp/react-stage5b-interaction-probe.mjs
```

Capture exit0: **95 states, 0 blocked requests, 0 page errors**. Nine HTTP console errors are the intentional failure-fixture statuses (503/500), not failed asset loads or runtime exceptions. Unmodified comparator exit1: **50 identical, 45 pixel-different, 0 dimension-different, 0 missing**. Accepted original index SHA remains `560ed579f85718b5cc71f9569fd0eb6cde4d7ae92850ee38f1f75e581aa422b1`; comparator verified every original PNG hash. Evidence: `/private/tmp/react-stage5b-full/{capture-index.json,screenshots,metadata}`, `/private/tmp/react-stage5b-comparison/{comparison.json,differences}`. Inspection pairs are in `/private/tmp/react-stage5b-inspection/`.

History and Settings states are now all pixel identical in this full run, including History metadata, source hints, dark/narrow/open/error states. Library publication and rollback result metadata are also pixel identical after the composed-text-node correction. Earlier History102px and Library75px differences were real text-node paint behavior, not waived raster noise.

## Concrete findings and owner fix list

1. **[P1 parity] Omitted message paint containment causes the 1px heading/claim/list shift.** Original `src/lib/components/chat/Messages/Message.svelte:52–65,158–164` applies `.message-virtualized { content-visibility:auto; contain-intrinsic-size:auto 150px }`, excluding WebKit. React ChatPage message rows omit it. Earlier nine-ancestor diagnostics stopped before this ancestor. Full ancestry inspection shows original content-visibility auto versus React visible. Disposable setting of that original property on React's closest `.message-listitem` changes the supported-answer heading/claim crop from3795px to **0**, and the rich heading/list crop from2403px to **0**, without changing heading geometry, fonts, list wrappers or source-panel structure. Whole supported-answer probe then has only294 max1 placeholder pixels. Evidence: `/private/tmp/react-stage5b-probes/{answer,rich}-517{3,6}-paint.json`, `*-base.png`, `*-content-auto.png`; probe script above. Smallest owner change: restore original containment/intrinsic150px and WebKit exclusion on the same message-row boundary, with the original scroll follow-up behavior. Do not add pixel offsets. The probe used an arbitrary intrinsic fallback500px while already visible, so production must use original150px. This diagnoses the containment property, not a new intrinsic-size choice.

   Rejected hypotheses with independent evidence: moving SourcePanel to a sibling, adding original anonymous assistant wrappers, removing list div wrappers and wrapping heading text do not change the3795px answer crop. List-wrapper removal alone leaves the rich2403px unchanged. `.normalize`, locale and list-style probes from3C likewise did not fix it. No blanket typography waiver is justified.

2. **[P2 parity] Missing suggestion entrance and hover color motion.** React `ChatPage.tsx:262` retains animationDelay but lacks the original `.waterfall`, keyframes, button transition-colors and child transition classes. Original `Suggestions.svelte:91–145` uses 200ms ease opacity0→1/translateY6px→0, forwards fill,45ms stagger. Runtime `getComputedStyle`/`getAnimations` records each original suggestion with that animation and React with no animation. Restore original motion and color transitions. Canonical Math.random=0.5 supplemental comparison preserves identical content/order/boxes and leaves2096 max1 text pixels; the original completed transform layer is a plausible reason, to be confirmed after the actual motion port.

3. **[P2 parity] Missing source-modal and details motion.** Original `common/Modal.svelte:133,142` has overlay fade10ms and active flyAndScale200ms. Runtime recorded the source modal inner transform `translate3d(0,-8px,0) scale(.95)`/opacity0 to identity/opacity1 over200ms; React Modal has no corresponding animation. Original `common/Collapsible.svelte:179` expands/collapses detail content over300ms with quintOut, animating height, padding, margins, border widths and opacity; React ChatAnswer Detail inserts/removes it immediately. Runtime confirms original300ms animation and React none. Restore the exact supported transitions with appropriate reduced-motion behavior. The original `.modal-content` scaleUp CSS is not used by the inspected modal markup and is not asserted to be active.

4. **[P2 parity] Alert palette and non-WARNING icons differ.** `ChatAnswer.tsx:324–345` uses ArrowRightCircle only for WARNING and one generic exclamation-circle icon for every other type. Original `Markdown/AlertRenderer.svelte` maps NOTE→Info, TIP→LightBulb, IMPORTANT→Star, WARNING→ArrowRightCircle, CAUTION→Bolt. `renderer.css:31–59` hardcodes older palette hex values while original uses border/text sky500, emerald500, purple500, yellow500 and rose500 utilities. Restore the original utility colors and per-type SVGs. The full95 WARNING region has964 changed pixels in preliminary regional analysis, and a separate palette/style check is required after containment; other exposed alert variants need supplemental evidence because the95 fixture contains WARNING only. No safety exception covers color/icon drift.

5. **[P2 parity] Rich safe controls still have unresolved exact pixels.** Current rich-top still lacks the original Python Tippy visible at the pinned retained pointer, despite the earlier full-width target correction. Code font improvement is visible and reduces rich-top10566→8664 and rich-middle6549→4475. The remaining tooltip state must be checked with intentional hover and pointer already over newly created language reference. Download SVGs combine two original paths into one; Collapse uses reordered relative geometry; details chevron differs by36px in preliminary regional analysis. Restore original path/element structure where the post-containment comparison confirms drift. Safe code/display/copy/collapse, chart/table exports and detail chevrons have no exception.

6. **[P2 parity] Intermittent model label and remaining rich borders/text need post-fix resolution.** Expanded light initial states in this run contain799 extra model-label pixels (max86) in addition to suggestion differences, matching the earlier tracked issue. The original-trigger markup correction has not proved that state exact. Rich writing-panel and long-table border/text differences remain open pending the containment rerun. Current geometry alone does not waive them. Preserve original wrappers/CSS/control text; isolate only residual differences after the known cause is fixed.

## Random suggestions and mobile hover classification

The original config order and `.sort(() => Math.random() - .5)` algorithm are preserved in React. Original editor/Svelte and React mounts consume different random calls, so a fixed global seed does not produce the same permutation. The prior fixture-only reverse was removed. Supplemental canonical Math.random=0.5 screenshots render the same three titles/subtitles in the same order and at matching geometry; no changed copy/control/layout is hidden. Treat permutation as identified nondeterministic content, retain every raw full95 diff, and independently require motion, text paint and focus-ring parity. No route-specific random skip/order hack or golden regeneration is permitted.

The736px mobile-overlay diff is the logo hover background under a retained pointer. Supplemental paired original/React captures in BOTH reduced and ordinary motion modes are **pixel identical** with retained pointer and after moving to the same neutral location: `mobile-{reduce,no-preference}-517{3,6}.png` and `mobile-neutral-{reduce,no-preference}-517{3,6}.png` in `/private/tmp/react-stage5b-interactions`. Runtime records matching hover/background states. This is a narrow event/timing-dependent interaction-state difference, not a layout/color-rule mismatch. Original and React can both show or omit that hover depending on pointer arrival/transition state. No source change is requested for this736px alone.

## Per-case classification

All identical cases are explicit in comparison.json. Every non-identical case is listed below. Codes: **R** identified random permutation plus unresolved suggestion animation/text paint; **M** intermittent model-label paint; **C** proven missing message paint containment; **P**294 max1 composer-placeholder edge pixels; **E** approved safety exception; **T** tooltip/SVG/alert/border residuals pending corrected capture; **H** narrow pointer/timing classification above; **A** narrow rounded-edge antialiasing (reviewed against same geometry/colors, no moved text). Counts remain raw zero-tolerance pixels; these labels do not change comparator output.

| Case | Changed pixels | Max channel | Classification |
| --- | ---: | ---: | --- |
| chat-empty-light-1440 | 5766 | 223 | R |
| chat-empty-light-1440-repeat | 5766 | 223 | R |
| chat-typed-multiline-initial | 5766 | 223 | R |
| chat-answer-initial | 5766 | 223 | R |
| chat-answer | 4089 | 239 | C + P; header/alert tiny edges recheck |
| chat-sources-expanded | 3795 | 239 | C; modal underlying text, not modal layout |
| chat-source-detail-modal | 3789 | 131 | C; modal underlying text, not modal layout |
| chat-empty-light-390 | 5936 | 223 | R |
| chat-empty-dark-1440 | 6042 | 174 | R |
| chat-empty-dark-390 | 6159 | 174 | R |
| chat-insufficient-evidence-initial | 6565 | 223 | R + M |
| chat-insufficient-evidence | 3063 | 166 | C/P and residual status/error paint; require corrected rerun |
| chat-request-failure-initial | 6565 | 223 | R + M |
| chat-request-failure | 3710 | 153 | C/P and residual status/error paint; require corrected rerun |
| chat-history-save-failure-initial | 6565 | 223 | R + M |
| chat-history-save-failure | 4111 | 239 | C + P; header/alert tiny edges recheck |
| chat-rich-content-initial | 5766 | 223 | R |
| chat-rich-content-top | 8664 | 255 | C + P + T; E: Python Run/blocked-frame icon only where visible |
| chat-rich-content-middle | 4475 | 255 | C + P + T; E: Python Run/blocked-frame icon only where visible |
| chat-rich-content-bottom | 3119 | 250 | C + P + T; E: Python Run/blocked-frame icon only where visible |
| chat-long-content-initial | 5766 | 223 | R |
| chat-long-content-top | 8664 | 255 | C + P + T; E: Python Run/blocked-frame icon only where visible |
| chat-long-content-bottom | 4855 | 233 | C + P + T; E: Python Run/blocked-frame icon only where visible |
| chat-in-flight-initial | 6565 | 223 | R + M |
| chat-in-flight | 1030 | 204 | E: omitted cosmetic Stop; pending cursor/placeholder C/P residual must recheck |
| chat-in-flight-complete | 4139 | 239 | C + P; header/alert tiny edges recheck |
| chat-suggestion-hover-focus | 6565 | 223 | R + M |
| chat-suggestion-hover | 6628 | 242 | R + M |
| chat-suggestion-focus | 11766 | 242 | R + M |
| chat-sidebar-expanded-light-initial | 6565 | 223 | R + M |
| chat-sidebar-expanded-light | 6565 | 223 | R + M |
| chat-sidebar-expanded-dark-initial | 6042 | 174 | R |
| chat-sidebar-expanded-dark | 6042 | 174 | R |
| chat-mobile-sidebar-overlay-initial | 5936 | 223 | R |
| chat-mobile-sidebar-overlay | 736 | 10 | H: canonical paired states exact |
| library-files-selected | 16 | 1 | A: header switch/status rounded edges; panel corner only where max2 |
| library-review-unchecked | 22 | 1 | A: header switch/status rounded edges; panel corner only where max2 |
| library-review-checked | 22 | 1 | A: header switch/status rounded edges; panel corner only where max2 |
| library-review-dark-initial | 12 | 1 | A: header switch/status rounded edges; panel corner only where max2 |
| library-files-selected-dark | 4 | 1 | A: header switch/status rounded edges; panel corner only where max2 |
| library-publication-failure-initial | 14 | 2 | A: header switch/status rounded edges; panel corner only where max2 |
| root-light-1440 | 6565 | 223 | R + M |
| root-dark-1440 | 6042 | 174 | R |
| c-baseline-session-light-1440 | 7780 | 223 | R |
| c-baseline-session-dark-1440 | 7870 | 174 | R |

## Narrow approved differences and limits

ADR0004/defect ledger authorize only no Python Run, no cosmetic Stop/overlapping Send now, inert external destinations/resources, a tokenless sanitized HTML sandbox and inert blocked-frame replacement. The missing Run moves Collapse into the available header space; blocked browser-icon pixels may differ. External anchors must retain visible styling. These exceptions do not cover ordinary text/border/tooltip/icon/color/motion drift.

Library's remaining4–22px differences are confined to unchanged rounded header switch/status outlines; two panel-corner pixels max2 occur only in `library-publication-failure-initial` this run. No text differs there, and exact repetitions of the same visible Library/History/Settings panels elsewhere provide a control. This is the narrowly documented antialiasing allowance; it is not a general max-channel threshold. Other max1 suggestion and placeholder text remains pending the restored animation/containment capture.

The runtime probe records matching source-modal focus on the close control. It sends Escape before cleanup but makes no independent post-Escape assertion; Stage4/5A own broader keyboard/IME/scroll/host/unsafe-content verification. This review used deterministic fixtures and emulated desktop/mobile Chrome, not physical touch hardware, a real model, the8GB reference laptop or packaged Tauri. Stage6 cleanup still requires post-cleanup visual/offline rechecks. Stage5B remains open until owner corrections are independently recaptured and no unexplained changes remain.

## Round 1/2 focused re-review and initial glyph-paint diagnosis

This section follows owner corrections; the original full95 table above remains historical raw evidence and has not been overwritten. Current complete uncommitted source snapshots are `/private/tmp/react-stage5-round1-review-package` and `/private/tmp/react-stage5-round2-review-package`. Primary reports combined115 React tests and strict checking passed; this reviewer did not rerun those behavior suites. Final fresh95 is pending the last active-motion corrections and primary's source freeze.

### Resolved causes reported by owners, awaiting final shared capture

- Chat now applies original non-WebKit message containment/intrinsic150px. Owner paired evidence `/private/tmp/react-chat-stage5/` has only294 max1 placeholder pixels on supported answer; long-bottom is exact. The row geometry, scrollHeight3729/client839 and final scrollTop2890 match; long-scroll sample trajectories differ by timing but reach the same final position. Native drawer is now a body portal with original full-width wrapper and modified-End key handling; owner reports desktop/narrow and long-drawer screenshots exact. These must still be covered by final independent evidence.
- Renderer owner reports source-expanded/modal exact; rich/long-bottom only294 placeholder pixels; writing/alert/details/table borders all exact after containment. Download/Collapse/details exact SVG structure, alert utility palettes/per-type icons and native source/details motion are restored. The earlier Mermaid A residual had an actual root SVG font-rule omission (original16px/26px vs React15px/24.375px); inlineSvgStyles now includes a matching SVG root while retaining sanitization. Final owner evidence `/private/tmp/react-stage5-renderer-final-paired/` records matched A styles/Range and1 changed pixel max2. Final independent capture remains required.
- Python Tippy difference is a retained-pointer consequence of shuffled suggestions: original Summarize is at y682.375/center706.375 and overlaps the later Python header y700.125; React Summarize is y586.375/center610.375. Pointer remained at the clicked suggestion's former location. Owner confirms actual original reference:hover=true/Tippy visible and React:hover=false/hidden, while intentional Python hover displays the tooltip in both. This is an identified pointer-state difference induced by random order, not permission to force a tooltip visible. Final shared comparison must retain and classify the raw pixels.

### Initial model/suggestion glyph edges: actual controls and negative hypotheses

The canonical Math.random=0.5 supplemental case fixes only suggestion permutation; it does not replace or modify the95 accepted originals. Fresh initial expanded `/qa` and redirect can show6956 changed pixels (max129) versus the current original:294 max1 composer-placeholder pixels plus6662 model/suggestion glyph-edge pixels. A prior redirect294 result is not a stable route distinction. All text, control geometry and copy are identical. These pixels have not been hidden or dismissed based on matching rectangles.

Evidence and bounded probes:

| Probe | Raw outcome |
| --- | --- |
| `/private/tmp/react-stage5b-empty-diagnostic{.mjs,/}` | Both `/qa` and redirect reproduced6956 after an additional1s wait. Original screenshots remain identical. All inherited paint styles recorded. |
| `/private/tmp/react-stage5b-empty-layers{.mjs,/}` | CDP actual fonts match: custom Inter-Regular,18 model glyphs and24 first-suggestion-title glyphs. Initial LayerTree capture had no event and does not establish a layer-origin claim. |
| `/private/tmp/react-stage5b-empty-paint-variants{.mjs,/}` | A fresh React base without any DOM mutation is294px; the same original is0. Compared with prior React drifted base, React alone changes6662 glyph-edge pixels, max129. Late forced extra compositing introduces820 unrelated logo/label pixels and is not a proposed fix. |
| `/private/tmp/react-stage5b-empty-repeats{.mjs,/}` | Six fresh React contexts:4 initial6956,1 initial294,1 initial299(max2 tiny corner/control edge). Reassigning existing leaf textContent to the same value takes every6956 case to294 without changing text/styles/geometry. This is diagnostic evidence only; no text-reset code is proposed. |
| `/private/tmp/react-stage5b-empty-normal-repaint{.mjs,/}` | Six of six initial React contexts6956 become294 after genuine hover over each suggestion followed by moving to a neutral point. No DOM or style mutation. Original base, hover and type+Backspace are0. All seven model/title/subtitle text-node Range lists, element boxes and **all computed styles** are exactly equal before and after hover. Finished CSS-animation currentTime/timing/keyframes are also exactly equal. Thus paint differs in the same React DOM after an ordinary interaction while measured text/layout/state is stable. Type+Backspace then gives1394 pixels confined to the active composer placeholder/caret; model/suggestion glyphs remain exact. |
| `/private/tmp/react-stage5b-empty-font-timing{.mjs,/}` | Four cold captures:[6956,294,6956,294]. Four disposable entry-response probes that await existing Inter font load/FontFaceSet.ready before React mount:[6962,6956,6962,6956]. Four500ms Inter-response-delay controls:[294,294,294,294]. Awaiting fonts before mount **does not fix it**; later font swap causes a repaint that does. No source, font bytes or baseline changed. The first attempt timed out waiting networkidle before any capture; React5176 immediately returned HTTP200 and the retry completed. No server-failure conclusion is drawn. |
| `/private/tmp/react-stage5b-empty-transition-start{.mjs,/}` | Corrected early-document observer records the actual native startup calls. A control with all CSS entrance durations/delays zero and native animate duration/delay zero still has6956/6962 on React and0 on original. Restoring the four Placeholder parent fades at insertion gives6956 in3/3. These controls do not establish animation as the cause. |
| `/private/tmp/react-stage5b-empty-outer-start{.mjs,/}` | Restoring the actual original outer wrapper and opacity fade50ms at React DOM insertion, awaiting native completion then canceling its fill, gives[6956,6956,294,6956] after four6956 bases. This does not reliably fix glyph paint. A late wrapper/fade produced backdrop edge changes and is not a valid implementation remedy. |

The observed condition is **initial Chrome text paint that varies with render/repaint history**, confined to the18 model-selector glyphs and the six suggestion title/subtitle strings in the canonical empty state. Actual browser-internal cache mechanics remain an inference, not a proved engine bug or an excuse to change coordinates/fonts. The six ordinary-hover controls, stable complete text Range/style/finished-animation data, original-stable/React-varying controls, and no-mutation exact React case demonstrate that the residual is not persistent copy/layout/font/control drift. A font preload, delay, widget remount, pixel offset, forced repaint or text-reset production hack is not justified.

**Acceptance recommendation:** after correcting the independent active motion omissions below, permit only this specifically documented initial glyph-edge raster variation if the fresh full95 and ordinary-interaction checks reproduce the same bounded regions and otherwise exact content/layout. Keep every raw changed-pixel report. This recommendation is not a general max-channel/count threshold; any moved baseline, changed text, persistent post-hover glyph difference, color/icon/control change or new region still fails. Primary retains final acceptance judgment. The full Stage5B gate is still open.

### Additional active motion findings and dormant source directives

Native Element.animate logging during real routed original UI establishes two additional omissions:

1. Original `Chat.svelte:4325` inserts `.w-full.h-full.flex.flex-col` and runs opacity0→1 over50ms on both initial `/qa` and New Chat after an answer. React has nav/pane directly beneath #chat-container and records no corresponding animation. Restore the original wrapper and active fade50 with native cleanup for motion parity; the control above proves this must not be advertised as a reliable glyph-paint fix.
2. Original `Models/Selector.svelte:950` reachable model-dropdown runs flyAndScale200ms (helper default y=-8, start=.95, cubicOut); React `.chat-model-menu` records no native or CSS equivalent. Restore that active transition.

Evidence: `/private/tmp/react-stage5b-menu-remount-motion.mjs` and `/private/tmp/react-stage5b-menu-remount-motion/results.json`. Original logs opacity setup plus50ms outer fade at initial/remount and200ms dropdown. React logs zero calls for all three paths. The first probe used a duplicated original #sidebar-new-chat-button ID; it was corrected to its visible `a#sidebar-new-chat-button` and the complete two-port probe then passed.

The logo/title/description/suggestion-parent `in:fade` source directives in Placeholder.svelte did **not** execute during these original initial or New Chat paths. No native calls were logged for them. Their source presence alone does not authorize adding new entrance behavior; no blanket port of dormant local transitions is requested. The outerChat fade and dropdown are active and need the owner correction before final independent capture.

### Primary classification decision and immutable-reference bridge

Primary accepted the narrowly documented initial Chrome text raster classification **contingent on the final capture identifying the same exact cases/regions and the ordinary-hover controls above**. No global pixel/channel threshold, masks, rewritten baseline or production repaint/remount/delay hack is allowed. Browser-internal cache mechanics remain unproved. The final gate stays open for ordinary source corrections and fresh evidence.

A further comparison ties the canonical current original directly to the accepted frozen original: against immutable `chat-sidebar-expanded-light.png`, the model crop `(1026,509)–(1150,522)` has0 changed pixels, the Find second-row glyph crop has0, and Summarize/Compare title+subtitle crops have0 after only the documented integer96px row-permutation translation. This is an analysis of crops, not a changed reference image. Thus fresh canonical-original controls retain the accepted glyph paint.

## Consolidated nongolden menu, focus and closure review

The95 original states omit menu-open and expanded-input states. The approved interaction-state review therefore also used current original/React paired supplementary evidence, without adding or modifying any original golden. The following are confirmed migration regressions and require owner fixes before final capture.

### Menu appearance and positioning

`/private/tmp/react-stage5b-menu-geometry/` and `/private/tmp/react-stage5b-all-menu-states/` contain complete DOM/computed style/control geometry, settled full-view PNGs, and actual focus/key observations. The latter covers1440×1000 and390×844 in both light and dark (24 menu-open PNGs), with the same supported-answer fixture and canonical shuffle. All cases have zero browser errors and zero blocked requests.

| Menu/view | Original rectangle | React rectangle before correction |
| --- | --- | --- |
| Chat actions desktop, both themes | `(338.125,89.25,200,33)` | `(338.125,87.25,224,43.5)` |
| Chat actions narrow, both themes | `(96.125,122.8125,200,33)` | `(92.125,120.8125,224,43.5)` |
| Regenerate desktop, both themes | `(489,514.875,198,122)` | `(489,360.875,200,126)` |
| Regenerate narrow, both themes | `(74,597.1875,198,122)` | `(74,443.1875,200,126)` |
| Model desktop after answer, both themes | `(935.5,871.25,320,73)` | `(935.5,874,320,69)` |
| Model narrow after answer, both themes | `(18.5,715.25,320,73)` | `(18.5,718,320,69)` |

Original Chat actions and Regenerate use the actual common Dropdown portal and DropdownMenu, including radius12px/padding2px/solid border; original dark background is gray850, border gray800, text white. React Chat actions uses radius16px/padding6px/60%-alpha light border, gray700 light text, gray900 dark background/gray200 dark text. React Regenerate uses radius16px/padding4px, gray900 dark background/bordergray850. These are ordinary visible differences, not raster noise or safety exceptions.

Original Regenerate opens **below** its trigger by default, `sideOffset=-2`, and uses the shared viewport auto-flip/clamp/scroll/resize placement. React hardcodes `bottom-full` and opens above. Restoring below-row placement must account for message paint containment; a native-style body portal/viewport placement is the appropriate original boundary. Chat actions original sideOffset is8 rather than React6. Original model menu's after-answer bottom spacer is4px; React omits it, consistent with the4px height difference (owner must confirm exact placement/style rather than add arbitrary offsets).

**Actual missing model-row control:** the captured original model DOM also contains an enabled, hover-revealed `button aria-label="More Options"` at `(1210.5,913.25,16,16)` before the check mark. React's captured model-row DOM omits it. Original ModelItemMenu source includes Keep in Sidebar and Copy Link, with Edit/Delete separately gated. The captured DOM establishes the exposed trigger; the submenu/action outcome still needs a short actual original probe before deciding supported preservation versus a documented pre-existing broken action. Source presence alone is not claimed as completed action evidence. Primary was notified before full95 acceptance.

### Actual focus and keys, not assumed library defaults

Original common Dropdown is this repository's custom component, not an assumed Bits UI roving menu. The real probe records:

| Case | Original | React before correction |
| --- | --- | --- |
| Chat actions open | focus on portal `role=menu`, `tabindex=-1` | focus stays on Chat actions trigger |
| Regenerate open | focus on portal `role=menu`, `tabindex=-1` | suggestion input auto-focused |
| Chat actions Escape | focus returns to `#chat-input` | focus remains on trigger |
| Regenerate Escape | focus returns to `#chat-input` | focus becomes BODY |
| Model open desktop | search input focused | search input focused |
| Model open390px | focus stays on model trigger | search input auto-focused |
| Model Escape | composer focused | composer focused |

ArrowDown, ArrowUp, Home and End leave original Chat actions/Regenerate focus on the menu root: there is no original roving handler to invent. On the single-model search they leave search focus and the single selection intact. React Chat actions stays on its trigger; Regenerate stays in its prematurely focused input. Click-outside closes without restoring composer focus in both. The narrow model auto-focus difference is a real emulated-viewport focus regression; physical-device virtual-keyboard appearance was not tested.

Smallest owner correction is the original actual focus/portal/placement behavior and styles, not a new menu design or new keyboard system. Full activeElement/selection records are in `react-stage5b-all-menu-states/results.json`.

### Closing and interruption behavior

`/private/tmp/react-stage5b-overlay-close-motion.mjs` and `/private/tmp/react-stage5b-overlay-close-motion/results.json` record actual native animation frames and current panel heights. Fixtures intercept every8765 request. The first probe draft supplied only one text line and could not reach the original Expand control; it was corrected to the original three-line draft. The complete paired run then passed with zero errors/blocked requests.

- **Source modal matches:** settled Escape and Escape40ms into entrance both remove the original and React modal immediately; zero exit-animation calls. Original uses `in:fade`/`in:flyAndScale`, so an outro must not be invented.
- **Expanded Drawer matches:** settled Escape and Escape30ms into entrance both remove the original and React editor/modal immediately; zero exit-animation calls. Original Drawer uses `in:fly`, so no Drawer outro change is requested.
- **Details settled close:** both have300ms vertical slide from24.375px to0. Original marks its exiting panel inert; React did not.
- **[P2 parity] Details reversal fails:** during opening, original close starts from the current17.4323px height and runs214.55ms; React cancels and restarts at full24.375px for300ms. During closing, original reopen starts at current4.7787px and runs241.19ms; React restarts at0 for300ms. Exact observed values vary with frame timing; the invariant difference is current-pose/proportional-duration reversal versus restarting an endpoint. Preserve the same node, current progress, proportional duration and inert outro. Source modal/Drawer are not part of this finding.

Separate original dropdown controls show Chat actions and Regenerate settled close use200ms flyAndScale identity/opacity1→translateY-8px/scale.95/opacity0. Escape during entrance reverses its current pose with proportional duration (examples47.60ms/82.78ms). Those menu enter/outro omissions were assigned and owners report motion fixes landed; independent post-fix verification is still required. `/status` is an inline panel and records no native entrance/exit animation in either original or React; no status-motion fix is requested.

Commands used for these supplementary checks:

```sh
node /private/tmp/react-stage5b-extra-menu-motion.mjs
node /private/tmp/react-stage5b-extra-menu-settled-motion.mjs
node /private/tmp/react-stage5b-menu-geometry.mjs
node /private/tmp/react-stage5b-all-menu-states.mjs
node /private/tmp/react-stage5b-overlay-close-motion.mjs
```

Implementation ownership remains Chat for Chat actions/model menu and renderer for Regenerate/Details. Both owners received the concrete CSS/geometry, focus and reversal findings. The browser source pause was explicitly released after the consolidated runs; no browser probe remains pending from this round. Final fresh95 and corrected nongolden-menu review remain required.

## Final re-review preparation and repeat gate

The consolidated implementation now shares `desktop-shell/react/NativeDropdown.tsx` and `nativeMotion.tsx`. Read-only source review confirms the native default-viewport portal/flip/clamp behavior, focused `role=menu` root, Escape restoration only while the menu owns focus, outside close without restoration, no invented arrow-key roving, inert exit, and sampled current-progress/proportional-duration transition reversal. These code observations do not substitute for the pending paired runtime retakes. The model-row More Options trigger/action outcomes are being qualified against actual original behavior before the final source freeze; no action is accepted solely from dormant source.

The unchanged `migration-parity/capture.mjs` performs an independent fresh-context empty-page screenshot repeat and throws on unequal SHA256 hashes. That assertion executes before the complete index is written or the requested output directory is published. Each screenshot and its metadata have already been saved in the temporary `docqa-parity-capture-*` staging directory. Therefore a failed repeat must retain that staging directory, both raw PNG hashes, metadata, exact capture source hash, server/build identity and stderr. It is a failed repeat gate even if later investigation attributes its pixels to the narrowly accepted initial model/suggestion glyph raster variation.

Primary explicitly approved the following procedure: first run the unchanged harness; do not silently relax the check or rerun until green. If it fails, preserve and independently classify that failed run. A separately identified supplemental harness copy may then record **repeatFAIL** and continue the full95 matrix, retaining both hashes and marking its capture gate failed. That supplemental completion must never be reported as a raw repeat pass. Any review acceptance must separately cite matching canonical original/React controls for the exact affected regions, retain every raw difference, and state the limitation. The immutable originals and zero-tolerance comparator remain unchanged. No global threshold, mask, baseline update or production repaint hack is authorized.

Final full95, final menu-open light/dark/narrow appearance and focus, More Options outcomes, actual transition reversal, and immutable-reference hash verification remain pending. The report status remains **not passed** until those evidence-based classifications are complete.

## Production round5 full capture: real CSS precision regression

The first final run used the frozen round5 production preview at `http://127.0.0.1:4177`, with unchanged capture source and no retry. `/private/tmp/react-stage5b-final-run/run.json` retains the exact harness SHA, immutable original index SHA, exit0, both independent empty screenshot hashes, all95 staging PNG hashes and logs. The unchanged repeat assertion **passed**. Capture completed95 states, zero blocked requests, zero page errors, six expected HTTP console errors from failure fixtures. The unchanged comparator produced **30 identical /65 pixel differences /0 dimensions /0 missing** at `/private/tmp/react-stage5b-final-comparison/`. This is not accepted visual parity.

Production introduced a concrete color-precision change that must be fixed rather than waived. Three-port comparison of unchanged original5173, current React dev5176 and final production4177 shows original/dev `--tw-shadow` use `rgb(0 0 0 / 0.1)`; production minification rewrites it to `#0000001a`, whose alpha is26/255. Browser computed box-shadow serialization misleadingly rounds both to `.1`; the custom-property value and pixel control expose the difference. Original/dev editable text retains `oklch(0.373 0.034 259.733)` while production lowers it to `rgb(54,65,83)`. Evidence: `/private/tmp/react-stage5b-final-production-css/{results.json,5173.png,5176.png,4177.png}`.

A separate precise disposable-property control proves cause: paired typed original versus production has2559 changed pixels, max2. Restoring only native `--tw-shadow` leaves287, max1, in typed glyphs. Restoring the editable's original OKLCH color as well makes the **whole screenshot pixel identical (0)**. No baseline or screenshot was modified. Evidence: `/private/tmp/react-stage5b-final-css-cause/{5173-base.png,4177-base.png,4177-shadow.png,4177-shadow-color.png,results.json}` and script of the same name. Thus the extensive faint horizontal shadow rows and typed glyph edges are an actual build transformation regression, not accepted raster variation. Primary identified Vite's CSS-minification path and approved `build.cssMinify:false`; a fresh production build and new unchanged full95 run are required.

Supplemental round5 final menus completed against the same4177 build at `/private/tmp/react-stage5b-final-menus-complete/`: all four light/dark desktop/narrow menu rectangles, root/search focus, ArrowUp/Down/Home/End, Escape-to-composer and outside-close behavior match original. React has zero page errors/blocked requests. The original model menu produces its pre-existing unsupported-response JSON parse errors; no original behavior was repaired or hidden. The first supplementary draft selected `.app-dropdown-menu` for React Chat actions, whose correct skin class is `.chat-actions-menu`, and timed out after completing all original views; its partial outputs are preserved at `/private/tmp/react-stage5b-final-menus/`. The corrected full retake uses the actual classes and completed. Both browsers are now closed for the coordinated build correction. Narrow SVG residual acceptance remains pending the unminified production retake.

## Persistent placeholder294 diagnosis: omitted native pseudo placement

The earlier294 max1 placeholder pixels were **not** accepted as browser noise. Original `src/app.css:429` uses a floated, absolutely positioned, clamped pseudo-element on the empty Tiptap paragraph. React `answering/react/chat.css:24` used a static inline pseudo-element. Both colors are exactly `#676767`; the visible origin alone was insufficient to identify the paint boundary.

Authorized disposable dev5176/original5173 paired supported-answer controls prove the correction: original-versus-React has344 changed pixels; adding **only** `float:left; position:absolute` to React's empty pseudo reduces it to50, with all294 composer-placeholder differences removed. Remaining50 pixels are outside the placeholder, at header/user-question-bubble edges y17–173. Adding the native line-clamp/overflow/orientation rules preserves that zero placeholder difference. Evidence: `/private/tmp/react-stage5b-placeholder-cause/{5173-base.png,5176-base.png,5176-absolute.png,5176-native.png,results.json}` and `/private/tmp/react-stage5b-placeholder-cause.mjs`; full computed pseudo styles are retained. Primary assigned the faithful native pseudo style restoration before build6. This is a source-backed correction, not a pixel offset, repaint hack or tolerance. Browser closed after the completed paired probe.

### Retained round5 per-case raw difference ledger (rejected production build)

Every nonexact case from the rejected round5 run is listed below. These raw differences remain evidence; the later build6b comparison will independently determine whether each production CSS regression is gone. `CSS` means the confirmed production color/alpha transformation is present or must be excluded by the corrected-build retake; `shuffle` is the separately qualified native random suggestion permutation, and `safety/pointer` requires its explicit supported-state control. No row here is waived. The30 exact rows remain recorded in the complete comparison JSON.

| Case | Pixels | Max channel | Classification before corrected-build retake |
| --- | ---: | ---: | --- |
| `chat-empty-light-1440` | 7408 | 223 | CSS + shuffle/initial glyph controls pending |
| `chat-empty-light-1440-repeat` | 7408 | 223 | CSS + shuffle/initial glyph controls pending |
| `chat-typed-multiline-initial` | 7408 | 223 | CSS + shuffle/initial glyph controls pending |
| `chat-typed-multiline` | 2559 | 2 | CSS; retain until corrected-build comparison |
| `chat-answer-initial` | 7408 | 223 | CSS + shuffle/initial glyph controls pending |
| `chat-answer` | 3036 | 2 | CSS; retain until corrected-build comparison |
| `chat-sources-expanded` | 2742 | 2 | CSS; retain until corrected-build comparison |
| `chat-source-detail-modal` | 2741 | 1 | CSS; retain until corrected-build comparison |
| `chat-empty-light-390` | 6413 | 223 | CSS + shuffle/initial glyph controls pending |
| `chat-empty-dark-1440` | 5959 | 174 | CSS + shuffle/initial glyph controls pending |
| `chat-empty-dark-390` | 5698 | 174 | CSS + shuffle/initial glyph controls pending |
| `chat-insufficient-evidence-initial` | 10206 | 223 | CSS + shuffle/initial glyph controls pending |
| `chat-insufficient-evidence` | 3058 | 2 | CSS; retain until corrected-build comparison |
| `chat-request-failure-initial` | 10206 | 223 | CSS + shuffle/initial glyph controls pending |
| `chat-request-failure` | 3058 | 2 | CSS; retain until corrected-build comparison |
| `chat-history-save-failure-initial` | 10206 | 223 | CSS + shuffle/initial glyph controls pending |
| `chat-history-save-failure` | 3086 | 2 | CSS; retain until corrected-build comparison |
| `chat-rich-content-initial` | 7408 | 223 | CSS + shuffle/initial glyph controls pending |
| `chat-rich-content-top` | 8899 | 255 | CSS + explicit safety/pointer classification pending |
| `chat-rich-content-middle` | 4679 | 255 | CSS + explicit safety/pointer classification pending |
| `chat-rich-content-bottom` | 3036 | 2 | CSS; retain until corrected-build comparison |
| `chat-long-content-initial` | 7408 | 223 | CSS + shuffle/initial glyph controls pending |
| `chat-long-content-top` | 8899 | 255 | CSS + explicit safety/pointer classification pending |
| `chat-long-content-bottom` | 3036 | 2 | CSS; retain until corrected-build comparison |
| `chat-in-flight-initial` | 10212 | 223 | CSS + shuffle/initial glyph controls pending |
| `chat-in-flight` | 3768 | 204 | CSS + explicit safety/pointer classification pending |
| `chat-in-flight-complete` | 3086 | 2 | CSS; retain until corrected-build comparison |
| `chat-suggestion-hover-focus` | 10212 | 223 | CSS + shuffle/initial glyph controls pending |
| `chat-suggestion-hover` | 10340 | 242 | CSS + shuffle/initial glyph controls pending |
| `chat-suggestion-focus` | 15480 | 242 | CSS + shuffle/initial glyph controls pending |
| `chat-sidebar-expanded-light-initial` | 7408 | 223 | CSS + shuffle/initial glyph controls pending |
| `chat-sidebar-expanded-light` | 7408 | 223 | CSS + shuffle/initial glyph controls pending |
| `chat-sidebar-expanded-dark-initial` | 5959 | 174 | CSS + shuffle/initial glyph controls pending |
| `chat-sidebar-expanded-dark` | 5959 | 174 | CSS + shuffle/initial glyph controls pending |
| `chat-mobile-sidebar-overlay-initial` | 6413 | 223 | CSS + shuffle/initial glyph controls pending |
| `chat-mobile-sidebar-overlay` | 1122 | 10 | CSS + retained-pointer hover control pending |
| `library-files-selected` | 16 | 1 | CSS; retain until corrected-build comparison |
| `library-review-unchecked` | 22 | 1 | CSS; retain until corrected-build comparison |
| `library-review-checked` | 22 | 1 | CSS; retain until corrected-build comparison |
| `library-review-dark-initial` | 4 | 1 | CSS; retain until corrected-build comparison |
| `library-files-selected-dark` | 8 | 1 | CSS; retain until corrected-build comparison |
| `library-review-unchecked-dark` | 12 | 1 | CSS; retain until corrected-build comparison |
| `library-review-checked-dark` | 12 | 1 | CSS; retain until corrected-build comparison |
| `library-publication-failure-initial` | 6 | 2 | CSS; retain until corrected-build comparison |
| `library-publication-failure` | 4 | 1 | CSS; retain until corrected-build comparison |
| `history-record-open-dark-initial` | 8 | 1 | CSS; retain until corrected-build comparison |
| `history-record-open-dark` | 8 | 1 | CSS; retain until corrected-build comparison |
| `history-delete-clear` | 8 | 1 | CSS; retain until corrected-build comparison |
| `history-delete-outcome` | 8 | 1 | CSS; retain until corrected-build comparison |
| `history-failure-initial` | 10 | 4 | CSS; retain until corrected-build comparison |
| `history-failure` | 10 | 4 | CSS; retain until corrected-build comparison |
| `settings-updated-dark-initial` | 12 | 1 | CSS; retain until corrected-build comparison |
| `settings-updated-dark` | 4 | 1 | CSS; retain until corrected-build comparison |
| `settings-degraded-initial` | 12 | 1 | CSS; retain until corrected-build comparison |
| `settings-degraded` | 12 | 1 | CSS; retain until corrected-build comparison |
| `settings-error-initial` | 12 | 1 | CSS; retain until corrected-build comparison |
| `settings-error` | 12 | 1 | CSS; retain until corrected-build comparison |
| `library-dark-1440` | 6 | 2 | CSS; retain until corrected-build comparison |
| `history-dark-1440` | 8 | 1 | CSS; retain until corrected-build comparison |
| `history-persistence-off-dark` | 4 | 1 | CSS; retain until corrected-build comparison |
| `settings-dark-1440` | 12 | 1 | CSS; retain until corrected-build comparison |
| `root-light-1440` | 10206 | 223 | CSS + shuffle/initial glyph controls pending |
| `root-dark-1440` | 5959 | 174 | CSS + shuffle/initial glyph controls pending |
| `c-baseline-session-light-1440` | 10020 | 223 | CSS + shuffle/initial glyph controls pending |
| `c-baseline-session-dark-1440` | 8564 | 174 | CSS + shuffle/initial glyph controls pending |

## Corrected build6b full95 and supplementary qualification

The unchanged harness ran **once** against frozen production4177 build6b. Its independent empty repeat passed; no supplemental repeatFAIL harness or retry was needed. Evidence: `/private/tmp/react-stage5b-build6b-run/{run.json,capture.log,staging-0}` and `/private/tmp/react-stage5b-build6b-full/`. Capture:95 states, zero blocked requests, zero page errors, six expected HTTP failure-fixture console errors. Unmodified zero-tolerance comparator: **53 identical /42 pixel differences /0 dimensions /0 missing**, `/private/tmp/react-stage5b-build6b-comparison/`. All immutable original hashes were verified again.

The previously real precision/placeholder differences are gone: typed multiline, supported answer, expanded sources/source modal, rich bottom, long bottom, and every History/Settings golden state are now pixel identical. All nonexact final cases are classified in the final ledger below; no global pixel threshold or mask is used.

The first build6b supplementary menu retake (`/private/tmp/react-stage5b-build6b-menus/`) verifies exact geometry and focus for all three menus in desktop/narrow light/dark. ArrowDown/Up/Home/End now ran in **all four views**, retaining the same native root/search/trigger focus. Escape restores composer focus; click outside closes without restoration. React has zero page errors/blocked requests. The original model menu retains its pre-existing unsupported-response JSON parse errors; these are recorded rather than attributed to React.

It also caught a distinct source precision error: Chat/model menu CSS literally specified `#0000001a`, independently of the now-disabled build optimizer. Actual native shadow-lg uses `.1` alpha. Chat actions menu+20px shadow differs722/348 pixels (light/dark); model differs1554/660. Regenerate's shared native utility shadow is already exact on desktop. Primary assigned exactly four Chat CSS alpha replacements, no JavaScript or other CSS. These menu selectors are absent from the95 closed-menu golden states; primary explicitly retained build6b full95 as evidence and required a scoped production build7 menu retake. The raw build6b supplementary differences remain preserved.

### Narrow vector and rounded-edge controls

`/private/tmp/react-stage5b-build6b-svg-cause/` independently records the two LineSpace SVGs in both narrow themes, every SVG/path noncustom computed style, every path rectangle and screen CTM, and parent styles. All original/React styles, path data, rectangles and matrices match. Both screen CTMs are exactly `[0.5833333333333334,0,0,0.5833333333333334,85,668.6875]` and the second icon uses y695.6875. Raw whole-screen residuals are9 light pixels (max11, one at panel corner82,718) and8 dark pixels (max9), localized to x90–97/y673–707. Ordinary item hover+neutral does not change them. Cloning the original's **same** SVG DOM changes6 pixels with max11/light or9/dark, without a style/geometry change; cloning React's DOM does not change it. Original-clone versus React-base still has7 light/max2 and6 dark/max1 edge pixels. This is concrete paint-history sensitivity, not an assertion about unproved browser internals or an arbitrary channel waiver. No SVG path/color/size fix or production repaint hack is justified by these controls.

`/private/tmp/react-stage5b-build6b-corners/` records fresh original/React Library-dark and supported-answer controls. Fresh original Library versus its immutable frozen image itself varies12 max1 header/title-edge pixels. Matched fresh original versus React differs14 max2: those12 plus exactly two Library panel corner pixels `(519,374)` and `(519,391)`. Both panels, service-status and preference switch have identical complete noncustom computed styles and rectangles. Ordinary header hover+neutral leaves them unchanged. The paired supported-answer has28 max1 pixels only in the user-question bubble’s rounded-edge region x1062–1290/y141–172; composer and answer content are exact. These exact residual regions are retained for an explicit narrow vector/corner/glyph raster classification; no ordinary typography, palette, geometry or controls are waived.

## Final Stage5B acceptance

**Accepted for the Stage5 visual/interaction gate. No open owner correction remains.** This is a human classification of retained raw differences, not a claim that all95 PNGs are pixel identical. Primary explicitly accepted the narrowly evidenced initial text raster variation and the exact vector/rounded-edge regions below. All originally confirmed ordinary layout, typography, color, control, focus and motion regressions were corrected and verified. No masks, tolerance changes, original regeneration, production repaint/delay hacks or rerun-until-green were used.

Final evidence consists of unchanged full95 production **build6b** (53 identical/42 pixel differences, original hashes verified) plus scoped **build7** open-menu and interaction checks. Build7 changed only four literal shadow alpha values in the two open-menu presets; these selectors are not active in the95 fixed golden states. Primary explicitly retained full6b and required scoped build7 retakes. Both unchanged full captures (round5 rejected and build6b final) passed the independent repeated empty-page assertion; no repeatFAIL continuation was needed. The earlier production CSS precision regression and all raw failed evidence remain preserved.

All eight final scoped browser scripts exited0, sequentially, against the same frozen production4177 origin with full Chromium151.0.7922.34 and every8765 request intercepted. All browser processes were closed before this acceptance handoff. Primary has subsequently stopped the owned comparison servers and authorized Stage6; this report does not imply post-cleanup parity. Production screenshots after cleanup are a separate required gate.

### Final matched controls

- **Menus:** all three desktop menu plus20px-shadow crops are pixel identical in both themes. Narrow Chat actions has one max1 corner pixel in each theme; model has one light/two dark max1 corner pixels. Narrow Regenerate retains the exact9 light/8 dark vector/corner pixels qualified above. Every menu rectangle, root/search/mobile-trigger focus, ArrowDown/ArrowUp/Home/End, Escape-to-composer, and outside-close behavior matches in all four views. No new arrow roving was introduced. Original model-menu unsupported-response JSON parse errors remain recorded; React has zero page errors/blocked requests.
- **More Options actual outcomes:** original and React submenu rectangles match210×60, at desktop `(936.5,586.125)` and narrow `(95.5,524.90625)`. Copy Link produces the respective same-origin `/?model=secure-qa-local`, without toast. Keep in Sidebar changes the live menu to Hide from Sidebar and exposes Models/Document Assistant locally; Hide reverses it. No pinned-model persistence is invented. Original then attempts unsupported `/api/v1/users/user/settings/update` POSTs and receives parse errors; React retains the observable local state without adding that API. Both request histories and empty pin-storage observations are retained.
- **Pinned sidebar:** all12 desktop light/dark/FR/DE sidebar crops (pinned, Shift/unpin, collapsed) and the new narrow Models state are pixel identical. Tooltip/local folder toggle/unpin/re-pin and `/?model=secure-qa-local` navigation match; navigation preserves the local pin, produces zero answering/history writes, and keeps native mobile sidebar state. Original empty Tiptap `innerText` is `\n`, React empty contenteditable is `''`; both are semantically empty and render identically.
- **Initial paint:** three fresh canonical same-content React contexts yield exact/6667-edge-pixels/exact before interaction. The drifted run is restricted to the previously qualified initial model/suggestion glyph/corner regions; ordinary suggestion hover+neutral makes **all three whole screenshots exact**. Every captured text-node range, computed style and finished animation record stays unchanged. This repeats the earlier no-source-change control on final production; it does not establish unproved browser internals. Original/current and accepted-reference bridges are retained in the earlier diagnosis.
- **Suggestion hover/focus and mobile pointer:** final canonical initial suggestions, actual Summarize hover, keyboard focus, mobile sidebar retained pointer and neutral pointer in both reduced and ordinary motion modes are all **whole-image pixel identical**. The raw fixed95 permutation moves the actual hovered/focused suggestion between rows; the736 mobile pixels are the qualified retained logo-hover state.
- **Rich pointer:** identical seeded interaction recipes click original Summarize at y682.375 and React at y586.375 because the original editor consumes a different number of random calls. Original retained pointer leaves Python Tippy visible; React does not. Moving both to neutral reduces raw5863 differences to595. Intentional Python hover makes both tooltips visible at exactly `(448,668,59.125,28)` and still has595 differences:594 from the approved missing Run/control reflow and one Mermaid glyph edge pixel. The sampled leaf span's `:hover` is false in both; the actual reference parent and Tippy visibility/rectangle are retained, so a leaf-only hover check is not substituted for the real tooltip state.
- **Motion:** Regenerate actual original/React entrance200ms, interrupted close97.6ms from opacity.488, interrupted reopen187.8ms from.061, settled close200ms; DOM retained and inert only on exit. Details entrance300ms, reverse close201.696ms, reopen293.697ms, settled exit300ms, same retained DOM/inert semantics. Final suggestion animations are200ms with0/45/90ms delays and original color-transition timing. Source modal and expanded Drawer retain their earlier verified entry-only motion and instantaneous settled/interrupted Escape removal; no unsupported outro was added. Active outer Chat fade50ms and model dropdown200ms were separately verified in the runtime logs above; dormant Placeholder directives were not invented.

**Region correction:** the three residual rich-middle pixels `(857,876)`, `(854,878)`, `(855,878)` are on the rounded **Scroll to bottom button**, over the Vega plot. They are not Vega text or chart-color differences. The enlarged paired crop is `stage5-final-rich-pointer/5173-middle-diff-region.png`; corresponding original/React RGB values are `(101,138,179)→(103,140,180)`, `(229,232,235)→(226,229,233)`, `(157,179,202)→(159,180,203)`. Native round-button classes and filled-arrow path are retained. All ten paired SVG text geometries and painted typography/fill values match; only inherited list-style differs, which does not paint an SVG text node. No Vega font/color waiver is made. Likewise the28 max1 pixels at x1062–1290/y141–172 are the **user-question bubble's rounded edges**, not a model-label glyph difference; earlier location guesses are corrected here.

### Classification key for every final raw case

| Code | Exact scope and evidence |
| --- | --- |
| EXACT | All RGBA pixels identical to the immutable original. |
| S | Native random suggestion permutation only: original config/order/sort retained; original editor consumes different random calls. Same-content canonical initial/hover/focus screenshots are exact. No copy, control or layout is concealed. |
| I | Specifically evidenced initial model/suggestion glyph-edge raster variation, with identical ranges/styles/fonts/finished motion and final production exact→drifted→exact repeated controls plus normal-hover exact repaint. No general text tolerance. |
| F | Hover/focus belongs to the actual selected suggestion, which moved rows under S; same-content canonical hover/focus is whole-image exact. |
| H1 | Header service-dot/switch rounded edges within the listed raw bounding box; complete sampled native styles/rects match. Fresh original itself varies against the frozen header. No palette or dimensional change. |
| H2 |28 max1 user-question-bubble rounded-edge pixels at x1062–1290/y141–172; native bubble presentation retained. No glyph or copy difference. |
| H3 | Exactly two dark Library panel corner pixels `(519,374)`, `(519,391)`, max2; complete panel computed styles and rectangles match. |
| H4 | Exactly three rich-middle rounded Scroll to bottom button pixels listed above, max3; native classes/path retained. No Vega content difference. |
| V | One Mermaid A glyph-edge pixel `(857,876)`, max2; corrected root16px/Arial rule, identical19px glyph rectangle, text/style/font/fill and measured geometry. Narrow LineSpace supplementary residuals are separately bounded by exact paths/styles/screenCTMs and original same-SVG clone sensitivity. |
| P1 |736px retained mobile logo-hover state; same-pointer final paired reduced/ordinary-motion screenshots both0. |
| P2 |5268px Python Tippy/reference hover state induced by S's different click position; matched neutral or intentional hover removes it. No tooltip control is missing. |
| E1 |594px Python Run omission and resulting Collapse reflow: explicit approved no-code-execution exception. Other safe controls/paths preserved. |
| E2 |1046px inert blocked-frame placeholder icon: explicit approved no executable/untrusted iframe exception, same150px frame area. |
| E3 |732px omitted cosmetic Stop control in pending answer: explicit approved truthful cancellation/one-job exception; no fake cancellation or overlapping Send now. |

All raw images/overlays remain unchanged. The table's bounds are observations, not masks. A count alone never selects an allowance. The following ledger exhausts the95 cases, including all42 raw differences.

| Case | Changed pixels | Max channel | Raw bounding box | Classification |
| --- | ---: | ---: | --- | --- |
| `chat-empty-light-1440` | 4846 | 223 | [435, 596, 605, 723] | S |
| `chat-empty-light-1440-repeat` | 4846 | 223 | [435, 596, 605, 723] | S |
| `chat-typed-multiline-initial` | 4846 | 223 | [435, 596, 605, 723] | S |
| `chat-typed-multiline` | 0 | 0 | — | EXACT |
| `chat-answer-initial` | 4846 | 223 | [435, 596, 605, 723] | S |
| `chat-answer` | 0 | 0 | — | EXACT |
| `chat-sources-expanded` | 0 | 0 | — | EXACT |
| `chat-source-detail-modal` | 0 | 0 | — | EXACT |
| `chat-empty-light-390` | 4846 | 223 | [34, 535, 204, 662] | S |
| `chat-empty-dark-1440` | 4848 | 174 | [435, 596, 605, 723] | S |
| `chat-empty-dark-390` | 4848 | 174 | [34, 535, 204, 662] | S |
| `chat-insufficient-evidence-initial` | 7649 | 223 | [537, 502, 1207, 723] | S + I |
| `chat-insufficient-evidence` | 50 | 1 | [262, 17, 1291, 173] | H1 + H2 (22 +28) |
| `chat-request-failure-initial` | 7644 | 223 | [537, 509, 1150, 723] | S + I |
| `chat-request-failure` | 22 | 1 | [262, 17, 1147, 31] | H1 |
| `chat-history-save-failure-initial` | 4846 | 223 | [537, 596, 707, 723] | S |
| `chat-history-save-failure` | 22 | 1 | [262, 17, 1147, 31] | H1 |
| `chat-rich-content-initial` | 7644 | 223 | [537, 509, 1150, 723] | S + I |
| `chat-rich-content-top` | 5863 | 255 | [431, 668, 1187, 877] | E1 + P2 + V (594 +5268 +1) |
| `chat-rich-content-middle` | 1643 | 255 | [827, 144, 1187, 879] | E1 + E2 + H4 (594 +1046 +3) |
| `chat-rich-content-bottom` | 0 | 0 | — | EXACT |
| `chat-long-content-initial` | 7644 | 223 | [537, 509, 1150, 723] | S + I |
| `chat-long-content-top` | 5863 | 255 | [431, 668, 1187, 877] | E1 + P2 + V (594 +5268 +1) |
| `chat-long-content-bottom` | 0 | 0 | — | EXACT |
| `chat-in-flight-initial` | 7644 | 223 | [537, 509, 1150, 723] | S + I |
| `chat-in-flight` | 732 | 204 | [1260, 945, 1290, 975] | E3 |
| `chat-in-flight-complete` | 50 | 1 | [262, 17, 1291, 173] | H1 + H2 (22 +28) |
| `chat-suggestion-hover-focus` | 4846 | 223 | [537, 596, 707, 723] | S |
| `chat-suggestion-hover` | 4910 | 242 | [537, 596, 707, 723] | S + F |
| `chat-suggestion-focus` | 10350 | 242 | [527, 586, 1159, 730] | S + F |
| `chat-sidebar-expanded-light-initial` | 7644 | 223 | [537, 509, 1150, 723] | S + I |
| `chat-sidebar-expanded-light` | 7644 | 223 | [537, 509, 1150, 723] | S + I |
| `chat-sidebar-expanded-dark-initial` | 4848 | 174 | [537, 596, 707, 723] | S |
| `chat-sidebar-expanded-dark` | 4848 | 174 | [537, 596, 707, 723] | S |
| `chat-mobile-sidebar-overlay-initial` | 4846 | 223 | [34, 535, 204, 662] | S |
| `chat-mobile-sidebar-overlay` | 736 | 10 | [4, 6, 38, 36] | P1 |
| `library-initial-narrow` | 0 | 0 | — | EXACT |
| `library-review-unchecked-initial` | 0 | 0 | — | EXACT |
| `library-files-selected` | 0 | 0 | — | EXACT |
| `library-review-unchecked` | 22 | 1 | [262, 17, 1147, 31] | H1 |
| `library-review-checked` | 22 | 1 | [262, 17, 1147, 31] | H1 |
| `library-review-dark-initial` | 0 | 0 | — | EXACT |
| `library-files-selected-dark` | 4 | 1 | [1133, 17, 1147, 21] | H1 |
| `library-review-unchecked-dark` | 10 | 1 | [1133, 17, 1147, 31] | H1 |
| `library-review-checked-dark` | 10 | 1 | [1133, 17, 1147, 31] | H1 |
| `library-review-narrow-initial` | 0 | 0 | — | EXACT |
| `library-review-narrow` | 0 | 0 | — | EXACT |
| `library-publication-progress-initial` | 0 | 0 | — | EXACT |
| `library-publication-progress` | 0 | 0 | — | EXACT |
| `library-publication-result` | 0 | 0 | — | EXACT |
| `library-rollback-result` | 0 | 0 | — | EXACT |
| `library-cancelable` | 0 | 0 | — | EXACT |
| `library-cancellation-result` | 0 | 0 | — | EXACT |
| `library-publication-failure-initial` | 2 | 2 | [519, 374, 520, 392] | H3 |
| `library-publication-failure` | 17 | 1 | [259, 17, 273, 31] | H1 |
| `history-empty` | 0 | 0 | — | EXACT |
| `history-request-pending` | 0 | 0 | — | EXACT |
| `history-request-settled` | 0 | 0 | — | EXACT |
| `history-record-open-initial` | 0 | 0 | — | EXACT |
| `history-record-open` | 0 | 0 | — | EXACT |
| `history-source-expanded` | 0 | 0 | — | EXACT |
| `history-record-open-dark-initial` | 0 | 0 | — | EXACT |
| `history-record-open-dark` | 0 | 0 | — | EXACT |
| `history-record-open-narrow-initial` | 0 | 0 | — | EXACT |
| `history-record-open-narrow` | 0 | 0 | — | EXACT |
| `history-delete-clear` | 0 | 0 | — | EXACT |
| `history-delete-outcome` | 0 | 0 | — | EXACT |
| `history-clear-confirmation` | 0 | 0 | — | EXACT |
| `history-clear-outcome` | 0 | 0 | — | EXACT |
| `history-failure-initial` | 0 | 0 | — | EXACT |
| `history-failure` | 0 | 0 | — | EXACT |
| `settings-updated-initial` | 0 | 0 | — | EXACT |
| `settings-updated` | 0 | 0 | — | EXACT |
| `settings-persistence-off` | 0 | 0 | — | EXACT |
| `settings-updated-dark-initial` | 0 | 0 | — | EXACT |
| `settings-updated-dark` | 0 | 0 | — | EXACT |
| `settings-persistence-off-dark` | 0 | 0 | — | EXACT |
| `settings-degraded-initial` | 0 | 0 | — | EXACT |
| `settings-degraded` | 0 | 0 | — | EXACT |
| `settings-error-initial` | 0 | 0 | — | EXACT |
| `settings-error` | 0 | 0 | — | EXACT |
| `library-light-1440` | 0 | 0 | — | EXACT |
| `library-dark-1440` | 2 | 2 | [519, 374, 520, 392] | H3 |
| `history-light-1440` | 0 | 0 | — | EXACT |
| `history-persistence-off-light` | 0 | 0 | — | EXACT |
| `history-dark-1440` | 0 | 0 | — | EXACT |
| `history-persistence-off-dark` | 0 | 0 | — | EXACT |
| `history-light-390` | 0 | 0 | — | EXACT |
| `settings-light-1440` | 0 | 0 | — | EXACT |
| `settings-dark-1440` | 0 | 0 | — | EXACT |
| `settings-light-390` | 0 | 0 | — | EXACT |
| `root-light-1440` | 7644 | 223 | [537, 509, 1150, 723] | S + I |
| `root-dark-1440` | 4848 | 174 | [537, 596, 707, 723] | S |
| `c-baseline-session-light-1440` | 7453 | 223 | [537, 596, 717, 723] | S |
| `c-baseline-session-dark-1440` | 7453 | 174 | [537, 596, 717, 723] | S |

### Durable final evidence and commands

Primary copied final evidence under `docs/development/react-migration/evidence/` before starting cleanup:

| Durable directory | Contents / executed script |
| --- | --- |
| `stage5-production-visual` | Complete unchanged build6b95 capture, metadata/index and all candidate hashes. |
| `stage5-production-comparison` | Unmodified comparator JSON, every original/candidate hash and all42 raw overlays. |
| `stage5-final-menus` |24 paired original/production menu PNGs, full DOM/styles/rects/focus/keys, comparison JSON, `probe.mjs`. |
| `stage5-final-more` | Actual clipboard/local pin/hide observations, native unsupported requests/errors, menu PNGs, `probe.mjs`. |
| `stage5-final-pinned` |13 exact sidebar/state comparisons, local navigation/unpin/collapse/locale results, `probe.mjs`. |
| `stage5-final-empty-control` | Exact/drifted/exact fresh contexts, unchanged text ranges/styles/motion before/after normal hover, `probe.mjs`. |
| `stage5-final-rich-pointer` | Retained/neutral/intentional Tippy and rich-middle pairs; SVG text evidence and enlarged scroll-button crop, `probe.mjs`. |
| `stage5-final-regenerate-motion` | Actual deterministic native entrance/reversal/exit assertions, `probe.mjs`. |
| `stage5-final-details-motion` | Actual native Details duration/current-pose/DOM/inert assertions, `probe.mjs`. |
| `stage5-final-interactions` | Exact canonical suggestion hover/focus and mobile pointer/reduced/ordinary motion pairs; native animation observations, `probe.mjs`. |

Executed sources remain `/private/tmp/react-stage5b-build7-{more,menus,pinned,empty-control,rich-pointer,regenerate-motion,details-motion,interactions}.mjs`; sequential execution manifest/logs are `/private/tmp/react-stage5b-build7-driver/`. Earlier diagnostic scripts and JSON/PNG paths above remain necessary for the causal findings; parent is preserving selected diagnostics. The exact executed temporary probes embed this workspace path and4177/5173; retained `probe.mjs` copies should be run with those endpoints or explicitly adjusted to the later review servers, preserving original/candidate identity. Do not silently repoint or replace accepted evidence.

Final full commands:

```sh
python3 /private/tmp/react-stage5b-final-capture-wrapper.py http://127.0.0.1:4177 /private/tmp/react-stage5b-build6b-full /private/tmp/react-stage5b-build6b-run
python3 app/document-qa/frontend/migration-parity/compare.py app/document-qa/frontend/migration-parity/original /private/tmp/react-stage5b-build6b-full /private/tmp/react-stage5b-build6b-comparison
python3 /private/tmp/react-stage5b-build7-driver.py
```

First command exit0 (95/repeat PASS); second exit1 deliberately reports the42 retained raw pixel differences; final driver all8 exit0. Original index SHA remains **560ed579f85718b5cc71f9569fd0eb6cde4d7ae92850ee38f1f75e581aa422b1**, and all95 original PNG hashes match acceptance. Final review outcome is **accepted with the enumerated native nondeterministic-state, narrow raster and explicit safety classifications**, not a zero-difference comparator result. No application implementation, Git index/history, original reference or user service/data was changed by this reviewer. This report remains the only repository write by5B.
