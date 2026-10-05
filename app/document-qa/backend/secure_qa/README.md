# Secure QA backend features

This Python package holds the four SDD workflow modules and supporting diagnostics behind their public interfaces. The Open WebUI Python host dispatches versioned loopback HTTP requests to these workflows and does not bind to a non-loopback interface. See the [SDD](../../../../docs/architecture/SDD.md).

| Module | State |
|---|---|
| `library/` | Document store adapter (Chroma) and versioned collections with an atomic active pointer and rollback. PDF validation and review are not built yet. |
| `answering/` | Text answer path: retrieval, context assembly, model runtime seam (E1 gateway and fake), citation validation, and the answer payload. Visual evidence is not built yet. |
| `history/`, `release_verification/`, `diagnostics/` | Scaffold only |

Run from `app/document-qa/backend` with the repository's virtualenv:

```bash
../../../.venv/bin/python -m unittest discover -s secure_qa -t .
```

`dev_host.py`, next to this package, is a development stand-in for the host that serves the answer path on `127.0.0.1` for frontend work.
