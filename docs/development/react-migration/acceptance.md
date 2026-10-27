# React migration acceptance

The approved [execution plan](../react-frontend-migration-scope.md) replaces the supported interface with React while preserving its observed appearance and actions. The original baseline is commit `4dc2a06a4fc57ff393ea43ef4b75014b1458eb9b`.

**Status:** all eight migration stages completed on 2026-10-21. Independent behavior, visual, and final reviews accepted the migration; both final-review findings are resolved. This change set remains uncommitted on `refactor/react`.

## Delivered

- React owns Chat, Library, History, Settings, navigation, preferences, and the safe rich-content renderer. Chat and saved History retain their distinct presentation.
- The Python host, wire contracts, collection storage, and saved-answer format remain unchanged.
- All 627 Svelte source files and all Svelte/SvelteKit dependencies were removed. The final lock has 587 package entries, including the root and platform optionals, down from 1,375.
- The launcher refreshes stale or legacy frontend installs. Its receipt includes exact manifest bytes, Node major, platform, and architecture; it is written atomically only after a successful install.
- Original screenshots, raw differences, interaction probes, findings, and their resolutions are retained. Applicable upstream notices remain unchanged; [UPSTREAM.md](../../../app/document-qa/frontend/UPSTREAM.md) records reused code and assets.

## Verification

| Check | Observed result |
| --- | --- |
| Strict TypeScript across retained source | Passed |
| Unified frontend suite | 177 tests passed in 28 files after the final fixes |
| Public client tests against disposable Python host | 2 passed |
| Launcher unit tests | 11 passed |
| Actual fresh and legacy dependency installation | Both passed; second launcher call skipped installation; installed graphs contain no Svelte |
| Fresh checkout type check and production build | Passed |
| Fresh checkout `dev:qa` routed fixtures | 11 scenarios passed, no browser errors or unexpected requests |
| Final production routed fixtures | 11 scenarios, 15 answer requests, 15 save attempts; no browser errors or unexpected requests |
| Final production through disposable Python host | Chat, Library publication/rollback, History, and Settings passed |
| Independent behavior review | Accepted; all findings resolved |
| Independent visual review before cleanup | Accepted: 95 captures, 53 exact, 42 individually classified raw differences |
| Post-cleanup visual review | Accepted: 95 captures, 54 exact against the original; 41 previously classified differences, no new drift |
| Real local model smoke | Passed with staged Qwen3-4B Q4_K_M and local MiniLM embeddings; correct claims/citation, save, and History reopen |
| Independent complete-change review | Accepted after independent production re-review closed both renderer findings |
| Visual review after final renderer fixes | All eight scoped captures byte-identical to accepted post-cleanup references |

The host evidence distinguishes actual Python operations from deliberately intercepted failures and delayed responses. It does not claim that a simulated cancellation race was observed in the real host.

The full post-cleanup capture also has 79 exact matches against the accepted pre-cleanup React capture. Its other 16 cases stay within previously measured initial glyph and rounded-edge regions. All 12 open-menu screenshots match the accepted menu reference exactly, as do seven pinned-sidebar/mobile crops. The asset probe recorded 40 actual local preview responses and five intercepted API responses, all successful, with no external requests or browser errors.

The real-model smoke published one generated fictional PDF through Library, asked for its maintenance window and approver, obtained both correct claims with a page-1 source quote, and reopened the saved answer in History. The model reported `stub: false`. The repeated smoke on the final fixed build took about 21.0 seconds on this development machine with two CPU threads. This is a narrow workflow smoke test, not a model-quality or performance qualification.

Final review found a Mermaid image-metadata request occurring before SVG sanitization (F7A1), and incorrect whole-message code-fence replacement when nested blocks precede top-level blocks (F7A2). The fixes inspect parsed Mermaid vertices before rendering and map root lexical fences while retaining nested editor-local saves. Their original reproductions are preserved. Independent re-review blocked all 11 hostile Mermaid metadata forms before any resource request, rendered three safe diagram controls, and verified nested/root Save, whole-message Copy, branch revisit, and unchanged persisted answer content. All 38 focused renderer tests passed. The eight affected/setup visual captures remained byte-identical to their accepted references.

## Appearance evidence and decisions

The original screenshot index and all 95 reference images remain unchanged. Comparison uses zero pixel tolerance and no masks. The [independent visual report](reviews/task-5b-report.md) maps each raw difference to an explicit explanation and supplemental controls.

Accepted differences are limited to documented safety exceptions, the original randomized suggestion order, pointer-dependent hover state, and specifically measured rasterization at unchanged glyph/vector/rounded-edge regions. They are not a general allowance for changed typography, layout, color, copy, or icons.

Actual defects discovered during comparison were fixed, including production CSS alpha/OKLCH rounding, composer placeholder placement, menu shadows, font choices, text-node segmentation, and content containment. Both Vite CSS minification and Tailwind production optimization remain disabled to preserve original color precision. Original transitions, interruption timing, focus, and keyboard behavior were checked separately from settled screenshots.

Security exceptions are recorded in [ADR 0004](../../architecture/decisions/0004-react-frontend-parity.md) and [existing defects](existing-defects.md): model-supplied code execution, remote resource loading, cosmetic answer cancellation, and overlapping dispatch are not reproduced. The interface retains supported local controls and their appearance.

