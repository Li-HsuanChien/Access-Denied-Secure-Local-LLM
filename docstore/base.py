"""The write/search I/O contract every document store implements."""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections import Counter
from collections.abc import Sequence

from .chunk import Chunk, SearchResult
from .embedding import Embedder


class DocumentStore(ABC):
    """Contract other workstreams build against.

    - `write` is an upsert keyed on `Chunk.id`: re-writing a chunk replaces it
      entirely, and no metadata from the previous version survives.
    - `search` returns at most `top_k` results ordered best first, with
      `score` as cosine similarity on the same scale for every backend.
    - `persist` guarantees everything written so far is durable on disk.
    - `load` attaches to an existing persisted index (for example after a
      process restart) without re-indexing, and returns its chunk count.
    """

    name: str = "base"

    def __init__(self, embedder: Embedder) -> None:
        self.embedder = embedder

    def write(self, chunks: Sequence[Chunk]) -> int:
        """Embed and index `chunks`. Returns the number of chunks written."""
        if not chunks:
            return 0
        dupes = [cid for cid, n in Counter(c.id for c in chunks).items() if n > 1]
        if dupes:
            # Chroma raises on duplicates while Qdrant silently keeps the last one;
            # reject them here so both backends behave the same.
            raise ValueError(f"Duplicate chunk ids in one write: {dupes[:5]}")
        vectors = self.embedder.embed_documents([c.text for c in chunks])
        self._upsert(chunks, vectors)
        return len(chunks)

    def search(self, query: str, top_k: int = 5) -> list[SearchResult]:
        if top_k < 1:
            raise ValueError("top_k must be >= 1")
        return self._query(self.embedder.embed_query(query), top_k)

    @abstractmethod
    def _upsert(self, chunks: Sequence[Chunk], vectors) -> None: ...

    @abstractmethod
    def _query(self, vector, top_k: int) -> list[SearchResult]: ...

    @abstractmethod
    def persist(self) -> None: ...

    @abstractmethod
    def load(self) -> int: ...

    @abstractmethod
    def count(self) -> int: ...

    @abstractmethod
    def reset(self) -> None:
        """Delete all indexed data so a benchmark run starts from empty."""

    def close(self) -> None:
        """Release clients, file handles and locks."""
