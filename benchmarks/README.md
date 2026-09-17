# Document store benchmark: Chroma vs Qdrant

Runs the same fixture chunks through `ChromaStore` and `QdrantStore` (both implement
`docstore.DocumentStore`) with the same all-MiniLM-L6-v2 embeddings on CPU. It reports
index time, memory, query latency, recall against exact search, and whether each index
survives a restart.

## One-time setup (needs network)

```bash
python3.12 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python scripts/fetch_model.py          # saves the model to models/all-MiniLM-L6-v2
docker pull qdrant/qdrant:v1.19.1
```

For the air-gapped machine, move the wheelhouse, the `models/` directory and
`docker save qdrant/qdrant:v1.19.1` output across instead.

## Start Qdrant (local only, telemetry off)

```bash
docker run -d --name qdrant-bench \
  -p 127.0.0.1:6333:6333 -p 127.0.0.1:6334:6334 \
  -e QDRANT__TELEMETRY_DISABLED=true \
  -v qdrant-bench-storage:/qdrant/storage \
  qdrant/qdrant:v1.19.1
```

If the container already exists, run `docker start qdrant-bench` instead, and `docker stop qdrant-bench` when you're done.
The project SDD rules out Docker and listening ports for the shipped app, so this server setup is for comparison only
(see `docs/E3-rag-document-store-status.md`).

## Run (offline)

```bash
.venv/bin/python -m benchmarks.run_benchmark
.venv/bin/python -m benchmarks.run_benchmark --synthetic 10000 --stores chroma,qdrant,qdrant-hnsw
```

The run prints a Markdown table and notes, and writes `.bench_data/results.md` and `results.json`.
It restarts the `qdrant-bench` container (before indexing, and again for the persistence
check); pass `--no-server-restart` to skip that.

## Fixtures

E2's fixture set is picked up automatically from `fixtures/`, `test_data/`, `tests/fixtures/`
or `data/fixtures/` (or pass `--fixtures DIR`). Supported: `*.jsonl` chunk dicts,
`*.txt`/`*.md` documents (split into 500-char windows), and an optional `queries.txt`.
Without any of these, 30 built-in placeholder chunks are used.
