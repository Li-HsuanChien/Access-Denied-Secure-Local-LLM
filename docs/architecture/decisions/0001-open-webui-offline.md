# ADR 0001: Adopt Open WebUI within an offline Tauri desktop

Status: approved design direction; written design awaiting review.  
Date: 2026-09-22.  
Supersedes the technology and transport choices in the user-provided SDD sections 4, 11, and 14 where they conflict with this decision. The four workflow-module interfaces and air-gap requirement remain authoritative.

## Context

The SDD originally selected a React/Vite frontend in Tauri, a Python sidecar, and local messages without an HTTP listener. The user subsequently selected Open WebUI for as much frontend and retrieval reuse as is feasible and clarified that the laptop is not connected to the internet. Open WebUI's frontend is SvelteKit and its Python backend is FastAPI. Its documented llama.cpp integration uses a local HTTP endpoint. Its official Desktop application uses Electron and currently requires internet on first launch. [Development guide](https://docs.openwebui.com/getting-started/advanced-topics/development/), [llama.cpp guide](https://docs.openwebui.com/getting-started/quick-start/connect-a-provider/starting-with-llama-cpp/), [Desktop README](https://github.com/open-webui/desktop/blob/main/README.md).

## Decision

Maintain a pinned Open WebUI source fork as the frontend and host implementation. Package it with a custom Tauri shell that manages a local Python host and llama.cpp runtime. Both bind only to `127.0.0.1`. Every asset and model is present before installation; first launch performs no download. The air-gapped laptop exposes no externally reachable listener. Dedicated Collection Library, Question Answering, Conversation History, and Release Verification modules retain the SDD behavior behind their own interfaces. Open WebUI code is reused inside their implementations where suitable; generic Open WebUI knowledge mutation and autonomous tools do not control release-critical behavior.

Select local single-worker Chroma as the first document-store adapter. The Collection Library supplies immutable versioned snapshots and atomic activation itself. If the selected fork, store, and model cannot pass offline, cross-platform, 8 GB, or 10,000-page qualification, revisit the architecture through a new decision record.

## Consequences

- Replace the SDD's React frontend with Svelte/Open WebUI. Retain Tauri as the packaged shell.
- Replace the SDD's no-HTTP-listener rule with loopback-only listeners and keep its no-external-network and no-externally-reachable-listener rules.
- Keep upstream changes narrow and record the pinned revision, local modifications, license notices, and branding obligations in release metadata. Current Open WebUI releases include a branding condition, so the release review checks the pinned revision's exact terms. [Open WebUI license](https://github.com/open-webui/open-webui/blob/main/LICENSE).
- Disable remote connections, plugin execution, model tools, code execution, web search, and runtime downloads. Offline flags alone do not prohibit outbound connections, so disconnected packaged tests enforce that condition. [Offline guidance](https://docs.openwebui.com/tutorials/maintenance/offline-mode/), [hardening guidance](https://docs.openwebui.com/getting-started/advanced-topics/hardening/).
- A separately trusted verifier checks signed bundles before installation; an installed application's startup check is additional defense.

## Rejected alternatives

The official Open WebUI Desktop app would require replacing its Electron shell and first-launch online setup for this MVP. The original React/Tauri frontend would preserve a no-listener transport but prevent substantial direct reuse of Open WebUI's Svelte frontend. Neither is selected for this release.
