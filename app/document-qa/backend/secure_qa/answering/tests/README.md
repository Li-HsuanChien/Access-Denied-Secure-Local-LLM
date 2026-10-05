# Answering behavior tests

These tests go through the Question Answering interface with deterministic fakes (SDD §13.1):

| File | What it covers |
|---|---|
| `test_service.py` | Grounded answers, prompt delimiting, the corrective retry and withholding, insufficient evidence, retrieval and model failures, context limits, one question at a time, and sanitized events |
| `test_citations.py` | Answer parsing and citation rules |
| `test_model_runtime.py` | The E1 gateway adapter against E1's documented contract. `LiveRuntimeTest` runs against a real runtime when `SECURE_QA_TEST_RUNTIME_URL` is set. |
| `test_golden.py` | Week 3 acceptance: golden queries retrieve expected chunks and their citations resolve exactly. Needs the embedding model. |
| `test_offline.py` | No non-loopback socket or DNS attempts while loading the embedder, publishing, searching or answering |

Visual-limit and cancellation tests arrive with those features.
