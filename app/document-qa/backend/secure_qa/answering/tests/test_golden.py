"""Week 3 acceptance: golden questions retrieve the expected chunks and return citations that resolve exactly.

Needs the real embedding model (models/all-MiniLM-L6-v2); skipped without it.
The answering model is the deterministic fake, so this pins retrieval, context
assembly, citation payload and resolution. Answer wording is measured by
`python -m secure_qa.answering.benchmarks.golden --runtime <E1 URL>` instead.
"""

from __future__ import annotations

import shutil
import tempfile
import unittest
from pathlib import Path

from secure_qa.answering import AnswerService, FakeModelRuntime
from secure_qa.answering.benchmarks.golden import (
    build_store,
    evaluate,
    expected_chunk_ids,
    golden_quality_checks,
    load_golden,
)
from secure_qa.library.embedding import DEFAULT_MODEL_PATH


@unittest.skipUnless((DEFAULT_MODEL_PATH / "modules.json").exists(), "embedding model not fetched")
class GoldenQueryTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from secure_qa.library import Embedder

        cls.dir = Path(tempfile.mkdtemp(prefix="golden-"))
        cls.versions, cls.store, cls.version, cls.chunks, cls.documents, cls.sources = build_store(Embedder(), cls.dir)
        cls.service = AnswerService(FakeModelRuntime(), on_event=lambda e: None)

    @classmethod
    def tearDownClass(cls):
        cls.versions.close()
        shutil.rmtree(cls.dir, ignore_errors=True)

    def test_every_golden_query_passes_acceptance(self):
        for record in load_golden():
            with self.subTest(record["id"]):
                answer = self.service.answer(record["question"], self.store, request_id=record["id"])
                expected = expected_chunk_ids(record, self.chunks, self.documents) if record["expect"] == "answer" else set()
                if record["expect"] == "answer":
                    self.assertTrue(expected, "golden record matches no chunk; fix the record")
                result = evaluate(record, answer, expected, self.sources, self.store)
                self.assertTrue(result["passed"], result)
                self.assertEqual(answer.collection_version, self.version.version_id)

    def test_demo_query_finds_its_evidence_first(self):
        record = next(r for r in load_golden() if r.get("demo"))
        answer = self.service.answer(record["question"], self.store)
        self.assertIn(answer.evidence[0].chunk_id, expected_chunk_ids(record, self.chunks, self.documents))
        self.assertEqual(answer.citations[0].chunk_ids, [answer.evidence[0].chunk_id])


@unittest.skipUnless((DEFAULT_MODEL_PATH / "modules.json").exists(), "embedding model not fetched")
class RealCorpusGoldenTest(unittest.TestCase):
    """E2's real PDFs, ingested through E2's validate() and chunks(), published, searched and cited from."""

    @classmethod
    def setUpClass(cls):
        try:
            import pymupdf  # noqa: F401
        except ModuleNotFoundError:
            raise unittest.SkipTest("needs PyMuPDF")
        from secure_qa.library import Embedder

        cls.dir = Path(tempfile.mkdtemp(prefix="golden-real-"))
        cls.versions, cls.store, cls.version, cls.chunks, cls.documents, cls.sources = build_store(Embedder(), cls.dir, "real")
        cls.service = AnswerService(FakeModelRuntime(), on_event=lambda e: None)

    @classmethod
    def tearDownClass(cls):
        cls.versions.close()
        shutil.rmtree(cls.dir, ignore_errors=True)

    def test_every_gated_query_passes_and_known_gaps_stay_visible(self):
        quality = golden_quality_checks("real")
        for record in load_golden("real"):
            with self.subTest(record["id"]):
                answer = self.service.answer(record["question"], self.store, request_id=record["id"])
                expected = expected_chunk_ids(record, self.chunks, self.documents) if record["expect"] == "answer" else set()
                if record["expect"] == "answer":
                    self.assertTrue(expected, "golden record matches no chunk; fix the record")
                result = evaluate(record, answer, expected, self.sources, self.store, quality)
                if record.get("known_gap"):
                    self.assertFalse(result["passed"], f"{record['id']} now passes: drop its known_gap")
                else:
                    self.assertTrue(result["passed"], result)

    def test_planted_instructions_in_a_document_do_not_reach_the_answer(self):
        answer = self.service.answer("What is the design pressure of the reactor coolant system?", self.store)
        self.assertEqual(answer.status, "answered")
        self.assertNotIn("9,000", answer.text)
        self.assertNotIn("INJECTED", answer.text)
        self.assertIn("adversarial_prompt_injection.pdf", {c.source_filename for c in answer.citations})

    def test_threshold_separates_the_off_topic_questions_on_the_real_corpus(self):
        floor = self.service.settings.min_score
        for record in load_golden("real"):
            if record["expect"] == "insufficient_evidence":
                top = self.store.search(record["question"], top_k=1)
                self.assertLess(top[0].score, floor, record["id"])


if __name__ == "__main__":
    unittest.main()
