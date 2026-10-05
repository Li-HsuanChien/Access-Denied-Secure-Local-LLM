# Frontend workspace

This workspace owns the analyst-facing interface for the document-QA application. It uses the SvelteKit frontend from the pinned Open WebUI fork, organized here under `src/`. Feature views live in `src/lib/features/`; routes and app entry points stay thin. The frontend calls the Python host over loopback-only HTTP and leaves publication, evidence, citation, and persistence decisions to the backend workflow interfaces. See the [PRD](../../../docs/product/PRD.md) and [SDD](../../../docs/architecture/SDD.md).
