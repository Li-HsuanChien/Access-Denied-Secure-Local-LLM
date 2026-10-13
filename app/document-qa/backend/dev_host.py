"""Development stand-in for the Open WebUI host: a loopback-only test endpoint for the RAG answer path.

Until the pinned Open WebUI fork is in `app/document-qa/`, this gives the frontend
(E4) a live backend to call. It stays a thin adapter (backend/AGENTS.md): it
validates the SDD §4.6 request envelope and dispatches to the Question Answering
workflow; all behavior lives in `secure_qa`.

    python dev_host.py                                    # deterministic test model, seeded golden collection
    python dev_host.py --runtime http://127.0.0.1:8080    # E1's runtime (`docqa-runtime up`)

    GET  /health        host, library and model-runtime state
    POST /v1/requests   {"request_id": "...", "operation": "answering.ask",
                         "payload": {"question": "...", "general_knowledge": true}}
                        -> {"request_id": "...", "operation": "answering.ask", "result": <Answer, wire/answer.schema.json>}

Collection Library operations (the corpus is the PDFs under `--corpus`; payloads name files by file name only):

    library.status     {}                                       -> {"active", "previous", "versions": [...]}
    library.review     {"files": ["a.pdf"]}                     -> import review, nothing changes
    library.publish    {"files": [...], "confirm_rejects": bool} -> status published | needs_confirmation | nothing_to_publish | busy | failed
    library.rollback   {}                                       -> {"active", "previous", "versions": [...]}
    library.integrity  {}                                       -> stored counts and checksums against the manifest

A workflow outcome, including `status: "failed"`, is a 200 with `result`.
Transport problems (bad JSON, unknown operation or field) are 4xx with
`{"request_id", "error": {"code", "message", "hint"}}`. Progress events and
cancellation (SDD §4.6) are not implemented yet; the answer arrives in one response.
"""

from __future__ import annotations

import os

os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
os.environ.setdefault("ANONYMIZED_TELEMETRY", "False")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

import argparse  # noqa: E402
import json  # noqa: E402
from dataclasses import asdict  # noqa: E402
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer  # noqa: E402
from pathlib import Path  # noqa: E402
from urllib.parse import urlsplit  # noqa: E402

from secure_qa.answering import AnswerService, ModelRuntimeError  # noqa: E402
from secure_qa.answering.model_runtime import is_loopback  # noqa: E402
from secure_qa.library.corpus import pdfs_in  # noqa: E402
from secure_qa.library.publication import Publisher  # noqa: E402

API_VERSION = "secure-qa-dev/1"
MAX_BODY = 64 * 1024
OPERATIONS = {
    "answering.ask": ({"question": str, "general_knowledge": bool}, ("question",)),
    "library.status": ({}, ()),
    "library.review": ({"files": list}, ()),
    "library.publish": ({"files": list, "confirm_rejects": bool}, ()),
    "library.rollback": ({}, ()),
    "library.integrity": ({}, ()),
}
ENVELOPE = {"request_id", "operation", "payload"}
_LOCAL_ORIGIN_SCHEMES = ("tauri://", "app://")


class DevHost(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, port: int, service: AnswerService, versions, corpus: Path | None = None) -> None:
        super().__init__(("127.0.0.1", port), Handler)  # loopback only, never configurable (SDD §4.6, §10)
        self.service = service
        self.versions = versions
        self.corpus = corpus
        self.publisher = Publisher(versions)

    def corpus_files(self, names: list | None) -> list[Path]:
        """The PDFs a library request names, or all of them. Names must be files in the corpus folder."""
        if self.corpus is None:
            raise LibraryRequestError("no_corpus", "No document folder is configured", "Start the host with --corpus <folder of PDFs>.")
        available = {p.name: p for p in pdfs_in(self.corpus)}
        if names is None:
            return list(available.values())
        unknown = [n for n in names if not isinstance(n, str) or n not in available]
        if unknown:
            raise LibraryRequestError("unknown_file", f"{len(unknown)} file(s) aren't in the document folder",
                                      "Name files exactly as listed by library.review.")
        return [available[n] for n in names]

    def library_state(self) -> dict:
        found = self.versions.versions()
        return {"active": found[0].version_id if found else None,
                "previous": found[1].version_id if len(found) > 1 else None,
                "versions": [v.summary() for v in found]}

    def health(self) -> dict:
        try:
            info = self.service.runtime.info()
            model = {"ready": True, "model_id": info.model_id, "name": info.name, "quant": info.quant,
                     "ctx_size": info.ctx_size, "stub": info.stub, "error": None}
        except ModelRuntimeError as exc:
            model = {"ready": False, "error": {"code": exc.code, "message": exc.message, "hint": exc.hint}}
        active = self.versions.active()
        library = {"ready": active is not None,
                   "active_version": active.version_id if active else None,
                   "chunk_count": active.chunk_count if active else 0,
                   "document_count": len(active.documents) if active else 0,
                   "embedding_model": active.embedding_model if active else None}
        ready = model["ready"] and library["ready"]
        return {"status": "ok" if ready else "degraded", "ready": ready, "api_version": API_VERSION,
                "answering": model, "library": library}


