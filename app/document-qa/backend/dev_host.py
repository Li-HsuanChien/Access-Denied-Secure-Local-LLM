"""Loopback-only development host for frontend and workflow contract testing.

It stays a thin adapter (backend/AGENTS.md): it validates the versioned request
envelope and dispatches to workflow modules; behavior lives in `secure_qa`.

    python dev_host.py                                    # deterministic test model, seeded golden collection
    python dev_host.py --runtime http://127.0.0.1:8080    # E1 gateway + staged local embedding model
    python dev_host.py --runtime http://127.0.0.1:8080 --embedding-model /path/to/all-MiniLM-L6-v2

    GET  /health        host, library and model-runtime state
    POST /v1/requests   {"request_id": "...", "operation": "answering.ask",
                         "payload": {"question": "...", "general_knowledge": true}}
                        -> {"request_id": "...", "operation": "answering.ask", "result": <Answer, wire/answer.schema.json>}

    Other operations manage PDF review/publication, local history and approved settings.

A workflow outcome, including `status: "failed"`, is a 200 with `result`.
Transport problems (bad JSON, unknown operation or field) are 4xx with
`{"request_id", "error": {"code", "message", "hint"}}`. Library progress is
polled by request ID; cancellation checks leave the active collection unchanged.
"""

from __future__ import annotations

import os

os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
os.environ.setdefault("ANONYMIZED_TELEMETRY", "False")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

import argparse  # noqa: E402
import json  # noqa: E402
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer  # noqa: E402
from urllib.parse import urlsplit  # noqa: E402

from secure_qa.answering import AnswerService, ModelRuntimeError  # noqa: E402
from secure_qa.answering.model_runtime import is_loopback  # noqa: E402

API_VERSION = "secure-qa-dev/1"
MAX_BODY = 150 * 1024 * 1024
OPERATIONS = {
    "answering.ask": {"question": str, "general_knowledge": bool},
    "library.review": {"files": list}, "library.publish": {"review_id": str, "confirmed": bool},
    "library.cancel": {"target_request_id": str}, "library.status": {"target_request_id": str},
    "library.versions": {}, "library.rollback": {},
    "history.save": {"conversation_id": str, "title": str, "answer": dict},
    "history.list": {}, "history.open": {"conversation_id": str}, "history.delete": {"conversation_id": str},
    "history.clear": {}, "history.enabled": {}, "history.set_enabled": {"enabled": bool},
    "settings.get": {}, "settings.update": {"general_knowledge": bool},
}
OPTIONAL = {("answering.ask", "general_knowledge")}  # omitted, it falls back to the saved setting
ENVELOPE = {"request_id", "operation", "payload"}
_LOCAL_ORIGIN_SCHEMES = ("tauri://", "app://")


