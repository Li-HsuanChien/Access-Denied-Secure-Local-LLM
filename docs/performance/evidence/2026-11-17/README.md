# Public-fixture latency evidence

All questions, answers and quotes in these opt-in evaluation files come from public checked-in fixtures. User collection/history files were not copied. Absolute repository paths are replaced by `<repo>` and the host-name hash is removed. Process IDs are transient measurement identifiers.

| Profile | Record |
|---|---|
| baseline | [baseline.json](baseline.json) |
| threads4 | [threads4.json](threads4.json) |
| microbatch128 | [microbatch128.json](microbatch128.json) |
| passive | [passive.json](passive.json) |
| metal-baseline | [metal-baseline.json](metal-baseline.json) |
| metal-combined | [metal-combined.json](metal-combined.json) |
| metal-final | [metal-final.json](metal-final.json) |
| cap256 | [cap256.json](cap256.json) |
| compact-v2 | [compact-v2.json](compact-v2.json) |
| summary | [summary.json](summary.json) |
| metal-control-repeat | [metal-control-repeat.json](metal-control-repeat.json) |
| final-cpu | [final-cpu.json](final-cpu.json) |
| small-metal | [small-metal.json](small-metal.json) |
| small-diagnostic | [small-diagnostic.json](small-diagnostic.json) |
| qwen3-small-metal | [qwen3-small-metal.json](qwen3-small-metal.json) |
| qwen3-small-metal-qualified | [qwen3-small-metal-qualified.json](qwen3-small-metal-qualified.json) |

[Initial NRC request](live-baseline-0.json) and [repeat](live-baseline-1.json) used the already-running NRC-only host without conversation IDs. Their psutil sin/sout fields are page I/O on macOS, not actual swap I/O. Extracted backend token timings are added explicitly.

[Flat measurements](measurements.csv) summarize per-request records. JSON preserves the separate usage/timing for each grounded, corrective, rewrite, summary and general fallback call. HTTP 200 can contain an application failure; inspect `answer.status` and call status, not transport success alone.

A false golden `evidence_retrieved` check on a timeout means the final failed answer has no evidence, not necessarily that retrieval missed. Later records separately capture `retrieval.hits` and `expected_evidence_found`. Citation resolution checks source IDs, quotes, offsets and checksums; read the investigation for semantic review and missing-fact classification findings.

Resumed comparisons: [smaller CPU](qwen3-small-cpu.json), [two-passage Metal](qwen3-small-top2.json). Public model provenance: [1.5B](small-model-provenance.json), [1.7B](qwen3-small-model-provenance.json). Actual demo: [first NRC request](live-demo-0.json), [repeat](live-demo-1.json). Automated fallback checks do not establish factual correctness; see the report’s corrected semantic assessment.
