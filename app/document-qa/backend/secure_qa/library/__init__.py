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
    "IntegrityReport",
    "PageSpan",
    "PublicationOutcome",
    "PublishError",
    "Publisher",
    "RetrievalError",
    "SearchResult",
    "SearchTrace",
    "ingest_corpus",
    "trace_search",
]


def __getattr__(name: str):
    if name == "ChromaStore":
        from .chroma_store import ChromaStore

        return ChromaStore
    if name in ("CollectionVersion", "CollectionVersions", "IntegrityReport", "PublishError"):
        from . import versions

        return getattr(versions, name)
    if name in ("PublicationOutcome", "Publisher"):
        from . import publication

        return getattr(publication, name)
    if name == "ingest_corpus":
        from .corpus import ingest_corpus

        return ingest_corpus
    if name in ("SearchTrace", "trace_search"):
        from . import search_trace

        return getattr(search_trace, name)
    raise AttributeError(name)
