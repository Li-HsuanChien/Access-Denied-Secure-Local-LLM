# Stage 4A routes, providers and real-client integration

Status: complete for the deterministic Stage 4 integration gate. All four workflows function through the unchanged isolated Python API. The final routed fixture suite passes 11 cases; the complete React suite passes 87 tests in 15 files; strict React type checking passes. No production provider, route, workflow, backend, wire-schema or storage change was required. Visual parity and locale parity remain separate acceptance work.

## Files changed

- `app/document-qa/frontend/src/react/App.test.tsx`: four additional actual App/shell/route tests for StrictMode/new chat, detached answer/history-save settlement across navigation, shared committed preferences, and history-save failure recovery. Existing five direct-route cases remain.
- `app/document-qa/frontend/src/react/providers/controllers.test.ts`: four additional public coordinator tests for preference refresh/write ordering, publication guards, nonoverlapping slow polls, late status/cancel identity, and uncertain POST ownership through null/error status until terminal failure.
- `app/document-qa/frontend/src/lib/features/answering/answeringHost.integration.test.ts`: host tests require explicit `SECURE_QA_TEST_HOST_URL=http://127.0.0.1:8766`. Missing configuration skips; any other endpoint throws before constructing/calling a client. No default reaches 8765.
- `app/document-qa/frontend/vitest.host.config.ts`: documents isolated opt-in and allows a 30-second host test timeout.
- `app/document-qa/frontend/migration-parity/integration/{runtime.mjs,fixture.browser.mjs,host.browser.mjs,README.md}`: portable browser assertions, safe local transport interception, a locally generated text PDF, full-Chrome launch, request/outcome/timing evidence, and documented fixture/host commands. Ported the validated `/private/tmp/chat-actions.mjs` assertions without absolute imports or production injection switches.

All work remains uncommitted. No manifests, shared CSS, original screenshots/capture harness, backend or another owner's feature production files were edited by this assignment.

## Isolation and browser conditions

Read-only planning was maintained until primary released the full-95 source freeze. Browser runs used coordinated source write freezes; primary and feature owners were notified when each finished. The last fixture run followed the final Stage 3 Chat/renderer parity fixes.

- React origin: `http://127.0.0.1:5176`; every production API-origin request was intercepted before delivery.
- Host destination: only explicit `http://127.0.0.1:8766`, using the existing disposable fake host/data at `/private/tmp/secure-qa-react-migration-baseline`. The live user service/data on 8765 were untouched.
- Only exact `/health` and `/v1/requests` API paths forward in host mode, with redirects disabled. Fixture mode never forwards them. Other origins are blocked and recorded.
- Browser: `chromium.executablePath()` explicitly selects full Chrome for Testing at `/Users/evansinocchi/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`; Chromium 151.0.7922.34. No implicit headless-shell selection.
- Viewport 1440×1000, scale 1, light theme, collapsed sidebar, America/New_York timezone, reduced motion, clipboard permission. Behavior timers remain live; these are assertion runs, not screenshot comparisons.
- Local Chrome/loopback access required sandbox escalation. Approval succeeded; no automatic approval rejection occurred.

## Commands and exact results

Commands run from `app/document-qa/frontend` unless noted:

