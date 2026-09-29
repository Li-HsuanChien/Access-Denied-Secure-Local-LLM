"""Chroma running embedded in-process with an on-disk PersistentClient (no server, no port)."""

from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path

from .base import DocumentStore, EmbeddingMismatchError
from .chunk import Chunk, SearchResult
from .embedding import Embedder

HNSW_CONFIG = {"space": "cosine", "max_neighbors": 16, "ef_construction": 100, "ef_search": 100}


class ChromaStore(DocumentStore):
    name = "chroma"

    def __init__(self, embedder: Embedder, path: str | Path, collection: str = "chunks") -> None:
        super().__init__(embedder)
        import chromadb
        from chromadb.config import Settings

        self.path = Path(path)
        self._collection_name = collection
        self._client = chromadb.PersistentClient(
            path=str(self.path),
            settings=Settings(anonymized_telemetry=False, allow_reset=True),
        )
        self._collection = None

    @property
    def collection_name(self) -> str:
        return self._collection_name

    @property
    def collection(self):
        if self._collection is None:
            collection = self._client.get_or_create_collection(
                name=self._collection_name,
                embedding_function=None,  # we always pass vectors; avoids Chroma's model download
                configuration={"hnsw": HNSW_CONFIG},
                metadata={
                    "embedding_model": self.embedder.model_name,
                    "embedding_dim": self.embedder.dimension,
                },
            )
            self._check_embedding_model(collection)
            self._collection = collection
        return self._collection

    def _check_embedding_model(self, collection) -> None:
        meta = collection.metadata or {}
        built_with = (meta.get("embedding_model"), meta.get("embedding_dim"))
        using = (self.embedder.model_name, self.embedder.dimension)
        if built_with != using:
            raise EmbeddingMismatchError(
                f"Collection '{self._collection_name}' was built with {built_with[0]} ({built_with[1]}-dim) "
                f"but the embedder is {using[0]} ({using[1]}-dim)"
            )

    def _upsert(self, chunks: Sequence[Chunk], vectors) -> None:
        batch = self._client.get_max_batch_size()
        for i in range(0, len(chunks), batch):
            part = chunks[i : i + batch]
            self.collection.upsert(
                ids=[c.chunk_id for c in part],
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

    def load(self) -> int:
        from chromadb.errors import NotFoundError

        try:
            collection = self._client.get_collection(self._collection_name)
        except NotFoundError as exc:
            raise LookupError(f"No persisted Chroma collection '{self._collection_name}' at {self.path}") from exc
        self._check_embedding_model(collection)
        self._collection = collection
        return self.count()

    def count(self) -> int:
        return self.collection.count()

    def reset(self) -> None:
        if any(c.name == self._collection_name for c in self._client.list_collections()):
            self._client.delete_collection(self._collection_name)
        self._collection = None

    def close(self) -> None:
        self._client.close()
        self._collection = None
