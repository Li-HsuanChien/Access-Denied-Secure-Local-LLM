# Real local answer latency

Run from the repository root with the project's virtual environment and staged
llama.cpp, answering GGUF and embedding weights. This harness never downloads.
Stop other DocQA inference jobs first: it starts one loopback runtime and one host,
uses one model slot, and sends requests sequentially. Do not run profiles in parallel.

```sh
export PYTHONPATH=app/document-qa/backend
.venv/bin/python -m secure_qa.answering.benchmarks.latency --prepare --output .bench_data/latency-prepare
.venv/bin/python -m secure_qa.answering.benchmarks.latency --legacy --output .bench_data/control
.venv/bin/python -m secure_qa.answering.benchmarks.latency --output .bench_data/current
```

Every measurement needs a fresh output directory. `--legacy` replays the frozen
pre-change grounded prompt and model-written summary; it is benchmark-only.
`--concise` and `--deterministic-summary` independently override those two choices.
Use `--threads`, `--threads-batch`, `--ubatch`, `--passive-threads`, `--top-k`,
`--max-tokens`, or `--gpu-layers` for controlled comparisons. `--model` accepts an
already-staged GGUF path for evaluation without changing production configuration.
`--prompt-report results.json` replays an earlier report's exact system prompt.
`--questions c01,warm,c02,missing` selects a subset; include `c01` before `followup`
to create its conversation context. The default suite includes the repeated NRC
question as `warm`; include it explicitly when overriding the list.

The corpus is the checked-in public real-PDF golden fixtures, separately published
under `.bench_data/latency-public-corpus`. User collections, history and settings
are never opened. Reports intentionally include public fixture answers and citation
text for inspection; this is an opt-in evaluation artifact, not production logging.
Do not adapt it to private documents without reviewing artifact handling.

`results.json` is flushed after each request and records HTTP wall time, startup,
per-call prompt/generation timings and token usage, citation validation, retrieval
hits, expected-fact/citation checks, 100 ms RSS samples and system-wide swap I/O.
Timeouts have unknown token/timing totals, never zero-cost successes. On macOS RSS
does not describe total unified-memory use; swap counters include all applications.
Cold means fresh processes, not flushed OS caches. HTTP wall time excludes UI render.
Inspect the actual answers: exact citation resolution does not establish entailment.

See [the investigation](../../../../../../docs/performance/2026-11-17-local-answer-latency.md)
for hardware, caveats, run order, results and the separate 8 GB qualification gate.