| Command | Result |
| --- | --- |
| `npm run test:react -- ../src/react/App.test.tsx ../src/react/providers/controllers.test.ts` | 2 files / 20 tests passed. |
| `npm run test:react` | Final settled-source run: 15 files / 87 tests passed, exit 0. Stage 3 had 79 tests; this assignment adds 8. |
| `npm run check:react` | Final settled-source strict TypeScript check passed, exit 0. |
| `npm run test:host` | 1 file / 2 tests safely skipped with no endpoint configured, exit 0. |
| `SECURE_QA_TEST_HOST_URL=http://127.0.0.1:8765 npm run test:host` | Expected rejection before any request, exit 1: explicit disposable endpoint required. |
| `SECURE_QA_TEST_HOST_URL=http://127.0.0.1:8766 npm run test:host` | Existing public answering-client suite: 1 file / 2 tests passed, exit 0. Seeded citation-bearing answer and insufficient-evidence outcome validated by the unchanged client/schema. |
| `REACT_INTEGRATION_OUTPUT=/private/tmp/react-integration-stage4a-fixture-final node migration-parity/integration/fixture.browser.mjs` | Final run: 11 routed cases passed, 15 answer requests / 15 history-save attempts, zero page errors, zero blocked/unexpected requests, exit 0. |
| `REACT_INTEGRATION_MODE=host SECURE_QA_TEST_HOST_URL=http://127.0.0.1:8766 REACT_INTEGRATION_OUTPUT=/private/tmp/react-integration-stage4a-host node migration-parity/integration/host.browser.mjs` | All four actual Python-host workflows passed; one browser scenario plus setup/final public-API assertions, zero page errors, zero blocked/unexpected requests, exit 0. |
| `node --check migration-parity/integration/{runtime,fixture.browser,host.browser}.mjs` | Each file was checked individually and passed, exit 0. |
| `git diff --check` | Passed, exit 0. |

The first added App-test run caught a test collection placement error, and strict checking caught test-only type issues. Those were corrected before the passing runs. No failing assertion required a product behavior change.

## Actual routed behavior evidence

Final detailed evidence: `/private/tmp/react-integration-stage4a-fixture-final/results.json`.

| Routed fixture case | Answer requests | Save attempts | Evidence |
| --- | ---: | ---: | --- |
| Direct routes, reload, Back/Forward, New Chat | 0 | 0 | `/`, `/qa`, `/library`, `/history`, `/settings`; `/c/old-thread` and unknown paths replace to `/`; reload and same-root New Chat clear draft. |
| Keyboard, suggestion, message actions and sources | 2 | 2 | Shift+Enter newline, IME Enter suppression, suggestion, user/whole-chat copy, user Save, assistant Save As Copy, previous branch, regeneration of selected latest question, Delete Cancel/Confirm, source modal Tab/Escape/close and restored focus. |
| Rapid Enter/click and queue lifecycle | 3 | 3 | Same-tick Enter plus captured Send click dispatches once. Queue Edit restores text; Delete removes it; FIFO next requests start only after prior answer and history-save settlement. Queued asks sample newly committed general-knowledge preference. |
| Detached old answer, route exit and New Chat | 2 | 2 | Dispatched old answer completes/saves once, unsent old queue is discarded, new session queues behind shared lock, late old result never enters new graph. |
| Save failure and recovery | 2 | 2 | Visible answer and existing warning survive two controlled history-save failures; lock releases and next question runs. |
| Header/Settings/History preferences | 1 | 1 | Header and Settings retain committed values during deferred and rejected writes; successful commit synchronizes consumers; History reflects disabled persistence, host save returns false, next ask uses committed flag. |
| History stale results and native layout | 0 | 0 | Clear rejects a late open; delete rejects a stale list. Full metadata/plain claims/native source details render without Chat chrome. Native Clear all confirmation is accepted through its actual dialog. |
| Library publication/cancellation/restart | 0 | 0 | Accepted/rejected review requires confirmation. Publication ID/polling survive navigation. Cancel targets original ID; true acknowledgement retains busy state until final cancelled response. Review remains for restart; new publication gets a new ID; rollback works. |
| Lost publication response | 0 | 0 | Invalid POST envelope leaves ownership intact through null status and status error, including navigation/remount; terminal cancelled status releases it and permits restart. |
| Model/status, code save and long scrolling | 2 | 2 | Actual model menu search/Compare/Set as default, status command/Close; no workflow request for those controls. CodeMirror Save updates local whole-message copy and survives regeneration/branch return while the persisted answer stays byte-for-byte equivalent. Actual Scroll to bottom reaches the long response tail. |
| Regeneration while pending | 3 | 3 | Regeneration reasks original selected question; pending sibling exposes no overlapping Regenerate; ordinary send queues and drains only after the regeneration/history settlement. |

