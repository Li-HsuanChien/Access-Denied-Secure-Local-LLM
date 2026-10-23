"""Corpus ingestion for the Library: PDFs in, a review and publishable chunks out (SDD §6.1, §6.2).

This is the consumer side of E2's ingestion seam. It calls E2's `validate()` and
`chunks()` (`ingestion/src/ingest.py`), turns the results into this module's own
records, and never lets a rejected file through silently: every file lands in
the review as accepted, accepted with warnings, or rejected with a reason.

    review = ingest_corpus(["a.pdf", "b.pdf"])
    review.accepted, review.rejected          # what the review screen lists
    review.manifest_sha256                    # same inputs and chunker -> same checksum
    versions.publish(review.chunks, review.documents)

E2's package sits at `<repo>/ingestion/` and isn't installed as a distribution,
so it is imported by path. Only this file knows that; the rest of the Library
sees `Chunk` and plain dicts. PyMuPDF (E2's extractor) is a build-machine
dependency of this step, not a runtime network dependency.
"""

from __future__ import annotations

import hashlib
import importlib
import json
import sys
import time
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from pathlib import Path

from ..paths import REPO_ROOT
from .chunk import Chunk


@dataclass
class FileReview:
    """One file's line on the review screen."""

    filename: str
    outcome: str  # accepted | accepted_with_warnings | rejected
    reject_reason: str | None = None
    reject_detail: str | None = None
    warnings: list[dict] = field(default_factory=list)
    checksum_sha256: str = ""
    byte_size: int = 0
    document_id: str | None = None
    pages: int = 0
    chunks: int = 0

    @property
    def rejected(self) -> bool:
        return self.outcome == "rejected"


@dataclass
class SourceText:
    """A document's canonical text stream and page boundaries: what citations are offsets into."""

    text: str
    page_bounds: list[tuple[int, int]]  # (char_start, char_end) per page; page n is index n-1


@dataclass
class CorpusReview:
    files: list[FileReview]
    chunks: list[Chunk]
    documents: list[dict]  # E2 Document records for accepted files
    sources: dict[str, SourceText]  # document_id -> text stream; empty unless `keep_text` was set
    chunker_config_id: str
    chunker_version: str
    validator_version: str
    extractor: str
    elapsed_s: float
    source_paths: dict[str, Path] = field(default_factory=dict)  # document_id -> original PDF path, for source caching (ADR 0006)

    @property
    def accepted(self) -> list[FileReview]:
        return [f for f in self.files if not f.rejected]

    @property
    def rejected(self) -> list[FileReview]:
        return [f for f in self.files if f.rejected]

    @property
    def warned(self) -> list[FileReview]:
        return [f for f in self.files if f.outcome == "accepted_with_warnings"]

    @property
    def manifest_sha256(self) -> str:
        """Checksum over the accepted documents and their chunks. Rerunning the same ingest gives the same value."""
        lines = [f"{d['document_id']} {d['checksum_sha256']}" for d in sorted(self.documents, key=lambda d: d["document_id"])]
        lines += [f"{c.chunk_id} {c.text_checksum_sha256}" for c in sorted(self.chunks, key=lambda c: c.chunk_id)]
        return hashlib.sha256("\n".join(lines).encode("utf-8")).hexdigest()

    def summary(self) -> dict:
        return {
            "files": len(self.files),
            "accepted": len(self.accepted),
            "accepted_with_warnings": len(self.warned),
            "rejected": len(self.rejected),
            "pages": sum(f.pages for f in self.accepted),
            "chunks": len(self.chunks),
            "manifest_sha256": self.manifest_sha256,
        }

    def to_dict(self) -> dict:
        """The import report written next to a published version (SDD §6.2)."""
        return {
            "schema": "secure-qa-import-report/1",
            "summary": self.summary(),
            "chunker": {"config_id": self.chunker_config_id, "version": self.chunker_version},
            "validator": self.validator_version,
            "extractor": self.extractor,
            "files": [f.__dict__ for f in self.files],
        }

    def write_report(self, path: str | Path) -> None:
        Path(path).write_text(json.dumps(self.to_dict(), indent=2, sort_keys=True), encoding="utf-8")


class IngestionUnavailable(RuntimeError):
    """E2's ingestion package or its PDF library can't be loaded."""


def _load_ingestion():
    if str(REPO_ROOT) not in sys.path:
        sys.path.insert(0, str(REPO_ROOT))
    try:
        return importlib.import_module("ingestion.src.ingest"), importlib.import_module("ingestion.src.schema")
    except ModuleNotFoundError as exc:
        raise IngestionUnavailable(
            f"Ingestion needs {exc.name!r}. From the repository root: .venv/bin/pip install pymupdf==1.28.2"
        ) from exc


def ingest_corpus(paths: Iterable[str | Path], *, keep_text: bool = False) -> CorpusReview:
    """Validate and chunk each PDF with E2's reference implementation.

    Files are processed in sorted filename order, so the same set of files gives
    the same chunk list and manifest checksum. A rejected file produces no
    chunks. With `keep_text`, the text streams are kept for resolving citations
    exactly (used by tests and the golden runner, not by publication).
    """
    started = time.perf_counter()
    ingest, schema = _load_ingestion()
    config = schema.ChunkerConfig()
    files: list[FileReview] = []
    chunks: list[Chunk] = []
    documents: list[dict] = []
    sources: dict[str, SourceText] = {}
    source_paths: dict[str, Path] = {}
    validator = extractor = ""

    for path in sorted((Path(p) for p in paths), key=lambda p: (p.name, str(p))):
        result = ingest.validate(path)
        validator, extractor = result.validator_version, result.extractor
        review = FileReview(
            filename=path.name,
            outcome=result.outcome.value,
            reject_reason=result.reject_reason.value if result.reject_reason else None,
            reject_detail=result.reject_detail,
            warnings=list(result.warnings),
            checksum_sha256=result.checksum_sha256,
            byte_size=result.byte_size,
        )
        files.append(review)
        if review.rejected or result.document is None:
            continue
        document = result.document
        review.document_id = document["document_id"]
        review.pages = document["page_count"]
        file_chunks = [Chunk.from_dict(c.to_dict()) for c in ingest.chunks(path, config, document["document_id"])]
        review.chunks = len(file_chunks)
        documents.append(document)
        source_paths[document["document_id"]] = path
        chunks += file_chunks
        if keep_text:
            text, pages, pdf = ingest.extract(path, sort=config.sorted_reading_order, strip_boilerplate=config.strip_running_headers)
            pdf.close()
            sources[document["document_id"]] = SourceText(text, [(p.char_start, p.char_end) for p in pages])

    return CorpusReview(
        files=files,
        chunks=chunks,
        documents=documents,
        sources=sources,
        chunker_config_id=config.config_id,
        chunker_version=config.chunker_version,
        validator_version=validator,
        extractor=extractor,
        elapsed_s=round(time.perf_counter() - started, 2),
        source_paths=source_paths,
    )


def pdfs_in(folder: str | Path) -> Sequence[Path]:
    """Every `.pdf` under `folder`, sorted. Other file types are not offered for review."""
    return sorted(p for p in Path(folder).rglob("*") if p.is_file() and p.suffix.lower() == ".pdf")
