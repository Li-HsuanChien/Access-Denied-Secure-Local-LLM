# Access-Denied-Secure-Local-LLM

Develop and evaluate a locally deployed AI platform for organizations that cannot use public AI services because of sensitive, proprietary, export-controlled, security-related, privacy-protected, or otherwise restricted information.

The repository contains product and architecture specifications and a React document-QA interface with a Python host and workflow modules. The Tauri desktop shell and release packages remain scaffolds, so the application currently runs as loopback-only development processes.

## Run it locally

The one-command launcher creates the Python environment, installs backend and frontend dependencies, starts the development host and React frontend, and opens the browser. It asks whether to run **Quick demo** (a deterministic test model and seeded collection, with no model weights or downloads) or **Real local AI** (a local llama.cpp model and embeddings; missing weights are downloaded only if you agree). Press Ctrl+C to stop everything.

- **Windows:** double-click `start.cmd`, or run it from a terminal.
- **macOS / Linux:** `./start.sh` (or `bash start.sh`).

Requirements: Python 3.11+, Node.js 20–22, and npm 10+ on your PATH. The first run installs dependencies and takes a few minutes. The launcher records a manifest/runtime fingerprint in `node_modules`; it runs `npm ci` again when manifests, Node major version, platform, architecture, or required packages change. If you run `npm ci` manually, the next launcher run may perform one additional install to create its receipt. Setup downloads (pip, npm, and any weights you opt into) use the network; running services stay bound to `127.0.0.1`.

### Manual steps

From the repository root, install the pinned Python dependencies once and start the host:

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python app/document-qa/backend/dev_host.py
```

In a second terminal, install and run the React frontend:

```sh
cd app/document-qa/frontend
npm ci
npm run dev:qa
```

Open `http://127.0.0.1:5173/`. The deterministic test model and seeded collection need no model weights. The [frontend README](app/document-qa/frontend/README.md) covers workflows and frontend commands. The standalone llama.cpp runtime chat formerly started by `start.cmd` lives at [`app/document-qa/backend/secure_qa/answering/llama_cpp/start.cmd`](app/document-qa/backend/secure_qa/answering/llama_cpp/start.cmd).

## Documentation

- [Product requirements](docs/product/PRD.md)
- [System design](docs/architecture/SDD.md)
- [ADR 0004: React frontend parity](docs/architecture/decisions/0004-react-frontend-parity.md)
- [Historical codebase design](docs/superpowers/specs/2026-09-22-secure-local-document-qa-codebase-design.md)
- [Historical ADRs 0001–0003](docs/architecture/decisions/0001-open-webui-offline.md)
- [Contributing](CONTRIBUTING.md)
- [Application layout](app/README.md)
- [Desktop shell](app/desktop/README.md)
- [Document-QA application](app/document-qa/README.md)
- [Release area](app/release/README.md)
- [Backend workflow modules and tests](app/document-qa/backend/secure_qa/README.md)
- [E2 ingestion schemas and fixture corpus](ingestion/README.md) (not yet wired into the app)
- [E1 LLM runtime report](docs/reports/E1-runtime-report.md) (runtime adapter: [llama_cpp](app/document-qa/backend/secure_qa/answering/llama_cpp/README.md))
