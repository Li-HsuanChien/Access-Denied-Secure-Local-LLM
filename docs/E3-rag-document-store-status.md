# E3: RAG and Document Store status

**Last updated:** 2026-10-05 · **Owner:** E3 (Conrad Brady) · **Branch:** `E3-Rag/Document-Store`

This is a running document. Update the **BLUF**, **Current status**, **Deliverables** and the **Log** whenever work lands.
Requirements are quoted from the PRD and SDD, which now live in the repo at `docs/product/PRD.md` and `docs/architecture/SDD.md`. The older *Capstone Project Doc* and the codebase design spec on `main` have been superseded; the spec is now a pointer to the SDD.

---

## BLUF

**The week 3 retrieval-to-answer path works end to end and meets its acceptance test with a deterministic test model.**

- **The path:** a question is searched in the active collection version, filtered by a relevance threshold, assembled into labelled passages, sent through E1's runtime contract, and checked for citations. The result is a structured answer whose citations resolve to the exact source characters.
- **Golden queries:** all 14 pass acceptance. All 10 answerable questions retrieve their expected chunk at rank 1, cite it, and resolve exactly. All 4 off-topic questions are refused.
- **E1 wire test:** the same path runs over HTTP against E1's actual runtime (stub backend). E1's stub has no model weights, so its canned text has no citations; the validator retried once and then correctly withheld it.

**What's still missing for the objective as written is the frozen LLM.** E1 hasn't published a frozen model yet; their branch was last updated 2026-09-28 and doesn't have the week 3 freeze. Nobody has run a real model through the path yet.

- **Decision needed from the team:** SDD §5.1 gives a citation one page number, but E2's chunks span pages. Our citation payload carries a page range plus per-page spans. E2 raised this, and the SDD hasn't been updated.
- **Waiting on:**
  - E1's frozen model and manifest
  - access to the 8 GB reference laptop
  - E2's branch being merged, so we can import their schema instead of mirroring it
- **Next:**
  - Run the golden set through E1's runtime with the frozen model, and record answer-quality facts and latency.
  - Hand E4 the dev endpoint and the answer schema.
  - Hand E5 the golden set, the answer schema and the threshold data.

## Note: Test Open Web UI for Security and Customizable

The review of Open WebUI's built-in Chroma and Ollama support, and the decisions taken from it, are in [`E3-next-steps.md`](E3-next-steps.md).

## Current status

- **Location:** the code now sits in `main`'s layout. `main` was merged into this branch rather than rebased, so no force push is needed.
  - Store and versioning: `app/document-qa/backend/secure_qa/library/`
  - Answer path: `secure_qa/answering/`
  - Development host: `app/document-qa/backend/dev_host.py`
- **Store:** Chroma, embedded and on disk, with all-MiniLM-L6-v2 on CPU, loaded offline.
- **Contract:** `index()`/`search()` on E2's Chunk schema v1.0.0, now with `min_score` and an explicit `RetrievalError`.
- **Versioned collections (SDD §4.1, §6.3):** a publish builds a candidate, verifies it and activates it atomically. Rollback works, only the active and previous versions are kept, and interrupted candidates are cleaned up. Failed publications never change the active version.
- **Answer path (SDD §4.2, §7.1, §7.3):** done for text. Visual evidence, streaming progress and cancellation are not built.
- **Tests:** 67 backend tests pass. The one skipped test is the live E1 test, which runs when `SECURE_QA_TEST_RUNTIME_URL` is set; it passed against E1's stub on 2026-10-05.
- **Decision record (ADR):** none written. Chroma is recorded in SDD §4.5 and §11 and in ADR 0001.

## Project overview

**Secure Local Document-QA System.** A chatbot-style research assistant that runs entirely on one air-gapped laptop. An analyst asks questions about an approved PDF collection and gets grounded answers with document and page citations.

| Constraint | Value (PRD/SDD) |
|---|---|
| Reference hardware | 8 GB RAM, integrated graphics, no dedicated accelerator |
| Platforms | Windows x86-64, macOS on Apple silicon, Ubuntu Linux x86-64 |
| Network | None at runtime: no telemetry, no automatic downloads, no externally reachable listener. Loopback-only listeners are allowed for the Open WebUI host and llama.cpp |
| Stack | Tauri shell, pinned Open WebUI fork (Svelte frontend, Python host), llama.cpp, Sentence Transformers, SQLite, Chroma |
| Corpus | 2,000–5,000 pages of IAEA-style public PDFs; 10,000 pages for stress testing |
| Latency | Under 30 s for text questions; up to 2 min for visually complex ones |
| Concurrency | One question at a time |

**E3 scope:**
- the document-store seam (SDD §4.5)
- the store side of the Collection Library (versions, activation, rollback)
- for week 3, the retrieval-to-answer path in Question Answering: context assembly and the citation payload

