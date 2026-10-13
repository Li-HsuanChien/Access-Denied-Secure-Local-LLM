"""Versioned local HTTP operations exercise feature interfaces without Chroma or model weights."""
import http.client
import json
import tempfile
import threading
import unittest
from pathlib import Path

from dev_host import DevHost
from secure_qa.history import ConversationHistory
from secure_qa.settings import Settings


class LibraryFake:
    def review(self, files): return {"accepted": [{"name": item["name"]} for item in files], "rejected": []}
    def publish(self, review_id, *, confirmed, request_id): return {"version_id": "v0001"}
    def cancel(self, request_id): return True
    def status(self, request_id): return {"status": "running"}
    def versions_list(self): return {"active": "v0001", "versions": []}
    def rollback(self): return {"version_id": "v0000"}


class WorkflowHostTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.history = ConversationHistory(root / "history.db")
        self.settings = Settings(root / "settings.db")
        self.server = DevHost(0, object(), object(), LibraryFake(), self.history, self.settings)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.history.close()
        self.temp.cleanup()

    def call(self, operation, payload, request_id="r1"):
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=2)
        connection.request("POST", "/v1/requests", json.dumps({"request_id": request_id, "operation": operation, "payload": payload}), {"Content-Type": "application/json"})
        response = connection.getresponse()
        body = json.loads(response.read())
        connection.close()
        return response.status, body

    def test_settings_and_history_operations_round_trip_persistent_records(self):
        status, result = self.call("settings.update", {"general_knowledge": False})
        self.assertEqual((status, result["result"]["general_knowledge"]), (200, False))
        self.call("history.save", {"conversation_id": "c1", "title": "Question", "answer": {"model": {"model_id": "m1"}, "collection_version": "v4"}})
        _, listed = self.call("history.list", {})
        self.assertEqual(listed["result"]["conversations"][0]["collection_version"], "v4")
        _, opened = self.call("history.open", {"conversation_id": "c1"})
        self.assertEqual(opened["result"]["conversation"]["answer"]["model"]["model_id"], "m1")

    def test_library_operations_dispatch_through_feature_module(self):
        status, result = self.call("library.review", {"files": [{"name": "one.pdf", "data": "JVBERi0="}]})
        self.assertEqual((status, result["result"]["accepted"][0]["name"]), (200, "one.pdf"))

    def test_unknown_fields_still_fail_closed_for_every_operation(self):
        status, result = self.call("history.clear", {"unexpected": True})
        self.assertEqual((status, result["error"]["code"]), (400, "invalid_request"))
