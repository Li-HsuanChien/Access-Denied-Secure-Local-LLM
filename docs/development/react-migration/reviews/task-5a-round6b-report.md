# Stage 5A final scoped re-review — build 6b

Date: 2026-10-20. Independent Stage 5A reviewer. Complete snapshot: `/private/tmp/react-stage5-round6b-final-review-package`. Parent confirmed source freeze and successful build 6b before verification. Review-only; no frontend changes, commits, services/user-data mutations or subagents.

## Verdict

**F5A-5 is closed. Stage 5A accepts the reviewed behavior/security/persistence/accessibility scope with no remaining findings.** This combines the prior documented F5A-1–3 closures, round-5 F5A-4/atomic-submit/new-control verification, and the final focused evidence below. This is scoped Stage 5A acceptance; visual acceptance and Stage 6 cutover/removal remain separate gates.

## Independent final production checks

`node /private/tmp/stage5a-round6b-focus.mjs` — **PASS, 16 browser cases**.

Twelve model-menu cases cover original and production React, desktop 1440×1000 and narrow 390×844, and pointer/Enter/Space activation. The script asserts exact equality of active-element signatures (tag, role, label, id and relevant button text) between each original/React pair across the entire sequence:

| Activation | After opening | Tab | Shift+Tab | Escape |
| --- | --- | --- | --- | --- |
| Pointer | More Options button | Set as default | More Options button | Main composer |
| Enter | Menu container | Keep in Sidebar | Set as default | Main composer |
| Space | Menu container | Keep in Sidebar | Set as default | Main composer |

Four additional paired normal-menu cases confirm Chat actions and Regenerate both still focus their menu container on opening and return focus to the main composer on Escape. The model-specific correction has not changed these default dropdown paths.

Every React case had zero page errors and zero blocked requests. Original model-selector cases each recorded its previously observed unsupported-original JSON parse error; it did not alter the compared interaction. Normal-menu original cases were error-free. No new behavioral finding emerged.

`npm run test:react -- src/lib/features/answering/react/ModelOption.test.tsx src/lib/features/desktop-shell/react/NativeDropdown.test.tsx` — **11 tests in 2 files pass** (5 ModelOption, 6 NativeDropdown).

Source review confirms optional `focusOnOpen` defaults to true, pointer opening of ModelOption leaves it false, Enter/Space explicitly request focus and prevent default browser click, and previous focus is captured only when menu focus is requested. This matches the original activation distinction qualified in round 5.

## Evidence and limits

- Script: `/private/tmp/stage5a-round6b-focus.mjs`.
- Durable run output: `/private/tmp/react-stage5a-round6b-focus/probe.json`.
- Full log: `/private/tmp/stage5a-round6b-focus.log`.
- Full Chrome for Testing 151.0.7922.34 was explicitly launched at `/Users/evansinocchi/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`.
- Fresh production `build-react` assets were served directly from disk by request interception under synthetic origin 5176; original frontend assets came from isolated original 5173. All API 8765 requests were fulfilled by fixtures. Unexpected origins were aborted. No real user 8765/5174/8080 traffic occurred.
- This final round intentionally reruns the changed focus paths and their default-menu neighbors. It does not claim a fresh rerun of every prior sanitizer/export/locale/paragraph/offline case. Their previous explicit closures and round-5 evidence remain the basis for those unchanged areas.
- Parent separately reports 147 React tests, strict checking and successful build 6b. Stage 5B/root own the CSS minification/placeholder visual verification. Those results are corroborating separate evidence, not independent Stage 5A reruns.

Previous report: `task-5a-round5-report.md`; its sole remaining F5A-5 finding is superseded by this closure.
