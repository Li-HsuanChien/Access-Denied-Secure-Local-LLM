"""Document store I/O contract and backend implementations for the RAG workstream.

Backends are imported lazily so that using one does not require the other's client library.
"""

from .base import DocumentStore
from .chunk import Chunk, SearchResult
from .embedding import Embedder

__all__ = ["Chunk", "DocumentStore", "Embedder", "SearchResult", "make_store"]


def make_store(name: str, embedder: Embedder, **options) -> DocumentStore:
    if name == "chroma":
        from .chroma_store import ChromaStore

        return ChromaStore(embedder, **options)
    if name == "qdrant":
        from .qdrant_store import QdrantStore

        return QdrantStore(embedder, **options)
    raise ValueError(f"Unknown store '{name}' (expected 'chroma' or 'qdrant')")
