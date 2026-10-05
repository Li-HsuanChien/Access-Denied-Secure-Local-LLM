# ADR 0002: Separate runtimes, then group source by feature

**Status: active; reflected in the [System Design Document](../SDD.md).**
**Date:** 2026-09-22.

## Context

This is one desktop product. The repository separates the Tauri shell, the core document-QA application runtime, and release assembly while keeping product-specific work grouped by feature inside each runtime. The four Python workflow modules own product behavior; Open WebUI and Tauri remain implementation details at their respective seams.

## Decision

- Keep the Tauri shell at `app/desktop/`.
- Keep the document-QA application area at `app/document-qa/`, with the Open WebUI-based frontend workspace under `frontend/src/` and the Python host under `backend/`.
- Put new frontend behavior and UI tests under `frontend/src/lib/features/<feature>/`; keep frontend route entry points thin.
- Put the four Python workflow modules under `backend/secure_qa/<feature>/`, with each module's interfaces, wire schema, tests, adapters, and relevant benchmarks beside its owner.
- Keep host registration thin and route product operations through the workflow interfaces.
- Put shell tests and startup/process benchmarks under `app/desktop/`; put release assembly and full packaged acceptance under `app/release/`.
- Keep product and architecture documents under `docs/`.

Tauri owns startup, readiness, approved application paths, and shutdown for the Python host and llama.cpp runtime. The host and model runtime bind to loopback only. The frontend does not receive Tauri shell or filesystem capabilities by default.

## Why this shape

The `app/` directory makes the product boundary visible while keeping runtime projects distinct. Feature folders keep behavior, schemas, tests, and measurements near their owner. Keeping the frontend and Python host in separate workspaces makes their runtime boundaries explicit while retaining feature ownership. New domain behavior stays in `secure_qa` behind the SDD's four interfaces.
