# Answering frontend

`AnsweringView` owns the question interaction, readiness, answer sections, warnings, and expandable source passages. It receives the typed `AnsweringClient` interface from `types.ts`; HTTP and deterministic fixture adapters implement that seam. The HTTP adapter validates the backend-owned answer schema and rejects non-loopback destinations and redirects. The view renders workflow classifications directly and does not infer evidence from model prose.

Component and adapter tests are colocated here. `npm run test:frontend` runs them; `npm run test:host` exercises the HTTP adapter against the running seeded development host. See the [Question Answering design](../../../../../../../docs/architecture/SDD.md#42-question-answering) and [frontend setup](../../../../README.md).
