"""API contract v1: every response the gateway sends must validate against contract/*.schema.json.

These are the tests E3 / E4 / E5 can rely on: if a llama.cpp upgrade or a gateway change alters a response shape,
they fail. Set DOCQA_TEST_LLAMA_SERVER and DOCQA_TEST_MODELS_DIR to also run them against a real llama-server.
"""

import http.client
import json
import os
from pathlib import Path

import pytest

jsonschema = pytest.importorskip("jsonschema")
from referencing import Registry, Resource  # noqa: E402  (installed with jsonschema)

from docqa_runtime import API_VERSION  # noqa: E402
from docqa_runtime.gateway import shape_chunk, shape_completion  # noqa: E402
from docqa_runtime.launcher import Runtime  # noqa: E402

CONTRACT = Path(__file__).resolve().parents[1] / "contract"
SCHEMAS = {p.name.removesuffix(".schema.json"): json.loads(p.read_text(encoding="utf-8"))
           for p in CONTRACT.glob("*.schema.json")}
REGISTRY = Registry().with_resources(
    (s["$id"], Resource.from_contents(s)) for s in SCHEMAS.values()).with_resources(
    (f"{name}.schema.json", Resource.from_contents(s)) for name, s in SCHEMAS.items())


def check(name: str, instance) -> None:
    schema = SCHEMAS[name]
    jsonschema.Draft202012Validator(schema, registry=REGISTRY).validate(instance)


def request(port, method, path, body=None, headers=None):
    c = http.client.HTTPConnection("127.0.0.1", port, timeout=60)
    data = json.dumps(body).encode() if isinstance(body, (dict, list)) else body
    c.request(method, path, body=data, headers={"Content-Type": "application/json", **(headers or {})})
    r = c.getresponse()
    raw = r.read()
    c.close()
    return r.status, {k.lower(): v for k, v in r.getheaders()}, raw


def stream_events(port, body):
    status, headers, raw = request(port, "POST", "/v1/chat/completions", {**body, "stream": True})
    assert status == 200 and headers["content-type"].startswith("text/event-stream")
    events = [ln[5:].strip() for ln in raw.decode().splitlines() if ln.startswith("data:")]
    assert events[-1] == "[DONE]"
    return [json.loads(e) for e in events[:-1]]


REAL_BIN = os.environ.get("DOCQA_TEST_LLAMA_SERVER")
REAL_MODELS = os.environ.get("DOCQA_TEST_MODELS_DIR")
BACKENDS = ["stub"] + (["real"] if REAL_BIN and REAL_MODELS else [])


@pytest.fixture(params=BACKENDS)
def runtime(request, make_cfg):
    over = {} if request.param == "stub" else {"server_bin": REAL_BIN, "models_dir": REAL_MODELS, "startup_timeout_s": 300.0}
    rt = Runtime(make_cfg(**over), quiet=True)
    rt.start()
    yield rt
    rt.stop()


MSG = {"messages": [{"role": "user", "content": "Say hello."}], "max_tokens": 8, "temperature": 0}


def test_schemas_are_valid():
    assert {"health", "models", "model", "chat-completion", "chat-chunk", "error", "ready", "chat-request"} <= set(SCHEMAS)
    for s in SCHEMAS.values():
        jsonschema.Draft202012Validator.check_schema(s)


def test_health_and_models(runtime):
    port = runtime.cfg.port
    status, headers, raw = request(port, "GET", "/health")
    assert status == 200 and headers["x-docqa-api-version"] == API_VERSION
    check("health", json.loads(raw))
    status, _, raw = request(port, "GET", "/v1/models")
    check("models", json.loads(raw))
    mid = json.loads(raw)["data"][0]["id"]
    status, _, raw = request(port, "GET", f"/v1/models/{mid}")
    assert status == 200
    check("model", json.loads(raw))


def test_chat_completion_shape(runtime):
    check("chat-request", MSG)
    status, headers, raw = request(runtime.cfg.port, "POST", "/v1/chat/completions", MSG)
    assert status == 200 and headers["x-docqa-api-version"] == API_VERSION
    body = json.loads(raw)
    check("chat-completion", body)
    assert body["model"] == json.loads(request(runtime.cfg.port, "GET", "/health")[2])["model"]["id"]
    assert body["usage"]["completion_tokens"] >= 1 and body["timings"]["predicted_per_second"] > 0


