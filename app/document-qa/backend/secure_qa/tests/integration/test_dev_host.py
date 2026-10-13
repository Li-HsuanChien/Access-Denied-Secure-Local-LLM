"""Loopback HTTP contract between the development host and the Question Answering workflow (SDD §4.6)."""

from __future__ import annotations

import http.client
import json
import shutil
import tempfile
import threading
import unittest
from pathlib import Path

from dev_host import DevHost
from secure_qa.answering import AnswerService, AnswerSettings, FakeModelRuntime, ModelRuntimeError
from secure_qa.library import CollectionVersions, FakeEmbedder
from secure_qa.library.synthetic import synthetic_corpus
from secure_qa.paths import REPO_ROOT

WIRE_SCHEMA = Path(__file__).resolve().parents[2] / "answering" / "wire" / "answer.schema.json"


class DevHostTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dir = Path(tempfile.mkdtemp(prefix="dev-host-"))
        cls.versions = CollectionVersions(FakeEmbedder(), cls.dir)
        docs, chunks = synthetic_corpus()
        cls.versions.publish(chunks, [d.metadata() for d in docs])
        cls.runtime = FakeModelRuntime()
        cls.server = DevHost(0, AnswerService(cls.runtime, AnswerSettings(min_score=0.2), on_event=lambda e: None), cls.versions)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.port = cls.server.server_port

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.versions.close()
        shutil.rmtree(cls.dir, ignore_errors=True)

    def setUp(self):
        self.runtime.error = None

    def call(self, method: str, path: str, body=None, headers=None) -> tuple[int, dict, dict]:
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        raw = json.dumps(body).encode() if body is not None and not isinstance(body, bytes) else body
        conn.request(method, path, body=raw, headers={"Content-Type": "application/json", **(headers or {})})
        resp = conn.getresponse()
        data = resp.read()
        conn.close()
        return resp.status, json.loads(data) if data else {}, {k.lower(): v for k, v in resp.getheaders()}

    def ask(self, question="What is the annual occupational dose limit?", **extra):
        return self.call("POST", "/v1/requests", {"request_id": "r1", "operation": "answering.ask",
                                                  "payload": {"question": question, **extra}})

    def test_health_reports_library_and_model_state(self):
        status, body, _ = self.call("GET", "/health")
        self.assertEqual((status, body["status"], body["ready"]), (200, "ok", True))
        self.assertEqual(body["library"]["active_version"], "v0001")
        self.assertTrue(body["answering"]["stub"])

    def test_health_shows_why_answering_is_unavailable(self):
        self.runtime.error = ModelRuntimeError("runtime_unreachable", "The local model runtime isn't running", "Start it.")
        status, body, _ = self.call("GET", "/health")
        self.assertEqual((status, body["status"], body["answering"]["ready"]), (200, "degraded", False))
        self.assertEqual(body["answering"]["error"]["code"], "runtime_unreachable")

    def test_ask_returns_a_cited_answer_matching_the_wire_schema(self):
        status, body, _ = self.ask()
        self.assertEqual((status, body["request_id"], body["operation"]), (200, "r1", "answering.ask"))
        result = body["result"]
        self.assertEqual(result["status"], "answered")
        self.assertEqual(result["citations"][0]["source_filename"], "synthetic/radiation_protection_handbook.pdf")
        try:
            import jsonschema
        except ImportError:
            return
        jsonschema.Draft202012Validator(json.loads(WIRE_SCHEMA.read_text())).validate(result)

    def test_backend_failure_is_a_result_with_an_actionable_error(self):
        self.runtime.error = ModelRuntimeError("backend_timeout", "The model took too long to answer", "Try again.")
        status, body, _ = self.ask()
        self.assertEqual((status, body["result"]["status"]), (200, "failed"))
        self.assertEqual(body["result"]["error"], {"code": "backend_timeout", "message": "The model took too long to answer", "hint": "Try again."})

    def test_envelope_rejects_unknown_operations_and_fields(self):
        cases = [
            {"request_id": "r", "operation": "library.delete_everything", "payload": {}},
            {"request_id": "r", "operation": "answering.ask", "payload": {"question": "q", "temperature": 2}},
            {"request_id": "r", "operation": "answering.ask", "payload": {"question": "q"}, "debug": True},
            {"request_id": "r", "operation": "answering.ask", "payload": {"question": 5}},
            {"operation": "answering.ask", "payload": {"question": "q"}},
        ]
        for case in cases:
            with self.subTest(case):
                status, body, _ = self.call("POST", "/v1/requests", case)
                self.assertEqual((status, body["error"]["code"]), (400, "invalid_request"))
        status, body, _ = self.call("POST", "/v1/requests", b"{not json")
        self.assertEqual((status, body["error"]["code"]), (400, "invalid_json"))

    def test_rejects_non_local_host_and_origin(self):
        status, body, _ = self.call("GET", "/health", headers={"Host": "evil.example:8765"})
        self.assertEqual((status, body["error"]["code"]), (403, "host_not_allowed"))
        status, body, _ = self.call("GET", "/health", headers={"Origin": "https://evil.example"})
        self.assertEqual((status, body["error"]["code"]), (403, "origin_not_allowed"))

    def test_local_frontend_origin_gets_cors(self):
        status, _, headers = self.call("GET", "/health", headers={"Origin": "http://localhost:5173"})
        self.assertEqual((status, headers.get("access-control-allow-origin")), (200, "http://localhost:5173"))
        status, _, headers = self.call("OPTIONS", "/v1/requests", headers={"Origin": "tauri://localhost"})
        self.assertEqual(status, 204)
        self.assertIn("POST", headers["access-control-allow-methods"])

    def test_binds_loopback_only(self):
        self.assertEqual(self.server.server_address[0], "127.0.0.1")


