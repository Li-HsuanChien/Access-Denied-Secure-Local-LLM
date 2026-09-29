# E3: RAG and Document Store status

**Last updated:** 2026-09-29 · **Owner:** E3 (Conrad Brady) · **Branch:** `E3-Rag/Document-Store`

This is a running document. Update the **BLUF**, **Current status**, **Deliverables** and the **Log** whenever work lands.
Requirements are quoted from the team's *Capstone Project Doc* (PRD and System Design Document, "SDD") and from the codebase design spec on `main` (`docs/superpowers/specs/2026-09-22-secure-local-document-qa-codebase-design.md`).

---

## BLUF

**The team chose Chroma, and the week 2 prototype works: synthetic chunks in E2's Chunk schema are embedded locally, stored in an on-disk Chroma collection, searched, and every result traces back to its document, pages and character offsets. It has only been run on the dev laptop; it still needs a run on the 8 GB reference laptop.**

- **Decision needed from the team:** SDD §5.1 records one page number per chunk, but E2's chunks can span pages (a page range plus per-page spans). E2 has flagged that the SDD needs updating; it changes the citation format E3 finalizes later.
- **Waiting on:** access to the 8 GB reference laptop, and E2's branch being merged so we can import their schema instead of mirroring it.
- **Next:** run the demo and benchmark on the reference laptop, add version-specific collections with an atomic active-version switch (SDD §6.3), add the relevance threshold, then move the adapter into `main`'s `library/` folder.

## Note: Test Open Web UI for Security and Customizable 

## Current status

- **Store decision: Chroma.** Chroma runs embedded in-process with an on-disk `PersistentClient`, so there's no server or listening port. `main`'s codebase design spec (§4.1) also names Chroma as the production store. The Qdrant adapter and Docker helpers were removed (still in commit `bd58013`).
- **Embedding model:** all-MiniLM-L6-v2 (384-dim) on CPU, loaded offline from `models/`.
- **Index/search contract: v1, on E2's Chunk schema v1.0.0.** `index()` and `search()` return fixed result types (see *I/O contract v1*). 13 tests pass.
- **Demo: working** on the dev laptop, on both the synthetic set and 19 real E2 chunks from the NRC fixture.
- **Benchmark harness:** migrated to the new contract and now Chroma-only.
- **Decision record (ADR): not written.** The choice is recorded in `main`'s design spec; a short ADR under `docs/architecture/decisions/` may still be wanted.

## Project overview

**Secure Local Document-QA System.** A chatbot-style research assistant that runs entirely on one air-gapped laptop. An analyst asks questions about an approved PDF collection and gets grounded answers with document and page citations.

| Constraint | Value (PRD/SDD) |
|---|---|
| Reference hardware | 8 GB RAM, integrated graphics, no dedicated accelerator |
| Platforms | Windows x86-64, macOS on Apple silicon, Ubuntu Linux x86-64 |
| Network | None at runtime: no telemetry, no automatic downloads, no externally reachable listener. `main`'s design allows loopback-only listeners for the Open WebUI host and llama.cpp |
| Stack | Per `main`'s design: Tauri shell, pinned Open WebUI fork (Svelte frontend, Python host), llama.cpp, Sentence Transformers, SQLite, Chroma |
| Corpus | 2,000–5,000 pages of IAEA-style public PDFs; 10,000 pages for stress testing |
| Latency | Under 30 s for text questions; up to 2 min for visually complex ones |
| Concurrency | One question at a time |

**E3 scope:** the document-store seam (SDD §4.5), the store selection decision (§11), and the index/search contract the Collection Library and Question Answering modules build on.

## Deliverables

### Week 2 (Sep 22–28): local embedding + store prototype

> Stand up the selected vector store and embedding model; implement a prototype index/search adapter with synthetic chunks. **Acceptance:** synthetic chunks can be embedded, persisted, searched, and traced back to source metadata on the reference machine. **Demo:** index a small synthetic set and show top-k results with source metadata.

| Item | Status | Evidence |
|---|---|---|
| Store and embedding model stood up | Done | `docstore/chroma_store.py`, `docstore/embedding.py` |
| `index()` / `search()` return agreed schemas | Done | Input is E2 Chunk v1.0.0; outputs `IndexResult` and `SearchResult` (`docstore/chunk.py`) |
| Synthetic chunks | Done | `docstore/synthetic.py`: 5 documents, 11 chunks, 10 cross a page break; E2's ID formulas |
| Embedded, persisted, searched, traced | Done on dev laptop | `scripts/demo_index_search.py` searches from a new process; each hit shows document, pages, offsets and a checksum check |
| On the reference machine | **Not done** | Reference laptop not available yet |
| Demo | Ready | `.venv/bin/python -m scripts.demo_index_search` |