class DevHost(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, port: int, service: AnswerService, versions, library=None, history=None, settings=None) -> None:
        super().__init__(("127.0.0.1", port), Handler)  # loopback only, never configurable (SDD §4.6, §10)
        self.service = service
        self.versions = versions
        if history is None:
            from secure_qa.history import ConversationHistory
            history = ConversationHistory(versions.root / "history.sqlite3")
        if settings is None:
            from secure_qa.settings import Settings
            settings = Settings(versions.root / "settings.sqlite3")
        if library is None:
            from secure_qa.library.workflow import CollectionLibrary
            library = CollectionLibrary(versions)
        self.library, self.history, self.settings = library, history, settings

    def library_health(self) -> dict:
        active = self.versions.active()
        embedding_error = None
        if active is None:
            embedding_error = {"code": "no_active_collection", "message": "No collection is published yet",
                               "hint": "Publish a collection using the configured local embedding model."}
        elif (active.embedding_model, active.embedding_dim) != (self.versions.embedder.model_name,
                                                                  self.versions.embedder.dimension):
            embedding_error = {
                "code": "embedding_model_mismatch",
                "message": (f"The active collection uses {active.embedding_model} ({active.embedding_dim}-dim), "
                            f"but this host uses {self.versions.embedder.model_name} "
                            f"({self.versions.embedder.dimension}-dim)"),
                "hint": "Republish the collection with the configured embedding model before asking questions.",
            }
        return {"ready": active is not None and embedding_error is None,
                "active_version": active.version_id if active else None,
                "chunk_count": active.chunk_count if active else 0,
                "document_count": len(active.documents) if active else 0,
                "embedding_model": active.embedding_model if active else self.versions.embedder.model_name,
                "error": embedding_error}

    def health(self) -> dict:
        try:
            info = self.service.runtime.info()
            model = {"ready": True, "model_id": info.model_id, "name": info.name, "quant": info.quant,
                     "ctx_size": info.ctx_size, "api_version": info.api_version,
                     "runtime_version": info.runtime_version, "stub": info.stub, "error": None}
        except ModelRuntimeError as exc:
            model = {"ready": False, "error": {"code": exc.code, "message": exc.message, "hint": exc.hint}}
        library = self.library_health()
        ready = model["ready"] and library["ready"]
        return {"status": "ok" if ready else "degraded", "ready": ready, "api_version": API_VERSION,
                "answering": model, "library": library,
                "preferences": self.settings.read() | {"history_enabled": self.history.enabled()}}


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
            return self._error(413 if length > MAX_BODY else 411, None, "invalid_request", "Missing or oversized body", "Send a JSON body under 150 MiB.")
        try:
            body = json.loads(self.rfile.read(length))
        except (json.JSONDecodeError, UnicodeDecodeError):
            return self._error(400, None, "invalid_json", "The body isn't valid JSON", "Send a JSON object.")
        request_id, problem = validate(body)
        if problem:
            return self._error(400, request_id, "invalid_request", problem, "See the request envelope in dev_host.py.")
        payload = body["payload"]
        if body["operation"] == "answering.ask":
            err = self.server.library_health()["error"]
            if err and err["code"] == "embedding_model_mismatch":
                return self._error(409, request_id, err["code"], err["message"], err["hint"])
        try:
            operation = body["operation"]
            if operation == "answering.ask":
                try:
                    collection = self.server.versions.open_active()
                except LookupError:
                    return self._error(409, request_id, "no_active_collection", "No collection is published yet", "Publish a collection, then ask again.")
                general = payload.get("general_knowledge", self.server.settings.read()["general_knowledge"])
                result = self.server.service.answer(payload["question"], collection, request_id=request_id,
                                                    general_knowledge=general).to_dict()
            elif operation == "library.review": result = self.server.library.review(payload["files"])
            elif operation == "library.publish": result = self.server.library.publish(payload["review_id"], confirmed=payload["confirmed"], request_id=request_id)
            elif operation == "library.cancel": result = {"cancelled": self.server.library.cancel(payload["target_request_id"])}
            elif operation == "library.status": result = self.server.library.status(payload["target_request_id"])
            elif operation == "library.versions": result = self.server.library.versions_list()
            elif operation == "library.rollback": result = self.server.library.rollback()
            elif operation == "history.save": result = {"saved": self.server.history.save(payload["conversation_id"], payload["title"], payload["answer"])}
            elif operation == "history.list": result = {"conversations": self.server.history.list()}
            elif operation == "history.open": result = {"conversation": self.server.history.open(payload["conversation_id"])}
            elif operation == "history.delete": result = {"deleted": self.server.history.delete(payload["conversation_id"])}
            elif operation == "history.clear": self.server.history.clear(); result = {"cleared": True}
            elif operation == "history.enabled": result = {"enabled": self.server.history.enabled()}
            elif operation == "history.set_enabled": self.server.history.set_enabled(payload["enabled"]); result = {"enabled": self.server.history.enabled()}
            elif operation == "settings.get": result = self.server.settings.read()
            elif operation == "settings.update": result = self.server.settings.update(general_knowledge=payload["general_knowledge"])
            else: return self._error(400, request_id, "invalid_request", "Unknown operation", "Choose a supported local workflow operation.")
        except LookupError as exc:
            return self._error(404, request_id, "not_found", str(exc), "Refresh the local workflow and try again.")
        except ValueError as exc:
            return self._error(400, request_id, "invalid_request", str(exc), "Review the selected files and options.")
        except Exception:
            return self._error(500, request_id, "workflow_failed", "The local workflow could not finish.", "The current answer and active collection are preserved; retry after reviewing local storage.")
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
    fields = OPERATIONS.get(body.get("operation"))
    if fields is None:
        return request_id, f"Unknown operation {body.get('operation')!r}; supported: {', '.join(OPERATIONS)}"
    payload = body.get("payload")
    if not isinstance(payload, dict):
        return request_id, "payload must be an object"
    if extra := set(payload) - fields.keys():
        return request_id, f"Unknown payload field(s): {', '.join(sorted(extra))}"
    for name, kind in fields.items():
        if name in payload and not isinstance(payload[name], kind):
            return request_id, f"payload.{name} must be {kind.__name__}"
    if body["operation"] == "library.review":
        for index, item in enumerate(payload["files"]):
            if not isinstance(item, dict) or set(item) != {"name", "data"} or not isinstance(item["name"], str) or not isinstance(item["data"], str):
                return request_id, f"payload.files[{index}] must contain only string name and data fields"
    missing = {name for name in fields.keys() - payload.keys() if (body["operation"], name) not in OPTIONAL}
    if missing:
        return request_id, f"payload.{sorted(missing)[0]} is required"
    return request_id, None


