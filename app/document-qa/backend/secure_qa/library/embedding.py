"""Local sentence-transformers embedder, plus a deterministic fake for tests."""

from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path

import hashlib
import re

import numpy as np

from ..paths import MODELS_DIR

DEFAULT_MODEL_PATH = MODELS_DIR / "all-MiniLM-L6-v2"


class Embedder:
    """Wraps all-MiniLM-L6-v2 (384-dim) running on CPU.

    Loads from a local directory so nothing is fetched from the network at
    runtime; populate it once with `python scripts/fetch_model.py`.
    Embeddings are L2-normalised, so cosine similarity equals the dot product.
    """

    def __init__(
        self,
        model_path: str | Path = DEFAULT_MODEL_PATH,
        device: str = "cpu",
        batch_size: int = 64,
    ) -> None:
        model_path = Path(model_path)
        if not (model_path / "modules.json").exists():
            raise FileNotFoundError(
                f"No sentence-transformers model at {model_path}. "
                "Run `python scripts/fetch_model.py` once on a connected machine "
                "and copy the models/ directory to the air-gapped host."
            )
        from sentence_transformers import SentenceTransformer

        self.model = SentenceTransformer(str(model_path), device=device, local_files_only=True)
        # Recorded on every collection so a collection is never searched with a different model.
        self.model_name = model_path.name
        self.batch_size = batch_size
        self.dimension: int = self.model.get_embedding_dimension()

    def embed_documents(self, texts: Sequence[str]) -> np.ndarray:
        return self.model.encode(
            list(texts),
            batch_size=self.batch_size,
            normalize_embeddings=True,
            convert_to_numpy=True,
            show_progress_bar=False,
        ).astype(np.float32)

    def embed_query(self, text: str) -> np.ndarray:
        return self.embed_documents([text])[0]


class FakeEmbedder:
    """Deterministic bag-of-words hashing embedder for contract tests (SDD §13: workflow tests use fakes).

    No model files or torch needed. Texts that share words get similar vectors,
    so simple keyword queries still rank the expected chunk first.
    """

    model_name = "fake-hash-embedder"

    def __init__(self, dimension: int = 64) -> None:
        self.dimension = dimension

    def embed_documents(self, texts: Sequence[str]) -> np.ndarray:
        out = np.zeros((len(texts), self.dimension), dtype=np.float32)
        for row, text in enumerate(texts):
            for word in re.findall(r"[a-z0-9]+", text.lower()):
                out[row, int(hashlib.md5(word.encode()).hexdigest(), 16) % self.dimension] += 1.0
            norm = np.linalg.norm(out[row])
            if norm:
                out[row] /= norm
            else:
                out[row, 0] = 1.0  # cosine is undefined for the zero vector
        return out

    def embed_query(self, text: str) -> np.ndarray:
        return self.embed_documents([text])[0]