### Week 1 (Sep 15–21)

| # | Deliverable | Status | Notes |
|---|---|---|---|
| 1 | Document-store benchmark harness | Done, now Chroma-only | `benchmarks/`; see `benchmarks/README.md` |
| 2 | Stable write/search I/O contract | Superseded by v1 | Now `index()`/`search()` on E2's schema |
| 3 | Decision record: Chroma vs Qdrant | Decided: Chroma | Team decision, also in `main`'s design spec §4.1 |

### Coverage of the SDD §11 store selection criteria (Chroma)

| Criterion | Covered? | Evidence so far |
|---|---|---|
| Offline persistence | Yes | Identical top-k and counts after a process restart (tests, demo, benchmark) |
| Metadata filtering | No | Not in the contract yet |
| Atomic collection replacement | No | Version-specific collections plus an active pointer are designed in `main`'s spec, not built |
| Packaging reliability | No | No PyInstaller build yet; chromadb pulls in ~75 packages |
| Memory use | Partial | Dev-laptop numbers are unreliable (heavy swapping); must be measured on the 8 GB reference laptop |
| Performance at the 10,000-page target | Partial | Tested to 10,000 chunks in week 1; 10,000 pages is roughly 25–30k chunks at E2's 1,200/200 windows |

## I/O contract v1

Code lives in `docstore/`; `docstore/README.md` is the one-page version for other workstreams.

```python
store = ChromaStore(Embedder(), path=...)
store.index(chunks: Sequence[Chunk]) -> IndexResult
    # IndexResult(collection, indexed, total, embedding_model, embedding_dim, chunk_ids)
store.search(query: str, top_k=5) -> list[SearchResult]
    # SearchResult(chunk: Chunk, score: float, rank: int)
store.load() -> int      # reopen a persisted collection; LookupError if missing
store.count(), store.reset(), store.close()
```

`Chunk` and `PageSpan` mirror E2's `ingestion/src/schema.py` v1.0.0 field for field: `chunk_id`, `document_id`, `ordinal`, `text`, `text_checksum_sha256`, `char_start`/`char_end`, `page_start`/`page_end`, `page_spans` (per-page offsets, highlight rectangles, `coordinates_reliable`, page size), `token_estimate`, `chunker_config_id`, `chunker_version`. `Chunk.from_dict` accepts E2's output unchanged.

**Guaranteed and tested:**
- A search result's chunk equals the indexed chunk in every field, including page spans and rectangles.
- `score` is cosine similarity (within 3e-7 of exact in the benchmark); results are ordered best first with 1-based ranks.
- Re-indexing a chunk id fully replaces it.
- Duplicate ids and text that fails its checksum are rejected before anything is written.
- The collection survives a process restart.
- A collection records its embedding model; opening it with a different model raises `EmbeddingMismatchError`.
- Our `Chunk` validates against a vendored copy of E2's JSON Schema, and round-trips 19 real E2 chunks.

**Open alignment items:**
- **Document metadata** (filename, title) isn't stored with chunks; results carry `document_id`, which the Library's document records resolve. The demo uses a `documents.json` manifest as a stand-in.
- **Relevance threshold** (§7.1): add a `min_score` to `search`.
- **Collection versions** (§6.3 and design spec §4.1): one Chroma collection per version plus a durable active-version pointer and rollback.
- **Metadata filtering** on `search`.
- **Location:** `main`'s layout puts the Chroma adapter under `app/open-webui/backend/secure_qa/library/`; our branch predates that scaffold.

## Results (dev laptop, not decision-grade)

**Environment:** MacBook (Apple silicon, 8 CPUs, 8 GB RAM) with about 6 GB of swap in use; Python 3.12.4; chromadb 1.5.9; all-MiniLM-L6-v2 on CPU; HNSW cosine, M=16, ef_construction=100, ef_search=100.

| Run | Chunks | Index time (s) | Avg / p95 query (ms) | Recall@5 vs exact | Persisted | Reopen (s) |
|---|---|---|---|---|---|---|
| Synthetic placeholder set | 11 | 0.06 | 6.4 / 7.0 | 1.00 | yes | 0.38 |
| E2 NRC chunks + template filler | 2,000 | 7.3 | 8.8 / 9.8 | 0.88 | yes | 0.32 |
| Week 1: placeholder + filler (old schema) | 10,000 | 26.2 | 7.3 / 8.3 | 0.72 | yes | 0.49 |