class LibraryRequestError(Exception):
    def __init__(self, code: str, message: str, hint: str, status: int = 409) -> None:
        super().__init__(message)
        self.code, self.message, self.hint, self.status = code, message, hint, status


class Handler(BaseHTTPRequestHandler):
    server: DevHost
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):  # request lines only; never bodies (SDD §15)
        print(f"dev_host: {self.command} {self.path.split('?')[0]} -> {args[1] if len(args) > 1 else ''}", flush=True)

    # --- transport checks, mirroring E1's gateway ---------------------------------------

    def _origin_ok(self) -> bool:
        origin = self.headers.get("Origin")
        if origin is None or origin == "null" or origin.startswith(_LOCAL_ORIGIN_SCHEMES):
            return True
        url = urlsplit(origin)
        return url.scheme == "http" and is_loopback(url.hostname or "")

    def _guard(self) -> bool:
        host = (self.headers.get("Host") or "").rsplit(":", 1)[0].strip("[]")
        if not is_loopback(host):
            self._error(403, None, "host_not_allowed", "Only this computer may call the host", "Use http://127.0.0.1.")
            return False
        if not self._origin_ok():
            self._error(403, None, "origin_not_allowed", "Requests from web pages that aren't local are refused",
                        "Load the app from localhost or the desktop shell.")
            return False
        return True

    def _send(self, status: int, body: dict) -> None:
        raw = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Secure-QA-API-Version", API_VERSION)
        origin = self.headers.get("Origin")
        if origin and self._origin_ok():
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.end_headers()
        self.wfile.write(raw)

    def _error(self, status: int, request_id, code: str, message: str, hint: str) -> None:
        self._send(status, {"request_id": request_id, "error": {"code": code, "message": message, "hint": hint}})

    # --- routes --------------------------------------------------------------------------

    def do_OPTIONS(self):
        if not self._guard():
            return
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", self.headers.get("Origin", "null"))
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Max-Age", "600")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        if not self._guard():
            return
        if self.path.split("?")[0] != "/health":
            return self._error(404, None, "not_found", "Unknown path", "Use GET /health or POST /v1/requests.")
        self._send(200, self.server.health())

    def do_POST(self):
        if not self._guard():
            return
        if self.path.split("?")[0] != "/v1/requests":
            return self._error(404, None, "not_found", "Unknown path", "Use POST /v1/requests.")
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BODY:
            return self._error(413 if length > MAX_BODY else 411, None, "invalid_request", "Missing or oversized body", "Send a JSON body under 64 KiB.")
        try:
            body = json.loads(self.rfile.read(length))
        except (json.JSONDecodeError, UnicodeDecodeError):
            return self._error(400, None, "invalid_json", "The body isn't valid JSON", "Send a JSON object.")
        request_id, problem = validate(body)
        if problem:
            return self._error(400, request_id, "invalid_request", problem, "See the request envelope in dev_host.py.")
        payload = body["payload"]
        if body["operation"].startswith("library."):
            return self._library(request_id, body["operation"], payload)
        try:
            collection = self.server.versions.open_active()
        except LookupError:
            return self._error(409, request_id, "no_active_collection", "No collection is published yet", "Publish a collection, then ask again.")
        answer = self.server.service.answer(payload["question"], collection, request_id=request_id,
                                            general_knowledge=payload.get("general_knowledge"))
        self._send(200, {"request_id": request_id, "operation": body["operation"], "result": answer.to_dict()})


    def _library(self, request_id: str, operation: str, payload: dict) -> None:
        host = self.server
        try:
            if operation == "library.status":
                result = host.library_state()
            elif operation == "library.review":
                result = host.publisher.review(host.corpus_files(payload.get("files"))).to_dict()
            elif operation == "library.publish":
                outcome = host.publisher.publish(host.corpus_files(payload.get("files")),
                                                 confirm_rejects=payload.get("confirm_rejects", False))
                result = outcome.to_dict() | {"library": host.library_state()}
            elif operation == "library.rollback":
                try:
                    host.publisher.rollback()
                except LookupError:
                    raise LibraryRequestError("no_previous_version", "There is no previous version to roll back to",
                                              "Publish a second version first.") from None
                result = host.library_state()
            else:  # library.integrity
                try:
                    result = asdict(host.versions.check_integrity())
                except LookupError:
                    raise LibraryRequestError("no_active_collection", "No collection is published yet",
                                              "Publish a collection first.") from None
        except LibraryRequestError as exc:
            return self._error(exc.status, request_id, exc.code, exc.message, exc.hint)
        self._send(200, {"request_id": request_id, "operation": operation, "result": result})


