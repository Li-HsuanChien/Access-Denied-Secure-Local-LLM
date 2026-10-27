# Stage 6B launcher and documentation report

## Launcher

`launch.py` now fingerprints the exact `package.json` and `package-lock.json` bytes, receipt format version, Node major, platform, and architecture using length-delimited SHA-256 fields. A matching receipt skips installation only when `node_modules` and the React, React DOM, and Vite package manifests are present. Missing, stale, malformed, or incomplete installs run `npm ci`. Stale receipts are removed before install; a new receipt is written through a temporary file and atomic replace only after install success and required-package checks. The prerequisite check uses the selected Node executable, accepts Node 20–22, and reports a clear error outside that range. Windows `npm_cmd` behavior is preserved.

The receipt is `node_modules/.launcher-install-receipt.json`; the existing `node_modules/` ignore rule covers it. Running `npm ci` manually does not create a receipt, so a following launcher run can perform one additional install.

## Verification

- `python3 -m unittest app.desktop.tests.test_launcher -q` — 11 tests passed. Coverage includes missing and legacy installs, matching receipts, manifest/runtime/platform/architecture changes, required-package loss, install failure, missing packages after a nominally successful install, atomic-write cleanup, Node major rejection, and Windows npm command construction.
- `python3 -m py_compile launch.py app/desktop/tests/test_launcher.py` — passed.
- `git diff --check` — passed.
- `git diff --exit-code -- app/document-qa/frontend/LICENSE app/document-qa/frontend/LICENSE_HISTORY app/document-qa/frontend/LICENSE_NOTICE` — passed; all three retained notice files are unchanged.
- Primary ran real cached-offline `npm ci` through the launcher receipt code for fresh and legacy disposable frontends using Node 22.17.1. Both installs passed; the second launcher call skipped `npm ci`, and `npm ls --all` showed no Svelte packages. Primary retained the logs and JSON results at `/private/tmp/react-migration-fresh-install/` and `/private/tmp/react-migration-legacy-upgrade/`.

No user frontend/backend services or user data were touched by the focused tests. Real install verification ran only in the disposable paths above.

## Documentation updated

Updated current startup and contributor documentation to describe React as the canonical frontend, the 5173 loopback dev server, Node 20–22/npm 10+, build/check/test/preview commands, the launcher receipt behavior, and the remaining Tauri/release scaffolds. Files updated include root `README.md`, `app/README.md`, desktop and document-QA READMEs/AGENTS, frontend README and feature READMEs, frontend asset notes and `UPSTREAM.md`, VM QA instructions, SDD frontend/current-host wording, ADR 0004 status/decision, backend host guidance, and release acceptance scaffold wording.

`UPSTREAM.md` records Open WebUI v0.11.4 at commit `8bd8b4fac5e059578ac0c74b3c18d11139f88b7d`, translated shell/chat/composer/renderer markup, tokenizer extensions, CSS, fonts, favicon, icons, and retained notice obligations. It does not claim that switching frameworks removes attribution. The approved historical migration plan and ADRs 0001–0003 remain intact. No Tauri implementation, packaged release, or final product qualification is claimed.