Every case asserts zero browser page errors and zero unexpected network requests. Shared provider tests additionally verify slow polls never overlap; old status/cancel results cannot overwrite a new publication; publication without accepted files or required confirmation never calls transport; newer preference reads supersede older reads and pending writes suppress refresh reads.

## Real Python-host results and counts

Detailed evidence: `/private/tmp/react-integration-stage4a-host/results.json`. Before mutation, health confirmed `fake-extractive`, stub=true, active collection `v0001`, 6 documents/30 chunks, and both preferences true.

The browser recorded:

- `answering.ask`: **5**, all forwarded through the existing production client to 8766. One answer had persistence disabled, one old-session response was deliberately withheld by test transport until navigation/New Chat completed, and one answer used a controlled save failure. No transcript/new wire fields were added.
- `history.save`: **5 attempts**. **4 reached the host**: one returned saved=false while persistence was off, and three returned saved=true. One was a controlled test-only 503 and never reached the host; its answer remained visible and the next ask succeeded.
- `history.open`: **1**, opening a preexisting seeded full answer. Asserted the entire returned answer equals the saved original, including model, collection, citations, timing and other fields; no storage migration.
- `history.list`: **8**, `history.delete`: **1**, `history.clear`: **1** through the routed UI, with actual native confirmation. Final direct list was empty.
- `settings.update`: **2**, `history.set_enabled`: **2** through rendered controls, with Header/Settings/History synchronization. Both preferences finished enabled.
- `library.review`: **1** real review of a locally generated valid PDF plus invalid PDF: one accepted, one rejected, confirmation required.
- `library.publish`: **1** real successful publication; `library.status`: **1**; `library.cancel`: **1** using that publication's exact ID after route exit/return. The test withheld the already-completed POST response; the actual host correctly returned cancelled=false. The UI showed finishing text and retained ownership until the final POST response was released.
- `library.rollback`: **1**, restoring seeded active collection **v0001**. A final direct versions assertion confirmed the restored active version.
- Other browser reads: health **8**, settings.get **16**, history.enabled **16**, library.versions **8**. Development StrictMode can repeat reads; no mount initiated an answer/publication.

Setup/final direct public-API assertions separately recorded history.set_enabled=1, settings.update=1, history.clear=1, answering.ask=1, history.save=1, history.list=2 and library.versions=1. Thus the host browser command sent **6 real answer requests total** including setup. The separate existing client suite sent **2 more**. Counts in evidence distinguish UI requests and setup; controlled failures are not claimed as real backend failures.

## Findings, limitations and Stage 5 handoff

- No production cross-feature regression was found in the exercised cases. No extra provider lifetime, routing, cancellation, backend capability or storage layer was introduced.
- Primary's full-95 capture failure at Settings `.uncheck()` was reviewed read only: host-confirmed controlled switches intentionally restore their prior value until async writes settle, while Playwright uncheck checks immediately. The durable integration uses click plus an explicit committed-value wait. Deferred and rejected-write tests prove this is the intended contract; no product change was made for the capture timing assumption.
- Successful cancellation and lost-POST/null/error recovery use deterministic browser fixtures and public provider seams. The real-host run validates an actual completed-publication cancellation refusal and exact request identity. It does not claim a real slow-build cancellation race.
- This report establishes deterministic English workflow behavior. Original layout initializes i18n using query/localStorage/navigator detection and sets document language (en-US in captured browser), while the React entry currently declares lang=en and uses English copy. **Non-English locale selection/parity remains unqualified and must be reviewed by independent Stage 5A.** No locale expansion was implemented during Stage 4.
- Primary owns pixel comparison and tracked Chat/renderer/shell residuals. This assignment did not adjust original references, visual masks/tolerance or shared styling and makes no pixel parity claim.
- Full untrusted-rendering/offline review, real-model qualification, reference-hardware performance and packaged Tauri/platform acceptance remain their scheduled review/release stages. Host results here use the deterministic model and approved disposable data only.
