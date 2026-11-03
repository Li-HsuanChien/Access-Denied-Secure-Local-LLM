# E1 LLM runtime: Weeks 3–6 report (Otto Slade)

**Status, 2026-10-26.** The runtime work for Weeks 3–6 is in place and tested: 103 runtime tests (102 pass, 1 opt-in
real-engine test skipped) plus 3 prompt-parity tests in the backend suite. The release model is frozen in
`release-manifest.json`, the file E3 was waiting for. **Open:** every latency and peak-RAM figure. They must come
from the 8 GB reference laptop, which hasn't been used yet, and the dev machine was too memory-constrained to
give decision-grade numbers.

Runtime: [`app/document-qa/backend/secure_qa/answering/llama_cpp/`](../../app/document-qa/backend/secure_qa/answering/llama_cpp/README.md)
(paths below are relative to it). The [Weeks 1–2 report](E1-runtime-report.md) covers the launcher, API and baseline.

## Against the plan

| Week | Definition of Done | State |
|---|---|---|
| 3 | Selected model meets RAM / latency / **quality** thresholds on reference hardware; reproducible from documented config | **Quality met:** Qwen3-4B Q4_K_M scored 22/23 with the product prompt (`docs/week3-model-evaluation.md`). **Reproducible:** `release-manifest.json` + `docqa-runtime verify`. **RAM / latency: not measured** (reference laptop) |
| 3 | Final model manifest/checksum, frozen config, evaluation report, stable endpoint contract | Done: `release-manifest.json`, `runtime.toml`, `docs/week3-model-evaluation.md`, `docs/api.md` + `contract/*.schema.json` |
| 4 | Repeated restarts succeed; invalid model/config fails clearly; no network dependency | Done: restart test (3 cycles, same port, old process gone), config errors stop before load with a code + hint, offline by default. Config guide: `docs/configuration.md` |
| 5 | Real retrieved context fits safely; RAM/latency within threshold; configuration documented | **Context fits:** E3's largest real prompt (about 2,100 tokens) + 512 answer tokens in 4,096, about 1,500 spare; KV cache 576 MiB. **RAM/latency: not measured** (reference laptop). `bench` now times a prompt of that size |
| 6 | UI can detect health/model state; cancellation/shutdown does not corrupt later requests; errors actionable | Done: `X-Request-ID`, `POST /v1/requests/{id}/cancel`, cancel on hang-up and shutdown, `/health.requests.in_flight`; `tests/test_cancellation.py` checks the next request each time |

## What changed and why

- **The model is chosen with the prompt the product sends.** The Week 3 eval first used a runtime-only prompt,
  while E3's `context.py` defines the real one. `prompts.py` is now a copy of it, and a backend parity test fails
  if they drift.
- **Pinned llama.cpp defaults.** Build b11242 runs 4 slots and keeps up to 8 GiB of old prompts in RAM by
  default. `runtime.toml` pins `parallel = 1` and `cache_ram_mib = 0`.
- **Responses no longer pass through from llama-server.** The gateway re-emits the documented v1 shape, so a
  llama.cpp upgrade cannot change what E3 or E4 receive. JSON Schemas pin every response and error code.
- **Cancellation.** With one slot, an abandoned answer used to block the next question until it reached its token
  limit. A Windows-specific trap (a blocked read isn't woken by closing the socket) needed polling instead.
- **Manifest in the desktop app.** The app copies `runtime.toml` to the user-data folder, so the runtime now also
  looks for the manifest beside the models folder.

## Findings and handoffs

| For | Finding | Suggested action |
|---|---|---|
| E3 | Qwen3-4B declines unanswerable questions correctly but under "From your documents:", so every refusal trips `uncited_claim` and costs a second generation | Treat an absence-only documents section as empty, or tighten the rule text in `context.py` |
| E3 | One reasoning error: correct quote, opposite conclusion (`allowance-repay`) | Keep in E5's grounding set; the validator checks labels, not support |
| E3 | `LlamaCppGatewayRuntime` doesn't cancel | Send the host's request id as `X-Request-ID`; call `POST /v1/requests/{id}/cancel` on cancel |
| E4 | `/health.requests.in_flight` shows a busy runtime | Use it for a busy indicator; keep one question at a time |
| Release | The packaged app reports `release.manifest: false` | Copy `release-manifest.json` into `payload/runtime/` beside `models/` in `app/release/build.py` |
| E5 | Contract schemas in `contract/`; eval set and scoring in `src/docqa_runtime/evals.py` | Validate against the schemas in integration tests |

## On the reference laptop (the remaining Week 1, 3 and 5 evidence)

1. Copy the runtime folder with `bin/` and `models/`; run `docqa-runtime verify`.
2. Networking off: `docqa-runtime doctor`, then `docqa-runtime baseline --require-offline` (Week 1).
3. Close everything else: `docqa-runtime bench --quality --out runs/week3-selection` (Weeks 2, 3, 5): speed and
   RAM per candidate, judged on the largest real prompt, plus quality.
4. If threads matter (hybrid CPUs), compare `--threads` values, then `docqa-runtime freeze` and commit the manifest
   with the evidence.
