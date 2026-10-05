"""One-time, online step: download all-MiniLM-L6-v2 into models/ for offline use.

Run on a connected machine, then copy the models/ directory to the air-gapped host.
"""

from secure_qa.paths import MODELS_DIR

from sentence_transformers import SentenceTransformer

MODEL_ID = "sentence-transformers/all-MiniLM-L6-v2"
TARGET = MODELS_DIR / "all-MiniLM-L6-v2"

if __name__ == "__main__":
    SentenceTransformer(MODEL_ID, device="cpu").save(str(TARGET))
    print(f"Saved {MODEL_ID} to {TARGET}")
