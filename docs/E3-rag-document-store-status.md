# E3: RAG and Document Store status

**Last updated:** 2026-10-20 · **Owner:** E3 (Conrad Brady) · **Branch:** `E3-Rag/Document-Store`

This is a running document. Update the **BLUF**, **Current status**, **Deliverables** and the **Log** whenever work lands.
Requirements are quoted from the PRD and SDD, which now live in the repo at `docs/product/PRD.md` and `docs/architecture/SDD.md`. The older *Capstone Project Doc* and the codebase design spec on `main` have been superseded; the spec is now a pointer to the SDD.

---

## BLUF

**All E3 work that doesn't depend on someone else is finished (2026-10-20). The week 5 row repeats the week 4 objective, and it holds. The new work was getting it onto `main`'s UI path: done and tested, but the merge of `origin/main` into this branch is waiting on a team go-ahead. What is left depends on others: the 8 GB reference laptop (latency and RAM), the team's retrieval decision, and E2's chunker and policy calls.** `main` gained its own Library workflow on Oct 13 that chunks with the synthetic placeholder chunker and bypasses E2's `validate()`/`chunks()`, and its `dev_host.py` conflicts with ours. I rebuilt it on E2's pipeline, keeping `main`'s upload-based wire contract (which the Library screen already calls), in a scratch merge of `origin/main`. It is packaged in `.e3-merge-bundle/` (12 files plus `APPLY.md`) because the merge itself was not done in this working tree.

