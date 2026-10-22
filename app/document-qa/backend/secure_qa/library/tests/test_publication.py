"""Corpus ingestion, the publication workflow, integrity checks and search diagnostics (SDD §6, §7.1).

These run E2's real `validate()` and `chunks()` over its fixture PDFs, with the
deterministic fake embedder, so they need PyMuPDF and skip without it.
"""

from __future__ import annotations

import json
import shutil
import tempfile
import threading
import unittest
from pathlib import Path

from secure_qa.library import CollectionVersions, FakeEmbedder, PublishError, trace_search
from secure_qa.library.corpus import ingest_corpus
from secure_qa.library.publication import BUSY, FAILED, NEEDS_CONFIRMATION, NOTHING_TO_PUBLISH, PUBLISHED, Publisher
from secure_qa.paths import REPO_ROOT

try:
    import pymupdf  # noqa: F401

    HAVE_PDF = True
except ModuleNotFoundError:
    HAVE_PDF = False

FIXTURES = REPO_ROOT / "ingestion" / "fixtures"
NRC = FIXTURES / "normal" / "normal_nrc_reactor_concepts_ch01.pdf"
ADVERSARIAL = FIXTURES / "adversarial" / "adversarial_prompt_injection.pdf"
EMPTY = FIXTURES / "corrupt" / "corrupt_empty.pdf"
PASSWORD = FIXTURES / "protected" / "protected_user_password.pdf"
NOT_A_PDF = FIXTURES / "nonpdf" / "nonpdf_plaintext_renamed.pdf"


@unittest.skipUnless(HAVE_PDF and NRC.exists(), "needs PyMuPDF and E2's fixture PDFs")
class CorpusTest(unittest.TestCase):
    def test_every_file_is_accounted_for_and_rejects_have_reasons(self):
        review = ingest_corpus([NRC, ADVERSARIAL, EMPTY, PASSWORD, NOT_A_PDF])
        self.assertEqual(len(review.files), 5)
        self.assertEqual({f.filename for f in review.accepted}, {NRC.name, ADVERSARIAL.name})
        reasons = {f.filename: f.reject_reason for f in review.rejected}
        self.assertEqual(reasons, {EMPTY.name: "corrupt", PASSWORD.name: "password_protected", NOT_A_PDF.name: "non_pdf"})
        self.assertTrue(all(f.reject_detail for f in review.rejected))
        self.assertTrue(all(f.chunks == 0 for f in review.rejected))
        summary = review.summary()
        self.assertEqual((summary["files"], summary["accepted"], summary["rejected"]), (5, 2, 3))
        self.assertEqual(summary["chunks"], len(review.chunks))
        self.assertEqual(sum(f.chunks for f in review.accepted), len(review.chunks))

    def test_rerun_gives_identical_chunks_and_manifest_checksum_regardless_of_input_order(self):
        a = ingest_corpus([NRC, ADVERSARIAL])
        b = ingest_corpus([ADVERSARIAL, NRC])
        self.assertEqual(a.manifest_sha256, b.manifest_sha256)
        self.assertEqual([c.chunk_id for c in a.chunks], [c.chunk_id for c in b.chunks])
        self.assertTrue(all(c.checksum_ok for c in a.chunks))

    def test_kept_text_streams_resolve_chunk_offsets(self):
        review = ingest_corpus([NRC], keep_text=True)
        source = review.sources[review.documents[0]["document_id"]]
        for chunk in review.chunks:
            self.assertEqual(source.text[chunk.char_start:chunk.char_end], chunk.text)
            first, last = source.page_bounds[chunk.page_start - 1], source.page_bounds[chunk.page_end - 1]
            self.assertTrue(first[0] <= chunk.char_start and chunk.char_end <= last[1])

    def test_report_is_serializable_and_has_no_document_text(self):
        review = ingest_corpus([NRC, EMPTY])
        report = json.dumps(review.to_dict())
        self.assertIn("corrupt", report)
        self.assertNotIn(review.chunks[0].text[:60], report)


