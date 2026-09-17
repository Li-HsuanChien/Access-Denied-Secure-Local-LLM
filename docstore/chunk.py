"""Provisional Chunk shape shared by every DocumentStore.

The canonical Chunk schema is still being defined by another workstream. Keep
all knowledge of the field layout in this file so that when the schema lands,
only `Chunk`, `to_metadata` and `from_metadata` need to change; the stores
themselves never touch individual fields.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from typing import Any


@dataclass
class Chunk:
    id: str
    text: str
    source: str  # document path or URI the chunk was cut from
    page: int | None = None
    offsets: tuple[int, int] | None = None  # (start_char, end_char) within the source
    checksum: str | None = None  # sha256 of `text`; filled in automatically if omitted
    extra: dict[str, Any] = field(default_factory=dict)  # anything not yet in the schema

    def __post_init__(self) -> None:
        if self.checksum is None:
            self.checksum = sha256_text(self.text)
        if self.offsets is not None:
            self.offsets = (int(self.offsets[0]), int(self.offsets[1]))

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Chunk:
        """Build a Chunk from a loosely shaped dict; unknown keys go to `extra`."""
        known = {"id", "text", "source", "page", "offsets", "checksum", "extra"}
        extra = dict(data.get("extra") or {})
        extra.update({k: v for k, v in data.items() if k not in known})
        offsets = data.get("offsets")
        return cls(
            id=str(data["id"]),
            text=data["text"],
            source=data.get("source", "unknown"),
            page=data.get("page"),
            offsets=tuple(offsets) if offsets is not None else None,
            checksum=data.get("checksum"),
            extra=extra,
        )

    def to_metadata(self) -> dict[str, str | int | None]:
        """Flatten trace fields into scalar key/values that both Chroma and Qdrant accept.

        Every key is always present, with None for unset fields. Chroma's upsert
        merges metadata, and an explicit None is what removes a stale key when a
        chunk is re-written, for example a page number or marking that no longer applies.
        """
        start, end = self.offsets if self.offsets is not None else (None, None)
        return {
            "chunk_id": self.id,
            "source": self.source,
            "checksum": self.checksum,
            "page": self.page,
            "offset_start": start,
            "offset_end": end,
            "extra_json": json.dumps(self.extra, sort_keys=True) if self.extra else None,
        }

    @classmethod
    def from_metadata(cls, text: str, meta: dict[str, Any]) -> Chunk:
        """Inverse of `to_metadata`. Missing and None-valued keys are treated the same."""
        offsets = None
        if meta.get("offset_start") is not None and meta.get("offset_end") is not None:
            offsets = (meta["offset_start"], meta["offset_end"])
        return cls(
            id=meta["chunk_id"],
            text=text,
            source=meta["source"],
            page=meta.get("page"),
            offsets=offsets,
            checksum=meta.get("checksum"),
            extra=json.loads(meta["extra_json"]) if meta.get("extra_json") else {},
        )


@dataclass
class SearchResult:
    chunk: Chunk  # full chunk, including source trace metadata
    score: float  # cosine similarity, higher is more relevant (same scale for every store)
    rank: int  # 1-based position in the result list


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()
