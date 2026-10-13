# Frontend workspace

This workspace contains the pinned Open WebUI v0.11.4 SvelteKit source and the first product-owned answering feature. The upstream commit, source notices, and local changes are recorded in [UPSTREAM.md](UPSTREAM.md). Feature modules live under `src/lib/features/`; the `/qa` route is intentionally thin.

## Run local QA

Install the pinned Python dependencies once from the repository root:

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

Then start the deterministic host in one terminal from the repository root:

```sh
.venv/bin/python app/document-qa/backend/dev_host.py
```

In another terminal:

```sh
cd app/document-qa/frontend
npm ci
npm run dev:qa
```

Open `http://127.0.0.1:5173/qa`. The host seeds the golden collection and uses fake answering and embedding adapters, so QA needs no model weights. The browser harness only calls the host on `127.0.0.1:8765`.

To inspect interface states without starting Python, open `http://127.0.0.1:5173/qa?fixture=1`. Ask a normal question for an answer with a citation, or ask about something unknown to see the insufficient-evidence state. The fixture mode is for interface QA; use the host-backed route to verify the HTTP integration.

Ask **“What is the annual occupational dose limit?”** on the host-connected page to see a citation from the seeded Radiation Protection Handbook. In fixture mode, **“unknown topic”**, **“busy”**, **“fail”**, and **“warning”** show each QA state. Toggle general knowledge, expand a citation, submit with Enter, and use Shift+Enter for a new line. The other navigation items are placeholders in this Chat preview.

Run `npm run test:frontend` for the feature and adapter tests, `npm run test:host` with the host running for the HTTP integration checks, `npm run check` for product-owned QA type diagnostics, and `npm run build` for the local static build. Unused upstream source is retained for later integration and is outside the QA type-check scope. All supported serve commands bind to loopback; build and startup do not download runtime assets. Install dependencies once before disconnected QA. See the [PRD](../../../docs/product/PRD.md) and [SDD](../../../docs/architecture/SDD.md) for product requirements and system boundaries.
