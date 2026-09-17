"""Chroma running embedded in-process with an on-disk PersistentClient."""

from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path

from .base import DocumentStore
from .chunk import Chunk, SearchResult
from .embedding import Embedder

# Matched to QdrantStore so both indexes are built with the same HNSW settings.
HNSW_CONFIG = {"space": "cosine", "max_neighbors": 16, "ef_construction": 100, "ef_search": 100}


class ChromaStore(DocumentStore):
    name = "chroma"

    def __init__(self, embedder: Embedder, path: str | Path, collection: str = "chunks") -> None:
        super().__init__(embedder)
        import chromadb
        from chromadb.config import Settings

        self.path = Path(path)
        self.collection_name = collection
        self._client = chromadb.PersistentClient(
            path=str(self.path),
            settings=Settings(anonymized_telemetry=False, allow_reset=True),
        )
        self._collection = None

    @property
    def collection(self):
        if self._collection is None:
            self._collection = self._client.get_or_create_collection(
                name=self.collection_name,
                embedding_function=None,  # we always pass vectors; avoids Chroma's model download
                configuration={"hnsw": HNSW_CONFIG},
            )
        return self._collection

    def _upsert(self, chunks: Sequence[Chunk], vectors) -> None:
        batch = self._client.get_max_batch_size()
        for i in range(0, len(chunks), batch):
            part = chunks[i : i + batch]
            self.collection.upsert(
                ids=[c.id for c in part],
                embeddings=vectors[i : i + batch],
                documents=[c.text for c in part],
                metadatas=[c.to_metadata() for c in part],
            )

    def _query(self, vector, top_k: int) -> list[SearchResult]:
        res = self.collection.query(
            query_embeddings=[vector],
            n_results=top_k,
            include=["documents", "metadatas", "distances"],
        )
        # Chroma returns cosine *distance* (1 - similarity); convert to the contract's score.
        return [
            SearchResult(chunk=Chunk.from_metadata(doc, meta), score=1.0 - dist, rank=rank)
            for rank, (doc, meta, dist) in enumerate(
                zip(res["documents"][0], res["metadatas"][0], res["distances"][0]), start=1
            )
        ]

    def persist(self) -> None:
        # PersistentClient writes through to SQLite on every upsert and flushes the
        # HNSW segment itself; there is no explicit flush API in chromadb 1.x.
        pass

    def load(self) -> int:
        from chromadb.errors import NotFoundError

        try:
            self._collection = self._client.get_collection(self.collection_name)
        except NotFoundError as exc:
            raise LookupError(f"No persisted Chroma collection '{self.collection_name}' at {self.path}") from exc
        return self.count()

    def count(self) -> int:
        return self.collection.count()

    def reset(self) -> None:
        if any(c.name == self.collection_name for c in self._client.list_collections()):
            self._client.delete_collection(self.collection_name)
        self._collection = None

    def close(self) -> None:
        self._client.close()
        self._collection = None