@unittest.skipUnless(HAVE_PDF and NRC.exists(), "needs PyMuPDF and E2's fixture PDFs")
class PublisherTest(unittest.TestCase):
    def setUp(self) -> None:
        self.dir = Path(tempfile.mkdtemp(prefix="library-publish-"))
        self.versions = CollectionVersions(FakeEmbedder(), self.dir)
        self.publisher = Publisher(self.versions)

    def tearDown(self) -> None:
        self.versions.close()
        shutil.rmtree(self.dir, ignore_errors=True)

    def test_rejects_need_confirmation_and_nothing_changes_until_confirmed(self):
        outcome = self.publisher.publish([NRC, EMPTY])
        self.assertEqual(outcome.status, NEEDS_CONFIRMATION)
        self.assertEqual(len(outcome.review.rejected), 1)
        self.assertIsNone(self.versions.active())
        confirmed = self.publisher.publish([NRC, EMPTY], confirm_rejects=True)
        self.assertEqual(confirmed.status, PUBLISHED)
        self.assertEqual(self.versions.active().version_id, "v0001")
        self.assertEqual(set(confirmed.version.documents), {d["document_id"] for d in confirmed.review.documents})

    def test_nothing_publishable_changes_nothing(self):
        self.assertEqual(self.publisher.publish([EMPTY, NOT_A_PDF], confirm_rejects=True).status, NOTHING_TO_PUBLISH)
        self.assertIsNone(self.versions.active())

    def test_publish_verifies_counts_and_writes_the_import_report(self):
        outcome = self.publisher.publish([NRC, ADVERSARIAL])
        self.assertTrue(outcome.published)
        self.assertTrue(outcome.integrity.ok, outcome.integrity.problems)
        self.assertEqual(outcome.integrity.stored_chunks, outcome.version.chunk_count)
        report = json.loads((self.dir / "reports" / "v0001.json").read_text())
        self.assertEqual(report["summary"]["chunks"], outcome.version.chunk_count)
        self.assertEqual(report["summary"]["manifest_sha256"], outcome.review.manifest_sha256)

    def test_republish_keeps_chunk_ids_stable_and_prunes_old_reports(self):
        def ids(version):
            return set(self.versions.open(version).collection.get()["ids"])

        first = self.publisher.publish([NRC]).version
        first_ids = ids(first)
        second = self.publisher.publish([NRC, ADVERSARIAL]).version
        self.assertTrue(first_ids < ids(second), "the NRC chunks must keep their ids in the new version")
        third = self.publisher.publish([NRC]).version  # v0001 falls out of retention here
        self.assertEqual(ids(third), first_ids)
        self.assertEqual(sorted(p.name for p in (self.dir / "reports").glob("*.json")), ["v0002.json", "v0003.json"])

    def test_rollback_restores_the_previous_version_and_its_integrity(self):
        v1 = self.publisher.publish([NRC]).version
        v2 = self.publisher.publish([NRC, ADVERSARIAL]).version
        self.assertEqual(self.publisher.rollback().version_id, v1.version_id)
        self.assertEqual(self.versions.open_active().count(), v1.chunk_count)
        self.assertTrue(self.versions.check_integrity().ok)
        self.assertEqual(self.publisher.rollback().version_id, v2.version_id)  # rollback can be undone

    def test_a_failed_publish_leaves_the_active_version_unchanged(self):
        v1 = self.publisher.publish([NRC]).version
        original = self.versions.publish

        def explode(*a, **k):
            raise PublishError("simulated verification failure")

        self.versions.publish = explode
        try:
            outcome = self.publisher.publish([NRC, ADVERSARIAL])
        finally:
            self.versions.publish = original
        self.assertEqual(outcome.status, FAILED)
        self.assertIn("unchanged", outcome.message)
        self.assertEqual(self.versions.active(), v1)

    def test_only_one_publication_job_runs_at_a_time(self):
        started, release = threading.Event(), threading.Event()
        original = self.publisher.review

        def slow_review(paths):
            started.set()
            release.wait(10)
            return original(paths)

        self.publisher.review = slow_review
        first: list = []
        worker = threading.Thread(target=lambda: first.append(self.publisher.publish([NRC])))
        worker.start()
        self.assertTrue(started.wait(10))
        self.assertEqual(self.publisher.publish([NRC]).status, BUSY)
        release.set()
        worker.join(30)
        self.assertEqual(first[0].status, PUBLISHED)


