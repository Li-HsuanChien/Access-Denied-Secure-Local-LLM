"""Week 2 demo: index a small synthetic set into Chroma, then show top-k results with source metadata.

    .venv/bin/python -m scripts.demo_index_search                 # index, then search in a fresh process
    .venv/bin/python -m scripts.demo_index_search --e2-chunks tests/fixtures/e2/nrc_all_chunks.json
    .venv/bin/python -m scripts.demo_index_search search "What is the annual dose limit?"

`index` embeds the chunks and writes them to an on-disk Chroma collection, plus a
documents.json manifest (standing in for the Library's document records) so a
result's document_id can be traced to a filename. `search` reopens that store,
which proves the index was persisted. With no subcommand, the demo runs `index`
and then runs `search` in a new Python process.
"""

import os

# Offline before any library that could open a connection is imported.
os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
os.environ.setdefault("ANONYMIZED_TELEMETRY", "False")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

import argparse  # noqa: E402
import json  # noqa: E402
import subprocess  # noqa: E402
import sys  # noqa: E402
import textwrap  # noqa: E402
import time  # noqa: E402
from pathlib import Path  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_STORE = REPO_ROOT / ".bench_data" / "demo_store"
DEMO_QUERIES = [
    "How much RAM does the offline reference laptop have?",
    "What pressure is the primary coolant kept at?",
    "How soon must a broken safeguards seal be reported?",
]
E2_DEMO_QUERIES = [
    "How does a nuclear power plant produce electricity?",
    "What happens to the steam after it leaves the turbine?",
]


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("command", nargs="?", choices=["all", "index", "search"], default="all")
    p.add_argument("queries", nargs="*", help="queries for `search` (default: a built-in set)")
    p.add_argument("--store", type=Path, default=DEFAULT_STORE, help="Chroma data directory")
    p.add_argument("--e2-chunks", type=Path, help="index E2 chunk output (all_chunks.json or .jsonl) instead of synthetic chunks")
    p.add_argument("--top-k", type=int, default=3)
    return p.parse_args()


def load_chunks(args):
    from docstore import Chunk
    from docstore.synthetic import synthetic_corpus

    if args.e2_chunks is None:
        docs, chunks = synthetic_corpus()
        return chunks, {d.document_id: d.metadata() for d in docs}, "synthetic placeholder corpus"
    raw = args.e2_chunks.read_text(encoding="utf-8")
    if args.e2_chunks.suffix == ".jsonl":
        dicts = [json.loads(line) for line in raw.splitlines() if line.strip()]
    else:
        data = json.loads(raw)
        dicts = data["chunks"] if isinstance(data, dict) else data
    chunks = [Chunk.from_dict(d) for d in dicts]
    documents = {c.document_id: {"document_id": c.document_id, "source_filename": f"(E2 output: {args.e2_chunks.name})"} for c in chunks}
    return chunks, documents, f"E2 chunks from {args.e2_chunks}"


def cmd_index(args) -> None:
    from docstore import ChromaStore, Embedder

    chunks, documents, description = load_chunks(args)
    print("Loading embedding model (offline) ...")
    embedder = Embedder()
    store = ChromaStore(embedder, args.store)
    store.reset()
    t0 = time.perf_counter()
    result = store.index(chunks)
    elapsed = time.perf_counter() - t0
    store.close()
    (args.store / "documents.json").write_text(json.dumps(documents, indent=2))

    spanning = sum(c.page_end > c.page_start for c in chunks)
    print(f"\nIndexed {description}")
    print(f"  collection      {result.collection} at {args.store}")
    print(f"  chunks          {result.indexed} indexed, {result.total} in collection "
          f"({len(documents)} documents, {spanning} chunks span a page break)")
    print(f"  embedding       {result.embedding_model}, {result.embedding_dim}-dim, CPU")
    print(f"  time            {elapsed:.2f} s including embedding")


def cmd_search(args) -> None:
    from docstore import ChromaStore, Embedder

    queries = args.queries or (E2_DEMO_QUERIES if args.e2_chunks else DEMO_QUERIES)
    documents = json.loads((args.store / "documents.json").read_text())
    store = ChromaStore(Embedder(), args.store)
    count = store.load()
    print(f"\nReopened persisted collection '{store.collection_name}' in process {os.getpid()}: {count} chunks")

    for query in queries:
        t0 = time.perf_counter()
        results = store.search(query, top_k=args.top_k)
        ms = (time.perf_counter() - t0) * 1000
        print(f"\nQ: {query}   ({ms:.0f} ms)")
        for r in results:
            c = r.chunk
            doc = documents.get(c.document_id, {})
            pages = f"p. {c.page_start}" if c.page_start == c.page_end else f"pp. {c.page_start}-{c.page_end}"
            highlight = "reliable" if all(s.coordinates_reliable for s in c.page_spans) else "page only, no highlight"
            print(f"  #{r.rank}  score {r.score:.3f}  {doc.get('source_filename', '?')}  {pages}")
            print(f"      chunk {c.chunk_id} (ordinal {c.ordinal})  document {c.document_id}")
            print(f"      chars {c.char_start}-{c.char_end}  checksum {'ok' if c.checksum_ok else 'MISMATCH'}  "
                  f"coordinates {highlight}  chunker {c.chunker_version}")
            snippet = " ".join(c.text.split())
            print(textwrap.indent(textwrap.fill(f'"{snippet[:220]}{"..." if len(snippet) > 220 else ""}"', 96), "      "))
    store.close()


def main() -> None:
    args = parse_args()
    if not args.store.exists() and args.command == "search":
        sys.exit(f"No index at {args.store}; run the `index` step first.")
    if args.command in ("all", "index"):
        cmd_index(args)
    if args.command == "search":
        cmd_search(args)
    if args.command == "all":
        # Search from a brand-new process so the results come from what was persisted to disk.
        cmd = [sys.executable, "-m", "scripts.demo_index_search", "search", "--store", str(args.store), "--top-k", str(args.top_k)]
        if args.e2_chunks:
            cmd += ["--e2-chunks", str(args.e2_chunks)]
        sys.stdout.flush()
        subprocess.run(cmd + args.queries, cwd=REPO_ROOT, check=True)


if __name__ == "__main__":
    main()
