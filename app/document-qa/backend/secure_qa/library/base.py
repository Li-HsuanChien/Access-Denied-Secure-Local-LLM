"""The index/search contract every document store implements."""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections import Counter
from collections.abc import Sequence

from .chunk import Chunk, IndexResult, SearchResult
from .embedding import Embedder


class EmbeddingMismatchError(RuntimeError):
    """The collection was built with a different embedding model than the one in use."""


class RetrievalError(RuntimeError):
    """Search could not run. Never reported as an empty result (SDD §9: retrieval failure).

    The message names the failure type only, never the query text (SDD §15).
    """


class DocumentStore(ABC):
    """Contract other workstreams build against.

    - `index` takes E2 Chunks, embeds them and upserts by `chunk_id`. Re-indexing
      a chunk replaces it entirely. Data is durable on disk when `index` returns.
      Chunks whose text doesn't match `text_checksum_sha256`, and duplicate ids
      within one call, are rejected before anything is written.
    - `search` returns at most `top_k` results ordered best first. `score` is
      cosine similarity in [-1, 1] (not Open WebUI's `(1 + cos) / 2`), and each
      result carries the full Chunk as indexed. With `min_score`, results scoring
      below it are dropped (SDD §7.1 relevance threshold), so the list may be
      empty. A store that cannot search raises `RetrievalError`; an empty list
      always means "nothing relevant", never "something broke".
    - A collection records the embedding model that built it; opening or
      searching it with a different model raises `EmbeddingMismatchError`.
    - `load` attaches to an existing collection (for example after a restart)
      without re-indexing, and returns its chunk count.
    """

    name: str = "base"

    def __init__(self, embedder: Embedder) -> None:
        self.embedder = embedder

    def index(self, chunks: Sequence[Chunk]) -> IndexResult:
        """Embed and index `chunks`."""
        chunks = list(chunks)
        dupes = [cid for cid, n in Counter(c.chunk_id for c in chunks).items() if n > 1]
        if dupes:
            raise ValueError(f"Duplicate chunk ids in one index call: {dupes[:5]}")
        corrupt = [c.chunk_id for c in chunks if not c.checksum_ok]
        if corrupt:
            raise ValueError(f"Chunk text does not match text_checksum_sha256: {corrupt[:5]}")
        if chunks:
            self._upsert(chunks, self.embedder.embed_documents([c.text for c in chunks]))
        return IndexResult(
            collection=self.collection_name,
            indexed=len(chunks),
            total=self.count(),
            embedding_model=self.embedder.model_name,
            embedding_dim=self.embedder.dimension,
            chunk_ids=[c.chunk_id for c in chunks],
        )

    def search(self, query: str, top_k: int = 5, min_score: float | None = None) -> list[SearchResult]:
        if top_k < 1:
            raise ValueError("top_k must be >= 1")
        try:
            results = self._query(self.embedder.embed_query(query), top_k)
        except EmbeddingMismatchError:
            raise
        except Exception as exc:
            raise RetrievalError(f"Search of collection '{self.collection_name}' failed: {type(exc).__name__}") from exc
        if min_score is not None:
            results = [r for r in results if r.score >= min_score]  # ranks stay 1..n: results are sorted
        return results

    @property
    def collection_version(self) -> str:
        """The collection version answers record (SDD §4.2). Unversioned stores use the collection name."""
        return self.collection_name

    def document(self, document_id: str) -> dict | None:
        """The Library's document record (E2 Document fields) for citations, if this store has one."""
        return None

    @property
    @abstractmethod
    def collection_name(self) -> str: ...

    @abstractmethod
    def _upsert(self, chunks: Sequence[Chunk], vectors) -> None: ...

    @abstractmethod
    def _query(self, vector, top_k: int) -> list[SearchResult]: ...

    @abstractmethod
    def load(self) -> int: ...

    @abstractmethod
    def count(self) -> int: ...

    @abstractmethod
    def reset(self) -> None:
        """Delete the collection and everything in it."""

    def close(self) -> None:
        """Release clients, file handles and locks."""
