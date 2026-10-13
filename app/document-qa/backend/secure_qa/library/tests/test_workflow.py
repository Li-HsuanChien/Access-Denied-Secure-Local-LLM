import base64
import unittest

from secure_qa.library.workflow import CollectionLibrary


class Versions:
    def __init__(self): self.published = None
    def publish(self, chunks, docs, **kwargs):
        if kwargs["cancelled"](): raise RuntimeError("Publication cancelled")
        self.published = (chunks, docs)
        return type("Version", (), {"version_id": "v0001", "documents": docs, "chunk_count": len(chunks)})()
    def versions(self): return []
    def active(self): return None
    def rollback(self): return type("Version", (), {"version_id": "v0000"})()


class CollectionLibraryTest(unittest.TestCase):
    def setUp(self):
        self.versions = Versions()
        self.library = CollectionLibrary(self.versions, extract=lambda _data: [("Some useful document text." * 10, 612, 792)])

    def test_review_surfaces_rejections_and_requires_explicit_confirmation(self):
        result = self.library.review([
            {"name": "ok.pdf", "data": base64.b64encode(b"%PDF-valid").decode()},
            {"name": "bad.txt", "data": base64.b64encode(b"not a pdf").decode()},
        ])
        self.assertEqual(len(result["accepted"]), 1)
        self.assertEqual(len(result["rejected"]), 1)
        with self.assertRaisesRegex(ValueError, "confirm"):
            self.library.publish(result["review_id"], confirmed=False, request_id="r1")
        outcome = self.library.publish(result["review_id"], confirmed=True, request_id="r2")
        self.assertEqual(outcome["version_id"], "v0001")
        self.assertIsNotNone(self.versions.published)

    def test_all_rejected_review_cannot_publish(self):
        result = self.library.review([{"name": "bad.txt", "data": "bm90IGEgcGRm"}])
        with self.assertRaisesRegex(ValueError, "no accepted"):
            self.library.publish(result["review_id"], confirmed=True, request_id="r1")
