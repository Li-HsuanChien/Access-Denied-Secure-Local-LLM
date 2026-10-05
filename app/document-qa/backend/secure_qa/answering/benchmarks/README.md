# Question Answering benchmarks

This folder holds answer correctness, grounding, citation, refusal, visual-question, model latency and token-rate evaluation material. The [SDD](../../../../../../docs/architecture/SDD.md) defines model eligibility and release gates. Retrieval benchmarks belong to Collection Library; whole-process memory checks belong to the desktop shell.

## Golden queries (`golden_queries.json`, `golden.py`)

The golden set contains 14 controlled questions over the synthetic corpus plus E2's 19 real NRC chunks. Ten expect an answer and four expect a refusal; one of the refusals is a near miss that pins the relevance threshold.

Each record follows SDD §13.2. It has the question, the expected answer facts or refusal, and the evidence identified by source file, page and phrase. It also records the question type and visual expectation.

`golden.py` publishes the golden collection as a real collection version, asks each question and checks it:

| Check | Kind |
|---|---|
| Expected status | Acceptance |
| Expected evidence retrieved, and its rank | Acceptance |
| Expected evidence cited | Acceptance |
| Every citation resolves to the exact characters of the source text stream, with matching checksum and per-page offsets | Acceptance |
| Expected facts appear in the answer | Quality; depends on the model, so not an acceptance gate |

```bash
cd app/document-qa/backend
../../../.venv/bin/python -m secure_qa.answering.benchmarks.golden [--runtime fake|URL] [--show g01] [--json out.json]
```

This is a seed, not the evaluation suite. E5's benchmark adds real questions over the real corpus, answer-quality scoring and threshold tuning.
