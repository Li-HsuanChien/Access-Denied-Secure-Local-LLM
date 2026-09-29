# docstore: index and search contract (v1, Chroma)

E3's document-store adapter. It takes E2 Chunks (schema v1.0.0), embeds them locally with
all-MiniLM-L6-v2 on CPU, and stores them in an on-disk Chroma collection that runs in-process
with no server or listening port. It returns ranked results that carry the full chunk, so
every hit traces back to its document, pages, character offsets and highlight rectangles.

```python
from docstore import ChromaStore, Chunk, Embedder

store = ChromaStore(Embedder(), path="data/collections/v1")
result = store.index([Chunk.from_dict(d) for d in e2_chunk_dicts])   # -> IndexResult
hits = store.search("What is the annual dose limit?", top_k=5)       # -> list[SearchResult]
hits[0].chunk.document_id, hits[0].chunk.page_spans, hits[0].score
```

| Call | Returns | Guarantees |
|---|---|---|
| `index(chunks)` | `IndexResult(collection, indexed, total, embedding_model, embedding_dim, chunk_ids)` | Upsert by `chunk_id`; a re-indexed chunk is fully replaced. Durable on disk when it returns. Rejects duplicate ids and text that doesn't match `text_checksum_sha256`, before writing anything. |
| `search(query, top_k=5)` | `list[SearchResult(chunk, score, rank)]` | At most `top_k`, best first, `rank` 1-based. `score` is cosine similarity. `chunk` equals the indexed Chunk field for field. |
| `load()` | chunk count | Reopens a persisted collection; `LookupError` if there isn't one. |
| `count()`, `reset()`, `close()` | | |

A collection records the embedding model that built it. Opening or searching it with a
different model raises `EmbeddingMismatchError` (SDD §7.1: questions are embedded with the
collection's frozen model).

`Chunk` and `PageSpan` mirror E2's `ingestion/src/schema.py`. `tests/test_docstore.py` checks
them against a vendored copy of E2's JSON Schema and real E2 output (`tests/fixtures/e2/`).

## Try it

```bash
.venv/bin/python -m scripts.demo_index_search      # index the synthetic set, then search it from a new process
.venv/bin/python -m scripts.demo_index_search --e2-chunks tests/fixtures/e2/nrc_all_chunks.json
.venv/bin/python -m unittest discover -s tests -t . -v
```

`docstore/synthetic.py` generates the synthetic set: 5 small documents chunked the way E2's
chunker works, with E2's ID formulas. Its chunks have no PDF layout, so they carry
`coordinates_reliable=False` (cite the page, don't highlight).

## Not in v1 yet

- Version-specific collections and the atomic active-version pointer (SDD §6.3 and codebase design §4.1)
- The relevance threshold (`min_score`) and metadata filters on `search`
- Moving into `app/open-webui/backend/secure_qa/library/`, where `main`'s layout puts the Chroma adapter
