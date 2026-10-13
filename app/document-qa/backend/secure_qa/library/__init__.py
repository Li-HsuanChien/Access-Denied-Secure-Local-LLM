"""Collection Library: the document store behind the SDD §4.5 seam. E2 Chunks in, ranked SearchResults out.

Chroma (embedded, on-disk) is the selected store. Chroma-backed classes are
imported lazily so the chunk types can be used without chromadb installed.
"""

from .base import DocumentStore, EmbeddingMismatchError, RetrievalError
from .chunk import Chunk, IndexResult, PageSpan, SearchResult
from .embedding import Embedder, FakeEmbedder

__all__ = [
    "ChromaStore",
    "Chunk",
    "CollectionVersion",
    "CollectionVersions",
    "DocumentStore",
    "Embedder",
    "EmbeddingMismatchError",
    "FakeEmbedder",
    "IndexResult",
    "PageSpan",
    "PublishError",
    "RetrievalError",
    "SearchResult",
]


def __getattr__(name: str):
    if name == "ChromaStore":
        from .chroma_store import ChromaStore

        return ChromaStore
    if name in ("CollectionVersion", "CollectionVersions", "PublishError"):
        from . import versions

        return getattr(versions, name)
    raise AttributeError(name)
