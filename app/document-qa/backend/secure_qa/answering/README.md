# Question Answering

This module owns retrieval decisions, deterministic visual selection, inference, evidence classification and citation validation (SDD §4.2, §7). Its llama.cpp adapter stays private to this feature. See the [SDD](../../../../../docs/architecture/SDD.md).

**Built so far (week 3, E3):** the text path. Visual evidence (SDD §7.2), streaming progress and cancellation come later.

```
question ─► retrieve (Library store, min_score) ─► assemble context ─► model runtime ─► validate citations ─► Answer
                 │ nothing relevant                                       │ violations: one corrective retry,
                 └─► insufficient_evidence (+ general knowledge if on)     │ then withhold unsupported claims
```

```python
from secure_qa.answering import AnswerService, LlamaCppGatewayRuntime, FakeModelRuntime
from secure_qa.library import CollectionVersions, Embedder

versions = CollectionVersions(Embedder(), "data/collections")
service = AnswerService(LlamaCppGatewayRuntime("http://127.0.0.1:8080"))   # E1's runtime; FakeModelRuntime() in tests
answer = service.answer("What is the annual dose limit?", versions.open_active())
answer.to_dict()   # wire/answer.schema.json
```

## Context assembly (`context.py`)

- **Passage labels:** retrieved chunks become passages labelled `S1`, `S2`, ... in rank order. The model cites labels, never page numbers, and the service maps each label back to the exact chunk it stood for. So a citation can only point at evidence that was actually supplied, and page numbers come from the chunk's page spans, not from model output.
- **Untrusted text (SDD §10):** passages sit between `<<<S1 | title | pages>>>` and `<<<END S1>>>` delimiters, and the system prompt says they are data, not instructions. Any delimiter or `[S9]` lookalikes inside document text are neutralised.
- **Context budget:** passages are added best first until the budget runs out. The budget is the model's context window (from E1's `/health`), minus the answer allowance (512 tokens), the prompt and a margin. Rank order is never skipped. If E1 returns `context_length_exceeded`, the service retries with one fewer passage.
- **Answer format:** the model writes under the SDD §7.3 headings "From your documents:", "General model knowledge:" and "Limitations and uncertainty:". When the user turns general knowledge off, the prompt drops that section.
- **Versioning:** the prompt is versioned (`PROMPT_VERSION`), and every answer records the version it used.

## Citation validation (`citations.py`)

After generation, every sentence under "From your documents" must cite at least one supplied label. These are the three violations:

| Code | Meaning |
|---|---|
| `uncited_claim` | A document-section sentence has no label. |
| `unknown_citation` | A label names no passage that was supplied. |
| `cited_general_knowledge` | A label appears in the general-knowledge section. |

On any violation, the service makes one corrective generation attempt. If violations remain, it withholds the unsupported sentences, keeps the valid ones, and adds a `citation_validation_failed` warning (SDD §7.3). This check confirms citations point at supplied evidence. Whether a passage really supports its sentence is measured by the answer-quality benchmark, not enforced at runtime.

## Answer and citation payload (`answer.py`, `wire/answer.schema.json`)

| Field | Meaning |
|---|---|
| `status` | `answered` means at least one cited document claim. `insufficient_evidence` means there is no document-supported section (SDD §7.1). `failed` means `error` holds `{code, message, hint}`. |
| `documents` | Claims as `{text, citation_ids}`, the "From your documents" section. |
| `general_knowledge` | Uncited text. Show it labelled as not verified against the collection. |
| `limitations` | The "Limitations and uncertainty" lines. |
| `citations` | One entry per cited label, with the fields below. |
| `evidence` | Every passage supplied to the model, with score, rank and whether it was cited. These are the evidence ids for benchmarks. |
| `warnings` | `{code, message}` notices: `insufficient_evidence`, `citation_validation_failed`, `context_truncated`, `answer_truncated`, `test_model`, `runtime_api_version`. |
| Versions and timing | `model`, `collection_version`, `prompt_version` and `timing` (SDD §4.2, §4.3). |

Each citation carries:

- `document_id`, `document_title`, `source_filename`
- `page_start` / `page_end`
- `pages[]`, with per-page offsets and highlight rectangles. Only draw the rectangles when `coordinates_reliable` is true.
- `chunk_ids`
- `char_start` / `char_end` into the document's canonical text stream
- `text_checksum_sha256`
- `quote`, the full chunk text
- `evidence_type`, `score` and `rank`

A citation therefore resolves to exact source text: slicing the document's text stream at `char_start:char_end` gives the `quote`, and the checksum proves the quote is unchanged. E2's chunks span pages, so a citation carries a page range rather than SDD §5.1's single page number. That SDD update is still pending.

## Model runtime seam (`model_runtime.py`)

- **`LlamaCppGatewayRuntime`** speaks E1's runtime API `2026-09-v1` (`GET /health`, `POST /v1/chat/completions`, non-streaming) using only the standard library. It refuses any base URL that isn't loopback, and it maps E1's error envelope to `ModelRuntimeError(code, message, hint)` (`ContextLengthExceeded` for `context_length_exceeded`), plus `runtime_unreachable` when nothing is listening.
- **`FakeModelRuntime`** is deterministic. By default it answers extractively: it quotes the passage sentence that shares the most words with the question and cites that passage. It can also return scripted responses or fail every call.

## Relevance threshold

`AnswerSettings.min_score = 0.38` (cosine) is **provisional**. It comes from the golden-set run on 2026-10-05, where the weakest on-topic top result scored 0.407 and the strongest off-topic question scored 0.354. All other off-topic questions scored 0.21 or below. The SDD §7.1 benchmark must tune and freeze this value on real questions over the real corpus.

## Try it

From `app/document-qa/backend`:

```bash
../../../.venv/bin/python -m secure_qa.answering.benchmarks.golden --show g01     # golden demo query, in full
../../../.venv/bin/python -m secure_qa.answering.benchmarks.golden                # all golden queries, pass/fail table
../../../.venv/bin/python -m secure_qa.answering.benchmarks.golden --runtime http://127.0.0.1:8080   # through E1's runtime
../../../.venv/bin/python dev_host.py                                             # loopback test endpoint for the frontend
```
