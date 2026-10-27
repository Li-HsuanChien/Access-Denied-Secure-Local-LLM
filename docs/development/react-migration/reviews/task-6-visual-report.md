# Stage6 post-cleanup visual gate

Status: **accepted; no new cleanup drift or missing asset found.** Read-only review of the frozen canonical production `build/` served at `http://127.0.0.1:4177`. No application/harness/reference changes or subagents. Every8765 request was intercepted with fixtures. Port5173 was not used: the original was stopped and that port temporarily served a fresh React checkout. User5174/8765 and user data were untouched.

## Unchanged full95 capture and two comparisons

The existing capture harness ran once with a unique output root; full Chrome for Testing was explicitly selected through `chromium.executablePath()`, Chromium151.0.7922.34. The independent empty-page repeat **passed**, capture exit0,95 screenshots, zero page errors, zero blocked requests. Six console errors are only the expected503/500 failure fixtures. No retry, repeat relaxation, masks, tolerance or baseline changes.

Capture harness SHA256 is exactly the accepted pre-cleanup value: `61eef301e5bedc10a10505aa18ad88f0c2109e45f9700bf661e4e457463fffa9`. Original index SHA256 remains `560ed579f85718b5cc71f9569fd0eb6cde4d7ae92850ee38f1f75e581aa422b1`; the unchanged comparator verified all95 original PNG hashes again.

| Reference | Identical | Pixel differences | Dimensions | Missing |
| --- | ---: | ---: | ---: | ---: |
| Immutable original95 |54 |41 |0 |0 |
| Accepted pre-cleanup build6b95 |79 |16 |0 |0 |

The immutable-original comparison used the unchanged CLI. Candidate-to-candidate comparison imports that same module's `compare_images` function, verifies each accepted6b PNG against its existing index, and compares every RGBA channel at zero tolerance. No ACCEPTED marker was manufactured for the candidate and no reference directory was altered. Both raw results retain complete hashes, bounds and overlays. Human acceptance below classifies the existing variation; neither result is represented as95 pixel-identical.

## All16 changes relative to the accepted pre-cleanup candidate

Every difference is in a previously qualified Stage5 region: initial text/model-selector paint (including its five small selector-edge pixels), header/switch edges, the user-question bubble's28 rounded-edge pixels, or Library panel corners. There is no new body layout, font, color, control, missing class or asset drift. Stage5B's full same-source/range/style/font/normal-hover controls and explicit raster decisions remain applicable; no new threshold is introduced.

A strong independent-reference control closes the Library-dark qualification: the cleaned `library-dark-1440.png` is **whole-screen pixel identical** to the retained fresh original Stage5 control `/private/tmp/react-stage5b-build6b-corners/5173-library-dark-base.png`. Its14 pixels relative to accepted6b are therefore an already observed native paint state, not a cleanup change. Those14 consist of ten switch-edge pixels, original panel-top-left `(502,184)`/`(500,186)`, and the previously qualified bottom-corner `(519,374)`/`(519,391)` pixels. The original/control and React panels already have identical complete computed paint styles and rectangles. The post-cleanup `library-review-dark-initial` combines the same known corner/header states.

| Case | Pixels | Max channel | Bounds | Existing classification |
| --- | ---: | ---: | --- | --- |
| `chat-insufficient-evidence-initial` | 5 | 2 | [1181, 502, 1207, 526] | Qualified initial model/suggestion text/selector paint; Stage5 I |
| `chat-insufficient-evidence` | 28 | 1 | [1062, 141, 1291, 173] | 28 user-question bubble rounded-edge pixels; Stage5 H2 |
| `chat-request-failure-initial` | 5 | 2 | [1181, 502, 1207, 526] | Qualified initial model/suggestion text/selector paint; Stage5 I |
| `chat-history-save-failure-initial` | 6667 | 129 | [537, 502, 1207, 723] | Qualified initial model/suggestion text/selector paint; Stage5 I |
| `chat-history-save-failure` | 28 | 1 | [1062, 141, 1291, 173] | 28 user-question bubble rounded-edge pixels; Stage5 H2 |
| `chat-rich-content-initial` | 6662 | 129 | [537, 509, 1150, 723] | Qualified initial model/suggestion text/selector paint; Stage5 I |
| `chat-long-content-initial` | 6662 | 129 | [537, 509, 1150, 723] | Qualified initial model/suggestion text/selector paint; Stage5 I |
| `chat-in-flight-initial` | 6662 | 129 | [537, 509, 1150, 723] | Qualified initial model/suggestion text/selector paint; Stage5 I |
| `chat-sidebar-expanded-light-initial` | 6662 | 129 | [537, 509, 1150, 723] | Qualified initial model/suggestion text/selector paint; Stage5 I |
| `chat-sidebar-expanded-light` | 6662 | 129 | [537, 509, 1150, 723] | Qualified initial model/suggestion text/selector paint; Stage5 I |
| `library-files-selected` | 16 | 1 | [262, 17, 1147, 28] | Previously qualified header/switch edge state; Stage5 H1 |
| `library-review-dark-initial` | 14 | 2 | [500, 17, 1147, 392] | Existing native header/panel corner state, including exact old-original control |
| `library-review-unchecked-dark` | 10 | 1 | [1133, 17, 1147, 31] | Previously qualified header/switch edge state; Stage5 H1 |
| `library-review-checked-dark` | 10 | 1 | [1133, 17, 1147, 31] | Previously qualified header/switch edge state; Stage5 H1 |
| `library-publication-failure` | 17 | 1 | [259, 17, 273, 31] | Previously qualified header/switch edge state; Stage5 H1 |
| `library-dark-1440` | 14 | 2 | [500, 17, 1147, 392] | Existing native header/panel corner state, including exact old-original control |