def validate(body) -> tuple[str | None, str | None]:
    """Check the SDD §4.6 envelope. Unknown operations and fields are rejected."""
    if not isinstance(body, dict):
        return None, "The body must be a JSON object"
    request_id = body.get("request_id") if isinstance(body.get("request_id"), str) else None
    if extra := set(body) - ENVELOPE:
        return request_id, f"Unknown field(s): {', '.join(sorted(extra))}"
    if not request_id or len(request_id) > 128:
        return None, "request_id must be a non-empty string of at most 128 characters"
    spec = OPERATIONS.get(body.get("operation"))
    if spec is None:
        return request_id, f"Unknown operation {body.get('operation')!r}; supported: {', '.join(OPERATIONS)}"
    fields, required = spec
    payload = body.get("payload")
    if not isinstance(payload, dict):
        return request_id, "payload must be an object"
    if extra := set(payload) - fields.keys():
        return request_id, f"Unknown payload field(s): {', '.join(sorted(extra))}"
    for name, kind in fields.items():
        if name in payload and not isinstance(payload[name], kind):
            return request_id, f"payload.{name} must be {kind.__name__}"
    for name in required:
        if name not in payload:
            return request_id, f"payload.{name} is required"
    return request_id, None


def main() -> None:
    from secure_qa.answering import FakeModelRuntime, LlamaCppGatewayRuntime
    from secure_qa.answering.benchmarks.golden import golden_collection
    from secure_qa.library import CollectionVersions, Embedder
    from secure_qa.paths import DATA_DIR

    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--port", type=int, default=8765)
    p.add_argument("--runtime", default="fake", help="'fake' (deterministic test model) or E1's gateway URL")
    p.add_argument("--store", default=str(DATA_DIR / "dev_host_store"), help="collection root (catalog + Chroma directory)")
    p.add_argument("--corpus", type=Path, help="folder of PDFs the library.* operations review and publish (e.g. ingestion/fixtures)")
    args = p.parse_args()

    runtime = FakeModelRuntime() if args.runtime == "fake" else LlamaCppGatewayRuntime(args.runtime)
    print("dev_host: loading embedding model (offline) ...", flush=True)
    versions = CollectionVersions(Embedder(), args.store)
    if versions.active() is None:
        chunks, documents, _ = golden_collection()
        version = versions.publish(chunks, documents)
        print(f"dev_host: published the golden test collection as {version.version_id}", flush=True)
    server = DevHost(args.port, AnswerService(runtime), versions, args.corpus)
    print(f"dev_host: ready on http://127.0.0.1:{args.port}  (GET /health, POST /v1/requests)  "
          f"runtime={args.runtime} collection={versions.active().version_id}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        versions.close()


if __name__ == "__main__":
    main()
