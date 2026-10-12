# Collection Library

Owns candidate validation and review, staged publication, atomic active-version switching, rollback, cancellation and recovery (SDD §4.1, §6). Chroma is the selected production store behind the module's adapter seam (SDD §4.5); workflow tests use a deterministic fake embedder. See the [SDD](../../../../../docs/architecture/SDD.md).

**Built so far (E3):** the document-store adapter and versioned collections. **Not built yet:** PDF validation and review, progress reporting and cancellation. E2's `chunks()` (branch `E2-Chunking`) will feed `publish`.

Run everything from `app/document-qa/backend` with the repository's `.venv`:

```bash
../../../.venv/bin/python -m unittest discover -s secure_qa -t .            # all backend tests
../../../.venv/bin/python -m secure_qa.library.scripts.demo_index_search     # week 2 demo
../../../.venv/bin/python -m secure_qa.library.scripts.fetch_model           # one-time, online: embedding model -> models/
```

## Index and search contract (v1)

The adapter takes E2 Chunks (schema v1.0.0), embeds them locally with all-MiniLM-L6-v2 on CPU, and stores them in an on-disk Chroma collection that runs in-process, with no server or listening port. It returns ranked results that carry the full chunk, so every hit traces back to its document, pages, character offsets and highlight rectangles.

```python
from secure_qa.library import ChromaStore, Chunk, Embedder

store = ChromaStore(Embedder(), path="data/collections/dev")
result = store.index([Chunk.from_dict(d) for d in e2_chunk_dicts])        # -> IndexResult
hits = store.search("What is the annual dose limit?", top_k=5, min_score=0.38)   # -> list[SearchResult]
hits[0].chunk.document_id, hits[0].chunk.page_spans, hits[0].score
```

| Call | Returns | Guarantees |
|---|---|---|
| `index(chunks)` | `IndexResult(collection, indexed, total, embedding_model, embedding_dim, chunk_ids)` | Upserts by `chunk_id`, and a re-indexed chunk is fully replaced. Data is durable on disk when the call returns. Duplicate ids and text that doesn't match `text_checksum_sha256` are rejected before anything is written. |
| `search(query, top_k=5, min_score=None)` | `list[SearchResult(chunk, score, rank)]` | At most `top_k` results, best first, with 1-based `rank`. Results below `min_score` are dropped, so the list may be empty. `chunk` equals the indexed Chunk field for field. |
| `load()` | chunk count | Reopens a persisted collection. Raises `LookupError` if there isn't one. |
| `count()`, `reset()`, `close()` | | |

- **Score scale:** `score` is plain cosine similarity, from -1 to 1. Open WebUI's built-in Chroma reports `(1 + cos) / 2` on a 0 to 1 scale, so its `RAG_RELEVANCE_THRESHOLD` values don't carry over. Our threshold is 0.38 cosine, which is the same as 0.69 on Open WebUI's scale.
- **Failures are explicit:** if a store can't search (for example, a missing collection or a Chroma error), `search` raises `RetrievalError`. An empty list always means nothing relevant was found, never that something broke. This differs from Open WebUI, whose `search` returns `None` on any error. The error message names only the failure type, never the query text.
- **Embedding model check:** a collection records the embedding model that built it. Opening or searching it with a different model raises `EmbeddingMismatchError` (SDD §7.1).

## Versioned collections (SDD §4.1, §6.3)

```python
from secure_qa.library import CollectionVersions

versions = CollectionVersions(Embedder(), root="data/collections")
v = versions.publish(chunks, documents)   # E2 Document records for every document the chunks reference
store = versions.open_active()            # read-only, bound to the active version: answers record store.collection_version
versions.versions()                       # [active, previous]
versions.rollback()                       # the previous version becomes active; rollback can be undone
```

- **Storage:** each version is its own Chroma collection (`secure_qa_v0001`, ...) in `<root>/chroma`. That directory belongs to the Library and is separate from Open WebUI's `DATA_DIR/vector_db`.
- **Catalog:** `<root>/catalog.json` records the active and previous versions and each version's SDD §5.1 record: creation and activation times, chunk count, embedding model, chunker config ids, integrity checksum and document manifest.
- **Publication:** `publish` builds a candidate, then verifies it: the count, the chunk ids and checksums read back from Chroma, and a search smoke test. Only after that does it activate the candidate, by atomically replacing the catalog (temp file, fsync, `os.replace`).
- **Failure safety:** a failed publish deletes its candidate, raises `PublishError` and leaves the active version unchanged.
- **Retention:** only the active and previous versions are kept. Opening the store removes anything else, such as interrupted candidates or retired versions.

## Chunk schema

`Chunk` and `PageSpan` mirror E2's `ingestion/src/schema.py` v1.0.0 field for field, and `Chunk.from_dict` accepts E2's output unchanged. `tests/test_store.py` checks them against a vendored copy of E2's JSON Schema and real E2 output (`tests/fixtures/e2/`). Replace the mirror with an import once `E2-Chunking` is merged.

`synthetic.py` generates the synthetic set: 5 small documents chunked the way E2's chunker works, with E2's ID formulas. The synthetic chunks have no PDF layout, so they carry `coordinates_reliable=False`, meaning a citation shows the page but no highlight.

## Layout

| Path | What |
|---|---|
| `base.py`, `chroma_store.py` | Store contract and the Chroma adapter |
| `versions.py` | Versioned collections, active pointer and rollback |
| `chunk.py`, `embedding.py`, `synthetic.py` | E2 schema mirror, local embedder plus fake, synthetic corpus |
| `tests/` | Store and versioning tests, and vendored E2 fixtures |
| `benchmarks/` | Store benchmark (index time, latency, recall, memory, persistence) |
| `scripts/` | Week 2 demo and one-time model fetch |

Local-only and gitignored, at the repository root: `models/` (embedding model) and `.bench_data/` (indexes and results). Override them with `SECURE_QA_MODELS_DIR` and `SECURE_QA_DATA_DIR`.