@unittest.skipUnless(HAVE_PDF and NRC.exists(), "needs PyMuPDF and E2's fixture PDFs")
class IntegrityAndTraceTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.dir = Path(tempfile.mkdtemp(prefix="library-trace-"))
        cls.versions = CollectionVersions(FakeEmbedder(), cls.dir)
        cls.outcome = Publisher(cls.versions).publish([NRC, ADVERSARIAL])
        cls.store = cls.versions.open_active()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.versions.close()
        shutil.rmtree(cls.dir, ignore_errors=True)

    def test_integrity_matches_the_manifest(self):
        report = self.versions.check_integrity()
        self.assertTrue(report.ok, report.problems)
        self.assertEqual(report.stored_integrity_sha256, report.expected_integrity_sha256)
        self.assertEqual((report.stored_documents, report.stored_chunks),
                         (len(self.outcome.version.documents), self.outcome.version.chunk_count))

    def test_integrity_detects_a_tampered_chunk(self):
        collection = self.store.collection
        victim = collection.get(limit=1, include=["documents", "embeddings"])
        vectors = [list(v) for v in victim["embeddings"]]
        collection.update(ids=victim["ids"], embeddings=vectors, documents=[victim["documents"][0] + " tampered"])
        try:
            report = self.versions.check_integrity()
            self.assertFalse(report.ok)
            self.assertTrue(any("checksum" in p for p in report.problems))
        finally:
            collection.update(ids=victim["ids"], embeddings=vectors, documents=victim["documents"])
        self.assertTrue(self.versions.check_integrity().ok)

    def test_every_hit_maps_to_document_pages_and_chunk(self):
        trace = trace_search(self.store, "nuclear power plant produces electricity", top_k=5, min_score=None)
        self.assertEqual(len(trace.hits), 5)
        self.assertEqual(trace.unmapped, [])
        for rank, hit in enumerate(trace.hits, 1):
            self.assertEqual(hit.rank, rank)
            self.assertTrue(hit.source_filename and hit.document_title)
            self.assertTrue(1 <= hit.page_start <= hit.page_end)
            self.assertTrue(hit.chunk_id.startswith("chk_"))
            self.assertLess(hit.char_start, hit.char_end)
        self.assertEqual([h.score for h in trace.hits], sorted((h.score for h in trace.hits), reverse=True))

    def test_trace_marks_hits_below_the_threshold_without_hiding_them(self):
        everything = trace_search(self.store, "annual dose limit", top_k=5)
        cut = everything.hits[1].score
        trace = trace_search(self.store, "annual dose limit", top_k=5, min_score=cut)
        self.assertEqual(len(trace.hits), 5)
        self.assertEqual([h.kept for h in trace.hits], [True, True, False, False, False])
        self.assertAlmostEqual(trace.margin, trace.hits[0].score - cut)
        self.assertEqual(len(trace.kept), len(self.store.search("annual dose limit", top_k=5, min_score=cut)))

    def test_events_carry_ids_and_numbers_but_no_question_or_document_text(self):
        question = "what is the unique canary question text"
        trace = trace_search(self.store, question, top_k=3, min_score=0.0)
        event = json.dumps(trace.event())
        self.assertNotIn("canary", event)
        self.assertNotIn(trace.hits[0].preview[:40], event)
        self.assertEqual(json.loads(event)["query_chars"], len(question))


if __name__ == "__main__":
    unittest.main()
