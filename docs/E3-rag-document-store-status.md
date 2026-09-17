# E3: RAG and Document Store status

**Last updated:** 2026-09-17 · **Owner:** E3 (Conrad Brady) · **Branch:** `E3-Rag/Document-Store`

This is a running document. Update **Current status**, **Week 1 deliverables** and the **Log** whenever work lands.
Requirements are quoted from the team's *Capstone Project Doc* (PRD and System Design Document, "SDD").

---

## Current status

- **Benchmark harness: working.** Chroma and Qdrant run through one `DocumentStore` interface with the same embeddings. It measures index time, memory, query latency, recall against exact search, and persistence across restarts.
- **Write/search I/O contract: draft v0.** It's implemented and both stores pass the same checks. It still needs aligning with the SDD chunk record (§5.1) and sign-off from the workstreams that will call it.
- **Decision record (ADR): not started.** The harness only covers two of the SDD's six store selection criteria so far (see below).
- **Main risk:** the task specified Qdrant running as a Docker server, but the SDD rules out Docker, internal web servers and listening ports. The Qdrant results so far may not describe a deployable configuration (see *Blocking issue*).
- **E2 fixtures** aren't in the repo yet, so results so far use 30 placeholder chunks plus synthetic filler.

## Project overview

**Secure Local Document-QA System.** A chatbot-style research assistant that runs entirely on one air-gapped laptop. An analyst asks questions about an approved PDF collection and gets grounded answers with document and page citations.

| Constraint | Value (PRD/SDD) |
|---|---|
| Reference hardware | 8 GB RAM, integrated graphics, no dedicated accelerator |
| Platforms | Windows x86-64, macOS on Apple silicon, Ubuntu Linux x86-64 |
| Network | None at runtime: no telemetry, no automatic downloads, no externally reachable listener; release tests check for no listening ports and no DNS or outbound attempts |
| Stack | Tauri + React UI, Python sidecar packaged with PyInstaller, llama.cpp, Sentence Transformers, SQLite, and one selected document store |
| Corpus | 2,000–5,000 pages of IAEA-style public PDFs; 10,000 pages for stress testing |
| Latency | Under 30 s for text questions; up to 2 min for visually complex ones |
| Concurrency | One question at a time |

**E3 scope:** the document-store seam (SDD §4.5), the store selection decision (§11, which "must be recorded before implementation"), and the write/search contract the Collection Library and Question Answering modules build on.

## Week 1 deliverables

| # | Deliverable | Status | Notes |
|---|---|---|---|
| 1 | Document-store benchmark harness | Done (v0) | `docstore/`, `benchmarks/`; see `benchmarks/README.md` |
| 2 | Stable write/search I/O contract | Draft v0 | Implemented in `docstore/base.py` and `docstore/chunk.py`; open alignment items below |
| 3 | Decision record: Chroma vs Qdrant | Not started | Needs the criteria gaps closed and a run on the reference laptop |

### Coverage of the SDD §11 store selection criteria

| Criterion | Covered? | Evidence so far |
|---|---|---|
| Offline persistence | Yes | Both stores return identical results after a process restart; Qdrant also after a container restart |
| Metadata filtering | No | Not yet in the contract or the benchmark |
| Atomic collection replacement | No | SDD §6.3 publish, activate and roll back aren't tested |
| Packaging reliability | No | No PyInstaller build yet. Dependency footprint: chromadb pulls in 75 packages (including kubernetes, onnxruntime, opentelemetry, uvicorn); qdrant-client 17 |
| Memory use | Partial | Dev-laptop numbers aren't usable (host was heavily swapping); must be measured on the 8 GB reference laptop |
| Performance at the 10,000-page target | Partial | Tested with 10,000 *chunks*. 10,000 pages is roughly 60–70k chunks with the current 500-character windows (estimate at ~3,000 characters per page) |

## Blocking issue: Qdrant deployment mode

The benchmark runs Qdrant as a server in Docker, as the original task asked. The SDD says:

- "Docker, self-updating behavior, and an internal web server are not required."
- "No runtime network dependency, telemetry, automatic download, or externally reachable listener."
- Release acceptance tests check for "absence of listening ports."

A Qdrant server listens on TCP 6333 and 6334, even when bound to 127.0.0.1. The ways Qdrant could run under the SDD are:

