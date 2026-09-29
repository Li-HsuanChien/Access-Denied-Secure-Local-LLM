# Document store benchmark (Chroma)

Runs fixture chunks through `ChromaStore` (the selected store, embedded in-process with no
listening port) using all-MiniLM-L6-v2 on CPU. It reports index time, memory, query latency,
recall against exact search, and whether the index survives a process restart.

The earlier Chroma vs Qdrant comparison (Qdrant as a Docker server) was removed after the team
selected Chroma. It is in the git history at commit `bd58013`.

## One-time setup (needs network)

```bash
python3.12 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python scripts/fetch_model.py          # saves the model to models/all-MiniLM-L6-v2
```

For the air-gapped machine, move the wheelhouse and the `models/` directory across instead.

## Run (offline)

```bash
.venv/bin/python -m benchmarks.run_benchmark                       # synthetic placeholder corpus (11 chunks)
.venv/bin/python -m benchmarks.run_benchmark --synthetic 10000     # pad with template filler to 10,000 chunks
.venv/bin/python -m benchmarks.run_benchmark --fixtures tests/fixtures/e2
```

The run prints a Markdown table and notes, and writes `.bench_data/results.md` and `results.json`.

## Fixtures

Chunks follow E2's Chunk schema v1.0.0 (see `docstore/chunk.py`). `--fixtures DIR` loads
`*.jsonl` files (one E2 chunk dict per line) and `*.json` files in E2's `all_chunks.json`
shape, plus an optional `queries.txt` with one query per line. Without `--fixtures`, the
synthetic placeholder corpus from `docstore/synthetic.py` is used.