## Deliverables

### Week 3 (Sep 29 – Oct 5): controlled retrieval-to-answer path

> Build a controlled retrieval-to-answer path using synthetic/test chunks and the frozen LLM; define context assembly and citation payload. **Deliverable:** test RAG service: query → retrieve → assemble context → LLM → answer + citations. **Acceptance:** a controlled question retrieves expected chunks and returns citations that resolve to exact synthetic/test sources. **Demo:** golden query returns expected evidence and a citation-bearing answer.

| Item | Status | Evidence |
|---|---|---|
| Query → retrieve | Done | `AnswerService` searches the active version with `min_score` (`answering/service.py`) |
| Assemble context | Done, defined | `answering/context.py`: labelled, delimited passages in rank order, token budget from E1's `ctx_size`, prompt version recorded |
| LLM | Done against E1's contract; **frozen model pending** | `LlamaCppGatewayRuntime` speaks E1 API `2026-09-v1`, tested against a contract double and against E1's real runtime with the stub backend. No real model weights run yet. |
| Answer + citations | Done, defined | `answering/answer.py` and `answering/wire/answer.schema.json`. SDD §7.3 sections, citation validation with one corrective retry, then withholding |
| Acceptance: expected chunks retrieved, citations resolve exactly | **Met** (deterministic test model) | `answering/tests/test_golden.py`; `python -m secure_qa.answering.benchmarks.golden`: 14/14 |
| Demo: golden query | Ready | `python -m secure_qa.answering.benchmarks.golden --show g01` |
| E4 can call it | Ready | `dev_host.py`: loopback `GET /health` and `POST /v1/requests` (SDD §4.6 envelope), with accurate degraded state when E1's runtime is down |

### Week 2 (Sep 22–28): local embedding + store prototype

| Item | Status | Evidence |
|---|---|---|
| Store, embedding model, `index()`/`search()` on E2's schema | Done | `secure_qa/library/` |
| Embedded, persisted, searched, traced | Done on dev laptop | `python -m secure_qa.library.scripts.demo_index_search` |
| On the reference machine | **Not done** | Reference laptop not available yet |

### Week 1 (Sep 15–21)

| # | Deliverable | Status | Notes |
|---|---|---|---|
| 1 | Document-store benchmark harness | Done, Chroma-only | `secure_qa/library/benchmarks/` |
| 2 | Stable write/search I/O contract | Superseded by v1 | `index()`/`search()` on E2's schema |
| 3 | Decision record: Chroma vs Qdrant | Decided: Chroma | SDD §4.5 and §11, ADR 0001 |

### Coverage of the SDD §11 store selection criteria (Chroma)

| Criterion | Covered? | Evidence so far |
|---|---|---|
| Offline persistence | Yes | Identical results after a process restart (tests, demo, benchmark) |
| Metadata filtering | No | Not needed by any current caller; not in the contract |
| Atomic collection replacement | Yes (dev laptop) | `CollectionVersions`: one collection per version plus an atomically replaced catalog. Tested for failure, rollback, retention and recovery. |
| Packaging reliability | No | No PyInstaller build yet; chromadb pulls in about 75 packages |
| Memory use | Partial | Dev-laptop numbers are unreliable; needs the 8 GB reference laptop |
| Performance at the 10,000-page target | Partial | Tested to 10,000 chunks in week 1. 10,000 pages is roughly 25–30k chunks |

## Retrieval-to-answer path (week 3)

Details are in `secure_qa/answering/README.md`. In short:

1. **Bind the collection version.** `CollectionVersions.open_active()` returns a read-only store bound to the version that is active when the question starts. The answer records that version.
2. **Retrieve.**
   - `search(question, top_k=5, min_score=0.38)`.
   - Nothing above the threshold gives `insufficient_evidence`, with no document section. General knowledge is still allowed if it is turned on, from a prompt that has no passages.
   - A retrieval failure gives `failed` with `retrieval_failed`, and the model is never called.
3. **Assemble the context.**
   - Passages are labelled `S1..Sn` in rank order and wrapped in delimiters. Document text is neutralised so it can't close its delimiter or pre-cite itself.
   - The budget is E1's `ctx_size` minus 512 answer tokens, the prompt and a margin. On E1's `context_length_exceeded`, the service retries with one fewer passage.
