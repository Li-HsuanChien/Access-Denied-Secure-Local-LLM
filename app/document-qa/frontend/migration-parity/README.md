# React migration parity capture

This directory owns the reusable browser capture harness, deterministic API fixtures, and the original Svelte screenshots and metadata for the approved React migration. The acceptance states and capture conditions are defined in [the baseline matrix](BASELINE-MATRIX.md). Product source, package manifests, and lockfiles are outside this harness's ownership.

## Safety and scope

- The browser opens the actual routed app at `/qa`, `/library`, `/history`, `/settings`, `/`, and `/c/baseline-session`. Fixtures only answer API requests intercepted by Playwright; they do not replace or simulate route UI.
- All `127.0.0.1:8765` API traffic is fulfilled by `fixtures/responses.mjs`. The user's real host and its data are never contacted. Requests outside the configured app origin are blocked and recorded in capture metadata.
- The fixture data, timestamps, IDs, viewport, theme, sidebar state, and random suggestion ordering are deterministic. Interaction timers remain live.
- `original/` becomes immutable once Stage 1B accepts the captures. During capture development, outputs are provisional and may be regenerated. The report must record the accepted capture index/hash evidence and any unreachable pre-existing states.
- Do not activate Python or other code execution controls exposed by the original UI. Their presence is an observed original-app behavior and belongs in the defect ledger.

## Run

Run from the repository root with the frontend dependencies installed and a Chromium browser available to Playwright:

```sh
node app/document-qa/frontend/migration-parity/fixtures/validate-answer-fixtures.mjs
node app/document-qa/frontend/migration-parity/capture.mjs
```

The default capture command resolves `playwright` from the harness/frontend's local Node module paths and explicitly launches the full Chromium executable returned by `chromium.executablePath()`, matching the original capture engine. Do not use Playwright's implicit headless-shell selection: it can produce different text and edge pixels despite reporting the same browser version. If Playwright or Chromium is supplied from a separate cache, configure paths through environment variables instead of editing product manifests:

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/node_modules/playwright \
PLAYWRIGHT_EXECUTABLE=/absolute/path/to/chromium \
BASELINE_ORIGIN=http://127.0.0.1:5173 \
node app/document-qa/frontend/migration-parity/capture.mjs
```

`BASELINE_ORIGIN` optionally selects the app origin (default `http://127.0.0.1:5173`). The capture process intercepts `127.0.0.1:8765` in the browser and must not be pointed at the user's real API host. It writes into a temporary directory outside Vite's watched frontend while the browser is open, then replaces only an unaccepted, harness-owned `original/` directory after the browser closes. A preexisting `original/ACCEPTED.json` prevents replacement. Stage 1 must not add or change package manifests or lockfiles.

The fixture schema validator checks answer payloads against the backend's `answer.schema.json`. `responses.mjs` provides supported-answer, rich-Markdown, long-Markdown, insufficient-evidence, request-failure, library-publication, settings, and history scenarios. Keep renderer coverage (`rich`) distinct from length/scroll coverage (`long`).

## Evidence layout

- `capture.mjs`: routed Playwright interactions, readiness assertions, screenshots, computed geometry/styles, browser errors, blocked-request observations, and Chromium performance metrics.
- `fixtures/responses.mjs`: deterministic local wire fixtures and mutable fixture-side workflow state.
- `fixtures/validate-answer-fixtures.mjs`: schema validation for each answer case.
- `original/screenshots/`: captured original-app pixels.
- `original/metadata/`: one JSON record per screenshot.
- `original/capture-index.json`: generated list of capture evidence.

The metadata is diagnostic evidence, not a claim that the original UI is safe or that every requested state is reachable. See the Stage 1B report for the verified coverage and exceptions.

## Compare a React capture

Capture React into a separate directory while frontend source writes are paused:

```sh
BASELINE_ORIGIN=http://127.0.0.1:5176 \
BASELINE_OUTPUT_ROOT=/tmp/react-capture \
node app/document-qa/frontend/migration-parity/capture.mjs
```

Preference interactions click the switch and wait for its host-confirmed state
before capturing. This accommodates asynchronous controlled inputs without
changing the action or expected state. Other readiness checks, fixture data and
accepted originals remain the comparison reference.

Then compare against the accepted original with Python and Pillow:

```sh
python3 app/document-qa/frontend/migration-parity/compare.py \
  app/document-qa/frontend/migration-parity/original \
  /tmp/react-capture \
  /tmp/react-comparison
```

The comparator verifies the accepted original index and every reference PNG hash.
It reports missing images, dimension changes and every changed pixel, with zero
tolerance and no masks. Red difference images and `comparison.json` are written
only to the comparison directory. Exit status 1 means differences need review;
it does not classify a change as an approved safety exception or rasterization
noise. Both require explicit evidence and reviewer judgment.

After a primary reviewer accepts the evidence, place an `ACCEPTED.json` marker in `original/` containing the reviewer, date, and index SHA-256. The capture harness refuses to replace an accepted directory.
