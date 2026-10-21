# Upstream source and asset provenance

The React migration translates portions of Open WebUI v0.11.4, pinned to upstream commit [`8bd8b4fac5e059578ac0c74b3c18d11139f88b7d`](https://github.com/open-webui/open-webui/commit/8bd8b4fac5e059578ac0c74b3c18d11139f88b7d). React owns the shipped interface; the original Svelte implementation was removed from the active source tree during cutover. The historical source remains available in repository history for comparison and rollback.

## Reused and translated material

- **Shell and navigation:** React app shell, sidebar, top bar, model selector, mobile navigation, and their local interaction states translate the former Open WebUI shell and navigation markup.
- **Chat and composer:** React chat messages, composer, suggestion layout, loading/error states, and source panels translate the former chat and message-input presentation. Workflow requests and answer data remain product-owned and use the Python host contracts.
- **Answer renderer:** React Markdown, citation, code, math, diagram, chart, table, preview, and tooltip surfaces translate selected Open WebUI renderer interactions and markup. `baseline-*.ts` renderer extensions retain selected token parsing behavior needed for citations, footnotes, math, strikethrough, and fenced blocks. Arbitrary code execution and unsafe resource loading are not carried over.
- **Styles and design:** `src/app.css`, `src/tailwind.css`, `src/lib/features/personality/personality.css`, and the React feature styles include translated or adapted upstream CSS. Local product tokens and evidence-specific treatments are maintained in the personality feature.
- **Fonts and images:** `static/assets/fonts/Inter-Variable.ttf`, `static/assets/fonts/Vazirmatn-Variable.ttf`, `static/favicon.png`, and `static/static/favicon.png` are retained upstream assets. The favicon is used as the model fallback mark. Font files and image assets retain their upstream license/provenance obligations.
- **Icons:** Selected inline SVG geometry and icon choices are translated from Open WebUI controls. Product-specific icons and controls were authored or adapted for the React implementation.

The migrated product continues to use third-party packages for React rendering, Markdown and rich content, editors, diagrams, charts, and positioning. Their licenses are governed by their package distributions and lockfile; this file records Open WebUI provenance rather than replacing individual package notices.

## License and branding notices

The upstream `LICENSE`, `LICENSE_HISTORY`, and `LICENSE_NOTICE` files are retained unchanged. The license includes attribution and branding conditions; replacing Svelte with React does not remove obligations for translated markup, CSS, fonts, icons, or images. Review the retained notices before redistribution or any change in deployment scope.
