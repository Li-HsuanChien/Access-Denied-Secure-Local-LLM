"""Loopback-only development host for frontend and workflow contract testing.

It stays a thin adapter (backend/AGENTS.md): it validates the versioned request
envelope and dispatches to workflow modules; behavior lives in `secure_qa`.

    python dev_host.py                                    # deterministic test model, seeded golden collection
    python dev_host.py --runtime http://127.0.0.1:8080    # E1 gateway + staged local embedding model

    GET  /health        host, library and model-runtime state
    GET  /v1/source?document_id=..&version=..             cached source PDF for a citation (ADR 0006)
    POST /v1/requests   {"request_id": "...", "operation": "answering.ask",
                         "payload": {"question": "...", "general_knowledge": true}}
                        -> {"request_id": "...", "operation": "answering.ask", "result": <Answer, wire/answer.schema.json>}

Collection Library operations (browser-upload wire over E2's real ingestion, ADR 0004/0006):

    library.review     {"files": [{"name", "data"(base64 PDF)}]} -> {review_id, accepted:[{name,size}], rejected:[{name,reason}], warning, requires_confirmation}
    library.publish    {"review_id", "confirmed": bool}          -> {version_id, document_count, chunk_count}  (409 needs_confirmation | nothing_to_publish | busy)
    library.cancel     {"target_request_id"}                     -> {cancelled}  (publication is synchronous here)
    library.status     {"target_request_id"}                     -> {stage, done, total}  (progress; synchronous here)
    library.versions   {}                                        -> {active, versions:[{version_id,status,created_at,document_count,chunk_count}]}
    library.rollback   {}                                        -> {version_id}
    library.integrity  {}                                        -> stored counts and checksums against the manifest

Local history and approved settings are also served (history.*, settings.*).

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
import base64  # noqa: E402
import binascii  # noqa: E402
import json  # noqa: E402
import re  # noqa: E402
import shutil  # noqa: E402
import threading  # noqa: E402
import uuid  # noqa: E402
from dataclasses import asdict  # noqa: E402
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer  # noqa: E402
from pathlib import Path  # noqa: E402
from urllib.parse import parse_qs, urlsplit  # noqa: E402

from secure_qa.answering import AnswerService, ModelRuntimeError  # noqa: E402
from secure_qa.answering import memory as answer_memory  # noqa: E402
from secure_qa.answering.answer import Notice
from secure_qa.answering.memory import Conversation  # noqa: E402
from secure_qa.answering.model_runtime import is_loopback  # noqa: E402
from secure_qa.library.corpus import pdfs_in  # noqa: E402
from secure_qa.library.publication import (  # noqa: E402
    BUSY, FAILED, NEEDS_CONFIRMATION, NOTHING_TO_PUBLISH, PUBLISHED, Publisher,
)

API_VERSION = "secure-qa-dev/1"
MAX_BODY = 150 * 1024 * 1024  # 150 MiB: browser PDF uploads (library.review) carry base64 bytes in the request body
OPERATIONS = {
    # conversation_id optional -> per-room memory (append turns, summary, follow-up query rewrite); general_knowledge optional -> saved setting
    "answering.ask": ({"question": str, "general_knowledge": bool, "conversation_id": str}, ("question",)),
    # Browser-upload library wire (ADR 0004 un-retired on the host over E2's real ingestion):
    "library.review": ({"files": list}, ("files",)),                        # files: [{name, data(base64)}]
    "library.publish": ({"review_id": str, "confirmed": bool}, ("review_id",)),
    "library.cancel": ({"target_request_id": str}, ("target_request_id",)),
    "library.status": ({"target_request_id": str}, ("target_request_id",)),  # publication progress (synchronous here)
    "library.versions": ({}, ()),
    "library.set_document_enabled": ({"version_id": str, "document_id": str, "enabled": bool}, ("version_id", "document_id", "enabled")),
    "library.delete_document": ({"version_id": str, "document_id": str, "confirmed": bool}, ("version_id", "document_id", "confirmed")),
    "library.rollback": ({}, ()),
    "library.integrity": ({}, ()),
    "history.save": ({"conversation_id": str, "title": str, "answer": dict}, ("conversation_id", "title", "answer")),
    "history.list": ({}, ()),
    "history.open": ({"conversation_id": str}, ("conversation_id",)),
    "history.delete": ({"conversation_id": str}, ("conversation_id",)),
    "history.clear": ({}, ()),
    "history.enabled": ({}, ()),
    "history.set_enabled": ({"enabled": bool}, ("enabled",)),
    "settings.get": ({}, ()),
    "settings.update": ({"general_knowledge": bool}, ("general_knowledge",)),
}
ENVELOPE = {"request_id", "operation", "payload"}
_LOCAL_ORIGIN_SCHEMES = ("tauri://", "app://")
_SOURCE_ID = re.compile(r"^[A-Za-z0-9_-]{1,128}$")  # defense-in-depth; source_path also checks manifest membership


class DevHost(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, port: int, service: AnswerService, versions, corpus: Path | None = None,
                 history=None, settings=None) -> None:
        super().__init__(("127.0.0.1", port), Handler)  # loopback only, never configurable (SDD §4.6, §10)
        self.service = service
        self.versions = versions
        self.corpus = corpus
        self.publisher = Publisher(versions)
        self.library_job = threading.Lock()
        # Ephemeral upload state: a review id -> (CorpusReview, staged temp dir). Not durable workflow state.
        self._reviews: dict = {}
        self._reviews_lock = threading.Lock()
        self._uploads = versions.root / "uploads"
        shutil.rmtree(self._uploads, ignore_errors=True)  # no uploads survive a restart
        if history is None:
            from secure_qa.history import ConversationHistory
            history = ConversationHistory(versions.root / "history.sqlite3")
        if settings is None:
            from secure_qa.settings import Settings
            settings = Settings(versions.root / "settings.sqlite3")
        self.history, self.settings = history, settings

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

    # --- browser-upload library wire (ADR 0004 un-retired over E2 ingestion) ------------

    def review_upload(self, files: list) -> dict:
        """Stage uploaded PDFs to a temp dir, validate/chunk them, and cache the review."""
        review_id = uuid.uuid4().hex
        staged = self._uploads / review_id
        paths = []
        for index, item in enumerate(files):
            name = Path(item["name"]).name or "upload.pdf"  # basename only; never a client path
            if not name.lower().endswith(".pdf"):
                name += ".pdf"
            try:
                data = base64.b64decode(item["data"], validate=True)
            except (binascii.Error, ValueError):
                shutil.rmtree(staged, ignore_errors=True)
                raise LibraryRequestError("invalid_upload", f"{item['name']!r} is not valid base64 data",
                                          "Re-select the file and try again.", status=400) from None
            sub = staged / str(index)
            sub.mkdir(parents=True, exist_ok=True)
            (sub / name).write_bytes(data)
            paths.append(sub / name)
        review = self.publisher.review(paths)
        with self._reviews_lock:
            self._reviews[review_id] = (review, staged)
        return {
            "review_id": review_id,
            "accepted": [{"name": f.filename, "size": f.byte_size} for f in review.accepted],
            "rejected": [{"name": f.filename, "reason": f.reject_reason or "rejected"} for f in review.rejected],
            "warning": f"{len(review.warned)} file(s) imported with warnings." if review.warned else None,
            "requires_confirmation": bool(review.rejected),
        }

    def publish_review(self, review_id: str, confirmed: bool) -> dict:
        with self._reviews_lock:
            entry = self._reviews.get(review_id)
        if entry is None:
            raise LibraryRequestError("unknown_review", "This review is no longer available",
                                      "Select your files and review again.", status=404)
        review, staged = entry
        outcome = self.publisher.publish_review(review, confirm_rejects=bool(confirmed))
        if outcome.status == PUBLISHED:
            with self._reviews_lock:
                self._reviews.pop(review_id, None)
            shutil.rmtree(staged, ignore_errors=True)
            version = outcome.version
            return {"version_id": version.version_id, "document_count": len(version.documents),
                    "chunk_count": version.chunk_count}
        code, status = {
            NEEDS_CONFIRMATION: ("needs_confirmation", 409),
            NOTHING_TO_PUBLISH: ("nothing_to_publish", 409),
            BUSY: ("busy", 409),
            FAILED: ("publish_failed", 500),
        }.get(outcome.status, ("publish_failed", 500))
        raise LibraryRequestError(code, outcome.message or "Publication did not complete",
                                  "Review the selected files and try again.", status=status)

    def versions_listing(self) -> dict:
        return self.versions.listing()

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
        if origin in {"http://tauri.localhost", "https://tauri.localhost"}:
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
        path = self.path.split("?")[0]
        if path == "/health":
            return self._send(200, self.server.health())
        if path == "/v1/source":
            return self._source()
        return self._error(404, None, "not_found", "Unknown path", "Use GET /health, GET /v1/source or POST /v1/requests.")

    def _source(self) -> None:
        """Stream a cached source PDF for a citation (ADR 0006). Read-only, loopback-only."""
        params = parse_qs(urlsplit(self.path).query)
        document_id = (params.get("document_id") or [""])[0]
        version = (params.get("version") or [None])[0]
        if not _SOURCE_ID.match(document_id):
            return self._error(400, None, "invalid_request", "A valid document_id is required", "Open the citation again.")
        try:
            path = self.server.versions.source_path(document_id, version_id=version)
            source = path.read_bytes() if path is not None else None
        except Exception:
            source = None
        if source is None:
            return self._error(404, None, "not_found", "No cached source PDF for this citation",
                               "The document may not be cached; republish the collection with its PDFs available.")
        self._send_bytes(200, source, "application/pdf", {"Content-Disposition": "inline"})

    def _send_bytes(self, status: int, data: bytes, content_type: str, extra: dict | None = None) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Secure-QA-API-Version", API_VERSION)
        for key, value in (extra or {}).items():
            self.send_header(key, value)
        origin = self.headers.get("Origin")
        if origin and self._origin_ok():
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        if not self._guard():
            return
        if self.path.split("?")[0] != "/v1/requests":
            return self._error(404, None, "not_found", "Unknown path", "Use POST /v1/requests.")
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BODY:
            return self._error(413 if length > MAX_BODY else 411, None, "invalid_request", "Missing or oversized body", "Send a JSON body under 1 MiB.")
        try:
            body = json.loads(self.rfile.read(length))
        except (json.JSONDecodeError, UnicodeDecodeError):
            return self._error(400, None, "invalid_json", "The body isn't valid JSON", "Send a JSON object.")
        request_id, problem = validate(body)
        if problem:
            return self._error(400, request_id, "invalid_request", problem, "See the request envelope in dev_host.py.")
        exclusive = body["operation"] in {"answering.ask", "library.publish", "library.rollback",
                                            "library.set_document_enabled", "library.delete_document"}
        if exclusive and not self.server.library_job.acquire(blocking=False):
            return self._error(409, request_id, "busy", "Another library or answer job is running.", "Wait for it to finish and try again.")
        try:
            return self._dispatch(request_id, body)
        finally:
            if exclusive:
                self.server.library_job.release()

    def _dispatch(self, request_id, body):
        payload = body["payload"]
        operation = body["operation"]
        if operation.startswith("library."):
            return self._library(request_id, operation, payload)
        try:
            if operation == "answering.ask":
                err = self.server.library_health()["error"]
                if err and err["code"] == "embedding_model_mismatch":
                    return self._error(409, request_id, err["code"], err["message"], err["hint"])
                try:
                    collection = self.server.versions.open_active()
                except LookupError:
                    return self._error(409, request_id, "no_active_collection", "No collection is published yet", "Publish a collection, then ask again.")
                general = payload.get("general_knowledge", self.server.settings.read()["general_knowledge"])
                result = self._answer_in_conversation(payload["question"], collection, request_id,
                                                      general, payload.get("conversation_id")).to_dict()
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

    def _answer_in_conversation(self, question, collection, request_id, general, conversation_id):
        """Answer one question, giving it the thread's memory when a conversation id is sent.

        Thin wiring only: the answering workflow owns retrieval, generation,
        query rewrite and summarisation; history owns persistence.
        """
        history = self.server.history
        if not conversation_id:
            return self.server.service.answer(question, collection, request_id=request_id, general_knowledge=general)
        # History is best effort: unavailable storage must not discard an answer.
        history_failed = False
        convo = Conversation(conversation_id=conversation_id, summary="", recent_turns=[])
        try:
            convo = Conversation(conversation_id=conversation_id, summary=history.get_summary(conversation_id),
                                 recent_turns=history.recent_turns(conversation_id, limit=6))
            history.append_turn(conversation_id, "user", question)
        except Exception:
            history_failed = True
        answer = self.server.service.answer(question, collection, request_id=request_id,
                                            general_knowledge=general, conversation=convo)
        try:
            if not history_failed and history.append_turn(conversation_id, "assistant", "", answer=answer.to_dict()):
                history.set_summary(conversation_id,
                                    answer_memory.update_summary(self.server.service.runtime, convo.summary, question, answer.to_dict()))
        except Exception:
            history_failed = True
        if history_failed:
            answer.warnings.append(Notice("history_save_failed", "This answer is available here, but could not be saved to local history."))
        return answer

    def _library(self, request_id: str, operation: str, payload: dict) -> None:
        host = self.server
        try:
            if operation == "library.review":
                result = host.review_upload(payload["files"])
            elif operation == "library.publish":
                result = host.publish_review(payload["review_id"], payload.get("confirmed", False))
            elif operation == "library.cancel":
                # Publication runs synchronously in one request; there is nothing to cancel mid-flight.
                result = {"cancelled": False}
            elif operation == "library.status":
                # Synchronous publication: no incremental progress to report.
                result = {"stage": "", "done": 0, "total": 0}
            elif operation == "library.versions":
                result = host.versions_listing()
            elif operation == "library.set_document_enabled":
                try:
                    enabled = host.versions.set_document_enabled(payload["version_id"], payload["document_id"], payload["enabled"])
                except LookupError as exc:
                    raise LibraryRequestError("stale_document", str(exc), "Refresh Knowledge Collections and try again.") from None
                result = {"enabled": enabled}
            elif operation == "library.delete_document":
                if not payload["confirmed"]:
                    raise LibraryRequestError("confirmation_required", "Confirm deletion before removing this PDF.", "Review the PDF name and confirm Delete.")
                try:
                    version = host.publisher.delete_document(payload["version_id"], payload["document_id"], confirmed=True)
                except LookupError as exc:
                    raise LibraryRequestError("stale_document", str(exc), "Refresh Knowledge Collections and try again.") from None
                result = {"deleted": True, "version_id": version.version_id}
            elif operation == "library.rollback":
                try:
                    version = host.publisher.rollback()
                except LookupError:
                    raise LibraryRequestError("no_previous_version", "There is no previous version to roll back to",
                                              "Publish a second version first.") from None
                result = {"version_id": version.version_id}
            else:  # library.integrity
                try:
                    result = asdict(host.versions.check_integrity())
                except LookupError:
                    raise LibraryRequestError("no_active_collection", "No collection is published yet",
                                              "Publish a collection first.") from None
        except LibraryRequestError as exc:
            return self._error(exc.status, request_id, exc.code, exc.message, exc.hint)
        except Exception:
            return self._error(500, request_id, "workflow_failed", "The local library workflow could not finish.",
                               "The active collection is unchanged; check that PyMuPDF is installed and retry.")
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
    if body["operation"] == "library.review":
        for index, item in enumerate(payload["files"]):
            if not isinstance(item, dict) or set(item) != {"name", "data"} or not isinstance(item.get("name"), str) or not isinstance(item.get("data"), str):
                return request_id, f"payload.files[{index}] must have only string 'name' and base64 'data'"
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
    from secure_qa.history import ConversationHistory
    from secure_qa.library import CollectionVersions
    from secure_qa.paths import DATA_DIR
    from secure_qa.settings import Settings

    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--port", type=int, default=8765)
    p.add_argument("--runtime", default="fake", help="'fake' (deterministic QA) or E1's loopback gateway URL")
    p.add_argument("--embedding", choices=("auto", "fake", "local"), default="auto",
                   help="auto uses fake embeddings only with --runtime fake; real gateway mode uses the staged local model")
    p.add_argument("--embedding-model", help="path to the staged Sentence Transformers model directory")
    p.add_argument("--store", help="collection root; defaults to a separate fake or local-embedding QA store")
    p.add_argument("--corpus", type=Path, help="folder of PDFs the library.* operations review and publish (e.g. ingestion/fixtures)")
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
    server = DevHost(args.port, AnswerService(runtime), versions, corpus=args.corpus, history=history, settings=settings)
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
