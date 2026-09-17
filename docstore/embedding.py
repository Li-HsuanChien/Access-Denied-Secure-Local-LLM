"""Sentence-transformers embedder shared by every store, so comparisons use identical vectors."""

from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path

import numpy as np

DEFAULT_MODEL_PATH = Path(__file__).resolve().parent.parent / "models" / "all-MiniLM-L6-v2"


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