def create_embedder(mode: str, model_path=None):
    """Choose the QA fake explicitly or load the staged, offline production embedder."""
    from secure_qa.library import Embedder, FakeEmbedder

    if mode == "fake":
        return FakeEmbedder()
    if mode != "local":
        raise ValueError("embedding mode must be 'fake' or 'local'")
    try:
        return Embedder(model_path) if model_path is not None else Embedder()
    except ImportError as exc:
        raise RuntimeError(
            "The local embedding dependencies aren't installed. Install the pinned backend requirements "
            "on the connected staging machine, stage the model, then run this host offline."
        ) from exc


def resolve_embedding_mode(runtime: str, requested: str, model_path=None) -> str:
    """Default QA to fakes, while treating an explicit local path as a real embedder choice."""
    if requested != "auto":
        return requested
    return "fake" if runtime == "fake" and model_path is None else "local"


def main() -> None:
    from secure_qa.answering import FakeModelRuntime, LlamaCppGatewayRuntime
    from secure_qa.answering.benchmarks.golden import golden_collection
    from secure_qa.library import CollectionVersions
    from secure_qa.library.workflow import CollectionLibrary
    from secure_qa.history import ConversationHistory
    from secure_qa.settings import Settings
    from secure_qa.paths import DATA_DIR

    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--port", type=int, default=8765)
    p.add_argument("--runtime", default="fake", help="'fake' (deterministic QA) or E1's loopback gateway URL")
    p.add_argument("--embedding", choices=("auto", "fake", "local"), default="auto",
                   help="auto uses fake embeddings only with --runtime fake; real gateway mode uses the staged local model")
    p.add_argument("--embedding-model", help="path to the staged Sentence Transformers model directory")
    p.add_argument("--store", help="collection root; defaults to a separate fake or local-embedding QA store")
    args = p.parse_args()

    runtime = FakeModelRuntime() if args.runtime == "fake" else LlamaCppGatewayRuntime(args.runtime)
    embedding_mode = resolve_embedding_mode(args.runtime, args.embedding, args.embedding_model)
    try:
        embedder = create_embedder(embedding_mode, args.embedding_model)
    except (OSError, RuntimeError, ValueError) as exc:
        p.exit(2, f"dev_host: local embedding model unavailable: {exc}\n")
    store = args.store or str(DATA_DIR / ("dev_host_fake_store" if embedding_mode == "fake" else "dev_host_local_store"))
    versions = CollectionVersions(embedder, store)
    if versions.active() is None and embedding_mode == "fake":
        chunks, documents, _ = golden_collection()
        version = versions.publish(chunks, documents)
        print(f"dev_host: published the golden test collection as {version.version_id}", flush=True)
    elif versions.active() is None:
        print("dev_host: no local collection is published; health will remain degraded until one is published", flush=True)
    history = ConversationHistory(DATA_DIR / "history.sqlite3")
    settings = Settings(DATA_DIR / "settings.sqlite3")
    library = CollectionLibrary(versions)
    server = DevHost(args.port, AnswerService(runtime), versions, library, history, settings)
    print(f"dev_host: ready on http://127.0.0.1:{args.port}  (GET /health, POST /v1/requests)  "
          f"runtime={args.runtime} embedding={embedding_mode} collection="
          f"{versions.active().version_id if versions.active() else 'none'}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        versions.close()
        history.close()


if __name__ == "__main__":
    main()
