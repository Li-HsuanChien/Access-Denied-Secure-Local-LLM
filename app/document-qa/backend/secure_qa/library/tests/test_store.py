"""Contract tests for the Chroma document store.

Most tests use FakeEmbedder, so they need chromadb but not the embedding model.
`RealModelTest` runs only when models/all-MiniLM-L6-v2 is present.

    .venv/bin/python -m unittest discover -s tests -t . -v
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path

os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("ANONYMIZED_TELEMETRY", "False")

from secure_qa.library import Chunk, ChromaStore, EmbeddingMismatchError, FakeEmbedder, RetrievalError  # noqa: E402
from secure_qa.library.chunk import text_checksum  # noqa: E402
from secure_qa.library.embedding import DEFAULT_MODEL_PATH  # noqa: E402
from secure_qa.library.synthetic import PLACEHOLDER_QUERIES, synthetic_corpus  # noqa: E402

from secure_qa.paths import BACKEND_ROOT  # noqa: E402
E2_DIR = Path(__file__).resolve().parent / "fixtures" / "e2"


def e2_chunks() -> list[Chunk]:
    data = json.loads((E2_DIR / "nrc_all_chunks.json").read_text(encoding="utf-8"))
    return [Chunk.from_dict(c) for c in data["chunks"]]


class StoreTestCase(unittest.TestCase):
    embedder = FakeEmbedder()

    def setUp(self) -> None:
        self.dir = Path(tempfile.mkdtemp(prefix="library-test-"))
        self.store = ChromaStore(self.embedder, self.dir)

    def tearDown(self) -> None:
        self.store.close()
        shutil.rmtree(self.dir, ignore_errors=True)


class SchemaTest(unittest.TestCase):
    def test_e2_chunks_round_trip_through_dict(self):
        raw = json.loads((E2_DIR / "nrc_all_chunks.json").read_text(encoding="utf-8"))["chunks"]
        self.assertEqual([Chunk.from_dict(c).to_dict() for c in raw], raw)

    def test_synthetic_chunks_conform_to_e2_json_schema(self):
        try:
            import jsonschema
        except ImportError:
            self.skipTest("jsonschema not installed")
        validator = jsonschema.Draft202012Validator(json.loads((E2_DIR / "chunk.schema.json").read_text()))
        _, chunks = synthetic_corpus()
        for chunk in chunks:
            validator.validate(chunk.to_dict())

    def test_synthetic_ids_are_deterministic(self):
        first = [c.chunk_id for c in synthetic_corpus()[1]]
        self.assertEqual(first, [c.chunk_id for c in synthetic_corpus()[1]])
        self.assertEqual(len(first), len(set(first)))

    def test_rejects_other_schema_versions(self):
        data = e2_chunks()[0].to_dict() | {"schema_version": "2.0.0"}
        with self.assertRaises(ValueError):
            Chunk.from_dict(data)


class IndexSearchTest(StoreTestCase):
    def test_index_returns_index_result(self):
        _, chunks = synthetic_corpus()
        result = self.store.index(chunks)
        self.assertEqual(result.indexed, len(chunks))
        self.assertEqual(result.total, len(chunks))
        self.assertEqual(result.chunk_ids, [c.chunk_id for c in chunks])
        self.assertEqual((result.embedding_model, result.embedding_dim), ("fake-hash-embedder", 64))

    def test_search_returns_full_chunk_with_source_metadata(self):
        chunks = e2_chunks()
        self.store.index(chunks)
        by_id = {c.chunk_id: c for c in chunks}
        results = self.store.search("steam turbine generator", top_k=5)
        self.assertEqual([r.rank for r in results], [1, 2, 3, 4, 5])
        self.assertEqual([r.score for r in results], sorted((r.score for r in results), reverse=True))
        for r in results:
            self.assertEqual(r.chunk, by_id[r.chunk.chunk_id])  # every field, incl. page_spans and rects
            self.assertTrue(r.chunk.checksum_ok)

    def test_top_k_larger_than_collection(self):
        self.store.index(e2_chunks()[:3])
        self.assertEqual(len(self.store.search("reactor", top_k=10)), 3)

    def test_reindex_replaces_chunk(self):
        chunk = e2_chunks()[0]
        self.store.index([chunk])
        text = "Replacement text about pressurizer heaters."
        changed = replace(chunk, text=text, text_checksum_sha256=text_checksum(text), page_spans=chunk.page_spans[:1], page_end=1)
        self.store.index([changed])
        self.assertEqual(self.store.count(), 1)
        self.assertEqual(self.store.search("pressurizer", top_k=1)[0].chunk, changed)

    def test_rejects_duplicate_ids_and_bad_checksums(self):
        chunk = e2_chunks()[0]
        with self.assertRaises(ValueError):
            self.store.index([chunk, chunk])
        with self.assertRaises(ValueError):
            self.store.index([replace(chunk, text=chunk.text + " tampered")])
        self.assertEqual(self.store.count(), 0)

    def test_persists_across_process_restart(self):
        _, chunks = synthetic_corpus()
        self.store.index(chunks)
        expected = [r.chunk.chunk_id for r in self.store.search(PLACEHOLDER_QUERIES[0], top_k=3)]
        self.store.close()
        script = (
            "import json, sys; from secure_qa.library import ChromaStore, FakeEmbedder\n"
            "s = ChromaStore(FakeEmbedder(), sys.argv[1]); n = s.load()\n"
            f"print(json.dumps([n, [r.chunk.chunk_id for r in s.search({PLACEHOLDER_QUERIES[0]!r}, top_k=3)]]))"
        )
        out = subprocess.run([sys.executable, "-c", script, str(self.dir)], cwd=BACKEND_ROOT,
                             capture_output=True, text=True, check=True).stdout
        self.assertEqual(json.loads(out.strip().splitlines()[-1]), [len(chunks), expected])

    def test_min_score_drops_weak_results_and_keeps_ranks(self):
        self.store.index(e2_chunks())
        everything = self.store.search("steam turbine generator", top_k=10)
        cutoff = everything[2].score
        kept = self.store.search("steam turbine generator", top_k=10, min_score=cutoff)
        self.assertEqual([r.chunk.chunk_id for r in kept], [r.chunk.chunk_id for r in everything if r.score >= cutoff])
        self.assertEqual([r.rank for r in kept], list(range(1, len(kept) + 1)))
        self.assertEqual(self.store.search("steam turbine generator", top_k=10, min_score=1.01), [])

    def test_search_failure_raises_instead_of_returning_nothing(self):
        self.store.index(e2_chunks()[:3])
        self.store._client.delete_collection(self.store.collection_name)  # the store disappears underneath us
        with self.assertRaises(RetrievalError) as ctx:
            self.store.search("reactor")
        self.assertNotIn("reactor", str(ctx.exception))  # sanitized: no query text (SDD §15)

    def test_read_only_store_does_not_create_a_missing_collection(self):
        reader = ChromaStore(self.embedder, self.dir, "never_published", create=False)
        try:
            with self.assertRaises(RetrievalError):
                reader.search("reactor")
            self.assertNotIn("never_published", [c.name for c in self.store._client.list_collections()])
        finally:
            reader.close()

    def test_load_missing_collection(self):
        with self.assertRaises(LookupError):
            self.store.load()

    def test_refuses_collection_built_with_other_model(self):
        self.store.index(e2_chunks()[:2])
        self.store.close()
        other = ChromaStore(FakeEmbedder(dimension=32), self.dir)
        try:
            with self.assertRaises(EmbeddingMismatchError):
                other.load()
        finally:
            other.close()


@unittest.skipUnless((DEFAULT_MODEL_PATH / "modules.json").exists(), "embedding model not fetched")
class RealModelTest(StoreTestCase):
    @classmethod
    def setUpClass(cls):
        from secure_qa.library import Embedder

        cls.embedder = Embedder()

    def test_placeholder_queries_find_their_document(self):
        docs, chunks = synthetic_corpus()
        self.store.index(chunks)
        names = {d.document_id: d.source_filename for d in docs}
        expected = {
            "What pressure is the primary coolant kept at?": "reactor_coolant_systems",
            "What is the annual occupational dose limit?": "radiation_protection_handbook",
            "How soon must a broken safeguards seal be reported?": "safeguards_inspection_procedures",
            "How are Python packages installed without internet access?": "air_gap_deployment_guide",
        }
        for query, doc in expected.items():
            top = self.store.search(query, top_k=1)[0]
            self.assertIn(doc, names[top.chunk.document_id], query)


if __name__ == "__main__":
    unittest.main()
