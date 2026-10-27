# Answering frontend

The React chat screen composes the product-owned answer client, chat controller, composer, and shared answer renderer. It displays validated workflow classifications and citations while preserving the complete answer payload independently from local presentation edits.

The HTTP and deterministic fixture clients implement the same public client seam. The HTTP client validates the backend-owned answer schema and rejects non-loopback destinations and redirects. The application-level answering coordinator serializes dispatched requests and saves each returned result best-effort through the History workflow; a screen unmount does not cancel host work.

`npm run test:frontend` runs the frontend feature and rendered component tests. `npm run test:host` exercises HTTP integration with the running seeded development host. See the [Question Answering design](../../../../../../../docs/architecture/SDD.md#42-question-answering), [frontend setup](../../../../README.md), and [React contracts](../../../../../../../docs/development/react-migration/react-contracts.md).
