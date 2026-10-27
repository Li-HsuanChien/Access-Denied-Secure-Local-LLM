# Frontend workspace

This workspace contains the React 19, TypeScript, and Vite frontend. Product features and their workflow clients live under `src/lib/features/`; routes, app composition, and providers live under `src/react/`. The frontend calls the Python workflow host on loopback and has no standalone server backend. Reused Open WebUI source and assets are documented in [UPSTREAM.md](UPSTREAM.md); keep `LICENSE`, `LICENSE_HISTORY`, and `LICENSE_NOTICE` intact.

## Run local QA

Install the pinned Python dependencies once from the repository root:

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

Start the deterministic host in one terminal from the repository root:

```sh
.venv/bin/python app/document-qa/backend/dev_host.py
```

In another terminal:

```sh
cd app/document-qa/frontend
npm ci
npm run dev:qa
```

Open `http://127.0.0.1:5173/qa` (or `/`). The host seeds the golden collection and uses fake answering and embedding adapters, so QA needs no model weights. The React chat and service-health banner call the host only on `127.0.0.1:8765`.

The chat keeps the current temporary session in memory and saves each returned answer to local History when persistence is enabled. Use the sidebar to open Library for PDF review, publication and rollback; History for saved answers and citations; and Settings for preferences and readiness. History write failures leave the current answer visible. See [VM QA over SSH forwarding](../../../docs/development/vm-qa-ssh-forwarding.md) for private development VMs.

Ask **“What is the annual occupational dose limit?”** to see a citation from the seeded Radiation Protection Handbook. Ask **“How do I bake sourdough bread?”** to see the insufficient-evidence response; the test embedder matches on shared words, so some other unrelated questions still retrieve a passage. Toggle general knowledge, submit with Enter, and use Shift+Enter for a new line.

## Run against the real model

Start the llama.cpp runtime first, following its [README](../backend/secure_qa/answering/llama_cpp/README.md), then start the host with the runtime's loopback address:

```sh
.venv/bin/python app/document-qa/backend/dev_host.py --runtime http://127.0.0.1:8080
```

In this mode the host loads the staged local embedding model from `models/all-MiniLM-L6-v2` (override with `--embedding-model`) and uses a separate store with no seeded collection, so publish PDFs from Library before asking. Stage the embedding model once on a connected machine with `python -m secure_qa.library.scripts.fetch_model`, run from `app/document-qa/backend`.

## Commands

Use Node.js 20–22 and npm 10 or newer. The canonical commands are:

```sh
npm run dev:qa       # loopback Vite server at 127.0.0.1:5173
npm run build        # static production bundle in ../build
npm run preview      # loopback static preview
npm run check        # strict TypeScript check
npm run test:frontend
```

Run `npm run test:host` with the deterministic host running for the HTTP integration checks. The launcher detects stale frontend installs from exact manifest bytes, Node major, platform, architecture, and required packages; a missing or stale receipt triggers `npm ci`. Frontend build and startup do not download runtime assets. Install dependencies before disconnected QA. Tauri packaging and release assembly are not complete. See the [PRD](../../../docs/product/PRD.md) and [SDD](../../../docs/architecture/SDD.md) for product requirements and system boundaries.
