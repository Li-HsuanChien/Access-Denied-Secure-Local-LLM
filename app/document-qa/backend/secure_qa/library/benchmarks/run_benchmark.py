"""Benchmark the Chroma document store on fixture chunks with the local embedding model.

Examples:
    python -m secure_qa.library.benchmarks.run_benchmark                     # synthetic placeholder corpus
    python -m secure_qa.library.benchmarks.run_benchmark --synthetic 10000   # pad to 10,000 chunks to see scaling
    python -m secure_qa.library.benchmarks.run_benchmark --fixtures secure_qa/library/tests/fixtures/e2

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

from secure_qa.library.benchmarks.fixtures import load_fixture_set
from secure_qa.paths import BACKEND_ROOT, DATA_DIR
from secure_qa.library.embedding import DEFAULT_MODEL_PATH

OFFLINE_ENV = {
    "HF_HUB_OFFLINE": "1",
    "TRANSFORMERS_OFFLINE": "1",
    "ANONYMIZED_TELEMETRY": "False",
    "TOKENIZERS_PARALLELISM": "false",
}


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--fixtures", help="directory of E2 chunk output (default: synthetic placeholder corpus)")
    p.add_argument("--synthetic", type=int, default=0, metavar="N", help="pad the fixture set with synthetic chunks up to N total")
    p.add_argument("--top-k", type=int, default=5)
    p.add_argument("--repeats", type=int, default=20, help="passes over the query set for latency stats")
    p.add_argument("--data-dir", default=str(DATA_DIR))
    p.add_argument("--model-path", default=str(DEFAULT_MODEL_PATH))
    return p.parse_args()


def run_worker(phase: str, config_path: Path, data_dir: Path) -> dict | None:
    out = data_dir / f"{phase}.json"
    out.unlink(missing_ok=True)
    cmd = [sys.executable, "-m", "secure_qa.library.benchmarks.worker", "--phase", phase, "--config", str(config_path), "--out", str(out)]
    print(f"\n--- {phase} (new process) ---", flush=True)
    proc = subprocess.run(cmd, cwd=BACKEND_ROOT, env={**os.environ, **OFFLINE_ENV})
    if proc.returncode != 0 or not out.exists():
        print(f"!! {phase} phase failed (exit code {proc.returncode}); see output above", flush=True)
        return None
    return json.loads(out.read_text())


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


def build_report(args, fixtures, baseline, index, reload) -> str:
    n, k = len(fixtures.chunks), min(args.top_k, len(fixtures.chunks))
    headers = ["Row", "Index time (s)", "RSS after index / peak (MB)", "Avg query (ms)", "p95 query (ms)",
               f"Recall@{k}", "Persisted after restart", "Reopen (s)"]
    rows = []
    if baseline:
        q = baseline["query_embed"]
        rows.append(["Embedding only (baseline)", f"{baseline['embed_s']:.3f}",
                     f"{baseline['rss_after_mb']:.0f} / {baseline['peak_rss_mb']:.0f}",
                     f"{q['avg_ms']:.2f}", f"{q['p95_ms']:.2f}", "1.00 (exact)", "–", "–"])
    label = f"Chroma {pkg_version('chromadb')} (embedded)"
    if index is None:
        rows.append([label, "failed", *["–"] * 6])
    else:
        rows.append([
            label,
            f"{index['index_s']:.3f}",
            f"{index['rss_after_index_mb']:.0f} / {index['peak_rss_after_index_mb']:.0f}",
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
        "- HNSW parameters: cosine, M=16, ef_construction=100, ef_search=100",
        "",
        markdown_table(headers, rows),
        "",
        "Notes:",
        "- Index time is end-to-end `index()`, embedding included. The baseline row is the embedding share.",
    ]
    if index:
        lines.append(f"- RSS is the benchmark's Python process and includes ~{index['rss_model_mb']:.0f} MB for the embedding model and libraries. "
                     "Chroma runs in-process, so this is its whole footprint.")
    swap = psutil.swap_memory()
    if swap.used > 0.25 * psutil.virtual_memory().total:
        lines.append(f"- WARNING: this host had {swap.used / 1024**3:.1f} GB of swap in use. Under memory pressure the OS compresses or swaps pages, "
                     "so current RSS values are unreliable. Prefer peak values, and re-run on the reference machine before quoting memory figures.")
    if index:
        lines.append(f"- Query latency is end-to-end `search()` (query embedding plus store lookup). First cold search: {index['cold_query_ms']:.1f} ms.")
    lines.append("- Persistence: the index was written by a process that then exited. A new process reopened it with `load()` and re-ran every query; "
                 "a pass needs the same chunk count and identical top-k ids.")
    if index and baseline:
        dev = max_score_deviation(index["ranked_ids"], index["ranked_scores"], baseline["exact_topk"])
        dev_text = f"max |score - exact cosine| = {dev:.1e}" if dev is not None else "no overlap with exact top-k"
        lines.append(f"- Contract checks: chunk fields round-trip {'ok' if index['trace_roundtrip_ok'] else 'MISMATCH'}, {dev_text}.")
    if "filler" in fixtures.description:
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
    }
    config_path = data_dir / "config.json"
    config_path.write_text(json.dumps(config, indent=2))
    print(f"Fixtures: {fixtures.description} ({len(fixtures.chunks)} chunks, {len(fixtures.queries)} queries)")

    started = time.perf_counter()
    baseline = run_worker("baseline", config_path, data_dir)
    index = run_worker("index", config_path, data_dir)
    reload = run_worker("reload", config_path, data_dir) if index else None

    report = build_report(args, fixtures, baseline, index, reload)
    (data_dir / "results.md").write_text(report + "\n")
    (data_dir / "results.json").write_text(json.dumps({"config": config, "baseline": baseline, "index": index, "reload": reload}, indent=2))
    print(f"\nTotal benchmark wall time: {time.perf_counter() - started:.1f} s\n")
    print(report)
    print(f"\nSaved {data_dir / 'results.md'} and {data_dir / 'results.json'}")


if __name__ == "__main__":
    main()
