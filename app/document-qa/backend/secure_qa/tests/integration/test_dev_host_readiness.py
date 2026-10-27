"""Readiness and adapter selection without starting the loopback HTTP server."""

from __future__ import annotations

import unittest
from pathlib import Path
from types import SimpleNamespace

from dev_host import DevHost, create_embedder, resolve_embedding_mode
from secure_qa.library import FakeEmbedder


class DevHostReadinessTest(unittest.TestCase):
    def test_fake_embedder_is_available_without_staged_model_files(self):
        self.assertIsInstance(create_embedder("fake"), FakeEmbedder)

    def test_auto_mode_uses_fakes_only_for_the_unconfigured_qa_runtime(self):
        self.assertEqual(resolve_embedding_mode("fake", "auto"), "fake")
        self.assertEqual(resolve_embedding_mode("http://127.0.0.1:8080", "auto"), "local")
        self.assertEqual(resolve_embedding_mode("fake", "auto", "/staged/model"), "local")

    def test_missing_local_embedding_model_has_staging_instructions(self):
        with self.assertRaisesRegex(FileNotFoundError, "fetch_model.py"):
            create_embedder("local", Path("/missing/local-model"))

    def test_existing_collection_must_match_the_selected_embedder(self):
        host = object.__new__(DevHost)
        host.versions = SimpleNamespace(
            active=lambda: SimpleNamespace(version_id="v0001", chunk_count=12, documents={"doc1": {}},
                                           embedding_model="fake-hash-embedder", embedding_dim=64),
            embedder=FakeEmbedder(dimension=128),
        )
        health = host.library_health()
        self.assertFalse(health["ready"])
        self.assertEqual(health["error"]["code"], "embedding_model_mismatch")
        self.assertIn("republish", health["error"]["hint"].lower())


if __name__ == "__main__":
    unittest.main()
