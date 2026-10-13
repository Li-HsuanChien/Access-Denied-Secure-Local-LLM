# Answering messages

- **`answer.schema.json`** (v1.0.0) is the structured answer and citation payload that `Answer.to_dict()` produces. Tests validate real answers against it. The field meanings are in [`../README.md`](../README.md#answer-and-citation-payload-answerpy-wireanswerschemajson).

## Development HTTP envelope (frontend → host, SDD §4.6)

Until the Open WebUI host exists, `app/document-qa/backend/dev_host.py` serves this contract on `127.0.0.1` only (default port 8765):

```
GET  /health
  200 {"status": "ok" | "degraded", "ready": bool, "api_version": "secure-qa-dev/1",
       "answering": {"ready": bool, "model_id", "name", "quant", "ctx_size", "stub", "error": null | {code, message, hint}},
       "library":   {"ready": bool, "active_version", "chunk_count", "document_count", "embedding_model"}}

POST /v1/requests
  {"request_id": "<client id>", "operation": "answering.ask",
   "payload": {"question": "<text>", "general_knowledge": true}}           # general_knowledge optional
  200 {"request_id", "operation", "result": <answer.schema.json>}          # includes status "failed" with error
  4xx {"request_id", "error": {"code", "message", "hint"}}                 # invalid_json, invalid_request, host/origin refused, no_active_collection
```

Unknown operations, envelope fields and payload fields are rejected. Requests must carry a loopback `Host` header. A browser `Origin` must be `http://localhost:*`, `http://127.0.0.1:*`, `tauri://`, `app://` or `null`, and those origins get CORS headers. Only one question runs at a time; a second concurrent ask gets `result.status = "failed"` with `error.code = "busy"`.

**Not in this version yet:** streaming progress events and cancellation by request ID.
