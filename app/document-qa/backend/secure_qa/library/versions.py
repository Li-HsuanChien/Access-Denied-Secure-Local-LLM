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

PDF review and extraction sit in `library.workflow`; this module owns verified,
versioned indexing, source snapshot staging, atomic activation, and rollback.
"""

from __future__ import annotations

import hashlib
import json
import os
import threading
from collections.abc import Iterable, Sequence
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from .chroma_store import ChromaStore, open_client
from .chunk import Chunk
from .embedding import Embedder

CATALOG_SCHEMA = "secure-qa-collections/1"
COLLECTION_PREFIX = "secure_qa_"


class PublishError(RuntimeError):
    """A candidate collection failed to build or verify. The active version is unchanged."""


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
        self._lock = threading.Lock()  # one publication at a time (SDD §6.2)
        self.recover()

    # --- reading -----------------------------------------------------------------------

    def active(self) -> CollectionVersion | None:
        catalog = self._read_catalog()
        return self._version(catalog, catalog["active"])

    def versions(self) -> list[CollectionVersion]:
        """The active version first, then the rollback version if there is one."""
        catalog = self._read_catalog()
        return [v for v in (self._version(catalog, catalog["active"]), self._version(catalog, catalog["previous"])) if v]

    def open_active(self) -> ChromaStore:
        """A read-only store bound to the version that is active now.

        Bind once per question: publishing a new version later doesn't change
        the store a question is already using, and the answer records this version.
        """
        version = self.active()
        if version is None:
            raise LookupError(f"No active collection at {self.root}; publish one first")
        return self.open(version)

    def open(self, version: CollectionVersion) -> ChromaStore:
        return ChromaStore(
            self.embedder,
            self.root / "chroma",
            version.collection_name,
            client=self._client,
            create=False,
            version_id=version.version_id,
            documents=version.documents,
        )

    # --- publication -------------------------------------------------------------------

    def publish(self, chunks: Sequence[Chunk], documents: Iterable[dict], *, smoke_query: str | None = None,
                source_files: dict[str, bytes] | None = None,
                cancelled=lambda: False, progress=lambda _stage, _done, _total: None) -> CollectionVersion:
        """Build, verify and atomically activate a new version. Returns it.

        On any failure the candidate is deleted, `PublishError` is raised and the
        active version is unchanged. The former active version becomes the
        rollback version; the one before it is deleted.
        """
        chunks = list(chunks)
        records = {d["document_id"]: dict(d) for d in documents}
        with self._lock:
            catalog = self._read_catalog()
            version_id = f"v{catalog['next_seq']:04d}"
            name = COLLECTION_PREFIX + version_id
            self._drop(name)  # a leftover from an interrupted run with the same id
            store = ChromaStore(self.embedder, self.root / "chroma", name, client=self._client)
            try:
                if not chunks:
                    raise PublishError("A collection needs at least one chunk")
                if cancelled():
                    raise PublishError("Publication cancelled")
                missing = sorted({c.document_id for c in chunks} - records.keys())
                if missing:
                    raise PublishError(f"No document record for {len(missing)} document(s), e.g. {missing[0]}")
                batch_size = 256
                for offset in range(0, len(chunks), batch_size):
                    if cancelled():
                        raise PublishError("Publication cancelled")
                    batch = chunks[offset:offset + batch_size]
                    store.index(batch)
                    progress("indexing", offset + len(batch), len(chunks))
                progress("verifying", len(chunks), len(chunks))
                if cancelled():
                    raise PublishError("Publication cancelled")
                integrity = self._verify(store, chunks, smoke_query)
                if cancelled():
                    raise PublishError("Publication cancelled")
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
            try:
                source_dir = self._write_sources(version_id, source_files or {})
            except Exception:
                self._drop(name)
                raise
            for document_id in version.documents:
                if document_id in (source_files or {}):
                    version.documents[document_id]["source_file"] = f"sources/{version_id}/{document_id}.pdf"
            progress("activating", len(chunks), len(chunks))
            if cancelled():
                if source_dir:
                    import shutil
                    shutil.rmtree(source_dir, ignore_errors=True)
                self._drop(name)
                raise PublishError("Publication cancelled")
            old_active = catalog["active"]
            versions = {version_id: asdict(version)}
            if old_active:
                versions[old_active] = catalog["versions"][old_active] | {"status": "previous"}
            try:
                self._write_catalog({
                    "schema": CATALOG_SCHEMA,
                    "active": version_id,
                    "previous": old_active,
                    "next_seq": catalog["next_seq"] + 1,
                    "versions": versions,
                })
            except Exception:
                if source_dir:
                    import shutil
                    shutil.rmtree(source_dir, ignore_errors=True)
                self._drop(name)
                raise
            progress("activated", len(chunks), len(chunks))
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
        """Remove collections the catalog doesn't reference (interrupted publications, retired versions)."""
        catalog = self._read_catalog()
        keep = {COLLECTION_PREFIX + v for v in (catalog["active"], catalog["previous"]) if v}
        removed = []
        for collection in self._client.list_collections():
            if collection.name.startswith(COLLECTION_PREFIX) and collection.name not in keep:
                self._drop(collection.name)
                removed.append(collection.name)
        sources = self.root / "sources"
        if sources.exists():
            for path in sources.iterdir():
                if path.name not in {v for v in (catalog["active"], catalog["previous"]) if v}:
                    import shutil
                    shutil.rmtree(path, ignore_errors=True)
        self.root.joinpath("catalog.json.tmp").unlink(missing_ok=True)
        return removed

    def _write_sources(self, version_id: str, source_files: dict[str, bytes]) -> Path | None:
        if not source_files:
            return None
        import shutil
        sources = self.root / "sources"
        sources.mkdir(parents=True, exist_ok=True)
        staging = sources / f".{version_id}.tmp"
        destination = sources / version_id
        shutil.rmtree(staging, ignore_errors=True)
        shutil.rmtree(destination, ignore_errors=True)
        staging.mkdir()
        try:
            for document_id, contents in source_files.items():
                if not document_id.replace("_", "").isalnum():
                    raise ValueError("Unsafe document identifier for source storage")
                with open(staging / f"{document_id}.pdf", "wb") as source:
                    source.write(contents)
                    source.flush()
                    os.fsync(source.fileno())
            os.replace(staging, destination)
            return destination
        except Exception:
            shutil.rmtree(staging, ignore_errors=True)
            raise

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
