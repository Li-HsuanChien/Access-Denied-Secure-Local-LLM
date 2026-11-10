"""Library adapter for ingestion's prepare -> commit -> verified-run handoff.

Only this adapter handles ingestion types. Reviews expose library-owned records;
indexing receives records read from a verified sealed run, never a partial build.
"""
from __future__ import annotations

import importlib
import shutil
import sys
from collections.abc import Iterable
from pathlib import Path

from ..paths import REPO_ROOT
from .chunk import Chunk
from .corpus import CorpusReview, FileReview, IngestionUnavailable, SourceText


def _pipeline():
    if str(REPO_ROOT) not in sys.path:
        sys.path.insert(0, str(REPO_ROOT))
    try:
        return importlib.import_module("ingestion.src.pipeline")
    except ModuleNotFoundError as exc:
        raise IngestionUnavailable(f"Ingestion needs the bundled dependency {exc.name!r}.") from exc


class ImportFailure(RuntimeError):
    """Sanitized library error; parser details and local paths stay private."""

    def __init__(self, code: str):
        self.code = code
        super().__init__({
            "insufficient_disk_space": "Not enough free disk space. Free some space and retry.",
            "staging_failed": "The import working folder could not be written. Check available storage and retry.",
            "ingest_busy": "Another import is still open. Finish or discard it before retrying.",
            "integrity_mismatch": "The prepared import failed verification. Select the PDFs again.",
            "run_not_complete": "The prepared import is incomplete. Select the PDFs again.",
        }.get(code, "The import could not finish. Select the PDFs and try again."))


class ImportReview:
    """One prepared import, retained until publication succeeds or it is discarded."""

    def __init__(self, paths: Iterable[str | Path], root: Path):
        self._pipeline = _pipeline()
        try:
            self._attempt = self._pipeline.prepare(paths, root)
        except self._pipeline.IngestError as exc:
            raise ImportFailure(exc.code) from None
        self._run_path: Path | None = None
        self._closed = False
        self.files = []
        originals = {c.checksum_sha256: c for c in self._attempt.candidates if c.disposition != "duplicate"}
        for candidate in self._attempt.candidates:
            result = originals[candidate.checksum_sha256] if candidate.disposition == "duplicate" else candidate
            self.files.append(FileReview(
                filename=candidate.source_filename, outcome=result.disposition,
                reject_reason=result.reject_reason, reject_detail=result.reject_detail,
                warnings=list(result.warnings), checksum_sha256=candidate.checksum_sha256 or "",
                byte_size=candidate.byte_size or 0, document_id=result.document_id,
                pages=result.page_count or 0, chunks=result.chunk_count or 0,
            ))

    @property
    def accepted(self) -> list[FileReview]:
        return [f for f in self.files if not f.rejected and f.document_id is not None]

    @property
    def rejected(self) -> list[FileReview]:
        return [f for f in self.files if f.rejected]

    @property
    def warned(self) -> list[FileReview]:
        return [f for f in self.files if f.warnings]

    def to_dict(self) -> dict:
        return {"files": [f.__dict__ for f in self.files],
                "requires_confirmation": self._attempt.requires_confirmation}

    def load(self, *, confirmed: bool = False, keep_text: bool = False) -> CorpusReview:
        """Seal once, then re-verify on every use, including indexing retries."""
        try:
            return self._load(confirmed=confirmed, keep_text=keep_text)
        except self._pipeline.IngestError as exc:
            raise ImportFailure(exc.code) from None

    def _load(self, *, confirmed: bool, keep_text: bool) -> CorpusReview:
        if self._closed:
            raise ValueError("This import was discarded or already published")
        if self._run_path is None:
            run = self._pipeline.commit(
                self._attempt,
                acknowledge_rejections=self._attempt.confirmation_token if confirmed else None,
            )
            self._run_path = run.path
        run = self._pipeline.load_run(self._run_path)
        manifest = run.manifest
        sources = {}
        if keep_text:
            # Benchmark-only canonical text inspection of the verified source;
            # import validation, extraction and chunking already ran in prepare().
            from ingestion.src.ingest import extract
            for document in run.documents:
                doc_id = document["document_id"]
                text, pages, pdf = extract(run.source_path(doc_id),
                    sort=manifest["chunker"]["sorted_reading_order"],
                    strip_boilerplate=manifest["chunker"]["strip_running_headers"])
                try:
                    sources[doc_id] = SourceText(text, [(p.char_start, p.char_end) for p in pages])
                finally:
                    pdf.close()
        return CorpusReview(
            files=self.files,
            chunks=[Chunk.from_dict(c) for c in run.iter_chunks()],
            documents=run.documents, sources=sources,
            chunker_config_id=manifest["chunker"]["config_id"],
            chunker_version=manifest["chunker"]["chunker_version"],
            validator_version=manifest["validator_version"], extractor=manifest["extractor"],
            elapsed_s=sum(p["seconds"] for p in self._attempt.phases),
            source_paths={d["document_id"]: run.source_path(d["document_id"]) for d in run.documents},
            ingestion={"run_id": run.run_id, "manifest_sha256": manifest["seal"]["manifest_sha256"],
                       "manifest": manifest},
        )

    def discard(self) -> None:
        if self._closed:
            return
        self._pipeline.discard(self._attempt)
        if self._run_path is not None:
            self._pipeline.prune(self._attempt.root, keep=[])
        self._closed = True


def recover_imports(root: Path) -> None:
    """Import work is transient; durable published sources live in the library.

    Ingestion recovers interrupted attempts and quarantines damaged runs first.
    Abandoned sealed runs and their quarantine copies are then removed so a
    restart cannot retain unreferenced PDFs or resurrect deleted documents.
    """
    pipeline = _pipeline()
    pipeline.recover(root)
    pipeline.prune(root, keep=[])
    shutil.rmtree(root / "quarantine", ignore_errors=True)
