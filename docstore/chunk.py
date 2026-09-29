"""Chunk types for the document store, mirroring E2's ingestion schema v1.0.0.

E2 owns the Chunk schema (`ingestion/src/schema.py` and
`ingestion/schemas/chunk.schema.json` on branch `E2-Chunking`). The dataclasses
here copy its field names and meanings exactly, so `Chunk.from_dict` accepts
E2's `Chunk.to_dict()` output unchanged, and `tests/test_docstore.py`
validates `Chunk.to_dict()` against a vendored copy of E2's JSON Schema.
Replace this mirror with an import once E2's package is merged.

Keep all knowledge of the field layout in this file. Stores only call
`to_metadata` and `from_metadata`, so a schema change touches nothing else.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass, field
from typing import Any

SCHEMA_VERSION = "1.0.0"


@dataclass
class PageSpan:
    """The part of a chunk on one page, with what a citation needs to highlight it."""

    page_number: int  # 1-based
    char_start: int  # offset into the document text stream
    char_end: int
    page_char_start: int  # offset within this page's own text
    page_char_end: int
    highlight_rects: list[list[float]]  # [[x0, y0, x1, y1], ...] in PDF points, top-left origin
    coordinates_reliable: bool
    page_width: float
    page_height: float


@dataclass
class Chunk:
    """One retrievable unit. Field names and meanings match E2's schema v1.0.0."""

    chunk_id: str
    document_id: str
    ordinal: int  # 0-based order within the document
    text: str
    text_checksum_sha256: str
    char_start: int  # offsets into the document text stream
    char_end: int
    page_start: int  # 1-based, inclusive
    page_end: int  # 1-based, inclusive
    page_spans: list[PageSpan]
    token_estimate: int
    chunker_config_id: str
    chunker_version: str

    def __post_init__(self) -> None:
        self.page_spans = [s if isinstance(s, PageSpan) else PageSpan(**s) for s in self.page_spans]

    @property
    def checksum_ok(self) -> bool:
        return text_checksum(self.text) == self.text_checksum_sha256

    def to_dict(self) -> dict[str, Any]:
        return {"schema_version": SCHEMA_VERSION, **asdict(self)}

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Chunk:
        """Build a Chunk from E2's `Chunk.to_dict()` output (or a line of E2 JSONL)."""
        version = data.get("schema_version", SCHEMA_VERSION)
        if version != SCHEMA_VERSION:
            raise ValueError(f"Unsupported chunk schema_version {version!r} (expected {SCHEMA_VERSION})")
        fields = {k: v for k, v in data.items() if k not in ("schema_version", "embedding")}
        return cls(**fields)

    def to_metadata(self) -> dict[str, str | int]:
        """Flatten the chunk (minus `text`) into scalar key/values that Chroma accepts.

        Chroma metadata values must be scalars, so `page_spans` is stored as JSON.
        Every key is always present: Chroma's upsert merges metadata, so a key
        missing from a re-write would keep its old value.
        """
        meta = asdict(self)
        del meta["text"]
        meta["page_spans"] = json.dumps(meta["page_spans"], separators=(",", ":"))
        meta["schema_version"] = SCHEMA_VERSION
        return meta

    @classmethod
    def from_metadata(cls, text: str, meta: dict[str, Any]) -> Chunk:
        """Inverse of `to_metadata`."""
        fields = {k: v for k, v in meta.items() if k != "schema_version"}
        fields["page_spans"] = json.loads(fields["page_spans"])
        return cls(text=text, **fields)


@dataclass
class SearchResult:
    chunk: Chunk  # the full chunk as indexed, including its source trace fields
    score: float  # cosine similarity; higher is more relevant
    rank: int  # 1-based position in the result list

    @property
    def pages(self) -> list[int]:
        return [s.page_number for s in self.chunk.page_spans]


@dataclass
class IndexResult:
    collection: str
    indexed: int  # chunks written by this call
    total: int  # chunks in the collection afterwards
    embedding_model: str
    embedding_dim: int
    chunk_ids: list[str] = field(default_factory=list)


def text_checksum(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()