1. **Qdrant local mode** (`QdrantClient(path=...)`): runs in-process with no server. The client warns that local mode is "not recommended for collections with more than 20,000 points", which the 10,000-page stress corpus would probably exceed. **Not benchmarked yet.**
2. **Bundle the Qdrant binary as a sidecar:** still opens a listening port, so it conflicts with the acceptance test unless the team accepts an exception.
3. **Chroma PersistentClient:** runs in-process with no port, which is how the current Chroma numbers were measured.

The ADR needs to settle this, and the team should confirm whether any listening port is acceptable.

## I/O contract v0

Other workstreams should code against these types, not a specific backend.

```python
@dataclass
class Chunk:
    id: str
    text: str
    source: str
    page: int | None = None
    offsets: tuple[int, int] | None = None   # character offsets in the source
    checksum: str | None = None              # sha256 of text, computed if omitted
    extra: dict = field(default_factory=dict)

@dataclass
class SearchResult:
    chunk: Chunk      # full chunk with trace metadata
    score: float      # cosine similarity, same scale for every backend
    rank: int         # 1-based

class DocumentStore(ABC):
    def write(self, chunks) -> int          # upsert by id; replaces the whole chunk; duplicate ids in one call -> ValueError
    def search(self, query, top_k=5) -> list[SearchResult]
    def persist(self) -> None               # everything written so far is durable
    def load(self) -> int                   # attach to an existing index; LookupError if missing
    def count(self) -> int
    def reset(self) -> None
    def close(self) -> None
```

**Guaranteed today, and checked by the benchmark for both stores:**
- Every `Chunk` field survives a write and a search unchanged.
- Scores match exact cosine similarity to within 1e-6.
- Re-writing a chunk leaves nothing behind from the previous version.

**Open alignment items:**
- **SDD §5.1 chunk record** lists: stable ID, document ID, page number, chunk order, extracted text, text coordinates when reliable, and embedding. v0 has `source` instead of document ID, no `chunk_order`, and character offsets instead of text coordinates. It also has `checksum`, which §5.1 doesn't list. The chunk schema owner decides; only `docstore/chunk.py` needs to change.
- **Minimum relevance threshold** (§7.1): scores are on the same cosine scale for every store, so the threshold stays valid whichever store is chosen. The contract may want a `min_score` parameter.
- **Metadata filtering** on `search`: needed if the ADR criterion is to be tested.
- **Collection versions** (§6.3 publish and roll back): probably one collection per version plus an atomic swap. Not designed yet.

## Preliminary benchmark results (dev laptop, not decision-grade)

**Environment:** MacBook (Apple silicon, 8 CPUs, 8 GB RAM) with 6.3–6.5 GB of swap in use; Python 3.12.4; chromadb 1.5.9; qdrant-client and server 1.19.1; all-MiniLM-L6-v2 on CPU. HNSW settings are the same for both stores (cosine, M=16, ef_construction=100, ef_search=100). The full reports are in `.bench_data/results*.md` (gitignored; regenerate with the commands in `benchmarks/README.md`).

**10,000 chunks** (30 placeholder chunks plus 9,970 synthetic), 10 queries × 20 repeats, top_k=5:

| Store | Index time (s) | Server RSS after index (MB) | Avg / p95 query (ms) | Recall@5 | Persisted | Reopen (s) |
|---|---|---|---|---|---|---|
| Embedding only (baseline) | 22.1 | – | 6.45 / 7.62 | 1.00 | – | – |
| Chroma (embedded) | 26.2 | n/a (in-process) | 7.34 / 8.29 | 0.72 | yes | 0.49 |
| Qdrant server (defaults) | 24.1 | 420 | 12.18 / 16.14 | 1.00* | yes | 0.37 |
| Qdrant server (HNSW forced) | 24.9 | 689 | 12.21 / 16.67 | 0.88 | yes | 0.54 |

\*Exact scan, not HNSW. See the findings below.

**What holds up so far:**
- Embedding dominates indexing: 22 s of the 24–26 s total.
- The store adds about 1 ms per query for Chroma and about 5–6 ms for the Qdrant server over HTTP. gRPC wasn't tested.
- An idle Qdrant server uses about 208 MB RSS before any data is loaded.
- Both stores passed the persistence check.

**What doesn't hold up yet:**
- Client memory figures, because of swapping on the dev laptop.
- Recall on synthetic data (see findings).
- Anything about Qdrant local mode, which hasn't been run.

