# Historical Codebase Design Record

**Status: historical; current decisions are defined by the [System Design Document](../../architecture/SDD.md).**

This file records an earlier design exploration. Its initial React/Vite and no-listener direction was later revised to use a pinned Open WebUI fork inside a custom Tauri shell, with loopback-only HTTP services and Chroma as the initial document-store adapter. Those decisions are now described in the SDD and [ADR 0001](../../architecture/decisions/0001-open-webui-offline.md); repository organization is described in [ADR 0002](../../architecture/decisions/0002-feature-first-layout.md).

Use the PRD and SDD as the sources of truth. This historical record does not supersede them. The `app/` tree remains a documentation scaffold and does not contain the application implementation or vendored Open WebUI source.
