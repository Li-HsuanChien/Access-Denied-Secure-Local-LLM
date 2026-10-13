"""The E1 gateway adapter against E1's runtime API contract 2026-09-v1.

`GatewayContractTest` runs against an in-process double that returns E1's
documented responses and error envelope. `LiveRuntimeTest` runs against a real
E1 runtime (stub or llama.cpp) when SECURE_QA_TEST_RUNTIME_URL is set, e.g.:

    docqa-runtime up --server-bin stub        # on E1's branch
    SECURE_QA_TEST_RUNTIME_URL=http://127.0.0.1:8080 python -m unittest secure_qa.answering.tests.test_model_runtime
"""

from __future__ import annotations

import json
import os
import socket
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from secure_qa.answering import ContextLengthExceeded, LlamaCppGatewayRuntime, ModelRuntimeError

HEALTH_OK = {
    "status": "ok", "ready": True, "api_version": "2026-09-v1", "runtime_version": "0.2.0",
    "engine": {"name": "llama.cpp", "server_version": "6543 (a1b2c3d)", "stub": False, "pid": 4312},
    "model": {"id": "qwen_qwen3-4b-instruct-2507-q4_k_m", "name": "Qwen3 4B Instruct 2507", "quant": "Q4_K_M",
              "architecture": "qwen3", "file_size_bytes": 2497280256, "ctx_size": 4096, "ctx_size_requested": 4096},
    "security": {"bind": "127.0.0.1", "loopback_only": True, "offline_mode": True},
    "error": None,
}


class E1Double(BaseHTTPRequestHandler):
    """Answers like E1's gateway (docs/api.md). `server.mode` picks the scenario."""

    def log_message(self, *args):
        pass

    def _send(self, status: int, body: dict) -> None:
        raw = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("X-DocQA-API-Version", "2026-09-v1")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        if self.path != "/health":
            return self._send(404, {"error": {"code": "not_found", "message": "no", "hint": "", "status": 404}})
        if self.server.mode == "loading":
            return self._send(503, HEALTH_OK | {"status": "loading", "ready": False})
        self._send(200, HEALTH_OK)

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        self.server.requests.append({"path": self.path, "host": self.headers["Host"], "body": body})
        if self.server.mode == "too_long":
            return self._send(400, {"error": {"message": "Prompt is 5000 tokens; context is 4096", "type": "invalid_request_error",
                                              "code": "context_length_exceeded", "hint": "Send fewer or shorter chunks.", "status": 400}})
        if self.server.mode == "crashed":
            return self._send(502, {"error": {"message": "Model process exited", "type": "server_error",
                                              "code": "backend_disconnected", "hint": "Restart the runtime.", "status": 502}})
        self._send(200, {
            "id": "chatcmpl-1", "object": "chat.completion", "created": 1790130000, "model": "qwen_qwen3-4b-instruct-2507-q4_k_m",
            "choices": [{"index": 0, "finish_reason": "stop", "message": {"role": "assistant", "content": "From your documents:\nX [S1]."}}],
            "usage": {"prompt_tokens": 1312, "completion_tokens": 58, "total_tokens": 1370},
            "timings": {"prompt_n": 1312, "predicted_n": 58},
        })


class GatewayContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), E1Double)
        cls.server.mode, cls.server.requests = "ok", []
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.runtime = LlamaCppGatewayRuntime(f"http://127.0.0.1:{cls.server.server_port}")

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def setUp(self):
        self.server.mode = "ok"
        self.server.requests.clear()

    def test_info_reads_model_version_and_context_size_from_health(self):
        info = self.runtime.info()
        self.assertEqual((info.model_id, info.quant, info.ctx_size, info.api_version, info.stub),
                         ("qwen_qwen3-4b-instruct-2507-q4_k_m", "Q4_K_M", 4096, "2026-09-v1", False))

    def test_complete_sends_a_non_streaming_openai_request(self):
        completion = self.runtime.complete([{"role": "user", "content": "hi"}], max_tokens=64, temperature=0.1, seed=42)
        self.assertEqual((completion.text, completion.prompt_tokens, completion.completion_tokens, completion.finish_reason),
                         ("From your documents:\nX [S1].", 1312, 58, "stop"))
        sent = self.server.requests[0]
        self.assertEqual(sent["path"], "/v1/chat/completions")
        self.assertEqual({k: sent["body"][k] for k in ("max_tokens", "temperature", "seed", "stream")},
                         {"max_tokens": 64, "temperature": 0.1, "seed": 42, "stream": False})
        self.assertTrue(sent["host"].startswith("127.0.0.1"))  # E1 rejects non-local Host headers

    def test_loading_runtime_is_a_runtime_error_with_hint(self):
        self.server.mode = "loading"
        with self.assertRaises(ModelRuntimeError) as ctx:
            self.runtime.info()
        self.assertEqual((ctx.exception.code, ctx.exception.status), ("model_loading", 503))
        self.assertTrue(ctx.exception.hint)

    def test_context_length_exceeded_is_its_own_error(self):
        self.server.mode = "too_long"
        with self.assertRaises(ContextLengthExceeded) as ctx:
            self.runtime.complete([{"role": "user", "content": "x"}], max_tokens=8, temperature=0, seed=1)
        self.assertEqual(ctx.exception.hint, "Send fewer or shorter chunks.")

    def test_backend_errors_keep_e1_code_and_hint(self):
        self.server.mode = "crashed"
        with self.assertRaises(ModelRuntimeError) as ctx:
            self.runtime.complete([{"role": "user", "content": "x"}], max_tokens=8, temperature=0, seed=1)
        self.assertEqual((ctx.exception.code, ctx.exception.hint), ("backend_disconnected", "Restart the runtime."))

    def test_runtime_not_running(self):
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            port = s.getsockname()[1]  # free port, nothing listening once closed
        with self.assertRaises(ModelRuntimeError) as ctx:
            LlamaCppGatewayRuntime(f"http://127.0.0.1:{port}").info()
        self.assertEqual(ctx.exception.code, "runtime_unreachable")

    def test_refuses_non_loopback_runtime(self):
        for url in ("http://10.0.0.5:8080", "http://example.com:8080", "https://127.0.0.1:8080", "http://0.0.0.0:8080"):
            with self.assertRaises(ValueError, msg=url):
                LlamaCppGatewayRuntime(url)
        LlamaCppGatewayRuntime("http://localhost:8080")
        LlamaCppGatewayRuntime("http://[::1]:8080")


@unittest.skipUnless(os.environ.get("SECURE_QA_TEST_RUNTIME_URL"), "set SECURE_QA_TEST_RUNTIME_URL to test against E1's runtime")
class LiveRuntimeTest(unittest.TestCase):
    def test_health_and_chat_against_e1(self):
        runtime = LlamaCppGatewayRuntime(os.environ["SECURE_QA_TEST_RUNTIME_URL"])
        info = runtime.info()
        self.assertEqual(info.api_version, "2026-09-v1")
        completion = runtime.complete([{"role": "user", "content": "Say hello."}], max_tokens=16, temperature=0, seed=1)
        self.assertTrue(completion.text)


if __name__ == "__main__":
    unittest.main()
