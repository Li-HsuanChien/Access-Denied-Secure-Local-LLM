# Vendored from E2

Copied unchanged from branch `E2-Chunking` at commit `36fda65` (Chunk schema v1.0.0):

| File here | E2 source |
|---|---|
| `chunk.schema.json` | `ingestion/schemas/chunk.schema.json` |
| `nrc_all_chunks.json` | `ingestion/walkthrough/all_chunks.json` (19 real chunks from the NRC Reactor Concepts fixture) |

`tests/test_docstore.py` uses them to check that `docstore.Chunk` stays in step with E2's schema. Delete these copies and point the tests at E2's files once `E2-Chunking` is merged.
