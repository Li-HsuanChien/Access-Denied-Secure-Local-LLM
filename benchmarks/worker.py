"""Runs one benchmark phase for one store in a fresh Python process.

Invoked by run_benchmark.py. Each phase runs in its own process so memory
numbers for one store are not inflated by the other, and so the reload phase
is a real process restart. Results are written as JSON to --out.
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

from benchmarks.docker_utils import container_process_memory_mb, container_running  # noqa: E402
from benchmarks.fixtures import load_fixture_set  # noqa: E402
from benchmarks.measure import measure, peak_rss_mb, rss_mb  # noqa: E402
from docstore import DocumentStore, Embedder, make_store  # noqa: E402

# Benchmark variant -> (backend, options). "qdrant" runs Qdrant with its defaults
# (exact scan for small segments); "qdrant-hnsw" forces HNSW for a like-for-like comparison with Chroma.
STORE_VARIANTS = {
    "chroma": ("chroma", lambda cfg: {"path": Path(cfg["data_dir"]) / "chroma"}),
    "qdrant": ("qdrant", lambda cfg: {"host": cfg["qdrant_host"], "port": cfg["qdrant_port"]}),
    "qdrant-hnsw": ("qdrant", lambda cfg: {"host": cfg["qdrant_host"], "port": cfg["qdrant_port"], "force_hnsw": True}),
}


def open_store(variant: str, embedder: Embedder, cfg: dict) -> DocumentStore:
    backend, options = STORE_VARIANTS[variant]
    return make_store(backend, embedder, **options(cfg))


def server_memory_mb(variant: str, cfg: dict) -> tuple[float, float] | None:
    container = cfg.get("qdrant_container")
    if STORE_VARIANTS[variant][0] == "qdrant" and container and container_running(container):
        return container_process_memory_mb(container)
    return None


def latency_summary(seconds: list[float]) -> dict:
    ms = np.array(seconds) * 1000
    return {"avg_ms": float(ms.mean()), "p50_ms": float(np.percentile(ms, 50)), "p95_ms": float(np.percentile(ms, 95))}


def load_embedder(cfg: dict) -> Embedder:
    embedder = measure(lambda: Embedder(cfg["model_path"]), "load embedding model").result
    embedder.embed_query("warm-up")  # one-off first-call cost is not attributed to any store
    return embedder


def run_baseline(cfg: dict) -> dict:
    """Embedding-only cost shared by both stores, plus exact top-k for recall checks."""
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
        exact.append({fixtures.chunks[i].id: float(sims[i]) for i in top})
    return {
        "embed_s": embed.elapsed_s,
        "rss_after_mb": embed.mem_after_mb,
        "rss_delta_mb": embed.mem_delta_mb,
        "peak_rss_mb": peak_rss_mb(),
        "query_embed": latency_summary(latencies),
        "exact_topk": exact,
        "embedding_dim": embedder.dimension,
    }


def run_index(variant: str, cfg: dict) -> dict:
    fixtures = load_fixture_set(cfg["fixtures"], cfg["synthetic"])
    chunks, queries, top_k = fixtures.chunks, fixtures.queries, cfg["top_k"]
    embedder = load_embedder(cfg)
    rss_model_mb = rss_mb()

    store = measure(lambda: open_store(variant, embedder, cfg), f"[{variant}] open store").result
    store.reset()
    server_before = server_memory_mb(variant, cfg)
    write = measure(lambda: store.write(chunks), f"[{variant}] write {len(chunks)} chunks")
    persist = measure(store.persist, f"[{variant}] persist")
    server_after = server_memory_mb(variant, cfg)
    peak_after_index = peak_rss_mb()
    count = store.count()

    cold = measure(lambda: store.search(queries[0], top_k), f"[{variant}] first search (cold)")
    latencies, ranked_ids, ranked_scores = [], [], []
    by_id = {c.id: c for c in chunks}
    trace_ok = True
    for repeat in range(cfg["repeats"]):
        for q in queries:
            m = measure(lambda: store.search(q, top_k), "", verbose=False)
            latencies.append(m.elapsed_s)
            if repeat == 0:
                ranked_ids.append([r.chunk.id for r in m.result])
                ranked_scores.append([r.score for r in m.result])
                trace_ok &= all(r.chunk == by_id.get(r.chunk.id) for r in m.result)
    lat = latency_summary(latencies)
    print(f"[{variant}] {len(latencies)} searches: avg {lat['avg_ms']:.2f}ms, p95 {lat['p95_ms']:.2f}ms", flush=True)

    index_stats = store.index_stats() if hasattr(store, "index_stats") else None
    store.close()
    return {
        "count": count,
        "rss_model_mb": rss_model_mb,
        "write_s": write.elapsed_s,
        "rss_after_index_mb": write.mem_after_mb,
        "rss_delta_index_mb": write.mem_delta_mb,
        "peak_rss_after_index_mb": peak_after_index,
        "persist_s": persist.elapsed_s,
        "server_rss_before_mb": server_before[0] if server_before else None,
        "server_rss_after_mb": server_after[0] if server_after else None,
        "server_peak_rss_after_index_mb": server_after[1] if server_after else None,
        "cold_query_ms": cold.elapsed_s * 1000,
        "query": lat,
        "ranked_ids": ranked_ids,
        "ranked_scores": ranked_scores,
        "trace_roundtrip_ok": trace_ok,
        "index_stats": index_stats,
    }


def run_reload(variant: str, cfg: dict) -> dict:
    fixtures = load_fixture_set(cfg["fixtures"], cfg["synthetic"])
    embedder = load_embedder(cfg)

    def reopen():
        store = open_store(variant, embedder, cfg)
        return store, store.load()

    try:
        reopened = measure(reopen, f"[{variant}] reopen persisted index in new process")
    except LookupError as exc:
        print(f"[{variant}] reload failed: {exc}", flush=True)
        return {"count": 0, "reopen_s": None, "ranked_ids": [], "error": str(exc)}
    store, count = reopened.result
    ranked_ids = [[r.chunk.id for r in store.search(q, cfg["top_k"])] for q in fixtures.queries]
    # Drop the benchmark index so it does not occupy memory while the next store is measured.
    store.reset()
    store.close()
    return {"count": count, "reopen_s": reopened.elapsed_s, "ranked_ids": ranked_ids, "error": None}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--phase", choices=["baseline", "index", "reload"], required=True)
    parser.add_argument("--store", choices=sorted(STORE_VARIANTS))
    parser.add_argument("--config", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    cfg = json.loads(Path(args.config).read_text())
    if args.phase == "baseline":
        result = run_baseline(cfg)
    elif args.phase == "index":
        result = run_index(args.store, cfg)
    else:
        result = run_reload(args.store, cfg)
    Path(args.out).write_text(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
