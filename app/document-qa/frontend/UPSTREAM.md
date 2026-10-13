Vendored from open-webui/open-webui v0.11.4
Upstream commit: 8bd8b4fac5e059578ac0c74b3c18d11139f88b7d

Local product changes:
- The root layout initializes one local model and local-user session, disables unrelated upstream server features, and renders Open WebUI's actual `Sidebar` and chat shell.
- The `/`, `/qa`, and `/c/[id]` routes use the upstream `Chat.svelte` page; it composes the upstream `MessageInput`, `Messages`, and `Navbar` components.
- `src/lib/features/answering/` contains the product-owned loopback client, validated wire types, and deterministic QA tests.
- `src/lib/features/answering/openWebUIChatAdapter.ts` calls the Python `answering.ask` operation and formats its result for the upstream message renderer. It supplies already-validated citations to Open WebUI's expandable citation panel. It does not expose Open WebUI's remote model, plugin, tool, or agent workflows.
- `src/lib/stores/index.ts` re-exports the shared product preference from `features/settings/preferencesStore.ts`; its durable value is owned by the local Settings workflow.
- `Sidebar.svelte` supports local navigation and skips upstream account and chat-list endpoints in local mode. The answer adapter saves returned answers best-effort through the History workflow, preserving the answer if saving fails.
- `src/app.html` uses a minimal local document shell with a content policy allowing only local connections and resources, with evaluated code retained for schema validation. `vite.config.ts` removes upstream backend proxies. Supported development servers bind to loopback, and build/startup scripts omit upstream Pyodide downloads.
- The development host uses the deterministic fake embedder and answering runtime, so local UI QA needs no model weights.
- `README.md` and `docs/development/vm-qa-ssh-forwarding.md` document local and private-VM QA.
- The HTTP adapter uses the backend-owned answer schema through Ajv; Vitest and jsdom provide the feature and adapter checks.
- `src/lib/features/personality/` supplies shared local design tokens, evidence styling, and concise state copy for the native shell.
- The root layout sets the upstream `mobile` store and the `dark` class (system preference or `localStorage.theme`), loads the tooltip base stylesheet, and reserves the fixed sidebar's width so the workspace never sits underneath it. It sizes the upstream chat container to the workspace instead of the viewport.
- In local mode `Sidebar.svelte` renders the Library, History, and Settings destinations with icons and an active state, and omits the upstream search entry and chat list. The local user's permissions and the layout's scoped styles hide upstream controls this build cannot serve: dictation, voice mode, read-aloud, continue-response, chat controls, and the attachment menu.
- `Chat.svelte` and `Placeholder.svelte` take the message-input placeholder from `personality/presentation.ts`; starter suggestions come from the layout's local configuration.
- `personality.css` also holds the shared page frame, panel, button, switch, and message styles used by the Library, History, and Settings views.


The source license and notices are retained in `LICENSE`, `LICENSE_NOTICE`, and `LICENSE_HISTORY`. Open WebUI v0.11.4 permits changed branding for deployments with no more than fifty users in any rolling thirty-day period; this product's local single-user deployment falls within that stated condition. Review those notices again before any broader distribution.
