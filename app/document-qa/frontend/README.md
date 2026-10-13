# Frontend workspace

This workspace contains the pinned Open WebUI v0.11.4 SvelteKit source. The application root uses Open WebUI's `Chat.svelte`, `Sidebar.svelte`, `MessageInput.svelte`, and `Messages.svelte`; the local answer adapter calls the Python workflow through the validated answering contract. The upstream commit, source notices, and local changes are recorded in [UPSTREAM.md](UPSTREAM.md).

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

Open `http://127.0.0.1:5173/qa` (or `/`). The host seeds the golden collection and uses fake answering and embedding adapters, so QA needs no model weights. The Open WebUI chat and service-health banner call the host only on `127.0.0.1:8765`.

The native chat keeps the current conversation in memory and saves each returned answer to local History when persistence is enabled. Use the sidebar to open Library for PDF review, publication and rollback; History for saved answers and citations; and Settings for preferences and readiness. History write failures leave the current answer visible. See [VM QA over SSH forwarding](../../../docs/development/vm-qa-ssh-forwarding.md) for running the same loopback-only services on a private development VM.

Ask **“What is the annual occupational dose limit?”** to see a citation from the seeded Radiation Protection Handbook. Ask **“How do I bake sourdough bread?”** to see the insufficient-evidence response; the test embedder matches on shared words, so some other unrelated questions still retrieve a passage. Toggle general knowledge, submit with Enter, and use Shift+Enter for a new line.

## Run against the real model

Start the llama.cpp runtime first, following its [README](../backend/secure_qa/answering/llama_cpp/README.md), then start the host with the runtime's loopback address:

```sh
.venv/bin/python app/document-qa/backend/dev_host.py --runtime http://127.0.0.1:8080
```

In this mode the host loads the staged local embedding model from `models/all-MiniLM-L6-v2` (override with `--embedding-model`) and uses a separate store with no seeded collection, so publish PDFs from Library before asking. Stage the embedding model once on a connected machine with `python -m secure_qa.library.scripts.fetch_model`, run from `app/document-qa/backend`.

## Checks

Run `npm run test:frontend` for the feature and chat-adapter tests, `npm run test:host` with the host running for the HTTP integration checks, `npm run check` for the product-owned answer adapter and fixture type diagnostics, and `npm run build` for the full static chat bundle. The bundle uses a 6 GB Node heap for Open WebUI's full component graph. Other Open WebUI server workflows are disabled in this local shell. All supported serve commands bind to loopback; build and startup do not download runtime assets. Install dependencies once before disconnected QA. See the [PRD](../../../docs/product/PRD.md) and [SDD](../../../docs/architecture/SDD.md) for product requirements and system boundaries.
