"""Week 6: graceful cancellation and shutdown.

The runtime has one model slot, so an answer nobody is waiting for must not keep generating. A request can be
cancelled by id, by the caller hanging up, or by the runtime stopping; in every case the caller gets a clear
`request_cancelled` (or is already gone), the slot is freed, and the next question is answered normally.
"""

import http.client
import json
import socket
import threading
import time

import pytest

from docqa_runtime.client import chat, get_json
from docqa_runtime.launcher import Runtime

from .test_contract import check

LONG = {"messages": [{"role": "user", "content": "Write a long story about a lighthouse."}], "max_tokens": 600,
        "temperature": 0}
SHORT = [{"role": "user", "content": "hello"}]


def post(port, path, body=None, headers=None, timeout=60):
    c = http.client.HTTPConnection("127.0.0.1", port, timeout=timeout)
    data = json.dumps(body).encode() if body is not None else b""
    c.request("POST", path, body=data, headers={"Content-Type": "application/json", **(headers or {})})
    r = c.getresponse()
    raw = r.read()
    c.close()
    return r.status, {k.lower(): v for k, v in r.getheaders()}, raw


def requests_info(rt):
    return get_json(rt.base_url(), "/health")[1]["requests"]


def wait_for(cond, timeout=10.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if cond():
            return True
        time.sleep(0.05)
    return False


@pytest.fixture
def slow_runtime(make_cfg, monkeypatch):
    monkeypatch.setenv("DOCQA_STUB_BANDWIDTH_GBS", "0.01")      # about 11 tokens/s, so a cancel lands mid-answer
    rt = Runtime(make_cfg(), quiet=True)
    rt.start()
    yield rt
    rt.stop()


def in_background(fn):
    out = {}

    def run():
        try:
            out["result"] = fn()
        except Exception as e:  # noqa: BLE001 - surfaced by the test
            out["error"] = e

    t = threading.Thread(target=run, daemon=True)
    t.start()
    return t, out


def test_cancel_a_non_streaming_answer(slow_runtime):
    rt, port = slow_runtime, slow_runtime.cfg.port
    t0 = time.time()
    t, out = in_background(lambda: post(port, "/v1/chat/completions", LONG, {"X-Request-ID": "q-1"}))
    assert wait_for(lambda: requests_info(rt)["in_flight"] == 1)
    st, _, raw = post(port, "/v1/requests/q-1/cancel")
    assert st == 200 and json.loads(raw) == {"id": "q-1", "cancelled": True}
    check("cancel", json.loads(raw))
    t.join(10)
    assert not t.is_alive() and time.time() - t0 < 10        # 600 tokens would take about a minute
    st, headers, raw = out["result"]
    err = json.loads(raw)
    assert st == 409 and err["error"]["code"] == "request_cancelled" and headers["x-request-id"] == "q-1"
    check("error", err)
    info = requests_info(rt)
    assert info["in_flight"] == 0 and info["cancelled"] == 1 and info["failed"] == 0
    assert chat(rt.base_url(), SHORT, max_tokens=3, stream=False)["text"]     # the next question is unaffected


def test_cancel_a_stream_mid_answer(slow_runtime):
    rt, port = slow_runtime, slow_runtime.cfg.port
    c = http.client.HTTPConnection("127.0.0.1", port, timeout=30)
    body = json.dumps({**LONG, "stream": True}).encode()
    c.request("POST", "/v1/chat/completions", body=body,
              headers={"Content-Type": "application/json", "X-Request-ID": "s-1"})
    r = c.getresponse()
    assert r.status == 200 and r.getheader("X-Request-ID") == "s-1"
    events = []
    while True:                                                  # read until the first words arrive
        line = r.readline().strip()
        if line.startswith(b"data:"):
            events.append(line[5:].strip())
            if b'"content"' in line:
                break
    assert post(port, "/v1/requests/s-1/cancel")[0] == 200
    while True:
        line = r.readline()
        if not line:
            break
        if line.strip().startswith(b"data:"):
            events.append(line.strip()[5:].strip())
    c.close()
    assert events[-1] == b"[DONE]"
    last = json.loads(events[-2])
    assert last["error"]["code"] == "request_cancelled"
    check("error", last)
    for e in events[:-2]:
        check("chat-chunk", json.loads(e))
    assert requests_info(rt)["in_flight"] == 0
    assert chat(rt.base_url(), SHORT, max_tokens=3)["text"]


def test_caller_hanging_up_frees_the_slot(slow_runtime):
    rt, port = slow_runtime, slow_runtime.cfg.port
    body = json.dumps(LONG).encode()
    s = socket.create_connection(("127.0.0.1", port))
    s.sendall(b"POST /v1/chat/completions HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\n"
              + f"Content-Length: {len(body)}\r\n\r\n".encode() + body)
    assert wait_for(lambda: requests_info(rt)["in_flight"] == 1)
    s.close()                                                    # the caller goes away without cancelling
    assert wait_for(lambda: requests_info(rt)["in_flight"] == 0, timeout=3)
    assert requests_info(rt)["cancelled"] == 1
    assert chat(rt.base_url(), SHORT, max_tokens=3, stream=False)["text"]


def test_request_ids(slow_runtime):
    rt, port = slow_runtime, slow_runtime.cfg.port
    st, headers, _ = post(port, "/v1/chat/completions", {"messages": SHORT, "max_tokens": 2}, {"X-Request-ID": "mine.42"})
    assert st == 200 and headers["x-request-id"] == "mine.42"
    st, headers, _ = post(port, "/v1/chat/completions", {"messages": SHORT, "max_tokens": 2})
    assert st == 200 and len(headers["x-request-id"]) == 32                  # generated when not sent
    c = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
    c.request("GET", "/health")
    r = c.getresponse()
    r.read()
    assert r.getheader("X-Request-ID") is None
    st, _, raw = post(port, "/v1/chat/completions", {"messages": SHORT}, {"X-Request-ID": "bad id!"})
    assert st == 400 and json.loads(raw)["error"]["code"] == "invalid_request"


def test_cancel_errors(slow_runtime):
    rt, port = slow_runtime, slow_runtime.cfg.port
    st, _, raw = post(port, "/v1/requests/nobody/cancel")
    err = json.loads(raw)
    assert st == 404 and err["error"]["code"] == "request_not_found"
    check("error", err)
    t, out = in_background(lambda: post(port, "/v1/chat/completions", LONG, {"X-Request-ID": "dup"}))
    assert wait_for(lambda: requests_info(rt)["in_flight"] == 1)
    st, _, raw = post(port, "/v1/chat/completions", LONG, {"X-Request-ID": "dup"})
    assert st == 409 and json.loads(raw)["error"]["code"] == "request_id_in_use"
    assert post(port, "/v1/requests/dup/cancel")[0] == 200
    t.join(10)
    c = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
    c.request("GET", "/v1/requests/dup/cancel")
    r = c.getresponse()
    assert r.status == 405 and json.loads(r.read())["error"]["code"] == "method_not_allowed"
    assert requests_info(rt)["failed"] == 1                     # only the duplicate-id request counts as failed


def test_shutdown_tells_callers_instead_of_hanging(make_cfg, monkeypatch):
    monkeypatch.setenv("DOCQA_STUB_BANDWIDTH_GBS", "0.01")
    rt = Runtime(make_cfg(), quiet=True)
    rt.start()
    port = rt.cfg.port
    t0 = time.time()
    t, out = in_background(lambda: post(port, "/v1/chat/completions", LONG, {"X-Request-ID": "late"}))
    assert wait_for(lambda: requests_info(rt)["in_flight"] == 1)
    rt.stop()
    t.join(10)
    assert not t.is_alive() and time.time() - t0 < 10
    if "result" in out:                                          # normally the caller hears why
        st, _, raw = out["result"]
        err = json.loads(raw)["error"]
        assert st == 409 and err["code"] == "request_cancelled" and "shutting down" in err["message"]
    else:                                                        # or the connection closed under it; never a hang
        assert isinstance(out["error"], (OSError, http.client.HTTPException))
