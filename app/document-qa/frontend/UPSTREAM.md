Vendored from open-webui/open-webui v0.11.4
Upstream commit: 8bd8b4fac5e059578ac0c74b3c18d11139f88b7d

Local product changes:
- `src/lib/features/answering/` contains the product-owned view, loopback client, fixture adapter, and tests.
- `src/routes/qa/+page.svelte` is the thin QA route.
- `src/routes/+layout.svelte` is a product-owned shell that imports the pinned frontend's global styles without starting unrelated backend/session/websocket behavior.
- `src/app.html` replaces the upstream splash screen and branding markup with a minimal local document shell.
- Unused upstream routes were omitted from this QA slice; the pinned shared source remains under `src/lib/` for later product integration.
- `vite.config.ts` removes upstream backend proxies. Every supported serve command binds to loopback; build and startup scripts omit the upstream Pyodide download step. `package.json` adds QA and test commands.
- `tsconfig.qa.json` limits type diagnostics to the product-owned QA route and answering feature because the unused upstream application currently has existing type errors.
- `app/document-qa/backend/dev_host.py` uses the existing deterministic fake embedder as well as the fake answering runtime, so local QA needs no downloaded model weights.
- `README.md` documents the local QA workflow.
- The HTTP adapter uses the backend-owned wire schema through Ajv; Vitest and an explicit jsdom dependency provide component tests. No second test framework was added.

The source license and notices are retained in `LICENSE`, `LICENSE_NOTICE`, and `LICENSE_HISTORY`. Open WebUI v0.11.4 permits changed branding for deployments with no more than fifty users in any rolling thirty-day period; this product's local single-user deployment falls within that stated condition. Review those notices again before any broader distribution.
