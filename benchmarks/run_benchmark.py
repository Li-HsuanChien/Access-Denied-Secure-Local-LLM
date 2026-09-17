"""Benchmark ChromaStore vs QdrantStore on the same fixtures and embedding model.

Examples:
    python -m benchmarks.run_benchmark                     # E2 fixtures if present, else placeholder chunks
    python -m benchmarks.run_benchmark --synthetic 10000   # pad to 10,000 chunks to see scaling
    python -m benchmarks.run_benchmark --stores chroma,qdrant,qdrant-hnsw

Store variants:
    chroma       Chroma PersistentClient, embedded in-process
    qdrant       Qdrant server in Docker with default settings (exact scan for small segments)
    qdrant-hnsw  Qdrant with HNSW forced at every size, for a like-for-like comparison with Chroma

Each phase (embedding baseline, index, reload) runs in a separate Python process
so memory figures are isolated and the reload is a true process restart.
Results are printed as Markdown and saved to <data-dir>/results.md and results.json.
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import subprocess
import sys
import time
from datetime import datetime
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path

import psutil

from benchmarks.docker_utils import container_running, restart_container, server_version, wait_until_ready
from benchmarks.fixtures import REPO_ROOT, load_fixture_set
from benchmarks.worker import STORE_VARIANTS
from docstore.embedding import DEFAULT_MODEL_PATH

OFFLINE_ENV = {
    "HF_HUB_OFFLINE": "1",
    "TRANSFORMERS_OFFLINE": "1",
    "ANONYMIZED_TELEMETRY": "False",
    "TOKENIZERS_PARALLELISM": "false",
}


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--stores", default="chroma,qdrant", help=f"comma-separated, from: {', '.join(STORE_VARIANTS)}")
    p.add_argument("--fixtures", help="fixture directory (default: auto-detect, else placeholder chunks)")
    p.add_argument("--synthetic", type=int, default=0, metavar="N", help="pad the fixture set with synthetic chunks up to N total")
    p.add_argument("--top-k", type=int, default=5)
    p.add_argument("--repeats", type=int, default=20, help="passes over the query set for latency stats")
    p.add_argument("--data-dir", default=str(REPO_ROOT / ".bench_data"))
    p.add_argument("--model-path", default=str(DEFAULT_MODEL_PATH))
    p.add_argument("--qdrant-host", default="localhost")
    p.add_argument("--qdrant-port", type=int, default=6333)
    p.add_argument("--qdrant-container", default="qdrant-bench", help="container used to sample server memory and to restart the server")
    p.add_argument("--no-server-restart", action="store_true", help="never restart the Qdrant container")
    args = p.parse_args()
    args.stores = [s.strip() for s in args.stores.split(",") if s.strip()]
    unknown = set(args.stores) - STORE_VARIANTS.keys()
    if unknown:
        p.error(f"unknown store(s) {sorted(unknown)}; choose from {list(STORE_VARIANTS)}")
    return args


def is_qdrant(variant: str) -> bool:
    return STORE_VARIANTS[variant][0] == "qdrant"


def run_worker(phase: str, store: str | None, config_path: Path, data_dir: Path) -> dict | None:
    out = data_dir / f"{phase}-{store or 'shared'}.json"
    out.unlink(missing_ok=True)
    cmd = [sys.executable, "-m", "benchmarks.worker", "--phase", phase, "--config", str(config_path), "--out", str(out)]
    if store:
        cmd += ["--store", store]
    print(f"\n--- {phase}{f' / {store}' if store else ''} (new process) ---", flush=True)
    proc = subprocess.run(cmd, cwd=REPO_ROOT, env={**os.environ, **OFFLINE_ENV})
    if proc.returncode != 0 or not out.exists():
        print(f"!! {phase} phase failed for {store or 'baseline'} (exit code {proc.returncode}); see output above", flush=True)
        return None
    return json.loads(out.read_text())


def restart_qdrant(args, reason: str) -> float:
    print(f"\n--- restarting Qdrant container '{args.qdrant_container}' ({reason}) ---", flush=True)
    t0 = time.perf_counter()
    restart_container(args.qdrant_container)
    wait_until_ready(f"http://{args.qdrant_host}:{args.qdrant_port}")
    return time.perf_counter() - t0


# --- scoring ---------------------------------------------------------------------------------


def recall_at_k(ranked_ids: list[list[str]], exact_topk: list[dict]) -> float:
    per_query = [len(set(ids) & exact.keys()) / len(exact) for ids, exact in zip(ranked_ids, exact_topk)]
    return sum(per_query) / len(per_query)


def max_score_deviation(ranked_ids, ranked_scores, exact_topk) -> float | None:
    devs = [
        abs(score - exact[cid])
        for ids, scores, exact in zip(ranked_ids, ranked_scores, exact_topk)
        for cid, score in zip(ids, scores)
        if cid in exact
    ]
    return max(devs) if devs else None


def persistence_verdict(index: dict, reload: dict | None, n_chunks: int) -> str:
    if reload is None:
        return "NO (reload crashed)"
    if reload.get("error"):
        return "NO (index not found)"
    if reload["count"] != n_chunks:
        return f"NO ({reload['count']}/{n_chunks} chunks)"
    changed = sum(a != b for a, b in zip(index["ranked_ids"], reload["ranked_ids"]))
    if changed:
        return f"PARTIAL (top-k changed for {changed} queries)"
    return "yes"


# --- report ----------------------------------------------------------------------------------


def markdown_table(headers: list[str], rows: list[list[str]]) -> str:
    widths = [max(len(str(r[i])) for r in [headers, *rows]) for i in range(len(headers))]
    fmt = lambda cells: "| " + " | ".join(str(c).ljust(w) for c, w in zip(cells, widths)) + " |"  # noqa: E731
    return "\n".join([fmt(headers), "|" + "|".join("-" * (w + 2) for w in widths) + "|", *map(fmt, rows)])


def pkg_version(name: str) -> str:
    try:
        return version(name)
    except PackageNotFoundError:
        return "not installed"


def build_report(args, fixtures, baseline, results, qdrant_url) -> str:
    n, k = len(fixtures.chunks), min(args.top_k, len(fixtures.chunks))
    qdrant_version = server_version(qdrant_url) or "?"
    labels = {
        "chroma": f"Chroma {pkg_version('chromadb')} (embedded)",
        "qdrant": f"Qdrant {qdrant_version} (Docker, defaults)",
        "qdrant-hnsw": f"Qdrant {qdrant_version} (Docker, HNSW forced)",
    }
    headers = ["Store", "Index time (s)", "Client RSS after index / peak (MB)", "Server RSS after index / peak (MB)",
               "Avg query (ms)", "p95 query (ms)", f"Recall@{k}", "Persisted after restart", "Reopen (s)"]
    rows = []
    if baseline:
        q = baseline["query_embed"]
        rows.append(["Embedding only (baseline)", f"{baseline['embed_s']:.3f}",
                     f"{baseline['rss_after_mb']:.0f} / {baseline['peak_rss_mb']:.0f}", "–",
                     f"{q['avg_ms']:.2f}", f"{q['p95_ms']:.2f}", "1.00 (exact)", "–", "–"])
    for store in args.stores:
        r = results.get(store, {})
        index, reload = r.get("index"), r.get("reload")
        if index is None:
            rows.append([labels[store], r.get("skipped", "failed"), *["–"] * 7])
            continue
        if index["server_rss_after_mb"] is not None:
            server = f"{index['server_rss_after_mb']:.0f} / {index['server_peak_rss_after_index_mb']:.0f}"
        else:
            server = "not sampled" if is_qdrant(store) else "n/a (in-process)"
        rows.append([
            labels[store],
            f"{index['write_s']:.3f}",
            f"{index['rss_after_index_mb']:.0f} / {index['peak_rss_after_index_mb']:.0f}",
            server,
            f"{index['query']['avg_ms']:.2f}",
            f"{index['query']['p95_ms']:.2f}",
            f"{recall_at_k(index['ranked_ids'], baseline['exact_topk']):.2f}" if baseline else "?",
            persistence_verdict(index, reload, n),
            f"{reload['reopen_s']:.3f}" if reload and reload.get("reopen_s") is not None else "–",
        ])

    mem = psutil.virtual_memory().total / 1024**3
    lines = [
        f"## Document store benchmark ({datetime.now():%Y-%m-%d %H:%M})",
        "",
        f"- Fixtures: {fixtures.description}; {n} chunks, {len(fixtures.queries)} queries x {args.repeats} repeats, top_k={args.top_k}",
        f"- Embedding: all-MiniLM-L6-v2 ({baseline['embedding_dim'] if baseline else '?'}-dim), CPU, "
        f"sentence-transformers {pkg_version('sentence-transformers')}, torch {pkg_version('torch')}",
        f"- Machine: {platform.system()} {platform.release()} {platform.machine()}, {os.cpu_count()} logical CPUs, {mem:.1f} GB RAM, Python {platform.python_version()}",
        f"- Clients: chromadb {pkg_version('chromadb')}, qdrant-client {pkg_version('qdrant-client')}",
        "- HNSW parameters for both stores: cosine, M=16, ef_construction=100, ef_search=100",
        "",
        markdown_table(headers, rows),
        "",
        "Notes:",
        "- Index time is end-to-end `write()`, embedding included. The baseline row is the embedding share, so store overhead is roughly the store row minus the baseline.",
    ]
    idx = {s: results.get(s, {}).get("index") for s in args.stores}
    model_rss = next((i["rss_model_mb"] for i in idx.values() if i), None)
    if model_rss is not None:
        lines.append(f"- Client RSS is the benchmark's Python process and includes ~{model_rss:.0f} MB for the embedding model and libraries. "
                     "Chroma runs in-process, so its whole footprint is client RSS. Qdrant's footprint is client RSS plus the `qdrant` server process "
                     "inside the container. Peak values are high-water marks, and the server peak is measured since a container restart just before indexing.")
    swap = psutil.swap_memory()
    if swap.used > 0.25 * psutil.virtual_memory().total:
        lines.append(f"- WARNING: this host had {swap.used / 1024**3:.1f} GB of swap in use. Under memory pressure the OS compresses or swaps pages, "
                     "so current RSS values are unreliable. Prefer peak values, and re-run on the reference machine before quoting memory figures.")
    cold = ", ".join(f"{s} {i['cold_query_ms']:.1f} ms" for s, i in idx.items() if i)
    lines.append(f"- Query latency is end-to-end `search()` (query embedding plus store lookup) after one untimed warm-up embedding. First cold search: {cold}.")
    restarts = [r["server_restart_s"] for s, r in results.items() if is_qdrant(s) and "server_restart_s" in r]
    restart_note = (f" For Qdrant, the container was also restarted with `docker restart` between the two processes (serving again within {max(restarts):.1f} s)."
                    if restarts else " The Qdrant container was NOT restarted." if any(map(is_qdrant, args.stores)) else "")
    lines.append("- Persistence: each store was written by a process that then exited. A new process reopened it with `load()` and re-ran every query; "
                 "a pass needs the same chunk count and identical top-k ids." + restart_note)
    checks = []
    for s, i in idx.items():
        if i and baseline:
            dev = max_score_deviation(i["ranked_ids"], i["ranked_scores"], baseline["exact_topk"])
            checks.append(f"{s}: chunk fields round-trip {'ok' if i['trace_roundtrip_ok'] else 'MISMATCH'}, "
                          f"max |score - exact cosine| = {dev:.1e}" if dev is not None else f"{s}: no overlap with exact top-k")
    if checks:
        lines.append(f"- Contract checks: {'; '.join(checks)}.")
    for s, i in idx.items():
        stats = i and i.get("index_stats")
        if not stats:
            continue
        line = f"- {labels[s]} built HNSW for {stats['indexed_vectors_count']}/{stats['points_count']} vectors in {stats['segments_count']} segments."
        if stats["indexed_vectors_count"] < stats["points_count"] and baseline:
            per_segment = stats["indexing_threshold_kb"] * 1024 // (baseline["embedding_dim"] * 4)
            line += (f" Segments under indexing_threshold ({stats['indexing_threshold_kb']} KB, about {per_segment} vectors per segment) are searched by "
                     "exact scan, so its recall reflects brute force rather than HNSW. Use `--stores ...,qdrant-hnsw` for a like-for-like HNSW row.")
        lines.append(line)
    if "synthetic" in fixtures.description:
        lines.append("- Synthetic filler chunks come from a small sentence-template vocabulary and form a dense near-duplicate cluster, which is a known "
                     "worst case for HNSW. Treat recall on this set as a stress test, not an estimate for real documents; use E2's fixtures for that.")
    return "\n".join(lines)


def main() -> None:
    args = parse_args()
    if not (Path(args.model_path) / "modules.json").exists():
        sys.exit(f"Embedding model not found at {args.model_path}. Run `python scripts/fetch_model.py` first.")

    data_dir = Path(args.data_dir)
    data_dir.mkdir(parents=True, exist_ok=True)
    fixtures = load_fixture_set(args.fixtures, args.synthetic)
    config = {
        "fixtures": args.fixtures,
        "synthetic": args.synthetic,
        "top_k": args.top_k,
        "repeats": args.repeats,
        "data_dir": str(data_dir),
        "model_path": args.model_path,
        "qdrant_host": args.qdrant_host,
        "qdrant_port": args.qdrant_port,
        "qdrant_container": args.qdrant_container,
    }
    config_path = data_dir / "config.json"
    config_path.write_text(json.dumps(config, indent=2))
    qdrant_url = f"http://{args.qdrant_host}:{args.qdrant_port}"
    can_restart = not args.no_server_restart and container_running(args.qdrant_container)
    print(f"Fixtures: {fixtures.description} ({len(fixtures.chunks)} chunks, {len(fixtures.queries)} queries)")

    started = time.perf_counter()
    baseline = run_worker("baseline", None, config_path, data_dir)
    results: dict[str, dict] = {}
    for store in args.stores:
        results[store] = {}
        if is_qdrant(store):
            if server_version(qdrant_url) is None:
                print(f"\n!! Qdrant not reachable at {qdrant_url}; skipping {store}. Start it with the docker command in benchmarks/README.md")
                results[store]["skipped"] = "not run (server unreachable)"
                continue
            if can_restart:
                restart_qdrant(args, "clean server memory before indexing")
        results[store]["index"] = run_worker("index", store, config_path, data_dir)
        if results[store]["index"] is None:
            continue
        if is_qdrant(store) and can_restart:
            results[store]["server_restart_s"] = restart_qdrant(args, "persistence check")
        results[store]["reload"] = run_worker("reload", store, config_path, data_dir)

    report = build_report(args, fixtures, baseline, results, qdrant_url)
    (data_dir / "results.md").write_text(report + "\n")
    (data_dir / "results.json").write_text(json.dumps({"config": config, "baseline": baseline, "results": results}, indent=2))
    print(f"\nTotal benchmark wall time: {time.perf_counter() - started:.1f} s\n")
    print(report)
    print(f"\nSaved {data_dir / 'results.md'} and {data_dir / 'results.json'}")


if __name__ == "__main__":
    main()