- **Through the host, as the UI drives it, with the real model (2026-10-19):** upload 4 real PDFs and 2 unreadable ones, review (rejects listed with reasons, confirmation required), publish while polling `library.status`, integrity re-read, ask, publish a second version, roll back. **15 of 15 checks pass.** 309 chunks from 4 documents, the same as the direct run. Answers took 26 s, 19 s and 53 s (c01, c10, i01) on this swap-bound Mac, and the off-topic question was refused in 0.1 s. Evidence: `docs/evidence/e3-host-path-2026-10-19-qwen3-4b.json`. Repeat with `secure_qa/answering/benchmarks/host_path_check.py`.
- **115 backend tests pass in the merged tree** (91 on this branch as it stands), including new tests for progress, cancellation, one-at-a-time, source PDF staging and the integrity operation, now run over E2's real PDFs.
- **For E1:** real retrieved context is about 2,100 estimated prompt tokens at most (5 passages) in a 4,096 window with 512 reserved, so nothing is dropped and headroom is about 1,500 tokens. The estimate runs high (last week's measured prompts were about 1,700). `docs/evidence/e3-context-sizes-2026-10-19.json`.
- **New risk, E2's unmerged chunker (`origin/E2-Chunking`, Oct 13, sentence-aligned cuts):** run through our golden set it fails c10 ("how many students": rank 2 becomes not retrieved) and c11 now returns no evidence at all, so 14 of 15 gated checks pass instead of 15. Other ranks shift by one or two. It is not in `main`, and I did not adopt it. See Findings.

**The week 4 objective is met on the dev laptop. E2's real PDFs are ingested, indexed and published as a versioned collection. A real question is retrieved, answered by E1's frozen Qwen3-4B model, and cited to the exact source characters. Rollback and republish are evidenced.** Latency is not met yet: it can only be judged on the 8 GB reference laptop.

- **Ingest to index:** E2's `validate()` and `chunks()` feed a review, confirm and publish workflow. A publish builds a candidate, re-reads it from the store, checks counts and checksums against the manifest, and activates it atomically. The same files give the same manifest checksum on every run. Rejected files get a stated reason and need explicit confirmation before the valid remainder publishes.
- **First real answers (Qwen3-4B Q4_K_M through E1's runtime, offline, 17 real-corpus questions):**
  - All 15 gated checks pass. Every citation resolves to exact source text.
  - 12 of 13 answerable questions contain the expected fact.
  - All 4 off-topic questions are refused.
  - Instructions planted in E2's adversarial document were not obeyed.
- **Demo:** ingest and index, ask, retrieve, answer, cite, publish a second version, roll back, republish. Run with the real model, **18 of 18 checks pass**: saved evidence is in `docs/evidence/e3-demo-2026-10-12-qwen3-4b.json`. The arXiv question has no evidence in `v0001` and is refused. After `v0002` it answers "11 students were in the class" with citations to page 11. After rollback it is refused again, and after republish it answers again. A citation saved under `v0002` still resolves in `v0003`.
- **Retrieval quality on the real corpus is weaker than on the synthetic set.** The expected chunk ranks first for 8 of 13 questions and reaches the answer for 11 of 13. The two misses are on the noisy arXiv paper, where the right chunk scores below `min_score`. They are reported as known gaps, not hidden.

**Needs outside help:**
- **Team go-ahead to merge `origin/main`** into this branch (E3 owner to raise with the team on 2026-10-20). The resolved files are ready (`.e3-merge-bundle/APPLY.md`).
- **E1 / reference laptop:** latency and RAM. **The reference laptop is not available yet, so this waits.** On this 8 GB Mac with about 6 GB of swap in use, answers took 70 s on average and 199 s at worst in week 4 (target: under 30 s), and 19 to 53 s for three answers through the host in week 5. The Mac is swap-bound, so the numbers are not decision-grade, but real RAG prompts are not safe until measured on the reference laptop. E1 also hasn't committed `release-manifest.json`, so `/health` reports `release.manifest: false`.
- **E2 (E3 owner to talk to E2 on 2026-10-20):**
  - Will the sentence-cut chunker on `E2-Chunking` go into `main`? On a scratch run it regresses golden query c10 and leaves c11 with no evidence (14 of 15 gated checks instead of 15). Whichever chunker ships, `min_score` has to be re-measured with it.
  - The arXiv extraction keeps ligature characters (`ﬁ`, `ﬀ`) and line-break hyphens, and `oversized_1200_pages.pdf` is accepted under the current 2,000-page limit. Both are E2's policy calls.
- **Team decision:** how to fix retrieval on noisy PDF text. On the 13 questions, dense-only retrieval ranks the expected chunk in the top 5 for 12, and 11 once the threshold applies; BM25 fused with dense retrieval gets all 13. Fusing changes the retrieval design (SDD §7.1), so it needs an ADR. See Findings.
- **Resolved since week 3:** the citation page format. `main`'s SDD §5.1 now says the citation payload carries a page range plus per-page spans.

**Next:**
- Merge `origin/main` with the team's go-ahead, re-run the tests and `host_path_check.py`, and tell E4 about `library.integrity` and the real-pipeline review reasons.
- Re-run the golden set and the demo on the 8 GB reference laptop and record latency and RAM.
- Hand E4 the `library.*` operations (`library/wire/README.md`). Hand E5 the real-corpus golden set, the threshold data and the integrity check.
- Get the retrieval decision from the team, then freeze `min_score` with E5.

## Note: Test Open Web UI for Security and Customizable

The review of Open WebUI's built-in Chroma and Ollama support, and the decisions taken from it, are in [`E3-next-steps.md`](E3-next-steps.md).

## Current status

- **Location:** this branch is now at `origin/codex/integrate-workstreams` (fast-forward), which merges E1, E2, E3 and E4 on top of `main`. E2's code is at `ingestion/`, E1's runtime at `app/document-qa/backend/secure_qa/answering/llama_cpp/`.
  - Store, versioning, ingestion adapter, publication and diagnostics: `app/document-qa/backend/secure_qa/library/`
  - Answer path: `secure_qa/answering/`
  - Development host: `app/document-qa/backend/dev_host.py`
- **Store:** Chroma, embedded and on disk, with all-MiniLM-L6-v2 on CPU, loaded offline.
- **Contract:** `index()`/`search()` on E2's Chunk schema v1.0.0 (E2's schema is unchanged since week 3), with `min_score` and an explicit `RetrievalError`.
- **Ingest to index (SDD §6):** `corpus.py` runs E2's reference `validate()` and `chunks()`. `publication.py` reviews, asks for confirmation if any file is rejected, builds, verifies and activates. One job at a time.
- **Versioned collections (SDD §4.1, §6.3):** a publish builds a candidate, verifies it and activates it atomically. Rollback works, only the active and previous versions are kept, and interrupted candidates are cleaned up. Failed publications never change the active version.
- **Integrity and diagnostics:** `CollectionVersions.check_integrity()` re-reads a version from the store and compares it with the manifest. `trace_search()` explains every search result: score, kept or dropped by the threshold, document, pages, chunk and offsets.
- **Answer path (SDD §4.2, §7.1, §7.3):** done for text, and run with a real model on 2026-10-12. Visual evidence, streaming progress and cancellation are not built.
- **Host for E4:** `dev_host.py` serves `answering.ask` and the `library.*` operations (status, review, publish with confirmation, rollback, integrity). Start it with `--corpus <folder of PDFs>`. The contract is `library/wire/README.md`.
- **Tests:** 91 backend tests pass (67 last week). With `SECURE_QA_TEST_RUNTIME_URL` set, the live E1 test also passed against the real Qwen3-4B runtime; without it, that one test is skipped. All runs are manual, with no CI. See [Testing](#testing-how-we-run-tests).
- **Decision record (ADR):** none written. Chroma is recorded in SDD §4.5 and §11 and in ADR 0001. The retrieval question below would need one if the team changes the retrieval design.

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

### Week 5 (Oct 13 – Oct 19): first true end-to-end path through the host

> Same E3 row as week 4: complete embedding/index pipeline, atomic publish/rollback, search diagnostics, and the first true retrieval-to-answer integration. **Depends on:** E2 corpus chunks; E1 runtime. **Demo:** ingest/index → ask → retrieve → answer → citation → rollback/republish evidence. The week's other rows lean on E3: E1 needs real retrieved context, E4 needs real publish and ask endpoints, E5 needs the index integrity report and golden queries.

| Item | Status | Evidence |
|---|---|---|
| Acceptance (results map to document/page/chunk, atomic publish, rollback, real cited answer) | Met on the dev laptop, unchanged since week 4 | Week 4 table below; `docs/evidence/e3-demo-2026-10-12-qwen3-4b.json` |
| Reconcile with `main`'s Library workflow | **Done in a scratch merge; not merged on this branch** | `main` replaced our folder-based `library.*` operations with upload-based ones (base64 PDFs, `review_id`, `target_request_id` polling, `library.cancel`) over a placeholder chunker. `library/workflow.py` now keeps that wire contract and runs E2's `validate()`/`chunks()` through `Publisher.publish_review()`. Resolved files are in `.e3-merge-bundle/` (see its `APPLY.md`). |
| `library.integrity` over the host | Added | New operation, documented in `library/wire/README.md` and SDD §4.1. A publish also reports `integrity_ok`. |
| Progress and cancellation (SDD §4.1) | Built on `main`'s store changes | Cancellation is checked between bounded index batches, before verification and before activation. Tested; failed or cancelled publishes leave the active version unchanged. |
| E4: publish and ask from the UI | Backend path verified over HTTP; UI itself not run | `host_path_check.py`: 15/15 with the real model (above). `npm` and the Svelte app were not started here. |
| E1: real retrieved context for runtime tuning | Delivered | `docs/evidence/e3-context-sizes-2026-10-19.json` (`context_sizes.py`): at most about 2,100 estimated prompt tokens, 0 of 13 answerable questions drop passages, about 1,500 tokens of headroom. |
| E5: integrity report, golden set, threshold data | Ready to hand over | `library.integrity` (also in the host-path evidence: 309 chunks, 4 documents, `ok`), `golden_real_queries.json`, the threshold table under Results. |
| Latency within threshold | **Still not met, not judged** | 26 s, 19 s and 53 s for three answers through the host on the swap-bound Mac. Needs the reference laptop. |

### Week 4 (Oct 6 – Oct 12): real corpus, real model, publish and rollback

> Complete embedding/index pipeline, atomic publish/rollback, search diagnostics, and the first true retrieval-to-answer integration. **Deliverable:** published searchable corpus; versioned collection; rollback; top-k search; first real RAG answer with citation. **Acceptance:** every retrieval result maps to document/page/chunk; publish is atomic; rollback works; real answer cites retrieved evidence. **Depends on:** E2 corpus chunks; E1 runtime. **Demo:** ingest/index → ask → retrieve → answer → citation → rollback/republish evidence.

| Item | Status | Evidence |
|---|---|---|
| Embedding and index pipeline | Done | E2's fixture PDFs run through E2's `validate()` and `chunks()` into a published version: 309 chunks from 4 documents in about 9 s with embeddings (`library/corpus.py`, `publication.py`). The 7-file review (3 accepted, 4 rejected with reasons) publishes after confirmation. |
| Published searchable corpus, versioned | Done | Version `v0001` and later, with a manifest, an import report and an integrity checksum. The same files give the same manifest checksum (`test_publication.py`). |
| Atomic publish | Done | Build, verify (counts, checksums, smoke search), then atomically replace the catalog. A failed publish leaves the active version unchanged. One job at a time. |
| Rollback and republish | Done, evidenced | `docs/evidence/e3-demo-2026-10-12-qwen3-4b.json` and `test_publication.py`. Rolling back removes the document added in the newer version from answers. A republish keeps chunk ids, so a citation saved under the old version still resolves. |
| Top-k search, diagnostics | Done | `trace_search()` shows rank, score, kept or dropped by `min_score`, document, pages, chunk and offsets, and flags any hit it can't trace. |
| Every retrieval result maps to document, page and chunk | Met | `test_every_hit_maps_to_document_pages_and_chunk`, and the demo's retrieval tables. |
| Integrity: stored counts match the manifest | Met | `check_integrity()`: counts, document set, chunk ids and text checksums. Detects a tampered chunk (tested). |
| First real RAG answer with citation | **Met on the dev laptop** | Qwen3-4B Q4_K_M (SHA-256 matches E1's pin) through E1's runtime, CPU only, offline. Golden run: 15/15 gated, citations resolve exactly. |
| Latency within threshold | **Not met, not judged** | 70 s mean, 199 s max on a swap-bound dev Mac. Needs the reference laptop. |
| E4 can publish and ask from the UI | Ready on the host | `library.*` and `answering.ask` operations, with a confirmation step for rejected files. No UI wiring was done on this side. |

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

### Real corpus, real model (2026-10-12, dev laptop)

**Setup:** E2's accepted fixtures (NRC chapter, DOE handbook, arXiv paper, adversarial document): 309 chunks, 4 documents, published as `v0001`. Answering model: Qwen3-4B-Instruct-2507 Q4_K_M, whose SHA-256 matches E1's pin (`2fde00ce...`), through E1's runtime (llama.cpp b11242, commit `526c43b8f`, CPU only, offline, context 4096). 17 questions in `golden_real_queries.json`.

| Result | Value |
|---|---|
| Gated acceptance | **15/15** (the 2 known gaps are reported separately). Statuses, resolving citations, expected evidence retrieved, planted instructions ignored, off-topic refused. |
| Answer facts (quality, not gated) | 12/13. The miss is c11 (the four course units), where retrieval didn't find the chunk. |
| Cites the expected passage (quality) | 11/13. The misses are c09 and c11 (retrieval gaps). |
| Off-topic | 4/4 refused with `insufficient_evidence`. |
| Planted instructions (E2's adversarial document) | Not obeyed. The answers carry the real figures and none of the planted text. |
| Expected chunk rank | Rank 1 for 8 of 13. Rank 2 for 2 (c05, c10), rank 4 for c07. Not retrieved for c09 and c11. |
| Latency per question | Mean 70 s, median 31 s, max 199 s. The slowest were the 5-passage definition questions (c05 to c08, 128 to 199 s), with prompts of about 1,700 tokens and answers of about 290 tokens. |
| Runtime speed on this Mac | Prompt processing about 62 tok/s, generation about 2.6 tok/s. 8 GB RAM with about 6 GB swap in use, so this is swap-bound and not decision-grade. |

**Retrieval quality, dense retrieval on the real corpus (13 answerable questions):**

| Retriever | Expected chunk at rank 1 | In the top 5 |
|---|---|---|
| Dense, as built (all-MiniLM-L6-v2) | 8 | 12 (11 after the 0.38 threshold) |
| Dense, after Unicode and hyphen cleanup of the embedded text (earlier scratch run, older evidence definitions) | no change | no change |
| BM25 only | 9 | 13 |
| BM25 and dense, reciprocal rank fusion | 8 | 13 |

Measured in a scratch script over the same 309 chunks and the shipped golden records. BM25 and fusion are **not built**: they would change the retrieval design (SDD §7.1) and the meaning of `min_score`, so they need a team decision and an ADR.

### Relevance threshold on the real corpus

| Question set | Top-1 score |
|---|---|
| 13 on-topic questions | 0.452 to 0.784 |
| 8 off-topic questions | 0.091 to 0.413 |

The 0.413 is "What is the annual occupational dose limit for radiation workers?", a nuclear question the corpus doesn't answer. It passes the 0.38 gate, so refusing it falls to the model and the citation validator, not the threshold. The plainly off-topic questions top out at 0.344 (ethanol). Combined with last week's 0.407 on-topic minimum (synthetic set), no single cut-off separates every question, so `min_score` stays at the provisional **0.38**. E5's benchmark should settle it with the model in the loop.

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

- **Dense retrieval struggles with noisy extraction.** The arXiv paper's chunks carry ligature characters (`ﬁ`, `ﬀ`; 46 of 309 chunks) and line-break hyphens, and its abstract chunk scores 0.293 against a question that quotes its own title. Normalizing the embedded text barely helped, so the cause is mostly the model and the chunk length, not only the characters. Two arXiv records are kept as known gaps instead of being dropped.
- **E2's unmerged chunker changes our retrieval results.** `origin/E2-Chunking` (Oct 13) cuts on sentence boundaries and adds an import pipeline. Its `validate()`/`chunks()` still work with `ingest_corpus` (all library and publication tests pass), but the real-corpus golden set moves. Expected-chunk rank, current vs E2 branch (dense retrieval, `min_score` 0.38): c03 1/1, c05 2→3, c06 1→2, c08 1→3, c10 2→**not retrieved**, c11 not retrieved→**no passage above the threshold** (c09 not retrieved in both). Gated acceptance is 14 of 15 instead of 15 of 15. This is more evidence for the retrieval decision (BM25 fusion) and a reason to re-measure `min_score` whenever E2's chunker lands. Measured on a scratch copy; nothing was adopted.
- **The model answers well on retrieved evidence.** Qwen3-4B cited the right passages, kept to the supplied labels, refused every off-topic question, and ignored planted instructions. It adds a "General model knowledge" section after a document answer, which is allowed by SDD §7.3.
- **Answers are long.** About 290 generated tokens for a one-sentence fact. At 2 to 3 tok/s that is most of the latency. A tighter answer instruction in the prompt is worth testing on the reference laptop.
- **E2's decision-required fixtures:** `oversized_1200_pages.pdf` is accepted under the current 2,000-page limit, and the repaired `corrupt_bad_xref.pdf` and the mixed scanned PDF are accepted with warnings. They duplicate NRC text, so they're kept out of the golden collection.
- **`/health.release.manifest` is `false`.** E1's `freeze` writes `release-manifest.json` on the reference laptop, and none is committed, so nothing checks the loaded model against a frozen manifest yet.

## Testing: how we run tests

**Short version:** tests are run by hand. There is no CI, no `.github/workflows`, and no git hooks (checked 2026-10-13), so nothing runs automatically on commit, push or merge. The SDD §14 requirement for packaged, network-disabled acceptance runs on all three platforms is not built yet.

SDD §13 sets the approach: behavior tests through public interfaces at the agreed seams, with deterministic fakes in workflow tests and focused integration tests for the real adapters. Quality of the model itself is measured by the golden-query benchmarks, not by unit tests.

| Suite | Runner | Command | Size |
|---|---|---|---|
| E3 backend (library, answering, dev host) | `unittest` | from `app/document-qa/backend`: `../../../.venv/bin/python -m unittest discover -s secure_qa -t .` | 91 tests, about 40 s, 1 skipped |
| E2 ingestion contracts | plain script | from `ingestion/`: `../.venv/bin/python tests/test_contracts.py` | 24 tests, all pass (2026-10-13) |
| E1 runtime | `pytest` | from `answering/llama_cpp/`: `pip install -e ".[dev]" && pytest` (uses the stub, about 1 minute) | 56 tests per E1's README; **not run here**, `pytest` isn't in the shared `.venv` |
| Frontend (E4) | none found | no Svelte or Tauri tests are in the repo yet | |

The E3 command does not pick up E1's tests, because they use pytest and live under `answering/llama_cpp/tests/`. Run each suite from its own folder.

**What the E3 suite covers (91 tests):**
- `library/tests/`: store contract, versioning, publication (38 tests)
  - search results map to document, page and chunk
  - atomic publish and rollback
  - the integrity check detects a tampered chunk
  - the same files give the same manifest checksum
- `answering/tests/`: service, citation validation, E1 gateway adapter, golden queries, offline audit (40 tests)
- `tests/integration/test_dev_host.py`: the loopback host's `/health`, request handling and `library.*` operations (13 tests)

**Tests that skip themselves.** Some tests need things that are gitignored or optional, and they skip with a stated reason when those are missing. A "passing" run on a fresh clone can therefore cover less than it looks like:
- Embedding model not fetched (`python -m secure_qa.library.scripts.fetch_model`): skips the Chroma store tests and the golden tests.
- PyMuPDF or E2's fixture PDFs missing: skips the publication tests and the dev-host corpus test.
- `SECURE_QA_TEST_RUNTIME_URL` unset: skips the live test against E1's runtime. This is the one skip in the 2026-10-13 run. To include it: `SECURE_QA_TEST_RUNTIME_URL=http://127.0.0.1:8080 ../../../.venv/bin/python -m unittest secure_qa.answering.tests.test_model_runtime`, with E1's runtime running (stub or real model).

**Benchmarks and demos (not part of the unit run).** These measure quality and produce evidence. Commands are in the next section.
- `golden` (synthetic set, 14 queries) and `golden --corpus real` (E2's PDFs, 17 queries) print a gated pass count. `--runtime URL` runs them through E1's runtime.
- `demo_end_to_end --evidence out.json` runs ingest, ask, publish, rollback and republish and saves the evidence. Last run: 18 of 18 with the real model.
- `run_benchmark` is the store benchmark.

**Offline checking.** `answering/tests/test_offline.py` fails on any non-loopback connect or DNS lookup made from Python. It can't see native code (Chroma's Rust core, torch), so the packet capture is still open (see Parked items).

**Suggested routine:** run the E3 `unittest` command before pushing, and E2's script if ingestion code changed. The golden runs need a model, so run them by hand when the answer path, prompt or retrieval changes.

## Environment and how to run

From `app/document-qa/backend`:

```bash
../../../.venv/bin/python -m unittest discover -s secure_qa -t .                 # 91 tests
../../../.venv/bin/python -m secure_qa.answering.benchmarks.golden --show g01     # week 3 demo (golden query)
../../../.venv/bin/python -m secure_qa.answering.benchmarks.golden                # all golden queries
../../../.venv/bin/python -m secure_qa.answering.benchmarks.golden --runtime http://127.0.0.1:8080   # via E1's runtime
../../../.venv/bin/python -m secure_qa.answering.benchmarks.golden --corpus real [--runtime URL]   # E2's real PDFs, 17 questions
../../../.venv/bin/python -m secure_qa.answering.benchmarks.demo_end_to_end [--runtime URL] [--evidence out.json]   # week 4 demo
../../../.venv/bin/python dev_host.py [--runtime http://127.0.0.1:8080] [--corpus ../../../ingestion/fixtures]   # loopback endpoint for E4, port 8765
../../../.venv/bin/python -m secure_qa.library.scripts.demo_index_search          # week 2 demo
../../../.venv/bin/python -m secure_qa.library.benchmarks.run_benchmark           # store benchmark
```

To run against E1's runtime with no model, from E1's `answering/llama_cpp/` folder:

```bash
pip install -e .
docqa-runtime stub-models
docqa-runtime up --server-bin stub
```

To run with the real model (one-time online setup, then offline): put llama.cpp b11242 (`llama-b11242-bin-macos-arm64.tar.gz` on macOS) in `llama_cpp/bin/`, put `Qwen_Qwen3-4B-Instruct-2507-Q4_K_M.gguf` from `bartowski/Qwen_Qwen3-4B-Instruct-2507-GGUF` in `llama_cpp/models/` (check the SHA-256 against `models/shortlist.json`), `pip install -e` the runtime, then `docqa-runtime up` from `llama_cpp/`. Both folders are gitignored.

**Setup:**
- One-time online setup: `.venv` from `requirements.txt` plus `pymupdf==1.28.2` (E2's extractor, needed to ingest PDFs), then `python -m secure_qa.library.scripts.fetch_model`.
- `.venv/`, `models/` and `.bench_data/` stay gitignored at the repository root.
- `secure_qa/library/tests/fixtures/e2/` holds copies of E2's NRC chunks from `E2-Chunking` at `36fda65`. E2's chunker has changed since (`refchunk-2.0.1`), but the schema hasn't. The synthetic golden set still uses these copies; the real-corpus set ingests E2's PDFs directly.

## Parked items (revisit later)

1. **Relevance threshold, to revisit.** `min_score = 0.38` cosine (0.69 on Open WebUI's scale) is still provisional. Real-corpus data was added on 2026-10-12 (see Results): on-topic 0.452 to 0.784, off-topic 0.091 to 0.413, and one topical question the corpus can't answer scores 0.413. Re-measure with E5's questions and the model in the loop before freezing (SDD §7.1). The value lives in `AnswerSettings.min_score` in `secure_qa/answering/service.py`. Golden record `r04` pins it.
2. **Citation page format: resolved.** `main`'s SDD §5.1 now says the citation payload carries a page range plus per-page spans, with a link to the first page of the range. E4 renders the link.
3. **Real-model run: done on 2026-10-12** on the dev laptop (see Results). Still to do on the 8 GB reference laptop.
4. **Unbuilt pieces, for later:**
   - streaming progress and cancellation (SDD §4.6), for both answering and publication
   - visual evidence (SDD §7.2)
   - the run on the 8 GB reference laptop
   - a packet capture covering native code that the Python audit hook can't see
5. **New: retrieval quality on noisy text.** Needs a team decision (BM25 fusion, a different embedding model, or accepting the gaps). See Findings.

## Open questions and dependencies

| Question | Owner / who to ask |
|---|---|
| Can we get the 8 GB reference laptop? Latency (70 s mean here, under 30 s required) and RAM can only be judged there. | Team / sponsor |
| Will E1 commit `release-manifest.json` (the frozen model manifest)? `/health.release.manifest` is `false` without it. | E1 |
| Retrieval on noisy PDF text: adopt BM25 and dense fusion (needs an ADR and a change to SDD §7.1), try another embedding model, or accept two known gaps? | Team, E5 |
| E2: should extraction normalize ligatures and line-break hyphens in the text stream, and is a 1,200-page PDF meant to pass the "oversized" check? | E2 |
| Should the dev-host `library.*` operations and `library/wire/README.md` be E4's contract, and does E4 want progress events during publication? | E4 |
| Will E2's sentence-cut chunker (`E2-Chunking`) go into `main`? It regresses golden query c10 under dense retrieval (see Findings), so `min_score` and the retrieval decision should be settled with it in the loop. | E2, team |
| Does E4 know the Library host now includes `library.integrity` and that publication runs on E2's real pipeline (rejected files, real reasons)? Their screen reads `rejected[].reason`; extra `files` and `summary` fields are additive. | E4 |
| Should E5 take the real-corpus golden set (`golden_real_queries.json`), the integrity check and the threshold data as the start of the smoke suite? | E5 |

## Next steps (proposed)

0. Merge `origin/main` using `.e3-merge-bundle/APPLY.md`, re-run the 115 tests, and delete the bundle. Then run `host_path_check.py` once more against the merged tree.
1. Re-run the real-corpus golden set and the demo on the **8 GB reference laptop** with the frozen model. Record latency, peak RAM, and the answer facts and citations again.
2. Test a shorter answer instruction in the prompt, to cut generation time. Re-run the golden set to check quality holds.
3. Hand E4 the `library.*` operations, and E5 the real-corpus golden set, the integrity check and the threshold data, so they can tune and freeze `min_score` (SDD §7.1).
4. Settle the retrieval question with the team, and write an ADR if the design changes.
5. Run at the **10,000-page stress scale**: E2's 1,200-page fixture alone gives 3,641 chunks.
6. Streaming progress and cancellation by request ID (SDD §4.6), for answering and publication.
7. **Packaging spike:** a PyInstaller bundle that imports and queries Chroma on all three platforms.
8. **Network capture** (pcap) during index, search and answer, to cover native code that the audit hook can't see.
9. Visual evidence selection (SDD §7.2), with the Question Answering owner.

## Log

- **2026-10-20 (week 5, work done 2026-10-19 to 2026-10-20):**
  - Confirmed the remaining items are outside E3's control: the reference laptop is unavailable, the E2 conversation is planned for today, and the merge awaits the team's go-ahead. Committed and pushed the docs and evidence; the merge bundle stays uncommitted.
  - Compared `origin/main` and the other workstreams. `main` now has its own `library/workflow.py` (placeholder chunker, upload-based `library.*` operations, cancellation and source staging in `versions.py`), history and settings modules, and a native chat UI. A trial merge conflicts in `dev_host.py` and three READMEs.
  - In a scratch worktree (this working tree was not merged): kept `main`'s wire contract, rebuilt `CollectionLibrary` on E2's pipeline via `Publisher.publish_review()`, added `library.integrity`, rewrote the Library and dev-host tests for uploads, and merged the READMEs and SDD §4.1. 115 tests pass. The resolved files are in `.e3-merge-bundle/`.
  - Added `host_path_check.py` (the UI path over HTTP) and ran it with the real Qwen3-4B model: 15/15. Added `context_sizes.py` for E1.
  - Tried E2's latest branch on a scratch copy: compatible, but it regresses c10 (see Findings). Not adopted.
  - The code changes are in the merge bundle, not yet in the branch.

- **2026-10-13:** added the Testing section: how each suite is run, what skips itself, and that nothing runs automatically (no CI or hooks). Re-ran the E3 suite (91 pass, 1 skipped) and E2's contract script (24/24). E1's pytest suite wasn't run because `pytest` isn't installed in `.venv`.

- **2026-10-12 (week 4):**
  - Brought the branch up to date by fast-forwarding to `origin/codex/integrate-workstreams` (E1, E2, E3, E4 merged on `main`). The 67 existing tests still passed.
  - Added the ingest-to-index pipeline: `library/corpus.py` (E2's `validate()` and `chunks()`, review, deterministic manifest checksum) and `library/publication.py` (confirmation for rejected files, one job at a time, import report).
  - Added `CollectionVersions.check_integrity()` and `library/search_trace.py` (search diagnostics).
  - Added `library.*` operations to `dev_host.py` for E4, with the contract in `library/wire/README.md`.
  - Added 17 real-corpus golden questions (`--corpus real`) with `known_gap`, model-dependent quality checks and a planted-instruction check, and the end-to-end demo with rollback and republish evidence. 91 tests pass.
  - With approval, downloaded llama.cpp b11242 (macOS arm64) and Qwen3-4B Q4_K_M (SHA-256 matches E1's pin), and ran the golden set (15/15 gated) and the demo (18/18) through E1's runtime. Mean latency 70 s on this swap-bound Mac.
  - Measured retrieval quality and threshold data on the real corpus; found two retrieval gaps on the arXiv paper.
  - The SDD §5.1 citation page-format question is resolved on `main`.

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
