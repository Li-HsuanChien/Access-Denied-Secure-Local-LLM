"""No outbound network attempts while loading the embedder, publishing, searching and answering (SDD §10, §14).

A Python audit hook records every socket connect and DNS lookup made through
Python's socket module while the workflow runs; anything not on loopback fails
the test. The model runtime is E1's gateway contract served by a loopback double.
Limitation: connections opened directly from native code (outside Python's
socket module) aren't visible here; the packaged network-disabled tests in SDD §14
are still required.
"""

from __future__ import annotations

import ipaddress
import shutil
import sys
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path

from secure_qa.answering import AnswerService, LlamaCppGatewayRuntime
from secure_qa.library import CollectionVersions, FakeEmbedder
from secure_qa.library.embedding import DEFAULT_MODEL_PATH
from secure_qa.library.synthetic import synthetic_corpus

from .test_model_runtime import E1Double

_recording: list | None = None


def _audit(event: str, args: tuple) -> None:
    if _recording is None:
        return
    if event == "socket.connect":
        address = args[1]
        _recording.append(("connect", address[0] if isinstance(address, tuple) else str(address)))
    elif event == "socket.getaddrinfo":
        _recording.append(("dns", str(args[0])))


sys.addaudithook(_audit)  # audit hooks can't be removed; `_recording` switches it on and off


def _is_local(host: str) -> bool:
    if host in ("localhost", "") or host.startswith("/"):  # "" / paths: AF_UNIX sockets
        return True
    try:
        return ipaddress.ip_address(host.split("%")[0]).is_loopback
    except ValueError:
        return False


class OfflineTest(unittest.TestCase):
    def test_workflow_makes_no_non_loopback_connections(self):
        global _recording
        server = ThreadingHTTPServer(("127.0.0.1", 0), E1Double)
        server.mode, server.requests = "ok", []
        threading.Thread(target=server.serve_forever, daemon=True).start()
        root = Path(tempfile.mkdtemp(prefix="offline-"))
        _recording = []
        try:
            if (DEFAULT_MODEL_PATH / "modules.json").exists():
                from secure_qa.library import Embedder

                embedder = Embedder()  # loading the model must not reach a model hub
            else:
                embedder = FakeEmbedder()
            docs, chunks = synthetic_corpus()
            versions = CollectionVersions(embedder, root)
            versions.publish(chunks, [d.metadata() for d in docs])
            service = AnswerService(LlamaCppGatewayRuntime(f"http://127.0.0.1:{server.server_port}"), on_event=lambda e: None)
            answer = service.answer("What pressure is the primary coolant kept at?", versions.open_active())
            versions.close()
            seen = list(_recording)
        finally:
            _recording = None
            server.shutdown()
            server.server_close()
            shutil.rmtree(root, ignore_errors=True)

        self.assertNotEqual(answer.status, "failed", answer.error)
        self.assertTrue(any(kind == "connect" for kind, _ in seen), "expected the loopback call to the model runtime")
        outbound = [(kind, host) for kind, host in seen if not _is_local(host)]
        self.assertEqual(outbound, [], f"non-loopback network attempts: {outbound}")


if __name__ == "__main__":
    unittest.main()