## All41 raw differences against immutable originals

Codes refer to the final classification key in `task-5b-report.md`: S native random permutation, I narrowly qualified initial paint, F focus/hover on the moved suggestion, H header/rounded edges, P retained-pointer state, V one Mermaid edge pixel, E explicit approved safety exceptions. The new cleanup introduces none of these allowances. Every row below retains its raw overlay; the other54 states are exactly identical in the comparison JSON.

| Case | Pixels | Max channel | Classification |
| --- | ---: | ---: | --- |
| `chat-empty-light-1440` | 4846 | 223 | S |
| `chat-empty-light-1440-repeat` | 4846 | 223 | S |
| `chat-typed-multiline-initial` | 4846 | 223 | S |
| `chat-answer-initial` | 4846 | 223 | S |
| `chat-empty-light-390` | 4846 | 223 | S |
| `chat-empty-dark-1440` | 4848 | 174 | S |
| `chat-empty-dark-390` | 4848 | 174 | S |
| `chat-insufficient-evidence-initial` | 7644 | 223 | S + I |
| `chat-insufficient-evidence` | 22 | 1 | H1:qualified header/switch edges |
| `chat-request-failure-initial` | 7649 | 223 | S + I |
| `chat-request-failure` | 22 | 1 | H1:qualified header/switch edges |
| `chat-history-save-failure-initial` | 7649 | 223 | S + I |
| `chat-history-save-failure` | 50 | 1 | H1 + H2:22 header +28 user-bubble edges |
| `chat-rich-content-initial` | 4846 | 223 | S |
| `chat-rich-content-top` | 5863 | 255 | E1 + P2 + V:594 Run/reflow +5268 pointer tooltip +1 Mermaid |
| `chat-rich-content-middle` | 1643 | 255 | E1 + E2 + H4:594 Run/reflow +1046 inert-frame icon +3 scroll-button edges |
| `chat-long-content-initial` | 4846 | 223 | S |
| `chat-long-content-top` | 5863 | 255 | E1 + P2 + V:594 Run/reflow +5268 pointer tooltip +1 Mermaid |
| `chat-in-flight-initial` | 4846 | 223 | S |
| `chat-in-flight` | 732 | 204 | E3:732 omitted cosmetic Stop pixels |
| `chat-in-flight-complete` | 50 | 1 | H1 + H2:22 header +28 user-bubble edges |
| `chat-suggestion-hover-focus` | 4846 | 223 | S |
| `chat-suggestion-hover` | 4910 | 242 | S + F |
| `chat-suggestion-focus` | 10350 | 242 | S + F |
| `chat-sidebar-expanded-light-initial` | 4846 | 223 | S |
| `chat-sidebar-expanded-light` | 4846 | 223 | S |
| `chat-sidebar-expanded-dark-initial` | 4848 | 174 | S |
| `chat-sidebar-expanded-dark` | 4848 | 174 | S |
| `chat-mobile-sidebar-overlay-initial` | 4846 | 223 | S |
| `chat-mobile-sidebar-overlay` | 736 | 10 | P1:736 retained mobile logo-hover pixels |
| `library-files-selected` | 16 | 1 | H1:qualified header/switch edges |
| `library-review-unchecked` | 22 | 1 | H1:qualified header/switch edges |
| `library-review-checked` | 22 | 1 | H1:qualified header/switch edges |
| `library-review-dark-initial` | 14 | 2 | Known header/panel-corner states proved by retained native control |
| `library-files-selected-dark` | 4 | 1 | H1:qualified header/switch edges |
| `library-publication-failure-initial` | 2 | 2 | H3:two panel corner pixels |
| `library-dark-1440` | 12 | 1 | 12 native header/panel-top-left edge pixels; exact old-original control |
| `root-light-1440` | 7644 | 223 | S + I |
| `root-dark-1440` | 4848 | 174 | S |
| `c-baseline-session-light-1440` | 7453 | 223 | S |
| `c-baseline-session-dark-1440` | 7453 | 174 | S |

