# ADR 0011: Concise document answers and deterministic conversation memory

**Status:** Active. Supersedes the summary-maintenance mechanism in ADR 0005.
**Date:** 2026-11-17.

## Evidence

The [real-model investigation](../../performance/2026-11-17-local-answer-latency.md)
measures the complete loopback answer request, including work after the answering
service returns. The existing host waits for a summary generation after every saved
answer, including the first turn. Follow-ups also generate a retrieval rewrite.
This contradicts ADR 0005's stated maximum of one additional small generation per
turn. Summary generation is absent from the answer's existing `timing` fields and
replaces the evidence prefix in llama.cpp's single slot, increasing the next
question's prompt-processing work.

## Decision

Use the answering module's existing bounded extractive summary mechanism for every
saved exchange. Retain excerpts of the question and validated answer, append them
to the prior summary, and retain at most 1,200 characters, favoring recent exchanges.
Keep the existing six-message recent-turn window and the model-assisted follow-up
retrieval rewrite, including its error fallback. Summary maintenance makes no model
call. Keep the callable signature compatible with the thin host adapter; existing
history records require no migration.

Memory remains delimited untrusted context, never citable evidence. Retrieval,
relevance filtering, citation validation, the single corrective retry, withholding
invalid claims, and general-knowledge labeling remain in force. The host continues
to hold its one-job lock through history persistence. No background generation,
parallel inference, remote calls, downloads, or unvalidated answer streaming is
introduced.

Use grounded prompt version `e3-rag-2026-11-17.1` in the answering workflow and
the runtime evaluation copy. Ask for direct supported facts, with one sentence
for a simple fact, and limitations only when they affect the answer. When the
requested fact is absent, state that only as a limitation, without citations or
a document-backed claim. Real-weight testing exposed the old prompt's tendency
to cite a statement of missing information as an answered document fact; the
revised instruction passed that refusal case. The correction limit and validator
are unchanged. Keep five retrieved passages, the 0.38 relevance floor, the 4096
context window, and the 512-token output ceiling; brevity is an instruction, not
a new truncation limit.

Retain the existing CPU configuration and Qwen3-4B Q4_K_M candidate. Lower thread
count, smaller microbatch and passive waiting did not establish a benefit under
the measured workload. Metal is recorded only as an optional Apple-platform
comparison; no GPU default or application model-download behavior is introduced.
Separately staged smaller weights may be evaluated without changing the selected
model; their results and quality limitations belong in the investigation. The frozen
release manifest is not requalified or rewritten by these development runs.

## Consequences and limits

- A saved first turn has no memory-related model call. A follow-up has at most one
  such call: the retrieval rewrite. Grounded-answer correction and general fallback
  can still add calls independently of memory.
- Summary text is now a deterministic collection of bounded excerpts, rather than
  a model-written abstraction. It cannot invent a new summary fact, but may omit
  older information or truncate a long exchange. The recent-turn window remains
  the primary source of immediate conversational context. This does not promise
  lossless recall of long conversations.
- Existing wire timings still describe the answering-service interval. Use the
  benchmark's HTTP wall time and per-call records for end-to-end performance;
  do not describe the existing `generation_ms` as total user wait.
- CPU settings and model selection must be justified by measured quality and
  resource use. This Mac's results do not qualify the designated 8 GB laptop or
  change the frozen release model, binary, or reference-machine requirements.

## Verification

Memory tests ensure saving retains the exchange without invoking the model,
remains bounded, and cannot incorporate invented summary output. Host integration
tests verify saved turns, memory and citations remain available with no extra
summary generation. Real-weight comparisons include supported questions,
unsupported questions, adversarial document instructions and a follow-up; see the
linked report for measured results and remaining qualification limits.

## Prepared Apple-silicon demo profile

The user subsequently requested a smaller model with Metal for the next-day demo.
Keep the reference/release configuration in `runtime.toml` unchanged and provide
`runtime.demo-macos.toml` as an explicitly selected developer demo profile:
Qwen3-1.7B Q4_K_M, all available layers on Metal (`n_gpu_layers=99`), and
`--chat-template-kwargs '{"enable_thinking":false}'`. The application still makes
one local validated answering request at a time. This is a text-demo selection,
not qualification of a new release or the 8 GB reference laptop.

The staged GGUF is from [ggml-org's pinned artifact](https://huggingface.co/ggml-org/Qwen3-1.7B-GGUF/blob/daeb8e2d528a760970442092f6bf1e55c3b659eb/Qwen3-1.7B-Q4_K_M.gguf),
SHA-256 `d2387ca2dbfee2ffabce7120d3770dadca0b293052bc2f0e138fdc940d9bc7b5`.
Its declared license is Apache-2.0. Acquisition and checksum verification happen
on this connected development machine; the demo launcher performs no installs or
downloads and uses only already-staged files. The original 4B weights remain
available. A preceding Qwen2.5-1.5B test omitted citations even after correction;
that model is not activated.

`app/desktop/start-demo-macos.command` starts the prepared profile through the
existing supervised local stack, or opens the already-running matching demo.
`launch.start_stack` accepts an optional explicit runtime configuration path;
ordinary launcher behavior remains unchanged. Documents, settings and history
continue using the same local host and stores. See the [demo runbook](../../development/macos-text-demo.md)
for startup and rollback. The report preserves the initial strict golden failure
for the half-life question and documents the verified alternative source passage
added to its evidence annotation; citation validation itself is unchanged.
