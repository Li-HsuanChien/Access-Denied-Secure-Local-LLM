# ADR 0002: Separate runtimes, then group source by feature

Status: design decision recorded; documentation-only scaffold.  
Date: 2026-09-22.  
Refines the repository layout in the [codebase design](../../superpowers/specs/2026-09-22-secure-local-document-qa-codebase-design.md) and complements [ADR 0001](0001-open-webui-offline.md).

## Context

The first scaffold placed Open WebUI under `vendor/`, the four Python modules under a separate `packages/secure_qa/` tree, and tests and schemas in root-level technical folders. That made feature ownership hard to see. Open WebUI itself develops its SvelteKit frontend at repository `src/` and Python backend at `backend/`. SvelteKit expects route files under `src/routes` and reusable frontend code under `src/lib`. Tauri keeps its native implementation under `src-tauri` and can bundle platform-specific sidecars. [Open WebUI development](https://docs.openwebui.com/getting-started/advanced-topics/development/), [SvelteKit structure](https://svelte.dev/docs/kit/project-structure), [Tauri sidecars](https://v2.tauri.app/develop/sidecar/).

## Decision

Use `app/` to group this single desktop product. It is a repository directory, not a Python package. Put the Tauri shell at `app/desktop/` and the pinned Open WebUI fork at `app/open-webui/`. Inside the fork, keep upstream `src/` as the frontend and `backend/` as the Python host. Put new frontend behavior and its UI tests under `src/lib/features/<feature>/`. Put the four Python workflow modules under `backend/secure_qa/<feature>/`, with each module's transport schema, interface tests, adapter tests, and relevant benchmarks in that same feature folder. Keep SvelteKit route files and Open WebUI host registrations thin. Put shell tests and process benchmarks under `app/desktop/`; put full packaged acceptance tests under `app/release/acceptance/`. Keep project architecture documents in root `docs/`.

Tauri's Rust code owns startup, readiness, approved application paths, and shutdown for the packaged Python host and llama.cpp binary. It shows a bundled startup screen, then loads the backend-served frontend from loopback. The Svelte frontend receives no Tauri shell or filesystem capability by default; the Python backend receives selected PDF content through the reviewed Library workflow. Tauri's configuration supports an HTTP webview URL, and its capability model allows permissions to be withheld from that webview. [Tauri configuration](https://v2.tauri.app/reference/config/), [capabilities](https://v2.tauri.app/security/capabilities/).

## Why this shape

The `app/` directory makes the product boundary visible while keeping its runtime projects distinct. Feature folders keep behavior, schemas, tests, and measurements near their owner. Keeping Open WebUI's source layout avoids a wholesale move of upstream files, which would make future pinned updates harder to review. New domain behavior stays in the `secure_qa` package behind the SDD's four interfaces; Open WebUI and Tauri remain implementation details at their respective seams. SvelteKit and pytest both support colocated unit tests. [SvelteKit structure](https://svelte.dev/docs/kit/project-structure), [pytest test layouts](https://docs.pytest.org/en/stable/explanation/goodpractices.html#choosing-a-test-layout).

## Consequences

- The prior `vendor/open-webui/`, `packages/secure_qa/`, `apps/`, root `contracts/`, root `tests/`, and root `benchmarks/` scaffold locations are retired. The source fork and Python modules live together under `app/open-webui/`.
- Frontend feature names mirror backend module names where a user-facing workflow exists. Release Verification is backend-only and runs before installation from a separately trusted verifier build.
- Chroma, llama.cpp, and SQLite adapters, transport schemas, tests, and relevant benchmarks live inside their owning feature folders rather than shared technical folders.
- Only the integration points required by the product change upstream Open WebUI files. The fork retains license notices and a record of local edits.
- This decision changes source organization only. The four SDD workflow interfaces, offline operation, and acceptance gates remain in force.

## Alternatives considered

A top-level `features/<feature>/{frontend,backend}` tree would colocate each vertical slice, but moving Open WebUI's SvelteKit and Python sources out of their expected layout would increase fork maintenance and build configuration. Separate top-level frontend and backend repositories would also split the upstream repository's packaging assumptions. The selected layout preserves upstream paths while grouping new work by feature within each runtime.

Root `desktop/` and `open-webui/` would also build, but `app/` gives this single product one clear boundary without implying multiple independent apps. The directory name has no framework behavior; each nested project retains its own expected root. [Tauri project structure](https://v2.tauri.app/start/project-structure/), [Open WebUI development](https://docs.openwebui.com/getting-started/advanced-topics/development/).
