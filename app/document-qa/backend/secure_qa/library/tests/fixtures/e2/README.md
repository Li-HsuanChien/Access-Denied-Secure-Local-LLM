# Vendored from E2

These files are copied unchanged from branch `E2-Chunking` at commit `36fda65` (Chunk schema v1.0.0):

| File here | E2 source |
|---|---|
| `chunk.schema.json` | `ingestion/schemas/chunk.schema.json` |
| `nrc_all_chunks.json` | `ingestion/walkthrough/all_chunks.json` (19 real chunks from the NRC Reactor Concepts fixture) |
| `nrc_document.json` | `ingestion/walkthrough/document.json` (its Document record) |
| `nrc_text.txt` | `ingestion/walkthrough/text/normal_nrc_reactor_concepts_ch01.text.txt` (canonical text stream; chunk offsets index into it) |
| `nrc_offsets.json` | `ingestion/walkthrough/text/normal_nrc_reactor_concepts_ch01.offsets.json` (page boundaries) |

The library tests use these files to keep `Chunk` in step with E2's schema. The golden queries use them to check that citations resolve to the exact source characters. Delete these copies and point the tests at E2's files once `E2-Chunking` is merged.
