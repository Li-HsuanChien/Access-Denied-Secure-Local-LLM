"""The model-runtime seam (SDD §4.5): E1's llama.cpp gateway in production, a deterministic fake in tests.

`LlamaCppGatewayRuntime` speaks E1's runtime API contract `2026-09-v1`
(`answering/llama_cpp/docs/api.md` on branch `E1-LLM/Runtime`): `GET /health` and
OpenAI-compatible `POST /v1/chat/completions`, loopback only. It uses only the
standard library, so the answering module adds no HTTP dependency.
"""

from __future__ import annotations

import http.client
import ipaddress
import json
import re
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Protocol
from urllib.parse import urlsplit

SUPPORTED_API_VERSIONS = ("2026-09-v1",)


@dataclass
class ModelInfo:
    """What an answer records about the model that produced it (SDD §4.3: model version)."""

    model_id: str
    name: str
    quant: str | None
    ctx_size: int
    api_version: str | None
    runtime_version: str | None
    stub: bool  # True when no real model weights are loaded (E1 stub or the test fake)


@dataclass
class Completion:
    text: str
    finish_reason: str | None = None
    prompt_tokens: int | None = None
    completion_tokens: int | None = None


class ModelRuntimeError(RuntimeError):
    """The runtime could not answer. `code` is stable (E1's error codes plus `runtime_unreachable`); `hint` is for users."""

    def __init__(self, code: str, message: str, hint: str = "", status: int | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.hint = hint
        self.status = status


class ContextLengthExceeded(ModelRuntimeError):
    """The prompt plus passages exceeded the model's context window (E1: send fewer or shorter chunks)."""


class ModelRuntime(Protocol):
    def info(self) -> ModelInfo: ...

    def complete(self, messages: Sequence[dict], *, max_tokens: int, temperature: float, seed: int) -> Completion: ...


# --- production adapter: E1's gateway -------------------------------------------------------


class LlamaCppGatewayRuntime:
    """Client for E1's loopback gateway. Refuses any base URL that isn't loopback (SDD §10)."""

    def __init__(self, base_url: str = "http://127.0.0.1:8080", timeout_s: float = 600.0, health_timeout_s: float = 5.0) -> None:
        url = urlsplit(base_url)
        if url.scheme != "http" or not is_loopback(url.hostname or ""):
            raise ValueError(f"The model runtime must be on loopback http (127.0.0.1, ::1 or localhost), not {base_url!r}")
        self.host = url.hostname
        self.port = url.port or 80
        self.prefix = url.path.rstrip("/")
        self.timeout_s = timeout_s
        self.health_timeout_s = health_timeout_s

    def info(self) -> ModelInfo:
        status, body, headers = self._request("GET", "/health", None, self.health_timeout_s)
        if status != 200 or not body.get("ready"):
            err = body.get("error") or {}
            raise ModelRuntimeError(
                err.get("code") or ("model_loading" if body.get("status") in ("starting", "loading") else "backend_unavailable"),
                err.get("message") or f"The model runtime is not ready (status: {body.get('status', status)})",
                err.get("hint") or "Wait for the model to finish loading, or restart the runtime.",
                status,
            )
        model = body.get("model") or {}
        return ModelInfo(
            model_id=model.get("id", "unknown"),
            name=model.get("name", model.get("id", "unknown")),
            quant=model.get("quant"),
            ctx_size=int(model.get("ctx_size") or 4096),
            api_version=body.get("api_version") or headers.get("x-docqa-api-version"),
            runtime_version=body.get("runtime_version"),
            stub=bool((body.get("engine") or {}).get("stub")),
        )

    def complete(self, messages: Sequence[dict], *, max_tokens: int, temperature: float, seed: int) -> Completion:
        payload = {"messages": list(messages), "max_tokens": max_tokens, "temperature": temperature, "seed": seed, "stream": False}
        status, body, _ = self._request("POST", "/v1/chat/completions", payload, self.timeout_s)
        if status != 200:
            err = body.get("error") or {}
            cls = ContextLengthExceeded if err.get("code") == "context_length_exceeded" else ModelRuntimeError
            raise cls(err.get("code") or f"http_{status}", err.get("message") or f"Model runtime returned HTTP {status}",
                      err.get("hint", ""), status)
        try:
            choice = body["choices"][0]
            usage = body.get("usage") or {}
            return Completion(
                text=choice["message"].get("content") or "",
                finish_reason=choice.get("finish_reason"),
                prompt_tokens=usage.get("prompt_tokens"),
                completion_tokens=usage.get("completion_tokens"),
            )
        except (KeyError, IndexError, TypeError) as exc:
            raise ModelRuntimeError("invalid_response", "The model runtime returned an unexpected response",
                                    "Check that the runtime matches API version 2026-09-v1.") from exc

    def _request(self, method: str, path: str, payload: dict | None, timeout: float) -> tuple[int, dict, dict]:
        conn = http.client.HTTPConnection(self.host, self.port, timeout=timeout)
        data = json.dumps(payload).encode("utf-8") if payload is not None else None
        headers = {"Content-Type": "application/json", "Content-Length": str(len(data))} if data is not None else {}
        try:
            conn.request(method, self.prefix + path, body=data, headers=headers)
            resp = conn.getresponse()
            raw = resp.read()
            resp_headers = {k.lower(): v for k, v in resp.getheaders()}
        except ConnectionRefusedError as exc:
            raise ModelRuntimeError("runtime_unreachable", "The local model runtime isn't running",
                                    "Start it with `docqa-runtime up`, then ask again.") from exc
        except TimeoutError as exc:
            raise ModelRuntimeError("backend_timeout", "The model took too long to answer",
                                    "Try a shorter question, or restart the runtime.") from exc
        except OSError as exc:
            raise ModelRuntimeError("runtime_unreachable", f"Couldn't reach the local model runtime ({type(exc).__name__})",
                                    "Check that the runtime is running, then ask again.") from exc
        finally:
            conn.close()
        try:
            body = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            body = {}
        return resp.status, body if isinstance(body, dict) else {}, resp_headers


def is_loopback(host: str) -> bool:
    if host == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


# --- deterministic fake for workflow tests (SDD §4.5, §13.1) --------------------------------

_PASSAGE = re.compile(r"<<<(S\d+) \|[^\n]*>>>\n(.*?)\n<<<END \1>>>", re.S)
_QUESTION = re.compile(r"^Question: (.+)$", re.M)
_WORD = re.compile(r"[a-z0-9]+")
_STOP = set("a an and are as at be by can do does for from has have how i in is it its many much of on or "
            "should so than that the their there these this to was what when where which who why will with".split())


@dataclass
class FakeModelRuntime:
    """Deterministic stand-in for the answering model.

    By default it answers extractively: it quotes the passage sentence that shares
    the most words with the question and cites that passage, so citation
    resolution can be checked exactly. With no passages it returns a short
    general-knowledge line. `responses` scripts exact replies in order instead
    (for citation-validation tests); `error` makes every call fail. Every request
    is kept in `requests`.
    """

    responses: list[str] | None = None
    error: ModelRuntimeError | None = None
    ctx_size: int = 4096
    requests: list[list[dict]] = field(default_factory=list)

    def info(self) -> ModelInfo:
        if self.error is not None:
            raise self.error
        return ModelInfo("fake-extractive", "Deterministic test model", None, self.ctx_size, None, None, stub=True)

    def complete(self, messages: Sequence[dict], *, max_tokens: int, temperature: float, seed: int) -> Completion:
        self.requests.append([dict(m) for m in messages])
        if self.error is not None:
            raise self.error
        if self.responses is not None:
            return Completion(self.responses.pop(0) if len(self.responses) > 1 else self.responses[0], "stop")
        prompt = messages[-1]["content"]
        question = _QUESTION.search(prompt)
        passages = _PASSAGE.findall(prompt)
        if not passages:
            return Completion("General model knowledge:\nThe test model has no general knowledge to add.", "stop")
        wanted = _words(question.group(1) if question else "")
        # Most shared words wins; ties go to the higher-ranked passage, then the earlier sentence.
        _, _, _, label, sentence = max(
            (len(wanted & _words(sentence)), -order, -index, label, sentence)
            for order, (label, text) in enumerate(passages)
            for index, sentence in enumerate(_sentences(text))
        )
        return Completion(f"From your documents:\n{sentence} [{label}]", "stop")


def _words(text: str) -> set[str]:
    return {w for w in _WORD.findall(text.lower()) if w not in _STOP}


def _sentences(text: str) -> list[str]:
    flat = " ".join(text.split())
    return [s for s in re.split(r"(?<=[.!?])\s+(?=[A-Z0-9])", flat) if s]