4. **Generate** through `LlamaCppGatewayRuntime` (E1's gateway, loopback only) or `FakeModelRuntime` in tests.
5. **Validate.**
   - Every sentence under "From your documents" must cite a supplied label, and general knowledge must not carry labels.
   - On any violation, the service makes one corrective attempt. If violations remain, unsupported sentences are withheld with a `citation_validation_failed` warning.
6. **Answer payload.**
   - The answer carries the status, claims with citation ids, general knowledge, limitations, citations, evidence, warnings, model version, collection version, prompt version and timing.
   - Each citation carries the document, page range, per-page offsets and highlight rectangles, chunk ids, stream offsets, checksum and full quote, so it resolves to exact source text.

**Why labels, not page numbers:** the model never writes page numbers. It cites `S2`, and the service maps `S2` to the chunk it supplied. So a citation can't point at evidence the model wasn't given, and page numbers come from E2's page spans.

## Results

### Golden queries (2026-10-05, dev laptop)

The golden collection is the synthetic placeholder corpus plus E2's 19 real NRC chunks: 30 chunks from 6 documents, published as version `v0001`. The answering model is the deterministic extractive fake.

| Result | Value |
|---|---|
| Acceptance | **14/14**. All 10 answerable questions retrieved their expected chunk at **rank 1**, cited it, and every citation resolved to the exact characters of the source text stream, with matching checksum and per-page offsets. All 4 off-topic questions were refused. |
| Answer facts (quality, not gated) | 9/10. The fake quotes one sentence and picked the wrong one for g06, even though it retrieved and cited the right chunk. |
| Through E1's runtime (stub backend) | The wire path works. All 10 answerable questions still retrieved the expected chunk at rank 1. The stub's canned uncited text was retried once, then withheld, so those answers came back `insufficient_evidence`. That is the designed behavior, and it will change once there is a real model. |

### Relevance threshold data (all-MiniLM-L6-v2, cosine)

| Question set | Top-1 score |
|---|---|
| 14 on-topic questions | 0.407 – 0.796 |
| 10 off-topic questions | -0.002 – 0.354 (the 0.354 is "boiling point of ethanol" against NRC steam text; all others ≤ 0.21) |

The provisional `min_score` is **0.38** cosine, the midpoint. That equals 0.69 on Open WebUI's `(1 + cos) / 2` scale. It is not decision-grade: E5's benchmark should tune it on real questions over the real corpus and freeze it (SDD §7.1).

### Store benchmark (dev laptop, not decision-grade)

**Environment:** MacBook (Apple silicon, 8 CPUs, 8 GB RAM) with about 6 GB of swap in use; Python 3.12.4; chromadb 1.5.9; all-MiniLM-L6-v2 on CPU; HNSW cosine, M=16, ef_construction=100, ef_search=100.

| Run | Chunks | Index time (s) | Avg / p95 query (ms) | Recall@5 vs exact | Persisted | Reopen (s) |
|---|---|---|---|---|---|---|
| Synthetic placeholder set | 11 | 0.06 | 6.4 / 7.0 | 1.00 | yes | 0.38 |
| E2 NRC chunks + template filler | 2,000 | 7.3 | 8.8 / 9.8 | 0.88 | yes | 0.32 |
| Week 1: placeholder + filler (old schema) | 10,000 | 26.2 | 7.3 / 8.3 | 0.72 | yes | 0.49 |

Recall below 1.00 comes from the template filler, which forms a near-duplicate cluster that HNSW handles badly. Re-check recall on real documents only.

## Offline evidence

`answering/tests/test_offline.py` installs a Python audit hook and records every socket connect and DNS lookup while the workflow runs: loading the real embedding model, publishing a version, searching, and answering through E1's contract on loopback. The test fails on anything that isn't loopback. On 2026-10-05 I checked by hand that the hook records a deliberate DNS lookup and a connection to a non-local address.

The audit hook can't see connections opened from native code. That includes Chroma's Rust core and torch, so the packaged network-disabled tests and a packet capture (SDD §14) are still required.

## Findings and gotchas

- **Read-only stores must not create collections.** Chroma's `get_or_create_collection` turns a missing collection into an empty one, so search would quietly return nothing. Published versions now open with `create=False`, so a missing collection raises `RetrievalError`.
- **Sharing a Chroma client:** in-process clients on the same path share state, so `ChromaStore` accepts an existing client and only closes a client it created itself.
- **Chroma `upsert` merges metadata.** `Chunk.to_metadata()` always writes every key, so a re-indexed chunk is fully replaced.
- **Chroma metadata must be scalar,** so `page_spans` is stored as JSON. Pass `embedding_function=None` (otherwise Chroma downloads its default ONNX model) and turn telemetry off.
- **E2 chunks span pages:** 18 of 19 NRC chunks cross a page break, so citations use page ranges plus per-page spans.
- **E1's stub returns canned text without citations.** It proves the wire format, not answer quality. A real GGUF model is needed for that.
- **Vendored text streams must keep their exact bytes.** A line-ending conversion shifts every offset. `tests/fixtures/e2/.gitattributes` marks `nrc_text.txt` as `-text`, as E2 does.

## Environment and how to run

From `app/document-qa/backend`:

```bash
../../../.venv/bin/python -m unittest discover -s secure_qa -t .                 # 67 tests
../../../.venv/bin/python -m secure_qa.answering.benchmarks.golden --show g01     # week 3 demo (golden query)
../../../.venv/bin/python -m secure_qa.answering.benchmarks.golden                # all golden queries
../../../.venv/bin/python -m secure_qa.answering.benchmarks.golden --runtime http://127.0.0.1:8080   # via E1's runtime
../../../.venv/bin/python dev_host.py [--runtime http://127.0.0.1:8080]          # loopback endpoint for E4, port 8765
../../../.venv/bin/python -m secure_qa.library.scripts.demo_index_search          # week 2 demo
../../../.venv/bin/python -m secure_qa.library.benchmarks.run_benchmark           # store benchmark
```

To run against E1's runtime with no model, from E1's `answering/llama_cpp/` folder:

```bash
pip install -e .
docqa-runtime stub-models
docqa-runtime up --server-bin stub
```

**Setup:**
- One-time online setup: `.venv` from `requirements.txt`, then `python -m secure_qa.library.scripts.fetch_model`.
- `.venv/`, `models/` and `.bench_data/` stay gitignored at the repository root.
- `secure_qa/library/tests/fixtures/e2/` holds copies of E2's files from `E2-Chunking` at `36fda65`. Delete them once E2's branch is merged.

## Open questions and dependencies

| Question | Owner / who to ask |
|---|---|
| When is E1's frozen model and config available, and on which branch? The answer path is ready to run on it. | E1 |
| SDD §5.1 update for page-spanning chunks (page range plus per-page spans in citations) | E2 / SDD owner |
| Should the answer payload (`answering/wire/answer.schema.json`) and the dev envelope be the E4/E5 contract for week 4? | E4, E5 |
| E1's branch still uses `app/open-webui/`; `main` renamed it to `app/document-qa/`. E1's `answering/README.md` edit will conflict with ours on merge. | E1 |
| When will `E2-Chunking` merge, so the library can import E2's schema and `chunks()`? | E2 |
| When can we get access to the 8 GB reference laptop? | Team / sponsor |

## Next steps (proposed)

1. Run the golden set through E1's runtime with the **frozen model**. Record answer facts, citation-validation retries and withholding rates, and latency. Adjust the prompt if the model struggles with the label format.
2. Run the demo, tests, benchmark and golden set on the **8 GB reference laptop**, with embedder and model memory together.
3. Hand E5 the golden set, answer schema and threshold data so they can tune and freeze `min_score` on real questions (SDD §7.1).
4. Wire E2's `chunks()` into `CollectionVersions.publish` once E2's branch merges, and run at the **10,000-page stress scale** with real chunks.
5. Streaming progress and cancellation by request ID (SDD §4.6).
6. **Packaging spike:** a PyInstaller bundle that imports and queries Chroma on all three platforms.
7. **Network capture** (pcap) during index, search and answer, to cover native code that the audit hook can't see.
8. Visual evidence selection (SDD §7.2), with the Question Answering owner.

## Log

- **2026-10-05 (week 3):**
  - Merged `main` and moved `docstore/`, its tests, benchmarks and scripts into `app/document-qa/backend/secure_qa/library/`.
  - Library: added `min_score` and `RetrievalError` (failures never look like empty results), read-only stores for published versions, and `CollectionVersions` (atomic activation, rollback, retention, recovery).
  - Built the answer path in `secure_qa/answering/`: context assembly, the E1 gateway adapter plus a deterministic fake, citation parsing and validation with one corrective retry, the answer and citation payload, and its JSON schema.
  - Added 14 golden queries with exact citation resolution against source text streams (vendored E2's NRC document record, text stream and offsets). 14/14 pass.
  - Measured the relevance threshold data and set `min_score = 0.38` (provisional).
  - Added `dev_host.py`, a loopback test endpoint for E4, and an offline audit test.
  - Ran the path over HTTP against E1's runtime (stub backend). 67 tests pass.
- **2026-09-29 (week 2):**
  - Team selected Chroma. Removed the Qdrant adapter, Docker helpers and `qdrant-client`.
  - Rebuilt the contract as `index()`/`search()` on E2's Chunk schema v1.0.0, with checksum and duplicate checks and an embedding-model check per collection.
  - Added the synthetic chunk generator, a deterministic fake embedder, 13 tests and the week 2 demo.
  - Migrated the benchmark to the new contract (Chroma-only).
- **2026-09-22:** added the BLUF section.
- **2026-09-17 (week 1):**
  - Built the benchmark harness and contract v0.
  - Ran the benchmark at 30 chunks and 10,000 chunks on the dev laptop.
  - Fixed the Chroma metadata-merge bug.
  - Reviewed the work against the Capstone Project Doc.
  - Created branch `E3-Rag/Document-Store`.