## Menu and pinned-sidebar cleanup checks

Candidate-only screenshots used the same4177 production build and identical canonical fixtures/random values. Reference screenshots are accepted build7 evidence, not a server on5173.

- **All12 whole menu screenshots are pixel identical** to accepted build7: Chat actions, Regenerate and model menu in desktop1440×1000/narrow390×844, light/dark. Geometry/focus metadata also matches and every case has zero page errors/blocked requests. This confirms the retained utility/skin/shadow/icon graph, including the earlier narrow SVG raster state, did not change during pruning.
- **All seven sidebar/mobile representative crops are pixel identical**: light/dark pinned, Shift/unpin and collapsed states, plus narrow pinned overlay. Dark and mobile whole screenshots are also exact. Three light whole screenshots differ only by the existing initial suggestion glyph paint in `(537,596)–(717,723)` (5863pixels, max129); their entire sidebar region is0. No pin/model icon or presentation is missing. Existing local pin/unpin/folder/navigation observations still match; no new behavior audit was added.

## Asset request verification

The fixture rich-answer asset probe recorded **40 actual local-preview responses and five intercepted local-service fixture responses, all200**. Zero external responses, failed requests, page errors or blocked requests. Both favicon routes return actual PNG, not a SPA fallback: `/favicon.png` and `/static/favicon.png`, each200/image/png/21666bytes; observed UI images are loaded512×512.

Inter and Vazirmatn were explicitly loaded through `document.fonts`, and both report loaded. Used KaTeX_Main and KaTeX_Math faces also report loaded after the real rich fixture; unused declared math variants remain normally unloaded. No needed font/favicon was pruned. The full95 console audit likewise shows no asset404 or decode failure. This is a browser/resource verification of the selected scope, not a claim about dormant unused font variants.

## Evidence and reproduction

All outputs remain separate from the accepted references and frontend watched tree:

| Path | Evidence |
| --- | --- |
| `/private/tmp/react-stage6-visual-full` | Complete95 screenshots/metadata/index and raw hashes. |
| `/private/tmp/react-stage6-visual-run` | Once-only capture log, source/original hashes, PASS manifest and complete retained staging. |
| `/private/tmp/react-stage6-visual-vs-original` | Unchanged comparator JSON plus41 raw overlays. |
| `/private/tmp/react-stage6-visual-vs-precleanup` | Same zero-tolerance image function, verified accepted6b hashes,16 raw overlays. |
| `/private/tmp/react-stage6-visual-menus` |12 exact whole-image comparisons, PNGs, menu metadata and `comparison.json`. |
| `/private/tmp/react-stage6-visual-pinned` | Seven exact sidebar/mobile comparisons, full raw PNGs and known whole-page glyph variation. |
| `/private/tmp/react-stage6-visual-assets` | All response URLs/status/MIME types, font/image/favicon results and summary. |
| `/private/tmp/react-stage6-visual-portable` | Portable candidate-only menus/pin/assets probes, once-only capture wrapper and zero-tolerance candidate comparison; README. |

Executed script sources are `/private/tmp/react-stage6-visual-{menus,pinned,assets}.mjs`; all exited0. Portable copies only replace workspace discovery/output/port wiring and pass `node --check`; they do not re-run or alter evidence. Set `PARITY_REPO_ROOT` if not launching from repository root, `PARITY_PORT` for the candidate preview and a fresh `PARITY_OUTPUT_DIR` per probe. All are candidate-only; none opens5173/5174. Original/accepted references remain fixed directories.

Executed capture/comparison commands:

```sh
python3 /private/tmp/react-stage5b-final-capture-wrapper.py http://127.0.0.1:4177 /private/tmp/react-stage6-visual-full /private/tmp/react-stage6-visual-run
python3 app/document-qa/frontend/migration-parity/compare.py app/document-qa/frontend/migration-parity/original /private/tmp/react-stage6-visual-full /private/tmp/react-stage6-visual-vs-original
node /private/tmp/react-stage6-visual-menus.mjs
node /private/tmp/react-stage6-visual-pinned.mjs
node /private/tmp/react-stage6-visual-assets.mjs
```

The pre-cleanup comparison was executed inline using the unchanged module function; its reproducible form is `compare-candidate.py` in the portable directory. Capture/probes exit0; immutable comparator exit1 reports the41 intentionally retained classified raw differences. No test or comparison hides them. Every original PNG hash remains valid. All browsers are now closed; no independent visual blocker remains for the post-cleanup gate.
