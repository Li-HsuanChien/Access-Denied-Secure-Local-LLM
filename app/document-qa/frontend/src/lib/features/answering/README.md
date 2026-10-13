# Answering frontend

The product route uses the pinned Open WebUI Chat, Sidebar, MessageInput, and Messages components. `openWebUIChatAdapter.ts` connects that native chat to the typed `AnsweringClient` interface and renders validated workflow classifications and citations through Open WebUI's message and citation panels.

`AnsweringView` remains a focused feature fixture for readiness, answer sections, and failure-state tests; it is not the product chat screen. The HTTP and deterministic fixture adapters implement the same client seam. The HTTP adapter validates the backend-owned answer schema and rejects non-loopback destinations and redirects.

Component and adapter tests are colocated here. `npm run test:frontend` runs them; `npm run test:host` exercises the HTTP adapter against the running seeded development host. See the [Question Answering design](../../../../../../../docs/architecture/SDD.md#42-question-answering) and [frontend setup](../../../../README.md).