### Decisions made during execution

1. Used the existing dedicated `refactor/react` branch and recoverable baseline. The approved plan allows branch isolation; the consequence is a large uncommitted change set for review.
2. Ran the five screen assignments in smaller waves to fit the four-agent session limit. Ownership and gates were preserved; elapsed time increased.
3. Followed the approved assignment/review sequence and uncommitted handoff instead of generic skill defaults requiring per-task commits. Review packages therefore explicitly include untracked files.
4. Omitted the original Python Run action because model-supplied execution violates the product boundary. The intentional control/reflow difference is retained in visual evidence.
5. Preserved the ordinary queue but omitted cosmetic Stop and overlapping Send now. Neither actual cancellation nor concurrent answering is supported; the pending-state control difference is documented.
6. Removed external navigation destinations from model-generated links while retaining their appearance. External destinations cannot be opened from those links.
7. Temporarily reassigned baseline harness debugging from the capture agent to the inventory agent after reproducible readiness failures. This cost additional baseline time and avoided accepting empty screenshots.
8. Preserved Set as default's observed menu-open/no-visible-change outcome without making its failing unsupported upstream call or inventing a success toast. This retains an existing ineffective affordance; persistent model selection remains outside scope.
9. Accepted only the specifically evidenced initial glyph-paint variation and measured edge pixels described in the visual report. A misclassification would require reopening those exact comparisons; raw images, coordinates, styles, and causal controls are retained for that purpose.

The user explicitly selected `gpt-6.1-sol` to replace unavailable Terra for shell conversion and dependency cleanup, retaining the requested medium effort.

## Run

Use Node 20–22 and npm 10 or newer. From the repository root, `./start.sh` or `python3 launch.py` starts the existing interactive development launcher. On Windows, use `start.cmd`.

For frontend commands:

```sh
cd app/document-qa/frontend
npm ci
npm run dev:qa
npm run check
npm run test:frontend
npm run build
npm run preview
```

The developer frontend binds to `127.0.0.1:5173`; preview also binds to loopback. The normal Python host remains on `127.0.0.1:8765`. Verification used intercepted fixtures and separate disposable data/ports, leaving existing user services and data untouched. Temporary validation listeners on 4177, 8766, 8767, and 8087 were shut down after review.

Running `npm ci` manually does not write the launcher receipt, so the next launcher run may reinstall once. A matching valid receipt performs no installation or network check.

## Size and limits

The original static build contained 5,139 files / 144,190,783 bytes. The final React build contains 554 files / 45,212,907 bytes, including source maps, local fonts, locale chunks, and renderer dependencies. Unused static assets removed during cutover totaled 12,346,429 bytes. These are build inventory measurements, not startup latency or process memory qualifications. Vite still reports its large-chunk advisory.

This migration does not implement or certify Tauri packaging, signed releases, 8 GB reference-machine performance, source-page images/highlighting, visual answering, streaming, answer cancellation, or durable chat threads. The retained Python development host is not a production FastAPI implementation. Runtime browser resource checks and local model offline settings are distinct from physically disconnecting the machine.

## Evidence index

- [Integration report](reviews/task-4a-report.md)
- [Final independent behavior review](reviews/task-5a-round6b-report.md)
- [Independent visual review and all 95 classifications](reviews/task-5b-report.md)
- [Source/dependency cutover report](reviews/task-6a-report.md)
- [Launcher and documentation report](reviews/task-6b-report.md)
- [Post-cleanup visual review](reviews/task-6-visual-report.md)
- [Independent final review](reviews/task-7a-report.md)
- [Final renderer fixes and regressions](reviews/task-7-fix-report.md)
- [Independent final re-review acceptance](reviews/task-7a-rereview-report.md)
- [Final scoped visual acceptance](reviews/task-7-visual-report.md)
- [Final re-review production probe](evidence/stage7-final-rereview/probe.json)
- [Final scoped visual comparison](evidence/stage7-visual-comparison/comparison.json)
- [Final type, test, build, and launcher logs](evidence/stage7-final-checks/)
- [Handoff integrity checks](evidence/stage8-integrity.json)
- [Fresh installation receipt evidence](evidence/stage6-install/fresh.json)
- [Legacy installation receipt evidence](evidence/stage6-install/legacy.json)
- [Production routed fixtures](evidence/stage6-fixture/results.json)
- [Production disposable-host workflows](evidence/stage6-host/results.json)
- [Final fixed-build routed fixtures](evidence/stage7-final-fixture/results.json)
- [Final fixed-build disposable-host workflows](evidence/stage7-final-host/results.json)
- [Fresh development command](evidence/stage6-fresh-dev/results.json)
- [Pre-cleanup production comparison](evidence/stage5-production-comparison/comparison.json)
- [Post-cleanup production comparison](evidence/stage6-visual-vs-original/comparison.json)
- [Initial real-model smoke](evidence/stage7-real-model/summary.json)
- [Final fixed-build real-model smoke](evidence/stage7-final-real-model/summary.json)

Raw evidence retains original execution paths and timestamps. Files under `evidence/` are durable copies; the reusable capture and fixture tools live in `app/document-qa/frontend/migration-parity/`. Historical rejected captures and causal probes are retained alongside the accepted results.
