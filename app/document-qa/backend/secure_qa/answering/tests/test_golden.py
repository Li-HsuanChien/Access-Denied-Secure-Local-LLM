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
from secure_qa.answering.benchmarks.golden import build_store, evaluate, expected_chunk_ids, load_golden
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


if __name__ == "__main__":
    unittest.main()