FIXTURES = REPO_ROOT / "ingestion" / "fixtures"
CORPUS_FILES = [FIXTURES / "normal" / "normal_nrc_reactor_concepts_ch01.pdf",
                FIXTURES / "adversarial" / "adversarial_prompt_injection.pdf",
                FIXTURES / "corrupt" / "corrupt_empty.pdf"]


class _Base:
    def call(self, body):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=120)
        conn.request("POST", "/v1/requests", body=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
        resp = conn.getresponse()
        data = json.loads(resp.read())
        conn.close()
        return resp.status, data

    def op(self, operation, payload=None, request_id="r1"):
        return self.call({"request_id": request_id, "operation": operation, "payload": payload or {}})


@unittest.skipUnless(CORPUS_FILES[0].exists(), "needs E2's fixture PDFs")
class DevHostLibraryTest(_Base, unittest.TestCase):
    """What E4's Library screen calls: review, publish with confirmation, rollback, integrity."""

    @classmethod
    def setUpClass(cls):
        try:
            import pymupdf  # noqa: F401
        except ModuleNotFoundError:
            raise unittest.SkipTest("needs PyMuPDF")
        cls.dir = Path(tempfile.mkdtemp(prefix="dev-host-library-"))
        cls.corpus = cls.dir / "pdfs"
        cls.corpus.mkdir()
        for f in CORPUS_FILES:
            shutil.copy(f, cls.corpus / f.name)
        cls.versions = CollectionVersions(FakeEmbedder(), cls.dir / "store")
        cls.server = DevHost(0, AnswerService(FakeModelRuntime(), AnswerSettings(min_score=0.2), on_event=lambda e: None),
                             cls.versions, cls.corpus)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.port = cls.server.server_port

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.versions.close()
        shutil.rmtree(cls.dir, ignore_errors=True)

    def test_publish_rollback_republish_through_the_envelope(self):
        status, body = self.op("library.status")
        self.assertEqual((status, body["result"]["active"]), (200, None))

        # The review lists every file with its reason; nothing is published yet.
        status, body = self.op("library.review")
        review = body["result"]
        self.assertEqual((review["summary"]["accepted"], review["summary"]["rejected"]), (2, 1))
        self.assertEqual({f["filename"]: f["reject_reason"] for f in review["files"] if f["reject_reason"]}, {"corrupt_empty.pdf": "corrupt"})
        self.assertEqual(self.op("library.status")[1]["result"]["active"], None)

        # A rejected file needs explicit confirmation (SDD §6.1).
        status, body = self.op("library.publish", {"files": ["normal_nrc_reactor_concepts_ch01.pdf", "corrupt_empty.pdf"]})
        self.assertEqual((status, body["result"]["status"], body["result"]["version"]), (200, "needs_confirmation", None))
        status, body = self.op("library.publish", {"files": ["normal_nrc_reactor_concepts_ch01.pdf", "corrupt_empty.pdf"], "confirm_rejects": True})
        first = body["result"]
        self.assertEqual((first["status"], first["version"]["version_id"], first["integrity"]["ok"]), ("published", "v0001", True))
        self.assertEqual(first["library"]["active"], "v0001")
        self.assertNotIn("text", json.dumps(first["version"]))

        # Ask against v0001, publish a second version, and the first becomes the rollback version.
        self.assertEqual(self.op("answering.ask", {"question": "How long are the fuel rods?"})[1]["result"]["collection_version"], "v0001")
        status, body = self.op("library.publish", {"files": ["normal_nrc_reactor_concepts_ch01.pdf", "adversarial_prompt_injection.pdf"]})
        self.assertEqual((body["result"]["status"], body["result"]["library"]["previous"]), ("published", "v0001"))
        self.assertEqual(self.op("answering.ask", {"question": "What is the design pressure of the reactor coolant system?"})[1]["result"]["collection_version"], "v0002")

        status, body = self.op("library.rollback")
        self.assertEqual((status, body["result"]["active"], body["result"]["previous"]), (200, "v0001", "v0002"))
        status, body = self.op("library.integrity")
        self.assertEqual((body["result"]["version_id"], body["result"]["ok"]), ("v0001", True))

    def test_files_must_be_in_the_document_folder(self):
        status, body = self.op("library.publish", {"files": ["../../etc/passwd"]})
        self.assertEqual((status, body["error"]["code"]), (409, "unknown_file"))
        status, body = self.op("library.review", {"files": [5]})
        self.assertEqual((status, body["error"]["code"]), (409, "unknown_file"))

    def test_library_payloads_are_validated(self):
        status, body = self.op("library.publish", {"confirm_rejects": "yes"})
        self.assertEqual((status, body["error"]["code"]), (400, "invalid_request"))
        status, body = self.op("library.rollback", {"version": "v0001"})
        self.assertEqual((status, body["error"]["code"]), (400, "invalid_request"))


class DevHostNoCorpusTest(_Base, unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dir = Path(tempfile.mkdtemp(prefix="dev-host-nocorpus-"))
        cls.versions = CollectionVersions(FakeEmbedder(), cls.dir)
        cls.server = DevHost(0, AnswerService(FakeModelRuntime(), on_event=lambda e: None), cls.versions)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.port = cls.server.server_port

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.versions.close()
        shutil.rmtree(cls.dir, ignore_errors=True)

    def test_publish_without_a_corpus_folder_is_an_actionable_error(self):
        status, body = self.op("library.publish")
        self.assertEqual((status, body["error"]["code"]), (409, "no_corpus"))
        self.assertIn("--corpus", body["error"]["hint"])

    def test_rollback_and_integrity_with_nothing_published_are_actionable_errors(self):
        self.assertEqual(self.op("library.rollback")[1]["error"]["code"], "no_previous_version")
        self.assertEqual(self.op("library.integrity")[1]["error"]["code"], "no_active_collection")


if __name__ == "__main__":
    unittest.main()
