# Collection Library benchmarks

This folder covers retrieval recall, import duration, index size and the 10,000-page collection stress test. Question and model-quality benchmarks live with Question Answering (`../../answering/benchmarks/`). See the [release gates](../../../../../../docs/architecture/SDD.md#13-testing-model-evaluation-and-acceptance).

## Store benchmark

The benchmark runs fixture chunks through `ChromaStore` using all-MiniLM-L6-v2 on CPU. It reports index time, memory, query latency, recall against exact search, and whether the index survives a process restart. Each phase runs in its own process, so memory numbers are isolated and the reload is a real restart.

```bash
cd app/document-qa/backend
../../../.venv/bin/python -m secure_qa.library.benchmarks.run_benchmark                     # synthetic corpus (11 chunks)
../../../.venv/bin/python -m secure_qa.library.benchmarks.run_benchmark --synthetic 10000   # pad with template filler
../../../.venv/bin/python -m secure_qa.library.benchmarks.run_benchmark --fixtures secure_qa/library/tests/fixtures/e2
```

The run writes `results.md` and `results.json` to `.bench_data/` at the repository root.

**One-time setup, which needs a network connection:**

```bash
python3.12 -m venv .venv && .venv/bin/pip install -r requirements.txt
```

Then, from `app/document-qa/backend`, run `python -m secure_qa.library.scripts.fetch_model`. For the air-gapped machine, copy the wheelhouse and the `models/` directory across instead.

**Fixtures:** `--fixtures DIR` loads `*.jsonl` files (one E2 chunk dict per line) and `*.json` files in E2's `all_chunks.json` shape. It also reads an optional `queries.txt` with one query per line. The earlier Chroma vs Qdrant comparison was removed after the team chose Chroma; it is in git history at commit `bd58013`.