## Findings and gotchas

- **Chroma `upsert` merges metadata.** Re-writing a chunk without a field kept the old value; in a test, an old `EAR99` marking survived on a chunk that no longer had one. Qdrant replaces the whole payload. Fixed in the contract: `Chunk.to_metadata()` always emits every key, using `None` for unset fields, which makes Chroma drop the key.
- **Qdrant only builds HNSW above `indexing_threshold`** (10,000 KB per segment, about 6,600 384-dim vectors). Below that it searches by exact scan, so its default recall is exact. Use the `qdrant-hnsw` variant for a like-for-like comparison.
- **HNSW loses isolated chunks inside near-duplicate clusters.** On the synthetic set, most misses in both stores were the 30 real chunks surrounded by template text: Chroma 0.72, Qdrant HNSW 0.88. Raising Chroma's `ef_search` to 2,000 didn't help. Real corpora with repeated boilerplate (headers, disclaimers) may show the same effect, so recall must be re-checked on E2's fixtures.
- **qdrant-client 1.19 removed `search()`;** use `query_points()`. Qdrant point IDs must be UUIDs or integers, so chunk ids are mapped with `uuid5` and the original id is kept in the payload.
- **Chroma setup details:** collection names need at least 3 characters. Pass `embedding_function=None`, or Chroma tries to download its default ONNX model. Disable telemetry with `Settings(anonymized_telemetry=False)`.
- **Offline setup:** the model loads from `models/all-MiniLM-L6-v2` with `local_files_only=True` and `HF_HUB_OFFLINE=1`; Chroma and Qdrant telemetry are off. This is configured but **not yet verified with a network capture**, which SDD §14 will require as evidence.
- **RSS is unreliable on macOS under memory pressure.** The report now shows peak RSS and warns automatically when swap is heavily used.

## Environment and how to run

- Setup, running and fixture formats: `benchmarks/README.md`.
- Gitignored, local only: `.venv/`, `models/` (87 MB embedding model, fetch with `scripts/fetch_model.py`), `.bench_data/`.
- The Qdrant container `qdrant-bench` (image `qdrant/qdrant:v1.19.1`, storage volume `qdrant-bench-storage`) is **stopped**. Restart it with `docker start qdrant-bench` before running the Qdrant variants.

## Open questions and dependencies

| Question | Owner / who to ask |
|---|---|
| Where and in what format will E2 commit the fixture set? | E2 |
| Timeline for the final Chunk schema, and do §5.1's text coordinates replace character offsets? | Chunk schema owner |
| Is any listening port or Docker acceptable for the store, or must it run in-process? | Team / SDD owner |
| The Capstone doc's early "Deliverables and Requirements" section (roles, `allowed_roles`, "pgvector or Qdrant", role filters) conflicts with the PRD/SDD (roles out of MVP scope, "Chroma or Qdrant"). Which is authoritative for filtering needs? | Team |
| Repo layout: the planned `benchmark/` (QA benchmark) sits next to this `benchmarks/` (store benchmark), and `docstore/` may belong under `retrieval/` | Team |
| When can we get access to the 8 GB reference laptop? | Team / sponsor |

## Next steps (proposed)

1. Add a **Qdrant local mode** variant to the harness, and decide whether the Docker server stays in the comparison.
2. Add **metadata filtering** and **atomic collection swap/rollback** checks to the contract and the harness.
3. Run at the **10,000-page stress scale** (about 60–70k chunks) with E2's fixtures.
4. Re-run on the **8 GB reference laptop** for memory and latency.
5. **Packaging spike:** build a PyInstaller bundle that imports and queries each candidate store on Windows, macOS and Linux.
6. Add a **deterministic fake `DocumentStore`** and contract tests, per SDD §13 (workflow tests use fakes; adapters get integration tests).
7. Write the **ADR** (e.g. `docs/adr/0001-document-store.md`) and link it from the SDD.

## Log

- **2026-09-17:**
  - Built the benchmark harness and contract v0.
  - Ran the benchmark at 30 chunks and 10,000 chunks on the dev laptop.
  - Found and fixed the Chroma metadata-merge bug; added the `qdrant-hnsw` variant, peak-memory reporting and automatic caveats.
  - Reviewed the work against the Capstone Project Doc: flagged the Qdrant/Docker conflict with the SDD and the uncovered selection criteria.
  - Created branch `E3-Rag/Document-Store`.
