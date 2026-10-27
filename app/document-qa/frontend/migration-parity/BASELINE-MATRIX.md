# Original capture matrix and ownership
Baseline Git commit 4dc2a06. Do not alter product source or original captures after capture.
Use Playwright Chromium at deviceScaleFactor 1, reducedMotion reduce for static captures, fixed clock 2026-10-20T12:00:00Z and deterministic UUIDs. Record exact browser/version.
Desktop 1440x1000 and narrow 390x844; light/dark from localStorage.theme. Wait for fonts.ready and two animation frames. Disable animation only for screenshot; exercise motion/focus separately.
Capture actual routes, never fixture-only views. Screen/state matrix:
- Chat /qa: empty in both themes and widths; desktop sidebar collapsed; suggestion hover/focus; typed multiline composer; in-flight; supported answer; sources expanded; long Markdown response; insufficient evidence; request failure; history-save failure.
- Root / and /c/baseline-session: direct load and reload/back/forward outcomes; screenshots only if visibly distinct; document unsupported states honestly.
- Library: initial versions, selected file list, review accepted/rejected with confirmation unchecked/checked, publication progress, cancellation result, failure, rollback. Both themes at desktop; initial/review narrow.
- History: empty, records list, opened saved answer with expanded sources, persistence off, delete and clear confirmation/outcome, loading/failure. Light/dark desktop; open narrow.
- Settings: default, updated preferences, persistence off, degraded readiness/error. Both themes and widths.
Capture visible hover/focus tooltips for actual exposed controls, expanded and collapsed sidebar and mobile overlay. Inventory unreachable states as pre-existing defects, never fabricate UI.
Fixtures must use valid backend wire payloads and deterministic metadata, IDs and timestamps. Route 127.0.0.1:8765 requests to disposable host 127.0.0.1:8766 or deterministic route fixtures; do not touch the user's running host/data. Block/report all outbound traffic. Harness must run unchanged later against React, with baseline selector adapters if necessary and no changing expected screenshots.
Ownership: 1A writes docs/development/react-migration/baseline-inventory.md and existing-defects.md; product source read-only. 1B owns frontend migration-parity/ harness and original screenshots/evidence plus report. No manifests or lockfiles changes in stage 1. Primary owns setup, progress ledger and shared configuration.
