"""Loopback HTTP contract between the development host and the Question Answering workflow (SDD §4.6)."""

from __future__ import annotations

import base64
import http.client
import json
import shutil
import tempfile
import threading
import unittest
from pathlib import Path

from dev_host import DevHost, create_embedder
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
        cls.sources = {d.metadata()["document_id"]: b"%PDF-1.4\n" + d.metadata()["document_id"].encode() for d in docs}
        cls.versions.publish(chunks, [d.metadata() for d in docs], sources=cls.sources)
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

    def test_health_reports_embedding_model_mismatch_before_a_question(self):
        original = self.versions.embedder
        self.versions.embedder = FakeEmbedder(dimension=128)
        try:
            status, body, _ = self.call("GET", "/health")
        finally:
            self.versions.embedder = original
        self.assertEqual((status, body["ready"]), (200, False))
        self.assertEqual(body["library"]["error"]["code"], "embedding_model_mismatch")
        self.assertIn("republish", body["library"]["error"]["hint"].lower())

    def test_question_is_rejected_when_collection_uses_another_embedding_model(self):
        original = self.versions.embedder
        self.versions.embedder = FakeEmbedder(dimension=128)
        try:
            status, body, _ = self.ask()
        finally:
            self.versions.embedder = original
        self.assertEqual((status, body["error"]["code"]), (409, "embedding_model_mismatch"))
        self.assertIn("republish", body["error"]["hint"].lower())

    def test_embedder_selection_keeps_fakes_explicit_and_local_model_errors_actionable(self):
        self.assertIsInstance(create_embedder("fake"), FakeEmbedder)
        with self.assertRaisesRegex(FileNotFoundError, "fetch_model.py"):
            create_embedder("local", Path(self.dir) / "missing-model")

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

    def test_settings_and_history_operations_round_trip_persistent_records(self):
        original = self.call("POST", "/v1/requests", {"request_id": "s0", "operation": "settings.get", "payload": {}})[1]["result"]["general_knowledge"]
        try:
            status, body, _ = self.call("POST", "/v1/requests", {"request_id": "s1", "operation": "settings.update", "payload": {"general_knowledge": False}})
            self.assertEqual((status, body["result"]["general_knowledge"]), (200, False))
            self.call("POST", "/v1/requests", {"request_id": "h1", "operation": "history.save",
                                               "payload": {"conversation_id": "c1", "title": "Question",
                                                           "answer": {"model": {"model_id": "m1"}, "collection_version": "v0001"}}})
            _, listed, _ = self.call("POST", "/v1/requests", {"request_id": "h2", "operation": "history.list", "payload": {}})
            self.assertEqual(listed["result"]["conversations"][0]["collection_version"], "v0001")
            _, opened, _ = self.call("POST", "/v1/requests", {"request_id": "h3", "operation": "history.open", "payload": {"conversation_id": "c1"}})
            self.assertEqual(opened["result"]["conversation"]["answer"]["model"]["model_id"], "m1")
            self.call("POST", "/v1/requests", {"request_id": "h4", "operation": "history.delete", "payload": {"conversation_id": "c1"}})
        finally:
            self.call("POST", "/v1/requests", {"request_id": "s2", "operation": "settings.update", "payload": {"general_knowledge": original}})

    def test_unknown_fields_still_fail_closed_for_every_operation(self):
        status, body, _ = self.call("POST", "/v1/requests", {"request_id": "r", "operation": "history.clear", "payload": {"unexpected": True}})
        self.assertEqual((status, body["error"]["code"]), (400, "invalid_request"))

    def _get(self, path: str, headers=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        conn.request("GET", path, headers={**(headers or {})})
        resp = conn.getresponse()
        data = resp.read()
        conn.close()
        return resp.status, data, {k.lower(): v for k, v in resp.getheaders()}

    def test_source_route_streams_a_cached_pdf_and_rejects_bad_or_unknown_ids(self):
        document_id, data = next(iter(self.sources.items()))
        status, body, headers = self._get(f"/v1/source?document_id={document_id}")
        self.assertEqual(status, 200)
        self.assertEqual(headers["content-type"], "application/pdf")
        self.assertEqual(headers.get("content-disposition"), "inline")
        self.assertEqual(body, data)

        # Unknown document -> 404 (it is not in the manifest).
        self.assertEqual(self._get("/v1/source?document_id=doc_unknown")[0], 404)
        # Malformed id (traversal attempt) -> 400 before any path work.
        self.assertEqual(self._get("/v1/source?document_id=../secret")[0], 400)
        # Missing id -> 400.
        self.assertEqual(self._get("/v1/source")[0], 400)

    def test_source_route_is_loopback_guarded(self):
        document_id = next(iter(self.sources))
        status, _, _ = self._get(f"/v1/source?document_id={document_id}", headers={"Host": "example.com"})
        self.assertEqual(status, 403)

    def test_conversation_id_builds_one_thread_with_memory_across_turns(self):
        room = "mem_room"
        try:
            # Two questions in the same room.
            s1, a1, _ = self.ask("What is the annual occupational dose limit?", conversation_id=room)
            s2, a2, _ = self.ask("And what about the public?", conversation_id=room)
            self.assertEqual(s1, 200)
            self.assertEqual(s2, 200)

            # One room, not one-history-per-message.
            _, listed, _ = self.call("POST", "/v1/requests", {"request_id": "l", "operation": "history.list", "payload": {}})
            rooms = [c for c in listed["result"]["conversations"] if c["conversation_id"] == room]
            self.assertEqual(len(rooms), 1)

            # The thread accumulates both turns (user+assistant each) and a running summary.
            _, opened, _ = self.call("POST", "/v1/requests", {"request_id": "o", "operation": "history.open", "payload": {"conversation_id": room}})
            convo = opened["result"]["conversation"]
            self.assertEqual([m["role"] for m in convo["messages"]], ["user", "assistant", "user", "assistant"])
            self.assertEqual(convo["messages"][0]["content"], "What is the annual occupational dose limit?")
            self.assertTrue(convo["summary"].strip())
        finally:
            self.call("POST", "/v1/requests", {"request_id": "d", "operation": "history.delete", "payload": {"conversation_id": room}})


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
    """What E4's Library screen calls: upload review, publish with confirmation, versions, rollback, integrity."""

    @classmethod
    def setUpClass(cls):
        try:
            import pymupdf  # noqa: F401
        except ModuleNotFoundError:
            raise unittest.SkipTest("needs PyMuPDF")
        cls.dir = Path(tempfile.mkdtemp(prefix="dev-host-library-"))
        cls.versions = CollectionVersions(FakeEmbedder(), cls.dir / "store")
        cls.server = DevHost(0, AnswerService(FakeModelRuntime(), AnswerSettings(min_score=0.2), on_event=lambda e: None),
                             cls.versions)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.port = cls.server.server_port

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.versions.close()
        shutil.rmtree(cls.dir, ignore_errors=True)

    def upload(self, *paths):
        return [{"name": p.name, "data": base64.b64encode(p.read_bytes()).decode()} for p in paths]

    def review(self, *paths):
        return self.op("library.review", {"files": self.upload(*paths)})[1]["result"]

    def test_upload_review_publish_versions_rollback_through_the_envelope(self):
        normal, adversarial, corrupt = CORPUS_FILES

        self.assertEqual(self.op("library.versions")[1]["result"]["active"], None)

        # Review lists accepted + rejected; a rejected file requires confirmation (SDD §6.1).
        review = self.review(normal, corrupt)
        self.assertEqual(len(review["accepted"]), 1)
        self.assertEqual([r["name"] for r in review["rejected"]], ["corrupt_empty.pdf"])
        self.assertTrue(review["requires_confirmation"])
        self.assertEqual(self.op("library.versions")[1]["result"]["active"], None)

        # Publishing a review with a rejected file is refused until confirmed.
        status, body = self.op("library.publish", {"review_id": review["review_id"]})
        self.assertEqual((status, body["error"]["code"]), (409, "needs_confirmation"))

        # Confirm the accepted remainder -> v0001 (a fresh review id, since the first wasn't consumed).
        review = self.review(normal, corrupt)
        status, body = self.op("library.publish", {"review_id": review["review_id"], "confirmed": True})
        self.assertEqual((status, body["result"]["version_id"]), (200, "v0001"))
        self.assertEqual(body["result"]["document_count"], 1)
        self.assertGreater(body["result"]["chunk_count"], 0)

        listing = self.op("library.versions")[1]["result"]
        self.assertEqual(listing["active"], "v0001")
        self.assertEqual([v["version_id"] for v in listing["versions"]], ["v0001"])
        self.assertEqual(self.op("answering.ask", {"question": "How long are the fuel rods?"})[1]["result"]["collection_version"], "v0001")

        # A second, all-valid upload publishes without confirmation; the first becomes the rollback version.
        review = self.review(normal, adversarial)
        self.assertEqual(self.op("library.publish", {"review_id": review["review_id"]})[1]["result"]["version_id"], "v0002")
        self.assertEqual(self.op("library.rollback")[1]["result"]["version_id"], "v0001")
        self.assertEqual(self.op("library.integrity")[1]["result"]["ok"], True)

    def test_unknown_review_and_payload_validation(self):
        self.assertEqual(self.op("library.publish", {"review_id": "nope"})[1]["error"]["code"], "unknown_review")
        self.assertEqual(self.op("library.review", {"files": [5]})[1]["error"]["code"], "invalid_request")
        self.assertEqual(self.op("library.publish", {"review_id": 3})[1]["error"]["code"], "invalid_request")


class DevHostEmptyLibraryTest(_Base, unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dir = Path(tempfile.mkdtemp(prefix="dev-host-empty-"))
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

    def test_versions_rollback_and_integrity_with_nothing_published_are_actionable(self):
        self.assertEqual(self.op("library.versions")[1]["result"], {"active": None, "versions": []})
        self.assertEqual(self.op("library.rollback")[1]["error"]["code"], "no_previous_version")
        self.assertEqual(self.op("library.integrity")[1]["error"]["code"], "no_active_collection")


if __name__ == "__main__":
    unittest.main()
