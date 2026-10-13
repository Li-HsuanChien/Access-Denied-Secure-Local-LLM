"""Review PDFs and publish only the explicitly accepted remainder."""

from __future__ import annotations

import base64
import hashlib
import threading
import uuid
from dataclasses import dataclass

from .chunk import PageSpan
from .synthetic import ChunkerConfig, SyntheticDocument, chunk_document
from .versions import CollectionVersions

MAX_FILE_BYTES = 100 * 1024 * 1024
MAX_REVIEW_BYTES = 100 * 1024 * 1024


@dataclass
class Review:
    accepted: list[dict]
    rejected: list[dict]


def _extract_pdf(data: bytes) -> list[tuple[str, float, float]]:
    try:
        import fitz
    except ImportError as exc:
        raise ValueError("The local PDF reader isn't installed. Ask the administrator to repair this offline bundle.") from exc
    try:
        document = fitz.open(stream=data, filetype="pdf")
        if getattr(document, "is_repaired", False):
            raise ValueError("The PDF has structural damage and was rejected as corrupt.")
        if document.needs_pass:
            raise ValueError("Password-protected PDFs aren't supported.")
        pages = [(page.get_text("text").strip(), page.rect.width, page.rect.height) for page in document]
        document.close()
        return pages
    except ValueError:
        raise
    except Exception as exc:
        raise ValueError("The PDF is unreadable or corrupt.") from exc


class CollectionLibrary:
    """Hides PDF validation, review state, chunking and atomic activation."""

    def __init__(self, versions: CollectionVersions, extract=_extract_pdf):
        self.versions = versions
        self.extract = extract
        self._reviews: dict[str, Review] = {}
        self._jobs: dict[str, dict] = {}
        self._lock = threading.Lock()
        self._publication_lock = threading.Lock()

    def review(self, files: list[dict]) -> dict:
        # One local user and one in-progress import: discard the prior draft when a fresh review begins.
        self._reviews.clear()
        accepted, rejected = [], []
        names: set[str] = set()
        total_bytes = 0
        for item in files:
            name = str(item.get("name", "document")) if isinstance(item, dict) else "document"
            try:
                if not isinstance(item, dict):
                    raise ValueError("The selected file entry is invalid.")
                data = item.get("data")
                if not isinstance(data, bytes):
                    data = base64.b64decode(data, validate=True)
                if name in names:
                    raise ValueError("A file with this name was already selected.")
                names.add(name)
                if not name.lower().endswith(".pdf") or not data.startswith(b"%PDF-"):
                    raise ValueError("Only valid PDF files are accepted.")
                if not data or len(data) > MAX_FILE_BYTES:
                    raise ValueError("The PDF is empty or larger than 100 MiB.")
                if total_bytes + len(data) > MAX_REVIEW_BYTES:
                    raise ValueError("Selected PDFs together exceed the 100 MiB review limit.")
                pages = self.extract(data)
                if not pages or not any(text for text, _, _ in pages):
                    raise ValueError("This PDF has no extractable text; scanned-only files aren't supported.")
                accepted.append({"name": name, "data": data, "pages": pages, "size": len(data)})
                total_bytes += len(data)
            except Exception as exc:
                rejected.append({"name": name, "reason": str(exc)})
        review_id = uuid.uuid4().hex
        self._reviews[review_id] = Review(accepted, rejected)
        return {"review_id": review_id, "accepted": [{"name": f["name"], "size": f["size"]} for f in accepted],
                "rejected": rejected, "requires_confirmation": bool(rejected),
                "warning": "Rejected files will not be imported." if rejected else None}

    def publish(self, review_id: str, *, confirmed: bool, request_id: str) -> dict:
        review = self._reviews.get(review_id)
        if review is None:
            raise LookupError("The review expired. Select the PDFs again.")
        if review.rejected and not confirmed:
            raise ValueError("Review and confirm rejected files before publishing the accepted remainder.")
        if not review.accepted:
            raise ValueError("There are no accepted PDFs to publish.")
        if not self._publication_lock.acquire(blocking=False):
            raise RuntimeError("A collection publication is already running.")
        cancelled = threading.Event()
        job = {"status": "running", "stage": "preparing", "done": 0, "total": len(review.accepted), "cancel": cancelled}
        with self._lock:
            self._jobs[request_id] = job
        try:
            docs, chunks, source_by_document = [], [], {}
            for index, file in enumerate(review.accepted, 1):
                if cancelled.is_set():
                    raise RuntimeError("Publication cancelled; the active collection is unchanged.")
                pages = [page[0] for page in file["pages"]]
                doc = SyntheticDocument.from_pages(file["name"], pages)
                file_hash = hashlib.sha256(file["data"]).hexdigest()
                doc.document_id = "doc_" + hashlib.sha256(file_hash.encode()).hexdigest()[:24]
                docs.append(doc.metadata())
                source_by_document[doc.document_id] = file
                chunks.extend(chunk_document(doc, ChunkerConfig()))
                job.update(stage="extracting", done=index)
            if not chunks:
                raise ValueError("The accepted PDFs contain no text to index.")
            for chunk in chunks:
                source = source_by_document[chunk.document_id]
                rebuilt = []
                # Attach source page dimensions while retaining text-only spans when extraction has no geometry.
                for span in chunk.page_spans:
                    _, width, height = source["pages"][span.page_number - 1]
                    rebuilt.append(PageSpan(span.page_number, span.char_start, span.char_end, span.page_char_start,
                                            span.page_char_end, [], False, width, height))
                chunk.page_spans = rebuilt
            version = self.versions.publish(chunks, docs,
                source_files={document_id: item["data"] for document_id, item in source_by_document.items()},
                cancelled=cancelled.is_set,
                progress=lambda stage, done, total: job.update(stage=stage, done=done, total=total))
            job.update(status="complete", version_id=version.version_id)
            self._reviews.pop(review_id, None)
            return {"version_id": version.version_id, "document_count": len(version.documents), "chunk_count": version.chunk_count}
        except Exception as exc:
            was_cancelled = cancelled.is_set() or "cancelled" in str(exc).lower()
            job.update(status="cancelled" if was_cancelled else "failed",
                       error="Publication cancelled; the active collection is unchanged." if was_cancelled else
                       "The candidate could not be published; the active collection is unchanged.")
            raise
        finally:
            self._publication_lock.release()

    def cancel(self, request_id: str) -> bool:
        job = self._jobs.get(request_id)
        if not job or job["status"] != "running" or job.get("stage") == "activating":
            return False
        job["cancel"].set()
        return True

    def status(self, request_id: str) -> dict | None:
        job = self._jobs.get(request_id)
        return {k: v for k, v in job.items() if k != "cancel"} if job else None

    def versions_list(self) -> dict:
        versions = self.versions.versions()
        return {"active": self.versions.active().version_id if self.versions.active() else None,
                "versions": [{"version_id": v.version_id, "status": v.status, "created_at": v.created_at,
                              "document_count": len(v.documents), "chunk_count": v.chunk_count} for v in versions]}

    def rollback(self) -> dict:
        version = self.versions.rollback()
        return {"version_id": version.version_id}
