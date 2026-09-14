"""
E2 ingestion schemas, version 1.0.0.

These dataclasses are the source of truth. The JSON Schema files in schemas/
describe the same objects for consumers outside Python (E3's index adapter, E4's
mock contracts); tests/test_conformance.py asserts the two cannot drift.

Identity rules, which the Week 3 criterion "same file/config yields same IDs"
depends on:

  document_id = doc_ + sha256(file bytes)[:24]
      Content-addressed. The same PDF imported twice under different filenames
      is the same document, and a re-import after a byte change is a new one.

  chunk_id    = chk_ + sha256(document_id | chunker_config_id | start | end)[:24]
      A pure function of content and configuration. Not of insertion order, not
      of wall-clock time, not a UUID. Reindexing the same file with the same
      config reproduces every ID exactly, which is what lets a citation stored
      in conversation history still resolve after a collection is republished
      (SDD 5.1: "historical conversations retain their original collection
      version"). Changing chunk size or overlap changes every ID, which is
      correct: the boundaries moved, so they are different chunks.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field, asdict
from typing import Any

SCHEMA_VERSION = '1.0.0'


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _sid(*parts: Any, prefix: str, length: int = 24) -> str:
    joined = '|'.join(str(p) for p in parts).encode('utf-8')
    return f'{prefix}_{hashlib.sha256(joined).hexdigest()[:length]}'


# ---------------------------------------------------------------------------
# chunker configuration
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class ChunkerConfig:
    """Chunking parameters. Its hash participates in every chunk ID."""
    target_chars: int = 1200
    overlap_chars: int = 200
    min_chunk_chars: int = 100
    split_on_word_boundary: bool = True
    chunker_version: str = 'refchunk-1.0.0'

    @property
    def config_id(self) -> str:
        canonical = json.dumps(asdict(self), sort_keys=True, separators=(',', ':'))
        return _sid(canonical, prefix='cfg', length=12)

    def to_dict(self) -> dict:
        d = asdict(self)
        d['config_id'] = self.config_id
        return d


# ---------------------------------------------------------------------------
# document
# ---------------------------------------------------------------------------
@dataclass
class Document:
    """One imported PDF. Fields follow SDD 5.1 'Document'."""
    document_id: str
    checksum_sha256: str
    source_filename: str
    display_title: str
    page_count: int
    byte_size: int
    pdf_version: str | None
    extractor: str
    import_warnings: list[dict] = field(default_factory=list)

    @staticmethod
    def make_id(file_bytes: bytes) -> str:
        return _sid(_sha256(file_bytes), prefix='doc')

    def to_dict(self) -> dict:
        return {'schema_version': SCHEMA_VERSION, **asdict(self)}


# ---------------------------------------------------------------------------
# chunk
# ---------------------------------------------------------------------------
@dataclass
class PageSpan:
    """
    The portion of a chunk that lives on one page.

    A chunk is NOT confined to a single page, so provenance is a list of these
    rather than one page number. See WALKTHROUGH.md: on the NRC baseline
    fixture, which averages 775 characters per page, a 1,200-character chunk
    spans two to three pages, and a single page_number field would make its
    citation point at the wrong page.
    """
    page_number: int                 # 1-based, as a reader would cite it
    char_start: int                  # offset into the document text stream
    char_end: int
    page_char_start: int             # offset within this page's own text
    page_char_end: int
    highlight_rects: list[list[float]]   # [[x0,y0,x1,y1], ...] PDF points, top-left origin
    coordinates_reliable: bool
    page_width: float
    page_height: float


@dataclass
class Chunk:
    """One retrievable unit. Fields follow SDD 5.1 'Chunk', extended for citations."""
    chunk_id: str
    document_id: str
    ordinal: int                     # 0-based order within the document
    text: str
    text_checksum_sha256: str
    char_start: int                  # offsets into the document text stream
    char_end: int
    page_start: int                  # 1-based, inclusive
    page_end: int                    # 1-based, inclusive
    page_spans: list[PageSpan]
    token_estimate: int              # heuristic, chars/4; for E3 context budgeting only
    chunker_config_id: str
    chunker_version: str

    @staticmethod
    def make_id(document_id: str, chunker_config_id: str, start: int, end: int) -> str:
        return _sid(document_id, chunker_config_id, start, end, prefix='chk')

    @property
    def spans_pages(self) -> bool:
        return self.page_end > self.page_start

    def to_dict(self, include_text: bool = True) -> dict:
        d = asdict(self)
        d = {'schema_version': SCHEMA_VERSION, **d}
        if not include_text:
            d.pop('text')
        return d


# ---------------------------------------------------------------------------
# citation target
# ---------------------------------------------------------------------------
@dataclass
class CitationTarget:
    """
    What E2 hands E3 so a citation can be rendered without reopening the source.

    SDD 7.3 requires a citation to identify document and page, expand into a
    rendering of that page, and highlight the supporting passage where reliable
    coordinates exist. That is satisfiable from a chunk's page_spans alone,
    which is the contract this type makes explicit.
    """
    document_id: str
    chunk_id: str
    page_number: int
    highlight_rects: list[list[float]]
    coordinates_reliable: bool
    page_width: float
    page_height: float
    quoted_text: str

    def to_dict(self) -> dict:
        return {'schema_version': SCHEMA_VERSION, **asdict(self)}


def citation_targets(chunk: Chunk) -> list[CitationTarget]:
    """Expand a chunk into one citation target per page it touches."""
    out = []
    for span in chunk.page_spans:
        local = chunk.text[span.char_start - chunk.char_start: span.char_end - chunk.char_start]
        out.append(CitationTarget(
            document_id=chunk.document_id,
            chunk_id=chunk.chunk_id,
            page_number=span.page_number,
            highlight_rects=span.highlight_rects,
            coordinates_reliable=span.coordinates_reliable,
            page_width=span.page_width,
            page_height=span.page_height,
            quoted_text=local.strip(),
        ))
    return out


def text_checksum(text: str) -> str:
    return _sha256(text.encode('utf-8'))
