"""Search diagnostics: why a question did or didn't find evidence (SDD §7.1, §9).

`trace_search` runs the same top-k search the answer path runs, without the
relevance cut-off, then marks each hit as kept or dropped by `min_score`. Every
hit is mapped back to its document record, pages, chunk id and character
offsets, and checked against the manifest. It answers: what came back, how far
above or below the threshold, and does each result trace to a real source?

    trace = trace_search(store, "What is the annual dose limit?", top_k=5, min_score=0.38)
    trace.kept, trace.margin, trace.hits[0].pages, trace.unmapped

The trace holds the question text for interactive use. Don't persist or log it:
operational events carry sizes, scores and ids only (SDD §9, §10), which
`TraceHit.event()` and `SearchTrace.event()` give.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Protocol

from .chunk import SearchResult


class Searchable(Protocol):
    @property
    def collection_version(self) -> str: ...

    def search(self, query: str, top_k: int = 5, min_score: float | None = None) -> list[SearchResult]: ...

    def document(self, document_id: str) -> dict | None: ...


@dataclass
class TraceHit:
    rank: int
    score: float
    kept: bool  # at or above min_score, so the answer path would use it
    chunk_id: str
    ordinal: int
    document_id: str
    document_title: str | None
    source_filename: str | None
    page_start: int
    page_end: int
    char_start: int
    char_end: int
    preview: str
    mapped: bool  # the hit resolves to a manifest document, valid pages and an unaltered text
    problems: list[str] = field(default_factory=list)

    def event(self) -> dict:
        """Sanitized form for operational logs: ids and numbers, no document text."""
        return {"rank": self.rank, "score": round(self.score, 4), "kept": self.kept, "chunk_id": self.chunk_id,
                "document_id": self.document_id, "pages": [self.page_start, self.page_end]}


@dataclass
class SearchTrace:
    query: str
    collection_version: str
    top_k: int
    min_score: float | None
    hits: list[TraceHit]
    elapsed_ms: float

    @property
    def kept(self) -> list[TraceHit]:
        return [h for h in self.hits if h.kept]

    @property
    def unmapped(self) -> list[TraceHit]:
        return [h for h in self.hits if not h.mapped]

    @property
    def margin(self) -> float | None:
        """Top score minus the threshold. Negative means the question found nothing the answer path would use."""
        if not self.hits or self.min_score is None:
            return None
        return self.hits[0].score - self.min_score

    def event(self) -> dict:
        return {"collection_version": self.collection_version, "query_chars": len(self.query), "top_k": self.top_k,
                "min_score": self.min_score, "returned": len(self.hits), "kept": len(self.kept),
                "top_score": round(self.hits[0].score, 4) if self.hits else None,
                "elapsed_ms": round(self.elapsed_ms, 1), "hits": [h.event() for h in self.hits]}


def trace_search(store: Searchable, query: str, *, top_k: int = 5, min_score: float | None = None) -> SearchTrace:
    """Search `store` for `query` and explain every result. Raises `RetrievalError` like `search` does."""
    started = time.perf_counter()
    results = store.search(query, top_k=top_k)  # no cut-off here: show the near misses too
    elapsed_ms = (time.perf_counter() - started) * 1000
    hits = [_hit(store, r, min_score) for r in results]
    return SearchTrace(query, store.collection_version, top_k, min_score, hits, elapsed_ms)


def _hit(store: Searchable, result: SearchResult, min_score: float | None) -> TraceHit:
    chunk = result.chunk
    record = store.document(chunk.document_id)
    problems = []
    if record is None:
        problems.append("document is not in the collection manifest")
    elif not 1 <= chunk.page_start <= chunk.page_end <= record["page_count"]:
        problems.append(f"pages {chunk.page_start}-{chunk.page_end} are outside the {record['page_count']}-page document")
    if not chunk.checksum_ok:
        problems.append("chunk text doesn't match its checksum")
    if [s.page_number for s in chunk.page_spans] != list(range(chunk.page_start, chunk.page_end + 1)):
        problems.append("page spans don't cover the chunk's page range")
    return TraceHit(
        rank=result.rank,
        score=result.score,
        kept=min_score is None or result.score >= min_score,
        chunk_id=chunk.chunk_id,
        ordinal=chunk.ordinal,
        document_id=chunk.document_id,
        document_title=record.get("display_title") if record else None,
        source_filename=record.get("source_filename") if record else None,
        page_start=chunk.page_start,
        page_end=chunk.page_end,
        char_start=chunk.char_start,
        char_end=chunk.char_end,
        preview=" ".join(chunk.text.split())[:160],
        mapped=not problems,
        problems=problems,
    )
