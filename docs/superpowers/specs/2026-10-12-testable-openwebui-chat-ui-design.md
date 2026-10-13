# Testable Open WebUI Chat Interface Design

**Status:** Approved and implemented on `codex/integrate-workstreams`
**Scope:** First QA-ready frontend slice on `codex/integrate-workstreams`

## Context

The merged branch contains the E3 text-answer workflow and loopback development host, but `app/document-qa/frontend/` is still a scaffold. The repository's approved architecture uses a pinned Open WebUI SvelteKit frontend inside Tauri. Project notes identify Open WebUI v0.11.4 at commit `8bd8b4f`; the source is not yet present in the repository.

The first interface should exercise the actual answer workflow without depending on the final model or packaged desktop app. E3's `dev_host.py` can seed a golden collection and use a deterministic fake model. It binds to `127.0.0.1`, exposes `GET /health` and `POST /v1/requests`, and enforces the request envelope documented in `answering/wire/README.md`.

## Goals

- Add a testable Chat view using the pinned Open WebUI SvelteKit source and shell.
- Submit questions through E3's existing host and render the structured answer and citations.
- Make answered, insufficient-evidence, busy, degraded, and failed states observable and testable.
- Run QA in a local browser development session while keeping Tauri as the product runtime.
- Keep evidence, retrieval, and citation decisions in the Python workflow modules.

## Not in this slice

- PDF selection, validation review, or collection publication UI.
- Conversation persistence or history screens.
- Visual-page selection and image reasoning.
- Streaming progress, cancellation, or retry controls beyond the backend's existing single corrective citation attempt.
- Tauri packaging or cross-platform release verification.

The Chat view may show whether the seeded QA collection and model are ready. It must not imply that document import is implemented.

## Approaches considered

1. **Extend the pinned Open WebUI fork (recommended).** Vendor the documented revision, preserve its SvelteKit app shell and suitable shared UI, and add product-owned feature modules. This follows ADR 0001 and avoids a later port from a temporary UI.
2. **Build a separate Svelte demo and port it later.** This isolates a fast prototype but duplicates route and styling work and risks testing a UI that will not ship.
3. **Build a React interface.** This conflicts with the approved SvelteKit/Open WebUI architecture and would prevent direct reuse of the upstream Svelte source.

The implementation should verify the documented upstream revision and its license/branding notices before importing source. Upstream behavior and code are treated as implementation material, not product workflow authority.

## Module design and seam

### Answering feature module

Own the Chat interaction: question submission, one-question-at-a-time presentation, general-knowledge setting, health summary, answer sections, citation expansion, and transport-error presentation. Its user-facing interface is `AnsweringView`, which receives an `AnsweringClient` dependency. That client has only `health()` and `ask(question, generalKnowledge)` operations.

The module presents fields already validated and classified by the Python workflow. It does not parse model prose, decide whether evidence supports a claim, create citations, or change citation page ranges.

### Client seam and adapters

Place the seam at the answering feature's client interface. It has two justified adapters:

- **Loopback HTTP adapter:** reads `GET /health` and sends the SDD request envelope to `POST /v1/requests`. It creates a request ID, validates response shape/version, maps transport errors and workflow statuses into a small typed result, and refuses non-loopback destinations. The development base is `http://127.0.0.1:8765`; the packaged host will use the SDD-managed same-origin configuration.
- **Fixture adapter:** returns deterministic health and answer results for component tests, including insufficient evidence, busy/failure, and citation-warning cases. Tests inject it through the same client interface used by the HTTP adapter.

The interface is the test surface. Answering feature-module tests exercise visible outcomes through the fixture adapter; the host integration test exercises the HTTP adapter against the real `dev_host.py` with `FakeModelRuntime` and its seeded collection. No test reaches into adapter internals to simulate answer behavior.

### Open WebUI integration

Add user-facing code under `app/document-qa/frontend/src/lib/features/answering/`. Keep route entry points thin and reuse Open WebUI's shell and focused shared UI modules where they fit. Do not embed the full upstream `Chat.svelte` as a generic product module; it is tightly coupled to Open WebUI stores, routes, and backend behavior. Disable or omit unrelated remote, plugin, tool, and model-management paths as required by ADR 0001.

The browser serves only as a local development QA harness. It is not a supported standalone product workflow. The shipped interface remains inside Tauri.

## User-visible behavior

- The Chat view starts with an empty prompt and a concise local-library readiness indicator.
- Submit is disabled while a question is in flight; a second concurrent question is not sent.
- An answer displays document-supported claims, general model knowledge, and limitations in their distinct sections.
- Each citation expands to its document name, page or page range, and supporting passage. Visual highlighting is shown only when the payload marks coordinates reliable and supplies them.
- Insufficient evidence, a degraded host, a busy result, citation-validation warnings, and transport errors receive distinct plain-language states.
- A failure leaves the typed question available for correction or retry. No cancellation affordance is shown because the host does not implement request cancellation.
- Keyboard focus, semantic labels, visible focus, contrast, and screen-reader announcements follow the frontend contributor guidance and SDD §7.4.

## Data flow

1. The feature module calls `health()` and shows library/model readiness from the host response.
2. The user submits a question and general-knowledge preference.
3. The HTTP adapter sends `{request_id, operation: "answering.ask", payload}` to the loopback host.
4. The host routes the request through `AnswerService` and returns the versioned answer payload or a typed transport error.
5. The feature module maps the result to visible state and renders answer and citation data without changing evidence semantics.

The deterministic fake runtime and seeded golden collection make this path repeatable without downloading model weights or contacting external services.

## Verification

- **Feature-module tests:** Use the fixture adapter to verify prompt submission, busy state, each answer status, error messaging, general-knowledge preference, citation expansion, keyboard access, and accessible announcements.
- **Host integration:** Start `dev_host.py` with its default fake runtime and seeded collection; use the loopback HTTP adapter to verify readiness, a citation-bearing answer, and insufficient evidence through the public request envelope.
- **Browser QA:** Run the SvelteKit development frontend locally and manually exercise the same flows. Add automated browser coverage using the pinned frontend's existing test tooling if available; do not add a second test framework without need.
- **Later desktop verification:** Reuse the feature tests and add a Tauri-hosted smoke flow after the desktop shell is integrated.

No external network is needed for routine UI QA. The frontend must not add remote assets, telemetry, or requests to non-loopback hosts.

## Documentation and acceptance

The PRD does not change. Before implementation lands, update the SDD or a linked decision record in the same implementation change set to document the feature-client seam, dev-only browser harness, and current host-to-frontend envelope. Record the pinned upstream revision, local modifications, and required license/branding notices with the vendored source.

This slice is accepted when a local developer can start the fake host and frontend, submit a golden question, inspect a citation's source passage, observe insufficient evidence and host-error states, and run the feature and host-integration checks without model weights or internet access.
