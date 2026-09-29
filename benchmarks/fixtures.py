"""Fixture chunks and queries for the store benchmark.

Resolution order:
  1. an explicit --fixtures directory of E2 chunk output
  2. the synthetic placeholder corpus from `docstore.synthetic`

A fixture directory may contain `*.jsonl` files (one E2 chunk dict per line) and/or
`*.json` files holding E2's `all_chunks.json` shape (`{"chunks": [...]}`) or a
list of chunk dicts. An optional `queries.txt` supplies one query per line;
otherwise the placeholder queries are used. `--synthetic N` pads the set with
template filler chunks up to N total.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from docstore import Chunk
from docstore.synthetic import PLACEHOLDER_PAGES, PLACEHOLDER_QUERIES, chunk_document, filler_documents, synthetic_corpus

REPO_ROOT = Path(__file__).resolve().parent.parent


@dataclass
class FixtureSet:
    description: str
    chunks: list[Chunk]
    queries: list[str]


def load_fixture_set(fixtures_path: str | None = None, synthetic_total: int = 0) -> FixtureSet:
    if fixtures_path:
        chunks, queries = _load_directory(Path(fixtures_path))
        description = f"E2 chunks from {fixtures_path}"
        if synthetic_total > len(chunks):
            extra = synthetic_total - len(chunks)
            chunks += _filler_chunks(extra)
            description += f" + {extra} synthetic filler chunks"
        return FixtureSet(description, chunks, queries)

    docs, chunks = synthetic_corpus(synthetic_total)
    description = "synthetic placeholder corpus"
    if len(docs) > len(PLACEHOLDER_PAGES):
        description += f" padded with template filler to {len(chunks)} chunks"
    return FixtureSet(description, chunks, list(PLACEHOLDER_QUERIES))


def _load_directory(directory: Path) -> tuple[list[Chunk], list[str]]:
    if not directory.is_dir():
        raise FileNotFoundError(f"Fixture directory not found: {directory}")
    dicts: list[dict] = []
    for path in sorted(directory.rglob("*.jsonl")):
        dicts += [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
    for path in sorted(directory.rglob("*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(data, dict) and isinstance(data.get("chunks"), list):
            dicts += data["chunks"]
        elif isinstance(data, list) and data and isinstance(data[0], dict) and "chunk_id" in data[0]:
            dicts += data
    if not dicts:
        raise ValueError(f"No E2 chunk .jsonl or .json files found in {directory}")
    chunks = [Chunk.from_dict(d) for d in dicts]

    queries_file = directory / "queries.txt"
    if queries_file.exists():
        queries = [q.strip() for q in queries_file.read_text(encoding="utf-8").splitlines() if q.strip()]
    else:
        queries = list(PLACEHOLDER_QUERIES)
    return chunks, queries


def _filler_chunks(n: int) -> list[Chunk]:
    chunks: list[Chunk] = []
    docs = filler_documents()
    while len(chunks) < n:
        chunks += chunk_document(next(docs))
    return chunks[:n]
