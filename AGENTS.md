# Contributor instructions

## Product and design sources of truth

- Product scope and acceptance goals are defined in [`docs/product/PRD.md`](docs/product/PRD.md).
- System behavior, interfaces, data, security, performance, testing, and technology choices are defined in [`docs/architecture/SDD.md`](docs/architecture/SDD.md).
- Read the relevant PRD and SDD sections before changing product behavior or architecture. Follow both documents; do not infer new requirements from the scaffold alone.
- When an approved product requirement changes, update the PRD. When an approved design, interface, technology, or workflow changes, update the SDD or add a linked decision record under `docs/architecture/decisions/`. Make the documentation change in the same change set as the implementation.
- The [historical codebase design](docs/superpowers/specs/2026-09-22-secure-local-document-qa-codebase-design.md) records an earlier React direction. The active Open WebUI/Tauri architecture and feature layout are captured by the SDD and [ADRs 0001](docs/architecture/decisions/0001-open-webui-offline.md) and [0002](docs/architecture/decisions/0002-feature-first-layout.md).

## Placement and implementation

- Put desktop shell and platform lifecycle code in `app/desktop/`.
- Put the document-QA interface and workflow host in `app/document-qa/`. The folder is named for its responsibility; it contains the pinned Open WebUI Svelte frontend under `frontend/src/` and Python host under `backend/`.
- Put workflow-owned Python modules in `app/document-qa/backend/secure_qa/<feature>/`; host integration belongs in `app/document-qa/backend/` and must remain a thin adapter.
- Put frontend code under `app/document-qa/frontend/src/lib/features/<feature>/`; keep route entry points thin and use workflow interfaces for product behavior.
- Put bundle assembly and pre-install release verification in `app/release/`.
- Keep tests, benchmarks, and wire contracts with their owning feature as described by the SDD. Use public module interfaces as test seams; keep third-party types and adapter details out of public workflow interfaces and persistent domain records.
- Treat imported documents as untrusted data. Preserve offline operation, evidence-grounding, citation-validation, privacy, and one-job-at-a-time constraints. Bind local services to loopback only; never expose a non-loopback listener or add outbound network behavior.
