"""Versioned collections: atomic activation, rollback, retention and recovery (SDD §4.1, §6.3)."""

from __future__ import annotations

import json
import shutil
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path

from secure_qa.library import CollectionVersions, FakeEmbedder, PublishError
from secure_qa.library.synthetic import synthetic_corpus

from .test_store import E2_DIR, e2_chunks


def synthetic():
    docs, chunks = synthetic_corpus()
    return chunks, [d.metadata() for d in docs]


def nrc():
    return e2_chunks(), [json.loads((E2_DIR / "nrc_document.json").read_text())]


class VersionsTest(unittest.TestCase):
    def setUp(self) -> None:
        self.dir = Path(tempfile.mkdtemp(prefix="library-versions-"))
        self.versions = CollectionVersions(FakeEmbedder(), self.dir)

    def tearDown(self) -> None:
        self.versions.close()
        shutil.rmtree(self.dir, ignore_errors=True)

    def reopen(self) -> None:
        self.versions.close()
        self.versions = CollectionVersions(FakeEmbedder(), self.dir)

    def collections(self) -> set[str]:
        return {c.name for c in self.versions._client.list_collections()}

    def test_publish_activates_a_verified_version(self):
        chunks, docs = synthetic()
        version = self.versions.publish(chunks, docs)
        self.assertEqual(version.version_id, "v0001")
        self.assertEqual(self.versions.active(), version)
        self.assertEqual(version.chunk_count, len(chunks))
        self.assertEqual(set(version.documents), {d["document_id"] for d in docs})
        store = self.versions.open_active()
        self.assertEqual(store.collection_version, "v0001")
        top = store.search("annual occupational dose limit", top_k=1)[0]
        self.assertEqual(store.document(top.chunk.document_id)["source_filename"], "synthetic/radiation_protection_handbook.pdf")

    def test_caches_source_pdfs_and_serves_them_only_for_manifest_documents(self):
        chunks, docs = synthetic()
        sources = {d["document_id"]: b"%PDF-1.4\n" + d["document_id"].encode() for d in docs}
        version = self.versions.publish(chunks, docs, sources=sources)
        for doc_id, data in sources.items():
            path = self.versions.source_path(doc_id)
            self.assertIsNotNone(path, doc_id)
            self.assertEqual(path.read_bytes(), data)
        # Unknown and traversal-style ids are not documents of the version -> no path.
        self.assertIsNone(self.versions.source_path("doc_does_not_exist"))
        self.assertIsNone(self.versions.source_path("../secret"))
        # Survives reopen.
        self.reopen()
        self.assertIsNotNone(self.versions.source_path(next(iter(sources))))

    def test_retention_drops_source_dirs_for_versions_that_fall_out(self):
        chunks, docs = synthetic()
        sources = {d["document_id"]: b"%PDF-1.4\n" for d in docs}
        v1 = self.versions.publish(chunks, docs, sources=sources)
        self.versions.publish(chunks, docs, sources=sources)
        self.versions.publish(chunks, docs, sources=sources)  # v1 now falls out of active+previous retention
        self.assertFalse((self.dir / "sources" / v1.version_id).exists())
        self.assertIsNone(self.versions.source_path(next(iter(sources)), version_id=v1.version_id))

    def test_second_publish_keeps_the_first_as_rollback_and_rollback_restores_it(self):
        first = self.versions.publish(*synthetic())
        second = self.versions.publish(*nrc())
        self.assertEqual([v.version_id for v in self.versions.versions()], ["v0002", "v0001"])
        self.assertEqual([v.status for v in self.versions.versions()], ["active", "previous"])
        self.assertEqual(self.versions.open_active().count(), second.chunk_count)

        restored = self.versions.rollback()
        self.assertEqual(restored.version_id, first.version_id)
        self.assertEqual(self.versions.open_active().count(), first.chunk_count)
        self.assertEqual(self.versions.versions()[1].version_id, "v0002")  # rollback can itself be undone

    def test_only_active_and_previous_are_retained(self):
        for _ in range(3):
            self.versions.publish(*synthetic())
        self.assertEqual([v.version_id for v in self.versions.versions()], ["v0003", "v0002"])
        self.assertEqual(self.collections(), {"secure_qa_v0003", "secure_qa_v0002"})

    def test_failed_publication_leaves_active_version_unchanged(self):
        active = self.versions.publish(*synthetic())
        chunks, docs = nrc()
        corrupt = chunks[:-1] + [replace(chunks[-1], text=chunks[-1].text + " tampered")]
        with self.assertRaises(PublishError):
            self.versions.publish(corrupt, docs)
        with self.assertRaises(PublishError):
            self.versions.publish(chunks, [])  # no document records
        with self.assertRaises(PublishError):
            self.versions.publish([], docs)
        self.assertEqual(self.versions.active(), active)
        self.assertEqual(self.collections(), {"secure_qa_v0001"})  # candidates were cleaned up

    def test_state_survives_reopen_and_interrupted_candidates_are_removed(self):
        self.versions.publish(*synthetic())
        self.versions._client.create_collection("secure_qa_v0099")  # as if a publish crashed mid-build
        self.reopen()
        self.assertEqual(self.versions.active().version_id, "v0001")
        self.assertEqual(self.collections(), {"secure_qa_v0001"})
        self.assertTrue(self.versions.open_active().search("coolant pressure", top_k=1))

    def test_rollback_without_previous_and_open_without_active(self):
        with self.assertRaises(LookupError):
            self.versions.open_active()
        self.versions.publish(*synthetic())
        with self.assertRaises(LookupError):
            self.versions.rollback()


if __name__ == "__main__":
    unittest.main()
