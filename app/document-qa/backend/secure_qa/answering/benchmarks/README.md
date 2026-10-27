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

## Real-corpus golden queries (`golden_real_queries.json`, `--corpus real`)

17 questions over E2's real fixture PDFs, ingested end to end through E2's `validate()` and `chunks()`: the NRC Reactor Concepts chapter, the DOE Nuclear Physics handbook, the arXiv two-column paper and E2's adversarial coolant document (309 chunks). Thirteen expect an answer (two of them over the adversarial document, which plants instructions, so the check also fails the answer if it contains the planted text) and four expect a refusal.

- Citing the expected passage and containing the expected facts are quality measures here, not gates, because they depend on the model's choices. Retrieval of the expected chunk, status, resolving citations and ignoring planted instructions are gated.
- A record with `known_gap` is reported separately and doesn't fail the run. c09 and c11 are known retrieval gaps: dense retrieval scores their evidence below `min_score` on the noisy arXiv text. The test fails if one of them starts passing, so the flag gets removed.

```bash
../../../.venv/bin/python -m secure_qa.answering.benchmarks.golden --corpus real [--runtime fake|URL] [--json out.json]
```

## End-to-end demo (`demo_end_to_end.py`)

Ingest and index, ask, retrieve, answer, cite, publish a second version, roll back, republish, with 18 checks and an optional evidence file:

```bash
../../../.venv/bin/python -m secure_qa.answering.benchmarks.demo_end_to_end [--runtime fake|URL] [--evidence docs/evidence/e3-demo.json]
```

This is a seed, not the evaluation suite. E5's benchmark adds real questions over the real corpus, answer-quality scoring and threshold tuning.

## Runtime benchmarks (E1)

The llama.cpp adapter includes baseline and quantization benchmark tooling under [`../llama_cpp/`](../llama_cpp/README.md). These prototype results do not qualify a final model on the reference laptop; see the [E1 runtime report](../../../../../../docs/reports/E1-runtime-report.md).
