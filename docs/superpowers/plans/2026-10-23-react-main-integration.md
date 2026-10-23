# React/main Integration Plan

**Goal:** Merge current main into refactor/react, retain main's workflow improvements in React, and open a PR into main.

**Architecture:** Keep React/Vite as the canonical frontend. Retain main's E2/E3 Python integration and use its new conversation and source-PDF APIs through existing typed clients and shared providers.

**Sources:** PRD, SDD, ADRs for React parity, conversation context and cached source PDFs.

## Tasks

- [x] Fetch main, inspect incoming changes and begin a merge without committing.
- [ ] Resolve deleted Svelte files by translating their behavior into feature-owned React components. Preserve complete answer metadata.
- [ ] Thread answering requests by stable conversation ID; restore validated ordered turns, support direct conversation routes and saved-chat navigation, and leave persistence to the host for threaded requests.
- [ ] Render local PDF previews and citation highlights with bundled PDF.js; preserve the loopback-only source client and block PDF scripting/external resources.
- [ ] Port Library document preview, enable/disable and confirmed deletion. Serialize mutations through the shared Library provider.
- [ ] Port first-run health and local-avatar fixes, update SDD/contracts for the new interfaces, and remove obsolete Svelte tests/adapters.
- [ ] Run focused regression tests, TypeScript checks, frontend/host tests, production build, and relevant Python workflow/ingestion tests. Review the integration, commit, push and open the requested PR.

## Validation

Tests must demonstrate stable conversation identity, no duplicate client history save, validated thread restoration, local source/version selection, cancellation of stale preview loads, Library confirmation and mutation serialization, and first-run model-ready presentation. Existing offline, renderer security, publication lifetime and queue tests remain regression gates.

## Checkpoint — 2026-10-23

Implementation ports and independent review fixes are present in this merge checkpoint. Frontend tests passed (188), the production build passed, and the final host integration suite passed (26). The earlier broader Python run passed 203 tests with one skip; its newly added history-failure regression was fixed and passes in the final host suite.

At the user's request, commit and push this checkpoint before completing the remaining work. Production browser verification, SDD/shared-contract documentation reconciliation, final integration review and PR creation remain pending. The browser verification script is included for continuation; its successful execution has not been established.