def test_stream_chunk_shape(runtime):
    chunks = stream_events(runtime.cfg.port, {**MSG, "stream_options": {"include_usage": True}})
    for c in chunks:
        check("chat-chunk", c)
    assert "".join(ch["delta"].get("content") or "" for c in chunks for ch in c["choices"])
    assert any(ch["finish_reason"] in ("stop", "length") for c in chunks for ch in c["choices"])
    assert any("usage" in c for c in chunks) and any("timings" in c for c in chunks)


@pytest.mark.parametrize("method,path,body,status,code", [
    ("POST", "/v1/chat/completions", {"messages": []}, 400, "invalid_request"),
    ("POST", "/v1/chat/completions", b"{nope", 400, "invalid_json"),
    ("POST", "/v1/chat/completions", {"model": "gpt-4o", **MSG}, 404, "model_not_found"),
    ("POST", "/v1/chat/completions", {**MSG, "temperature": 9}, 400, "invalid_request"),
    ("GET", "/v1/chat/completions", None, 405, "method_not_allowed"),
    ("GET", "/v1/models/other", None, 404, "model_not_found"),
    ("GET", "/nope", None, 404, "not_found"),
])
def test_errors_use_the_envelope(runtime, method, path, body, status, code):
    st, headers, raw = request(runtime.cfg.port, method, path, body)
    err = json.loads(raw)
    assert st == status and err["error"]["code"] == code and err["error"]["status"] == status
    check("error", err)
    assert headers["x-docqa-api-version"] == API_VERSION


def test_security_errors_use_the_envelope(runtime):
    for headers, code in (({"Host": "evil.example"}, "host_not_allowed"), ({"Origin": "https://evil.example"}, "origin_not_allowed")):
        st, _, raw = request(runtime.cfg.port, "GET", "/health", headers=headers)
        assert st == 403
        check("error", json.loads(raw))
        assert json.loads(raw)["error"]["code"] == code


def test_context_overflow_is_actionable(runtime):
    long = "word " * 40000                      # far beyond the 4096-token context
    st, _, raw = request(runtime.cfg.port, "POST", "/v1/chat/completions",
                         {"messages": [{"role": "user", "content": long}], "max_tokens": 4})
    err = json.loads(raw)
    assert st == 400 and err["error"]["code"] == "context_length_exceeded", err
    check("error", err)


def test_ready_file_shape(runtime):
    check("ready", runtime.ready_info())


# --------------------------------------------------- shaping (no server) --

def test_shaping_drops_build_specific_fields():
    raw = {"id": "chatcmpl-1", "object": "chat.completion", "created": 1, "model": "whatever-alias",
           "system_fingerprint": "b11242-526c43b8f", "__verbose": {"x": 1}, "generation_settings": {"n_ctx": 4096},
           "choices": [{"index": 0, "finish_reason": "stop",
                        "message": {"role": "assistant", "content": "hi", "reasoning_content": "secret"}}],
           "usage": {"prompt_tokens": 3, "completion_tokens": 1, "total_tokens": 4, "prompt_tokens_details": {}},
           "timings": {"prompt_n": 3, "prompt_ms": 1.0, "prompt_per_second": 3000.0, "predicted_n": 1,
                       "predicted_ms": 1.0, "predicted_per_second": 1000.0, "cache_n": 0, "draft_n": 0}}
    out = shape_completion(raw, "qwen-q4")
    check("chat-completion", out)
    assert out["model"] == "qwen-q4" and "reasoning_content" not in json.dumps(out) and "__verbose" not in out
    chunk = shape_chunk({"id": "c", "created": 1, "choices": [{"index": 0, "delta": {"content": "h", "reasoning_content": "x"},
                                                             "finish_reason": None}]}, "qwen-q4")
    check("chat-chunk", chunk)
    assert chunk["choices"][0]["delta"] == {"content": "h"}
