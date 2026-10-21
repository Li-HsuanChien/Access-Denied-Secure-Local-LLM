# Stage 5A independent behavior re-review — round 5

Date: 2026-10-20. Reviewer: independent Stage 5A agent. Source package: `/private/tmp/react-stage5-round5-final-review-package`; parent confirmed source freeze and successful final round-5 build before these probes. Review-only; no implementation edits, commits, user-service/data mutations, or subagents.

## Verdict

**F5A-4 is closed. The atomic submit fix and new pin/sidebar/link behavior pass the scoped independent checks. One new P2 parity finding, F5A-5, remains open.** Earlier F5A-1–3 closures from `task-5a-rereview-report.md` remain accepted; their unchanged sanitizer/locale/drawer implementation was not exhaustively rerun in this focused review. This report does not grant Stage 6 removal permission. Stage 5B independently owns visual acceptance, including the separately discovered production CSS minification issue.

## New finding: F5A-5 — More Options pointer opening changes keyboard focus/order (P2)

- Source: `app/document-qa/frontend/src/lib/features/desktop-shell/react/NativeDropdown.tsx:111–113`, used by `answering/react/ModelOption.tsx`.
- Reproduction on original and React production: open the model selector; click the model's **More Options** button; inspect `document.activeElement`; press Tab.
- Original: active element remains the **BUTTON** labelled **More Options**. Tab advances to **Set as default**.
- React: the unconditional layout-effect focus moves focus to the child **DIV role=menu**. Tab advances to **Keep in Sidebar**.
- Consequence: the same pointer-to-keyboard interaction has a different focus location and next action. This is a newly reachable parity difference, not a claimed inability to operate the menu.
- Cause: original `components/chat/ModelSelector/ModelItem.svelte:313–317` stops click propagation and toggles the externally bound `showMenu`; original `components/common/Dropdown.svelte:242–255` only focuses content when `shouldFocusContent` was set by its trigger path. React always focuses mounted open content.
- Scope caution: original common trigger also handles Enter/Space and requests menu focus. A correction should preserve the actual activation-mode distinction; unconditional focus suppression for the model instance has not been justified.
- Evidence: `/private/tmp/react-stage5a-round5-focus/probe.json`, `/private/tmp/react-stage5a-round5-tab/probe.json`. Reproduction scripts: `/private/tmp/stage5a-round5-focus.mjs`, `/private/tmp/stage5a-round5-tab.mjs`.
- Normal Chat actions correctly focuses its menu in both versions. Escape returns focus to `#chat-input` for both tested menus in both versions. Therefore this finding is specific to model More Options pointer opening, not a request to change all dropdowns or global Escape.
- Sent to primary and Chat owner with exact evidence before implementation.

## Independent closure evidence

### F5A-4: semantic blank paragraphs and outgoing wire text — PASS

Actual keyboard input, rather than assigning `textContent`, exercised five fixtures against original and production React. Each emitted exactly one ask and one save with identical question payloads:

| Input shape | Exact outgoing question (JSON escapes) |
| --- | --- |
| Single break | `first\nthird` |
| Blank paragraph | `first\n  \nthird` |
| Leading blank | `  \nfirst\nthird` |
| Trailing blank | `first\nthird` |
| Consecutive blanks | `first\n  \n  \nthird` |

Repeated main-editor → expanded-drawer → main-editor round trips (three cycles, type `!` at the draft end on each) preserved three semantic paragraphs: `first`, empty, `third`, then `third!`, then `third!!`. Final wire text was `first\n  \nthird!!!` in both implementations. No React errors or blocked requests. The original emitted its previously observed `a.valueOf is not a function` close error three times; that original defect is recorded and is not a requirement to reproduce.

### Atomic duplicate submit — PASS

Four independent production cases dispatch the competing actions within the same JavaScript turn, using a captured Send button reference and a delayed fixture response: Enter+click, click+Enter, double Enter, double click. Each produced **one ask, one save, and no queued duplicate**. This specifically exercises the stale rendered-DOM interval repaired by reading the controller's live draft getter.

### New model controls and sidebar behavior — PASS, except F5A-5

Desktop and mobile contexts independently exercised Copy Link, Keep in Sidebar, section collapse/reopen, Shift-unpin, repin, model-row navigation and Library → model-row navigation. Clipboard contained the local origin plus `/?model=secure-qa-local`. Row navigation cleared the draft; mobile closed the sidebar. No ask/save or unsupported write operation occurred in these navigation/control cases. Reload discarded the ephemeral pin.

A separate existing-answer case performed one ask/save, then pinned the model and typed a draft. Clicking the pinned row cleared both answer and draft without another ask/save. Pin survived New Chat, Hide from Sidebar removed it, and a reload discarded the pin while retaining the collapsed Models section key. Repinning respected that retained collapsed state until explicitly reopened. No React page errors or blocked requests.

## Evidence and commands

All browser runs used full Chrome for Testing **151.0.7922.34**, explicitly launched at:

`/Users/evansinocchi/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`

React assets were fulfilled directly from the frozen `build-react` directory by the route adapter, with the synthetic origin `http://127.0.0.1:5176`. Original assets came from the isolated original at 5173. Every request to API 8765 was fulfilled by fixture health/request handlers, and any other unexpected origin was aborted. No real user 8765/5174/8080 service was contacted. Tests used isolated browser contexts and their own localStorage/clipboard fixture state.

- `node /private/tmp/stage5a-round5.mjs` — **18 cases pass** (ten paired wire cases, two paired drawer cases, four atomic cases, desktop/mobile controls). Evidence `/private/tmp/react-stage5a-round5/probe.json`; log `/private/tmp/stage5a-round5.log`.
- `node /private/tmp/stage5a-round5-reset.mjs` — existing-answer reset/Hide/section-storage case **passes**. Evidence `/private/tmp/react-stage5a-round5-reset/probe.json`; corresponding log `/private/tmp/stage5a-round5-reset.log`.
- `node /private/tmp/stage5a-round5-focus.mjs` and `node /private/tmp/stage5a-round5-tab.mjs` — paired focus observations reproduce F5A-5; Escape and normal menu checks pass. Original Chat actions produced one unrelated unsupported-original JSON error; React produced none. An initial focus harness used an ambiguous original Chat actions accessible-name selector; corrected to the existing `#chat-context-menu-button` and reran completely.
- `npm run test:react -- src/lib/features/answering/react/Composer.test.tsx src/lib/features/answering/react/draftText.test.ts src/lib/features/answering/react/ModelOption.test.tsx src/lib/features/desktop-shell/react/PinnedModel.test.tsx src/lib/features/desktop-shell/react/NativeDropdown.test.tsx src/react/routes/navigation.test.ts` — **29 tests, 6 files pass**.

The primary separately reports 143 React tests, strict checking, production build and all 11 production fixture integration cases passing for this freeze. Those are corroborating owner/root results, not counted as independent reruns here. Existing browser scripts and JSON evidence are preserved in `/private/tmp`; no source cleanup performed. Production CSS-only follow-up and the F5A-5 owner correction require their own final verification before accepting the final build.

## Final follow-up

F5A-5 is closed by the independent production build-6b verification in `task-5a-round6b-report.md`. That final report supersedes this round's open-finding verdict.
