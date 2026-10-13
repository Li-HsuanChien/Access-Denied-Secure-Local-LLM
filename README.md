# Access-Denied-Secure-Local-LLM

Develop and evaluate a locally deployed AI platform for organizations that cannot use public AI services because of sensitive, proprietary, export-controlled, security-related, privacy-protected, or otherwise restricted information.

The repository contains the product and architecture specifications and a working local build of the document-QA interface: the pinned Open WebUI chat, the Library, History, and Settings views, and the Python host and workflow modules behind them. The Tauri desktop shell and release packages are not built yet, so the app currently runs as two loopback-only development processes.

## Run it locally

The easiest way is the one-command launcher. It creates the Python environment, installs the
backend and frontend dependencies, starts the two loopback services, and opens the browser. It is
interactive and asks whether to run the **Quick demo** (a deterministic test model and a seeded
collection - no model weights, no downloads) or **Real local AI** (a real llama.cpp model and
embeddings, downloading the weights only if you agree). Press Ctrl+C to stop everything.

- **Windows:** double-click `start.cmd`, or run it from a terminal.
- **macOS / Linux:** `./start.sh` (or `bash start.sh`).

Requirements: Python 3.11+ and Node.js 18-22 on your PATH. The first run installs dependencies and
takes a few minutes; later runs start quickly. Only setup downloads (pip, npm, and any weights you
opt into) use the network - the running services stay bound to `127.0.0.1`.

### Manual steps (fallback)

From the repository root, install the pinned Python dependencies once and start the host:

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python app/document-qa/backend/dev_host.py
```

In a second terminal, start the interface and open `http://127.0.0.1:5173/`:

```sh
cd app/document-qa/frontend
npm ci
npm run dev:qa
```

This uses a deterministic test model and a seeded test collection, so it needs no model weights. The [frontend README](app/document-qa/frontend/README.md) covers what to try, the test commands, and running against the real llama.cpp runtime.

The standalone llama.cpp runtime chat that `start.cmd` used to launch now lives at [`app/document-qa/backend/secure_qa/answering/llama_cpp/start.cmd`](app/document-qa/backend/secure_qa/answering/llama_cpp/start.cmd).

## Documentation

- [Product requirements](docs/product/PRD.md)
- [System design](docs/architecture/SDD.md)
- [Historical codebase design](docs/superpowers/specs/2026-09-22-secure-local-document-qa-codebase-design.md)
- [ADR 0001: Offline Open WebUI in Tauri](docs/architecture/decisions/0001-open-webui-offline.md)
- [ADR 0002: Feature-first source layout](docs/architecture/decisions/0002-feature-first-layout.md)
- [ADR 0003: Research workspace personality](docs/architecture/decisions/0003-research-workspace-personality.md)
- [Contributing](CONTRIBUTING.md)
- [Application layout](app/README.md)
- [Desktop shell](app/desktop/README.md)
- [Document-QA application](app/document-qa/README.md)
- [Release area](app/release/README.md)
- [Backend workflow modules and tests](app/document-qa/backend/secure_qa/README.md)
- [E2 ingestion schemas and fixture corpus](ingestion/README.md) (not yet wired into the app)
- [E1 LLM runtime report](docs/reports/E1-runtime-report.md) (runtime adapter: [llama_cpp](app/document-qa/backend/secure_qa/answering/llama_cpp/README.md))
