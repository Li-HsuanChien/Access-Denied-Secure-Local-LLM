# Secure QA backend features

This Python package holds the five SDD workflow modules and supporting diagnostics behind their public interfaces. The Python development host dispatches versioned loopback HTTP requests to these workflows and does not bind to a non-loopback interface. See the [SDD](../../../../docs/architecture/SDD.md).

| Module | State |
|---|---|
| `library/` | PDF review, validation, extraction, cancellable publication, source retention, and versioned Chroma collections. |
| `answering/` | Text answer path: retrieval, context assembly, model runtime seam (E1 gateway and fake), citation validation, and the answer payload. Visual evidence is not built yet. |
| `history/` | Local SQLite conversation storage and persistence controls. |
| `settings/` | Persisted general-knowledge preference and live readiness contract. |
| `release_verification/`, `diagnostics/` | Release verification and local diagnostics workflows. |

Run from `app/document-qa/backend` with the repository's virtualenv:

```bash
../../../.venv/bin/python -m unittest discover -s secure_qa -t .
```

`dev_host.py`, next to this package, is a loopback-only development host that dispatches all current feature operations.
