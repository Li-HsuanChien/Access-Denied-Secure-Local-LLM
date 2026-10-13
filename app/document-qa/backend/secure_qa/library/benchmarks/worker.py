"""Runs one benchmark phase in a fresh Python process.

Invoked by run_benchmark.py. Each phase runs in its own process so memory
numbers are isolated, and so the reload phase is a real process restart.
Results are written as JSON to --out.
"""

import os

# Runtime must be offline: block Hugging Face hub lookups and Chroma telemetry
# before any library that could open a connection is imported.
os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
os.environ.setdefault("ANONYMIZED_TELEMETRY", "False")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

import argparse  # noqa: E402
import json  # noqa: E402
from pathlib import Path  # noqa: E402

import numpy as np  # noqa: E402

from secure_qa.library.benchmarks.fixtures import load_fixture_set  # noqa: E402
from secure_qa.library.benchmarks.measure import measure, peak_rss_mb, rss_mb  # noqa: E402
from secure_qa.library import ChromaStore, Embedder  # noqa: E402


def open_store(embedder: Embedder, cfg: dict) -> ChromaStore:
    return ChromaStore(embedder, Path(cfg["data_dir"]) / "chroma")


def latency_summary(seconds: list[float]) -> dict:
    ms = np.array(seconds) * 1000
    return {"avg_ms": float(ms.mean()), "p50_ms": float(np.percentile(ms, 50)), "p95_ms": float(np.percentile(ms, 95))}


def load_embedder(cfg: dict) -> Embedder:
    embedder = measure(lambda: Embedder(cfg["model_path"]), "load embedding model").result
    embedder.embed_query("warm-up")  # one-off first-call cost is not attributed to the store
    return embedder


def run_baseline(cfg: dict) -> dict:
    """Embedding-only cost, plus exact top-k for recall checks."""
    fixtures = load_fixture_set(cfg["fixtures"], cfg["synthetic"])
    embedder = load_embedder(cfg)
    texts = [c.text for c in fixtures.chunks]
    embed = measure(lambda: embedder.embed_documents(texts), f"[baseline] embed {len(texts)} chunks")

    latencies = [
        measure(lambda: embedder.embed_query(q), "", verbose=False).elapsed_s
        for _ in range(cfg["repeats"])
        for q in fixtures.queries
    ]
    k = min(cfg["top_k"], len(texts))
    exact = []
    for q in fixtures.queries:
        sims = embed.result @ embedder.embed_query(q)
        top = np.argsort(-sims, kind="stable")[:k]
        exact.append({fixtures.chunks[i].chunk_id: float(sims[i]) for i in top})
    return {
        "embed_s": embed.elapsed_s,
        "rss_after_mb": embed.mem_after_mb,
        "rss_delta_mb": embed.mem_delta_mb,
        "peak_rss_mb": peak_rss_mb(),
        "query_embed": latency_summary(latencies),
        "exact_topk": exact,
        "embedding_dim": embedder.dimension,
    }


def run_index(cfg: dict) -> dict:
    fixtures = load_fixture_set(cfg["fixtures"], cfg["synthetic"])
    chunks, queries, top_k = fixtures.chunks, fixtures.queries, cfg["top_k"]
    embedder = load_embedder(cfg)
    rss_model_mb = rss_mb()

    store = measure(lambda: open_store(embedder, cfg), "[chroma] open store").result
    store.reset()
    index = measure(lambda: store.index(chunks), f"[chroma] index {len(chunks)} chunks")
    peak_after_index = peak_rss_mb()
    count = store.count()

    cold = measure(lambda: store.search(queries[0], top_k), "[chroma] first search (cold)")
    latencies, ranked_ids, ranked_scores = [], [], []
    by_id = {c.chunk_id: c for c in chunks}
    trace_ok = True
    for repeat in range(cfg["repeats"]):
        for q in queries:
            m = measure(lambda: store.search(q, top_k), "", verbose=False)
            latencies.append(m.elapsed_s)
            if repeat == 0:
                ranked_ids.append([r.chunk.chunk_id for r in m.result])
                ranked_scores.append([r.score for r in m.result])
                trace_ok &= all(r.chunk == by_id.get(r.chunk.chunk_id) for r in m.result)
    lat = latency_summary(latencies)
    print(f"[chroma] {len(latencies)} searches: avg {lat['avg_ms']:.2f}ms, p95 {lat['p95_ms']:.2f}ms", flush=True)

    store.close()
    return {
        "count": count,
        "rss_model_mb": rss_model_mb,
        "index_s": index.elapsed_s,
        "rss_after_index_mb": index.mem_after_mb,
        "rss_delta_index_mb": index.mem_delta_mb,
        "peak_rss_after_index_mb": peak_after_index,
        "cold_query_ms": cold.elapsed_s * 1000,
        "query": lat,
        "ranked_ids": ranked_ids,
        "ranked_scores": ranked_scores,
        "trace_roundtrip_ok": trace_ok,
    }


def run_reload(cfg: dict) -> dict:
    fixtures = load_fixture_set(cfg["fixtures"], cfg["synthetic"])
    embedder = load_embedder(cfg)

    def reopen():
        store = open_store(embedder, cfg)
        return store, store.load()

    try:
        reopened = measure(reopen, "[chroma] reopen persisted index in new process")
    except LookupError as exc:
        print(f"[chroma] reload failed: {exc}", flush=True)
        return {"count": 0, "reopen_s": None, "ranked_ids": [], "error": str(exc)}
    store, count = reopened.result
    ranked_ids = [[r.chunk.chunk_id for r in store.search(q, cfg["top_k"])] for q in fixtures.queries]
    store.reset()
    store.close()
    return {"count": count, "reopen_s": reopened.elapsed_s, "ranked_ids": ranked_ids, "error": None}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--phase", choices=["baseline", "index", "reload"], required=True)
    parser.add_argument("--config", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    cfg = json.loads(Path(args.config).read_text())
    result = {"baseline": run_baseline, "index": run_index, "reload": run_reload}[args.phase](cfg)
    Path(args.out).write_text(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