- Embedding is most of the index time (6.5 s of 7.3 s at 2,000 chunks); store overhead per query is about 1 ms.
- Recall below 1.00 comes from the template filler, which forms a near-duplicate cluster that HNSW handles badly. Re-check recall on real documents only.

## Findings and gotchas

- **Chroma `upsert` merges metadata.** A key missing from a re-write keeps its old value. `Chunk.to_metadata()` always writes every key, which is why a re-indexed chunk is fully replaced.
- **Chroma metadata must be scalar,** so `page_spans` is stored as a JSON string and decoded on the way out.
- **Chroma setup details:** pass `embedding_function=None`, or Chroma tries to download its default ONNX model. Disable telemetry with `Settings(anonymized_telemetry=False)`.
- **E2 chunks span pages.** On the NRC fixture, 18 of 19 chunks cross a page break, so citations must use `page_spans`, not one page number.
- **HNSW loses isolated chunks inside near-duplicate clusters.** Real corpora with repeated boilerplate (headers, disclaimers) may show the same effect.
- **Offline setup:** the model loads from `models/all-MiniLM-L6-v2` with `local_files_only=True` and `HF_HUB_OFFLINE=1`; Chroma telemetry is off. Configured but **not yet verified with a network capture**, which SDD §14 will require.
- **RSS is unreliable on macOS under memory pressure.** The benchmark reports peak RSS and warns when swap is heavily used.

## Environment and how to run

```bash
.venv/bin/python -m scripts.demo_index_search                   # week 2 demo
.venv/bin/python -m scripts.demo_index_search --e2-chunks tests/fixtures/e2/nrc_all_chunks.json
.venv/bin/python -m unittest discover -s tests -t . -v           # 13 tests
.venv/bin/python -m benchmarks.run_benchmark --synthetic 10000   # benchmark
```

- Setup: `benchmarks/README.md`. Gitignored, local only: `.venv/`, `models/` (fetch with `scripts/fetch_model.py`), `.bench_data/`.
- `tests/fixtures/e2/` holds copies of E2's schema and sample chunks from `E2-Chunking` at `36fda65`; delete them once E2's branch is merged.
- The `qdrant-bench` Docker container and `qdrant-bench-storage` volume from week 1 are no longer needed and can be removed.

## Open questions and dependencies

| Question | Owner / who to ask |
|---|---|
| SDD §5.1 update for page-spanning chunks (page range plus `page_spans`) | E2 / SDD owner |
| When will `E2-Chunking` merge, so `docstore` can import E2's schema? | E2 |
| When should E3 rebase onto `main` and move into `library/`? | Team |
| When can we get access to the 8 GB reference laptop? | Team / sponsor |
| The Capstone doc's early "Deliverables and Requirements" section (roles, `allowed_roles`, role filters) conflicts with the PRD/SDD. Which is authoritative for filtering needs? | Team |

## Next steps (proposed)

1. Run the demo, tests and benchmark on the **8 GB reference laptop**; record memory and latency.
2. Add **version-specific collections**, a durable **active-version pointer** and **rollback** (SDD §6.3).
3. Add the **relevance threshold** (`min_score`) and, if needed, **metadata filters** to `search`.
4. Run at the **10,000-page stress scale** with real E2 chunks.
5. **Packaging spike:** a PyInstaller bundle that imports and queries Chroma on Windows, macOS and Linux.
6. **Network capture** during index and search to prove there are no outbound attempts.
7. Rebase onto `main` and move `docstore/` into `app/open-webui/backend/secure_qa/library/`.

## Log

- **2026-09-29 (week 2):**
  - Team selected Chroma. Removed the Qdrant adapter, Docker helpers and `qdrant-client`.
  - Rebuilt the contract as `index()`/`search()` on E2's Chunk schema v1.0.0, with checksum and duplicate checks and an embedding-model check per collection.
  - Added the synthetic chunk generator, a deterministic fake embedder, 13 tests and the week 2 demo.
  - Migrated the benchmark to the new contract (Chroma-only); ran it on the synthetic set and on E2 chunks plus filler.
- **2026-09-22:** added the BLUF section.
- **2026-09-17 (week 1):**
  - Built the benchmark harness and contract v0.
  - Ran the benchmark at 30 chunks and 10,000 chunks on the dev laptop.
  - Found and fixed the Chroma metadata-merge bug; added the `qdrant-hnsw` variant, peak-memory reporting and automatic caveats.
  - Reviewed the work against the Capstone Project Doc: flagged the Qdrant/Docker conflict with the SDD and the uncovered selection criteria.
  - Created branch `E3-Rag/Document-Store`.
