"""Qdrant server running in a local Docker container, accessed over HTTP on localhost."""

from __future__ import annotations

import time
import uuid
from collections.abc import Sequence

from .base import DocumentStore
from .chunk import Chunk, SearchResult
from .embedding import Embedder

# Matched to ChromaStore's HNSW settings (M=16, ef_construction=100, ef_search=100).
HNSW_M = 16
HNSW_EF_CONSTRUCT = 100
HNSW_EF_SEARCH = 100
UPSERT_BATCH = 256
# Qdrant's smallest accepted values (KB of vectors per segment). See `force_hnsw`.
FORCED_INDEXING_THRESHOLD_KB = 1
FORCED_FULL_SCAN_THRESHOLD_KB = 10

# Qdrant point ids must be unsigned ints or UUIDs, so chunk ids are mapped to a
# deterministic UUID and the original id is kept in the payload.
_CHUNK_ID_NAMESPACE = uuid.UUID("6f1c1c7e-5b1a-4c2e-9d47-3f0e7a2b9c10")


def point_id(chunk_id: str) -> str:
    return str(uuid.uuid5(_CHUNK_ID_NAMESPACE, chunk_id))


class QdrantStore(DocumentStore):
    name = "qdrant"

    def __init__(
        self,
        embedder: Embedder,
        host: str = "localhost",
        port: int = 6333,
        collection: str = "chunks",
        wait_for_index: bool = True,
        force_hnsw: bool = False,
        timeout_s: int = 60,
    ) -> None:
        super().__init__(embedder)
        from qdrant_client import QdrantClient

        self.collection_name = collection
        # Qdrant builds HNSW in background optimizers after an upsert is acknowledged.
        # Waiting keeps write() comparable to Chroma, whose write returns once indexed.
        self.wait_for_index = wait_for_index
        # By default Qdrant only builds HNSW for segments holding more than ~10 MB of
        # vectors and searches smaller segments by exact scan. force_hnsw drops both
        # thresholds to their minimum so HNSW is always used, matching Chroma.
        self.force_hnsw = force_hnsw
        self.timeout_s = timeout_s
        self._client = QdrantClient(host=host, port=port, timeout=timeout_s)

    def _ensure_collection(self) -> None:
        from qdrant_client import models

        if self._client.collection_exists(self.collection_name):
            return
        hnsw = models.HnswConfigDiff(m=HNSW_M, ef_construct=HNSW_EF_CONSTRUCT)
        optimizers = None
        if self.force_hnsw:
            hnsw.full_scan_threshold = FORCED_FULL_SCAN_THRESHOLD_KB
            optimizers = models.OptimizersConfigDiff(indexing_threshold=FORCED_INDEXING_THRESHOLD_KB)
        self._client.create_collection(
            collection_name=self.collection_name,
            vectors_config=models.VectorParams(size=self.embedder.dimension, distance=models.Distance.COSINE),
            hnsw_config=hnsw,
            optimizers_config=optimizers,
        )

    def _upsert(self, chunks: Sequence[Chunk], vectors) -> None:
        from qdrant_client import models

        self._ensure_collection()
        for i in range(0, len(chunks), UPSERT_BATCH):
            points = [
                models.PointStruct(
                    id=point_id(c.id),
                    vector=v.tolist(),
                    payload={"text": c.text, **c.to_metadata()},
                )
                for c, v in zip(chunks[i : i + UPSERT_BATCH], vectors[i : i + UPSERT_BATCH])
            ]
            self._client.upsert(self.collection_name, points=points, wait=True)
        if self.wait_for_index:
            self._wait_until_optimized()

    def _wait_until_optimized(self) -> None:
        from qdrant_client import models

        deadline = time.monotonic() + self.timeout_s
        while True:
            info = self._client.get_collection(self.collection_name)
            if info.status == models.CollectionStatus.RED:
                raise RuntimeError(f"Qdrant collection '{self.collection_name}' reported status RED")
            settled = info.status != models.CollectionStatus.YELLOW
            if self.force_hnsw:
                settled = settled and (info.indexed_vectors_count or 0) >= (info.points_count or 0)
            if settled:
                return
            if time.monotonic() > deadline:
                raise TimeoutError(f"Qdrant optimizers still running after {self.timeout_s}s")
            time.sleep(0.05)

    def _query(self, vector, top_k: int) -> list[SearchResult]:
        from qdrant_client import models

        points = self._client.query_points(
            self.collection_name,
            query=vector.tolist(),
            limit=top_k,
            with_payload=True,
            search_params=models.SearchParams(hnsw_ef=HNSW_EF_SEARCH),
        ).points
        results = []
        for rank, p in enumerate(points, start=1):
            payload = dict(p.payload)
            text = payload.pop("text")
            # Qdrant's COSINE score is already cosine similarity.
            results.append(SearchResult(chunk=Chunk.from_metadata(text, payload), score=p.score, rank=rank))
        return results

    def persist(self) -> None:
        # Upserts use wait=True, so each batch is committed to the server's
        # write-ahead log before write() returns. The server owns durability.
        pass

    def load(self) -> int:
        if not self._client.collection_exists(self.collection_name):
            raise LookupError(f"No persisted Qdrant collection '{self.collection_name}'")
        return self.count()

    def count(self) -> int:
        return self._client.count(self.collection_name, exact=True).count

    def index_stats(self) -> dict:
        """Whether HNSW was actually built. Below the thresholds Qdrant searches by exact full scan."""
        info = self._client.get_collection(self.collection_name)
        return {
            "points_count": info.points_count,
            "indexed_vectors_count": info.indexed_vectors_count,
            "segments_count": info.segments_count,
            "full_scan_threshold_kb": info.config.hnsw_config.full_scan_threshold,
            "indexing_threshold_kb": info.config.optimizer_config.indexing_threshold,
        }

    def reset(self) -> None:
        if self._client.collection_exists(self.collection_name):
            self._client.delete_collection(self.collection_name)

    def close(self) -> None:
        self._client.close()
