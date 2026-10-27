"""The Library's publication workflow: review, confirm, build, verify, activate (SDD §6.1 to §6.3).

    publisher = Publisher(versions)
    outcome = publisher.publish(pdf_paths)                       # rejected files? -> status "needs_confirmation", nothing changes
    outcome = publisher.publish(pdf_paths, confirm_rejects=True) # the user reviewed the rejects: publish the valid remainder

One job runs at a time (SDD §6.2): a second call while one is running returns
`status="busy"` at once. A failed or refused publication never changes the
active version. A successful one writes the import report next to the catalog
(`<root>/reports/<version>.json`), re-reads the new version from the store to
check its integrity, and keeps reports only for the versions still retained.
"""

from __future__ import annotations

import threading
import time
from collections.abc import Sequence
from dataclasses import asdict, dataclass
from pathlib import Path

from .corpus import CorpusReview, ingest_corpus
from .versions import CollectionVersion, CollectionVersions, IntegrityReport, PublishError

PUBLISHED = "published"
NEEDS_CONFIRMATION = "needs_confirmation"
NOTHING_TO_PUBLISH = "nothing_to_publish"
BUSY = "busy"
FAILED = "failed"


@dataclass
class PublicationOutcome:
    status: str
    review: CorpusReview | None = None
    version: CollectionVersion | None = None
    integrity: IntegrityReport | None = None
    message: str = ""
    elapsed_s: float = 0.0

    @property
    def published(self) -> bool:
        return self.status == PUBLISHED

    def to_dict(self) -> dict:
        """The wire form for the host: review lines, the new version and its integrity check. No chunk text."""
        return {
            "status": self.status,
            "message": self.message,
            "elapsed_s": self.elapsed_s,
            "review": self.review.to_dict() if self.review else None,
            "version": self.version.summary() if self.version else None,
            "integrity": asdict(self.integrity) if self.integrity else None,
        }


class Publisher:
    def __init__(self, versions: CollectionVersions) -> None:
        self.versions = versions
        self._job = threading.RLock()

    @property
    def reports_dir(self) -> Path:
        return self.versions.root / "reports"

    def review(self, paths: Sequence[str | Path]) -> CorpusReview:
        """Validate and chunk the files without changing any collection (SDD §6.1)."""
        return ingest_corpus(paths)

    def publish(self, paths: Sequence[str | Path], *, confirm_rejects: bool = False,
                smoke_query: str | None = None) -> PublicationOutcome:
        # Reserve the job before reviewing files. The nested publish_review call
        # shares this reservation; another thread must return busy immediately.
        if not self._job.acquire(blocking=False):
            return PublicationOutcome(BUSY, message="Another publication is still running. Wait for it to finish.")
        try:
            return self.publish_review(self.review(paths), confirm_rejects=confirm_rejects, smoke_query=smoke_query)
        finally:
            self._job.release()

    def publish_review(self, review: CorpusReview, *, confirm_rejects: bool = False,
                       smoke_query: str | None = None) -> PublicationOutcome:
        """Publish an already-computed review (e.g. from a browser upload). One job at a time."""
        if not self._job.acquire(blocking=False):
            return PublicationOutcome(BUSY, message="Another publication is still running. Wait for it to finish.")
        started = time.perf_counter()
        try:
            if not review.accepted:
                return PublicationOutcome(NOTHING_TO_PUBLISH, review, message="None of the files can be published. "
                                          "Review the rejection reasons and choose different files.")
            if review.rejected and not confirm_rejects:
                return PublicationOutcome(NEEDS_CONFIRMATION, review, message=(
                    f"{len(review.rejected)} of {len(review.files)} files were rejected. "
                    "Confirm to publish the valid remainder, or choose different files."))
            try:
                version = self.versions.publish(review.chunks, review.documents, smoke_query=smoke_query,
                                                sources=review.source_paths, append=True)
            except PublishError as exc:
                return PublicationOutcome(FAILED, review, message=f"{exc}. The active collection is unchanged.")
            integrity = self.versions.check_integrity(version)
            self._write_report(version, review)
            return PublicationOutcome(PUBLISHED, review, version, integrity,
                                      elapsed_s=round(time.perf_counter() - started, 2))
        finally:
            self._job.release()

    def delete_document(self, version_id: str, document_id: str, *, confirmed: bool = False) -> CollectionVersion:
        """Delete a reviewed document and obsolete reports via Library-owned operations."""
        version = self.versions.delete_document(version_id, document_id, confirmed=confirmed)
        self.prune_reports()
        return version

    def rollback(self) -> CollectionVersion:
        """Make the rollback version active again (SDD §6.3)."""
        return self.versions.rollback()

    def _write_report(self, version: CollectionVersion, review: CorpusReview) -> None:
        self.reports_dir.mkdir(parents=True, exist_ok=True)
        review.write_report(self.reports_dir / f"{version.version_id}.json")
        self.prune_reports()

    def prune_reports(self) -> None:
        keep = {f"{v.version_id}.json" for v in self.versions.versions()}
        for stale in self.reports_dir.glob("v*.json"):
            if stale.name not in keep:
                stale.unlink()
