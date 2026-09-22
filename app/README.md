# Application layout

Scaffold only. This single desktop product groups the [Tauri shell](desktop/README.md), [Open WebUI frontend and Python backend](open-webui/README.md), and [release assembly](release/README.md). The four SDD workflow modules live under `open-webui/backend/secure_qa/`. Each feature keeps its transport schema, tests, and relevant benchmarks beside its owner. `app/` is a repository grouping directory, not a Python package. The [codebase design](../docs/superpowers/specs/2026-09-22-secure-local-document-qa-codebase-design.md) describes the boundaries.
