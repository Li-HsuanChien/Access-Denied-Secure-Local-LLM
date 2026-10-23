"""Versioned collections with an atomic active-version pointer and rollback (SDD §4.1, §6.3).

Every published version is its own Chroma collection inside one on-disk Chroma
directory (`<root>/chroma`). That directory is ours alone, separate from Open
WebUI's `DATA_DIR/vector_db`. A small JSON catalog (`<root>/catalog.json`) records
which version is active and which is the rollback version, plus each version's
document manifest, embedding model, chunker configs and integrity checksum.

Publication builds and verifies a candidate collection first. The active version
changes only when the catalog is atomically replaced (write a temp file, fsync,
`os.replace`), so a failed or interrupted publication never changes what
questions are answered from. Only the active and the immediately previous
versions are kept; anything else in the Chroma directory is removed on open.

This covers the store side of the Collection Library. PDF validation, review and
progress reporting sit above it and are not here yet.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import threading
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from .chroma_store import ChromaStore, open_client
from .chunk import Chunk
from .embedding import Embedder

CATALOG_SCHEMA = "secure-qa-collections/1"
COLLECTION_PREFIX = "secure_qa_"
SOURCES_DIR = "sources"  # <root>/sources/<version_id>/<document_id>.pdf — cached originals for citation viewing (ADR 0006)


class PublishError(RuntimeError):
    """A candidate collection failed to build or verify. The active version is unchanged."""


@dataclass
class IntegrityReport:
    """What `CollectionVersions.check_integrity` found when it re-read a published version from the store."""

    version_id: str
    ok: bool
    expected_chunks: int
    stored_chunks: int
    expected_documents: int
    stored_documents: int
    expected_integrity_sha256: str
    stored_integrity_sha256: str
    problems: list[str] = field(default_factory=list)


@dataclass
class CollectionVersion:
    """SDD §5.1 'Collection version'."""

    version_id: str
    status: str  # "active" or "previous" (the rollback version)
    created_at: str  # ISO 8601, UTC
    activated_at: str | None
    chunk_count: int
    embedding_model: str
    embedding_dim: int
    chunker_config_ids: list[str]
    integrity_sha256: str  # sha256 over the sorted "chunk_id text_checksum" lines
    documents: dict[str, dict] = field(default_factory=dict)  # document_id -> E2 Document record

    @property
    def collection_name(self) -> str:
        return COLLECTION_PREFIX + self.version_id

    def summary(self) -> dict:
        """The wire form of this record: everything the Library screen shows, without chunk text or highlight data."""
        return {
            "version_id": self.version_id,
            "status": self.status,
            "created_at": self.created_at,
            "activated_at": self.activated_at,
            "chunk_count": self.chunk_count,
            "embedding_model": self.embedding_model,
            "chunker_config_ids": self.chunker_config_ids,
            "integrity_sha256": self.integrity_sha256,
            "documents": [
                {"document_id": d["document_id"], "display_title": d.get("display_title"),
                 "source_filename": d.get("source_filename"), "page_count": d.get("page_count")}
                for d in self.documents.values()
            ],
        }


class CollectionVersions:
    """Publish, list, activate and roll back collection versions.

    `publish` takes E2 Chunks plus the Document record for every document they
    reference (E2 `Document.to_dict()` output, or at least `document_id`,
    `display_title`, `source_filename` and `page_count`).
    """

    def __init__(self, embedder: Embedder, root: str | Path) -> None:
        self.embedder = embedder
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self._catalog_path = self.root / "catalog.json"
        self._client = open_client(self.root / "chroma")
        self._lock = threading.RLock()  # one publication at a time (SDD §6.2)
        self.recover()

    # --- reading -----------------------------------------------------------------------

    def active(self) -> CollectionVersion | None:
        catalog = self._read_catalog()
        return self._version(catalog, catalog["active"])

    def versions(self) -> list[CollectionVersion]:
        """The active version first, then the rollback version if there is one."""
        catalog = self._read_catalog()
        return [v for v in (self._version(catalog, catalog["active"]), self._version(catalog, catalog["previous"])) if v]

    def listing(self) -> dict:
        """Return a consistent document list and selection from one catalog read."""
        with self._lock:
            catalog = self._read_catalog()
            versions = []
            for version_id in (catalog["active"], catalog["previous"]):
                if not version_id:
                    continue
                version = self._version(catalog, version_id)
                disabled = set(catalog.get("disabled_documents", {}).get(version_id, []))
                versions.append({
                    "version_id": version_id, "status": version.status, "created_at": version.created_at,
                    "document_count": len(version.documents), "chunk_count": version.chunk_count,
                    "documents": [document | {"enabled": document["document_id"] not in disabled}
                                  for document in version.summary()["documents"]],
                })
            return {"active": catalog["active"], "versions": versions}

    def open_active(self) -> ChromaStore:
        """A read-only store bound to the version that is active now.

        Bind once per question: publishing a new version later doesn't change
        the store a question is already using, and the answer records this version.
        """
        with self._lock:
            catalog = self._read_catalog()
            version = self._version(catalog, catalog["active"])
            if version is None:
                raise LookupError("No active collection")
            allowed = frozenset(version.documents) - frozenset(catalog.get("disabled_documents", {}).get(version.version_id, []))
            return self.open(version, enabled_documents=allowed)

    def document_enabled(self, version_id: str, document_id: str) -> bool:
        catalog = self._read_catalog()
        version = self._version(catalog, version_id) if version_id in catalog["versions"] else None
        if version is None or document_id not in version.documents:
            raise LookupError("Document is no longer in the library")
        return document_id not in catalog.get("disabled_documents", {}).get(version_id, [])

    def set_document_enabled(self, version_id: str, document_id: str, enabled: bool) -> bool:
        if type(enabled) is not bool:
            raise ValueError("enabled must be a boolean")
        with self._lock:
            catalog = self._read_catalog()
            self._require_current_document(catalog, version_id, document_id)
            selections = catalog.get("disabled_documents", {})
            disabled = set(selections.get(version_id, []))
            if enabled:
                disabled.discard(document_id)
            else:
                disabled.add(document_id)
            self._write_catalog(catalog | {"disabled_documents": selections | {version_id: sorted(disabled)}})
            return enabled

    def delete_document(self, version_id: str, document_id: str, *, confirmed: bool = False) -> CollectionVersion:
        if confirmed is not True:
            raise ValueError("Confirm deletion before removing a document")
        with self._lock:
            self._require_current_document(self._read_catalog(), version_id, document_id)
            return self.publish([], [], append=True, remove_document=document_id)

    @staticmethod
    def _require_current_document(catalog: dict, version_id: str, document_id: str) -> None:
        if catalog["active"] != version_id or document_id not in catalog["versions"].get(version_id, {}).get("documents", {}):
            raise LookupError("The library changed. Refresh and try again.")

    def open(self, version: CollectionVersion, *, enabled_documents: frozenset[str] | None = None) -> ChromaStore:
        return ChromaStore(
            self.embedder,
            self.root / "chroma",
            version.collection_name,
            client=self._client,
            create=False,
            version_id=version.version_id,
            documents=version.documents,
            enabled_documents=enabled_documents,
        )

    def check_integrity(self, version: CollectionVersion | None = None) -> IntegrityReport:
        """Re-read a published version (the active one by default) and compare it with its catalog record.

        Checks that the stored chunk count and document set match the manifest,
        that the chunk ids and checksums reproduce the recorded integrity
        checksum, that each stored text still matches its checksum, and that
        every chunk's pages sit inside its document. It never writes.
        """
        version = version or self.active()
        if version is None:
            raise LookupError(f"No active collection at {self.root}; publish one first")
        store = self.open(version)
        problems: list[str] = []
        pairs: list[tuple[str, str]] = []
        doc_ids: set[str] = set()
        batch = 500
        total = store.count()
        for offset in range(0, total, batch):
            got = store.collection.get(include=["metadatas", "documents"], limit=batch, offset=offset)
            for cid, meta, text in zip(got["ids"], got["metadatas"], got["documents"]):
                pairs.append((cid, meta["text_checksum_sha256"]))
                doc_ids.add(meta["document_id"])
                if hashlib.sha256(text.encode("utf-8")).hexdigest() != meta["text_checksum_sha256"]:
                    problems.append(f"chunk {cid}: stored text doesn't match its checksum")
                record = version.documents.get(meta["document_id"])
                if record is None:
                    problems.append(f"chunk {cid}: document {meta['document_id']} is not in the manifest")
                elif not 1 <= meta["page_start"] <= meta["page_end"] <= record["page_count"]:
                    problems.append(f"chunk {cid}: pages {meta['page_start']}-{meta['page_end']} outside {record['page_count']}-page document")
        stored = _integrity(pairs)
        if total != version.chunk_count:
            problems.append(f"store holds {total} chunks, manifest says {version.chunk_count}")
        if doc_ids != set(version.documents):
            problems.append(f"store holds chunks from {len(doc_ids)} documents, manifest lists {len(version.documents)}")
        if stored != version.integrity_sha256:
            problems.append("chunk ids and checksums don't reproduce the recorded integrity checksum")
        return IntegrityReport(
            version_id=version.version_id,
            ok=not problems,
            expected_chunks=version.chunk_count,
            stored_chunks=total,
            expected_documents=len(version.documents),
            stored_documents=len(doc_ids),
            expected_integrity_sha256=version.integrity_sha256,
            stored_integrity_sha256=stored,
            problems=problems[:50],
        )

    # --- publication -------------------------------------------------------------------

    def publish(self, chunks: Sequence[Chunk], documents: Iterable[dict], *, smoke_query: str | None = None,
                sources: Mapping[str, str | Path | bytes] | None = None,
                append: bool = False, remove_document: str | None = None) -> CollectionVersion:
        """Build, verify and atomically activate a new version. Returns it.

        On any failure the candidate is deleted, `PublishError` is raised and the
        active version is unchanged. The former active version becomes the
        rollback version; the one before it is deleted.
        With append=True, unchanged records, vectors and sources are carried
        forward. Confirmed deletion uses remove_document and retires every old
        snapshot so rollback cannot restore removed content.

        `sources` maps `document_id -> PDF path or bytes`; those originals are
        cached under `<root>/sources/<version_id>/<document_id>.pdf` so citations
        can be opened in the source PDF later (ADR 0006). It is best-effort:
        documents without a provided source are simply not cached.
        """
        chunks = list(chunks)
        incoming_chunks = list(chunks)
        records = {d["document_id"]: dict(d) for d in documents}
        with self._lock:
            catalog = self._read_catalog()
            version_id = f"v{catalog['next_seq']:04d}"
            name = COLLECTION_PREFIX + version_id
            self._drop(name)  # a leftover from an interrupted run with the same id
            store = ChromaStore(self.embedder, self.root / "chroma", name, client=self._client)
            try:
                if append and catalog["active"]:
                    previous = self._version(catalog, catalog["active"])
                    if (previous.embedding_model, previous.embedding_dim) != (self.embedder.model_name, self.embedder.dimension):
                        raise PublishError("The library embedding model changed; use the original model to manage this library")
                    retained = set(previous.documents) - set(records) - {remove_document}
                    chunks = store.copy_documents_from(self.open(previous), retained) + chunks
                    records = {key: previous.documents[key] for key in retained} | records
                    sources = {key: path for key in retained
                               if (path := self.source_path(key, version_id=previous.version_id)) is not None} | dict(sources or {})
                if not chunks and remove_document is None:
                    raise PublishError("A collection needs at least one chunk")
                missing = sorted({c.document_id for c in chunks} - records.keys())
                if missing:
                    raise PublishError(f"No document record for {len(missing)} document(s), e.g. {missing[0]}")
                store.index(incoming_chunks)
                integrity = self._verify(store, chunks, smoke_query)
            except Exception as exc:
                self._drop(name)
                if isinstance(exc, PublishError):
                    raise
                raise PublishError(f"Publishing {version_id} failed: {exc}") from exc

            now = _now()
            version = CollectionVersion(
                version_id=version_id,
                status="active",
                created_at=now,
                activated_at=now,
                chunk_count=len(chunks),
                embedding_model=self.embedder.model_name,
                embedding_dim=self.embedder.dimension,
                chunker_config_ids=sorted({c.chunker_config_id for c in chunks}),
                integrity_sha256=integrity,
                documents={k: records[k] for k in sorted({c.document_id for c in chunks})},
            )
            if sources:
                try:
                    self._stage_sources(version_id, set(version.documents), sources)
                except Exception as exc:
                    self._drop(name)
                    self._drop_sources(version_id)
                    raise PublishError(f"Caching sources for {version_id} failed: {exc}") from exc
            old_active = catalog["active"] if remove_document is None else None
            versions = {version_id: asdict(version)}
            if old_active:
                versions[old_active] = catalog["versions"][old_active] | {"status": "previous"}
            self._write_catalog({
                "schema": CATALOG_SCHEMA,
                "disabled_documents": {
                    **({old_active: catalog.get("disabled_documents", {}).get(old_active, [])} if old_active else {}),
                    version_id: sorted(set(catalog.get("disabled_documents", {}).get(catalog["active"], [])) & set(version.documents)) if append else [],
                },
                "active": version_id,
                "previous": old_active,
                "next_seq": catalog["next_seq"] + 1,
                "versions": versions,
            })
        self.recover()  # deletes the version that just fell out of retention
        return version

    def rollback(self) -> CollectionVersion:
        """Make the rollback version active again. The version rolled back from becomes the rollback version."""
        with self._lock:
            catalog = self._read_catalog()
            if not catalog["previous"]:
                raise LookupError("There is no previous version to roll back to")
            new_active, new_previous = catalog["previous"], catalog["active"]
            versions = catalog["versions"]
            versions[new_active] |= {"status": "active", "activated_at": _now()}
            versions[new_previous] |= {"status": "previous"}
            self._write_catalog(catalog | {"active": new_active, "previous": new_previous, "versions": versions})
            return self._version(self._read_catalog(), new_active)

    def recover(self) -> list[str]:
        with self._lock:
            return self._recover()

    def _recover(self) -> list[str]:
        """Remove collections the catalog doesn't reference (interrupted publications, retired versions)."""
        catalog = self._read_catalog()
        keep = {COLLECTION_PREFIX + v for v in (catalog["active"], catalog["previous"]) if v}
        removed = []
        for collection in self._client.list_collections():
            if collection.name.startswith(COLLECTION_PREFIX) and collection.name not in keep:
                self._drop(collection.name)
                removed.append(collection.name)
        keep_ids = {v for v in (catalog["active"], catalog["previous"]) if v}
        sources_root = self.root / SOURCES_DIR
        if sources_root.is_dir():
            for child in sources_root.iterdir():
                if child.is_dir() and child.name not in keep_ids:
                    shutil.rmtree(child, ignore_errors=True)
        self.root.joinpath("catalog.json.tmp").unlink(missing_ok=True)
        return removed

    # --- source PDFs (ADR 0006) --------------------------------------------------------

    def source_path(self, document_id: str, *, version_id: str | None = None) -> Path | None:
        """The cached source PDF for a document in a version (the active one by default).

        Returns the path only when `document_id` is a document of that version
        (so an id from a client can't escape the version's own folder) and the
        file is present; otherwise None.
        """
        catalog = self._read_catalog()
        vid = version_id or catalog["active"]
        if not vid or vid not in catalog["versions"]:
            return None
        version = self._version(catalog, vid)
        if version is None or document_id not in version.documents:
            return None
        path = self.root / SOURCES_DIR / version.version_id / f"{document_id}.pdf"
        return path if path.is_file() else None

    def _stage_sources(self, version_id: str, document_ids: set[str], sources: Mapping[str, str | Path | bytes]) -> None:
        dest = self.root / SOURCES_DIR / version_id
        dest.mkdir(parents=True, exist_ok=True)
        for document_id in sorted(document_ids):
            src = sources.get(document_id)
            if src is None:
                continue
            if "/" in document_id or "\\" in document_id or document_id in ("", ".", ".."):
                raise ValueError(f"unsafe document id {document_id!r}")
            data = bytes(src) if isinstance(src, (bytes, bytearray)) else Path(src).read_bytes()
            (dest / f"{document_id}.pdf").write_bytes(data)

    def _drop_sources(self, version_id: str) -> None:
        shutil.rmtree(self.root / SOURCES_DIR / version_id, ignore_errors=True)

    def close(self) -> None:
        self._client.close()

    # --- internals ---------------------------------------------------------------------

    def _verify(self, store: ChromaStore, chunks: list[Chunk], smoke_query: str | None) -> str:
        """Counts, checksums read back from the store, and a search smoke test (SDD §6.2)."""
        if store.count() != len(chunks):
            raise PublishError(f"Candidate holds {store.count()} chunks, expected {len(chunks)}")
        expected = _integrity((c.chunk_id, c.text_checksum_sha256) for c in chunks)
        stored = []
        batch = 1000
        for offset in range(0, len(chunks), batch):
            got = store.collection.get(include=["metadatas"], limit=batch, offset=offset)
            stored += [(cid, meta["text_checksum_sha256"]) for cid, meta in zip(got["ids"], got["metadatas"])]
        if _integrity(stored) != expected:
            raise PublishError("Candidate chunk ids or checksums don't match the chunks given")
        if not chunks:
            return expected
        if smoke_query is not None:
            if not store.search(smoke_query, top_k=1):
                raise PublishError("Smoke-test search returned no results")
        else:
            probe = chunks[0]
            top = store.search(probe.text, top_k=1)
            if not top or top[0].score < 0.99:  # a chunk's own text must find an identical vector
                raise PublishError("Smoke-test search did not find a chunk by its own text")
        return expected

    def _read_catalog(self) -> dict:
        if not self._catalog_path.exists():
            return {"schema": CATALOG_SCHEMA, "active": None, "previous": None, "next_seq": 1, "versions": {}}
        catalog = json.loads(self._catalog_path.read_text(encoding="utf-8"))
        if catalog.get("schema") != CATALOG_SCHEMA:
            raise RuntimeError(f"Unsupported collection catalog schema {catalog.get('schema')!r}")
        return catalog

    def _write_catalog(self, catalog: dict) -> None:
        tmp = self.root / "catalog.json.tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(catalog, f, indent=2, sort_keys=True)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, self._catalog_path)  # atomic on Windows, macOS and Linux
        if hasattr(os, "O_DIRECTORY"):  # make the rename itself durable (POSIX)
            fd = os.open(self.root, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(fd)
            finally:
                os.close(fd)

    @staticmethod
    def _version(catalog: dict, version_id: str | None) -> CollectionVersion | None:
        if not version_id:
            return None
        return CollectionVersion(**catalog["versions"][version_id])

    def _drop(self, name: str) -> None:
        if any(c.name == name for c in self._client.list_collections()):
            self._client.delete_collection(name)


def _integrity(pairs: Iterable[tuple[str, str]]) -> str:
    lines = "\n".join(f"{cid} {checksum}" for cid, checksum in sorted(pairs))
    return hashlib.sha256(lines.encode("utf-8")).hexdigest()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")
