"""Document store for the RAG workstream: E2 Chunks in, ranked SearchResults out.

Chroma (embedded, on-disk) is the selected store. `ChromaStore` is imported
lazily so the chunk types can be used without chromadb installed.
"""

from .base import DocumentStore, EmbeddingMismatchError
from .chunk import Chunk, IndexResult, PageSpan, SearchResult
from .embedding import Embedder, FakeEmbedder

__all__ = [
    "ChromaStore",
    "Chunk",
    "DocumentStore",
    "Embedder",
    "EmbeddingMismatchError",
    "FakeEmbedder",
    "IndexResult",
    "PageSpan",
    "SearchResult",
]


def __getattr__(name: str):
    if name == "ChromaStore":
        from .chroma_store import ChromaStore

        return ChromaStore
    raise AttributeError(name)
