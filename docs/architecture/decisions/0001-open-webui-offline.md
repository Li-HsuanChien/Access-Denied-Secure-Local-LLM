# ADR 0001: Adopt Open WebUI within an offline Tauri desktop

**Status: approved; reflected in the [System Design Document](../SDD.md).**
**Date:** 2026-09-22.

## Context

The SDD initially selected a React/Vite frontend in Tauri, a Python sidecar, and local messaging without an HTTP listener. The project then selected Open WebUI for frontend and retrieval reuse while retaining the air-gapped deployment requirement. Open WebUI supplies a SvelteKit frontend and Python/FastAPI backend. Its integration with llama.cpp uses a local HTTP endpoint. The official Open WebUI Desktop application is not used; the project supplies its own Tauri shell.

## Decision

Use a pinned Open WebUI source fork for the frontend and Python host, packaged inside a custom Tauri shell. Tauri manages the Python host and llama.cpp runtime. Both services bind only to `127.0.0.1`; all assets and models are included before installation, and first launch performs no download. The air-gapped laptop exposes no externally reachable listener.

Dedicated Collection Library, Question Answering, Conversation History, and Release Verification modules retain ownership of their SDD behaviors behind their own interfaces. Open WebUI is an implementation source; generic knowledge mutation and autonomous tools do not control release-critical behavior.

Use local single-worker Chroma as the initial document-store adapter. The Collection Library owns immutable versioned snapshots and atomic activation. If the selected fork, store, and model cannot pass offline, cross-platform, 8 GB, or 10,000-page qualification, revisit the architecture through an updated SDD or a new decision record.

## Consequences

- The SDD's frontend is SvelteKit/Open WebUI, with Tauri as the packaged desktop shell.
- Loopback-only HTTP services are permitted inside the desktop application; no service binds to a non-loopback address and no standalone browser workflow is supported.
- Upstream changes remain narrow. Record the pinned revision, local modifications, license notices, and branding obligations in release metadata.
- Disable remote connections, plugin execution, model tools, code execution, web search, and runtime downloads. Offline flags alone do not prohibit outbound connections, so disconnected packaged tests enforce that condition.
- A separately trusted verifier checks signed bundles before installation; an installed application's startup check is additional defense.
