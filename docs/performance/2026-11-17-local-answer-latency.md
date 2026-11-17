# Local text-answer latency investigation — 17 November 2026

This report concerns real local inference through the production Python host/workflow/runtime gateway, comparing the original Qwen3-4B Instruct 2507 Q4_K_M with smaller candidates. It is not a stub benchmark or reference-laptop qualification. **The CPU default has not met the under-30-second target reliably under the current workload.** The optional revised Metal run passed all 11 smoke checks below 30 seconds; this does not qualify the 8 GB reference laptop.

## Prepared demo outcome

At the user's request, the active development demo now uses **Qwen3-1.7B Q4_K_M with Metal and thinking disabled**, selected through a separate prepared profile. The [demo runbook](../development/macos-text-demo.md) gives the restart command. `runtime.toml`, the original 4B CPU default, and the frozen release manifest remain unchanged.

| Same NRC question in actual NRC-only app | Initial 4B CPU observation | Revised 1.7B Metal demo |
|---|---:|---:|
| First request after readiness (not process startup) | 62.615 s | 5.105 s |
| Immediate identical repeat | 37.077 s | 0.721 s |

Both demo answers correctly state approximately 12 feet and resolve to the actual NRC source. These probes have no conversation ID and do not add test chats to the user's history. Different background pressure and model/device settings mean this is an observed combined improvement, not an isolated speedup estimate for one change.

In the separate four-document saved-chat suite, the final 1.7B Metal run passed all **11 automated smoke checks**, with 0.031–8.008 s request latency, 5.448 s process startup and 2.264 GiB peak sampled host/model RSS. Startup plus first NRC answer was **8.071 s**. This meets the text-question target for this small demo workload on the M3/16 GB machine. The 8 GB reference laptop and larger production corpus remain unqualified, and the original CPU configuration still misses the target.

## Method

The test machine is an Apple M3 MacBook Air (Mac15,12), 16 GiB unified memory, four performance and four efficiency CPU cores, 10-core integrated GPU with Metal 4 support, macOS 26.6.2 (25G83), arm64. The designated reference laptop has 8 GB RAM and integrated graphics; it was not available in this session. Other applications remained open. Existing system memory pressure and swap are part of the observed conditions, not attributed entirely to DocQA.

The baseline runtime is llama.cpp 0.6.0, build 11429, commit d81235049; Python 3.13.2; Qwen3-4B Instruct 2507 Q4_K_M, 2,497,280,736 bytes, SHA-256 `2fde00ce69dd4899c70d020845e2638353015bba0fdf161b3eb965f2bca4464e`. Baseline: CPU-only, eight threads, 4096 context tokens, one slot, mmap on, mlock off, RAM prompt cache disabled, default logical batch 2048 / physical microbatch 512, temperature 0.1, seed 42, maximum answer 512 tokens. Sentence Transformers all-MiniLM-L6-v2 runs locally on CPU. Retrieval retains five chunks above cosine similarity 0.38. KV cache types are f16, flash attention is auto, and no explicit batch-thread override is set. Installed packages: torch 2.14.1, sentence-transformers 6.0.1, chromadb 1.5.9, numpy 2.5.4, psutil 7.2.2, PyMuPDF 1.28.2. The local llama.cpp build 11429 differs from frozen release build 11242; these runs do not requalify the release manifest.

Two initial requests used the running application's NRC-only collection (24 pages / 59 chunks), with no conversation ID and general knowledge disabled. The controlled benchmark uses a separate four-document public fixture collection (NRC, DOE, arXiv, adversarial coolant document; 135 pages / 282 chunks). It uses the real embedding model, store, HTTP host, answer service, gateway, and model weights. Each independent question starts a saved conversation, matching the interface default. A repeated NRC case uses a new conversation; the follow-up reuses the initial NRC conversation. User history and collection are not modified.

End-to-end latency starts before the loopback HTTP request and ends after receipt and JSON decoding of the complete validated response, including history persistence and summary maintenance. Frontend rendering and human typing are excluded. Retrieval is timed by the workflow; individual model-call wall time, actual prompt evaluation and token-generation timings and usage come from the runtime gateway. Citation parser/validator time is measured independently in the benchmark. Prompt token usage includes cached input; `prompt_n` reports tokens actually evaluated. Retries, rewrites, summary calls and general-knowledge fallback are identified separately. No unvalidated text is streamed to the interface.

Cold means a new model/backend and embedding/host process with no application prompt cache. OS file caches are not flushed; this is process-cold, not a powered-off laptop/disk-cold test. Startup is reported separately and added to first-request latency where indicated. Already-loaded means subsequent requests in the same process; a repeated identical prompt is distinguished from different questions because llama.cpp can reuse the single slot's KV prefix even with `--cache-ram 0`.

Memory is the maximum simultaneous sum of benchmark host/gateway/embedding process RSS plus llama-server RSS sampled every 100 ms. The desktop shell and other applications are excluded. RSS is not a total unified-memory footprint or an 8 GB capacity proof; compressed/swapped memory and short spikes may be missed. Swap used is system-wide. On macOS actual `vm_stat` Swapins/Swapouts times page size are used, because psutil's sin/sout expose pageins/pageouts. Initial live-probe counters came from psutil and must not be labeled actual swap I/O. Run order, thermal conditions, background apps, caching and memory pressure limit causal precision.

Quality checks use known fixture evidence, expected facts, exact citation quote/offset/checksum resolution, refusal cases, and manual review of answers and cited passages. Lexical fact matches are indicators, not semantic graders. Citation-label validation verifies supplied evidence identity, not entailment; semantic correctness is reviewed separately. This small collection and smoke set do not substitute for the full 2,000–5,000-page reference-machine evaluation, visual-model qualification, or long-conversation evaluation.

## Initial findings

The existing NRC-only collection returned a correct, cited fuel-rod answer in 62.615 s on the first measured request and 37.077 s on an immediate repeat. These were temporary questions with no saved-chat summary. The first request spent 31.952 s evaluating 868 uncached input tokens (872 total prompt tokens), 30.324 s generating 85 tokens, and 0.196 s retrieving evidence. The repeat evaluated one uncached token in 0.936 s, generated 88 tokens in 35.792 s, and retrieved evidence in 0.305 s. Both used one model call and no citation retry. This first live observation is an already-running but partly paged-out process, not a cold model load.

In the four-document saved-chat control, the first NRC request took 103.385 s: 65.590 s prompt evaluation, 26.539 s answer generation and 11.052 s for the separate summary call. The repeated question took 78.738 s and re-evaluated 1,751 of 1,755 input tokens: the intervening summary had displaced the evidence prefix. The PWR matrix question took 114.985 s, including a 29.997 s summary call. Retrieval took 0.032–0.193 s across these cases and citation validation 0.00025–0.00168 s.

A subsequent control question about PWR manufacturers was interrupted after more than 436 s in the model call. Its answer correctness and token totals are unknown; it is an aborted slow run, not an excluded success. A one-second native stack sample showed CPU quantized inference and OpenMP thread barriers. The follow-up passive-waiting experiment is motivated by that sample; it is not proof that spinning alone caused the slowdown. LLVM documents how [OpenMP waiting policy and block time control spinning versus yielding](https://openmp.llvm.org/design/Runtimes.html).

The user explicitly chose to continue under the current workload. Background CPU contention, thermal conditions and system-wide swap remain confounders. Reported elapsed-time differences are observations under that workload, not clean estimates of each setting's isolated causal effect. Token counts, call counts, preserved evidence and successful citation checks provide complementary evidence.

## Changes selected

1. Replace the post-answer model summary with bounded deterministic excerpts of the validated exchange. This removes one model call from every saved turn, including refusals and failed answers. It also leaves the evidence prefix in the model's single slot. A follow-up still performs its retrieval rewrite; memory remains untrusted context, not evidence.
2. Use a shorter, direct-answer grounded prompt, version `e3-rag-2026-11-17.1`, in both production and runtime evaluations. On NRC, answer output drops from 53 to 18 tokens in the controlled corpus. Total input drops only from 1,755 to 1,723 tokens: evidence remains the bulk of the prompt. Half-life output drops from 110 to 29 tokens. Unnecessary “None” limitations disappear.
3. Explicitly place missing requested facts only in limitations, without citations. The old prompt and the first concise experiment incorrectly classified the missing-temperature question as answered because they cited a statement of absence. Neither invented a melting temperature, but their classification was wrong. The final prompt returns insufficient evidence with no document claims or citations.

The [decision record](../architecture/decisions/0011-text-answer-latency.md) and SDD are updated in this change set. Retrieval threshold, top five passages, 512-token ceiling, 4096-token context, model, CPU defaults and validator are retained. There is no parallel generation, background summary, outbound application behavior or unvalidated streaming.

## Optional Apple GPU comparison

Metal uses the same Qwen3-4B weights with `n_gpu_layers=99`, offloading all available layers; it is a platform-specific comparison, not the CPU default or an integrated-GPU result for every laptop. These profiles each used a fresh process. Times below exclude startup and include saved-chat work. All non-first rows are already loaded; only `warm` repeats the same prompt.

| Question | Legacy Metal, s | Revised Metal, s | Revised result |
|---|---:|---:|---|
| NRC fuel-rod length (`c01`) | 20.594 | 10.658 | Approximately 12 feet, cited |
| NRC exact repeat (`warm`) | 25.004 | 0.747 | Same correct cited answer |
| PWR matrix (`c02`) | 32.936 | 9.224 | 17 × 17, cited |
| PWR manufacturers (`c03`) | 29.413 | 14.077 | Three correct manufacturers, cited |
| Radioactive half-life (`c05`) | 31.258 | 21.049 | Correct definition, cited |
| Coolant design pressure with hostile source instructions (`i01`) | 34.139 | 25.305 | 2,485 psig, cited; injected instructions ignored |
| World Cup, general knowledge off (`o01`) | 3.123 | 0.122 | Refused without model call |
| Contract fees absent from corpus (`o03`) | 2.029 | 0.043 | Refused without model call |
| NRC melting temperature absent (`missing`) | 38.084 | 23.921 | Insufficient evidence, no document claim |
| World Cup, general knowledge on (`fallback`) | 6.480 | 4.785 | Separately labeled general knowledge, no citations |
| PWR matrix conversational follow-up | 33.188 | 20.552 | Correct cited answer, one rewrite call |

Metal startup-to-ready was 6.748 s legacy and 7.584 s revised. Startup plus first NRC answer was 27.342 s and 18.242 s respectively. All 11 revised request-level checks passed and all requests were below 30 s in this run. Legacy passed 10/11 classification/citation/fact checks; its missing-temperature answer failed refusal classification and required one citation retry. Legacy also added irrelevant or misleading limitations, especially after correctly stating the PWR matrix. Exact source citations resolved in both versions' supported answers.

The revised NRC request spent 9.712 s processing its prompt and 0.727 s generating 18 tokens. The repeat processed one token in 0.039 s and generated in 0.663 s. No summary calls or citation retries occurred in the revised suite. Retrieval hit the known evidence for every supported question; standalone evidence IDs/ranks were unchanged between the two profiles. The follow-up rewrite changed the query/ranking but still retrieved and cited the expected passage. These are checks on a small fixed set, not a statistical guarantee.

## Settings and isolated experiments

| Experiment | Observed result | Decision |
|---|---|---|
| CPU, 8 threads, old behavior | NRC 103.385 s; repeat 78.738 s; PWR matrix 114.985 s | Control; a later manufacturer request was aborted after 436 s |
| CPU, 4 threads, old behavior | NRC 173.305 s; half-life 239.547 s; both correct | No measured benefit; retain default |
| CPU, physical microbatch 128 | NRC grounded call timed out at 180 s; old summary added 101.378 s; 281.675 s total | Reject; no valid answer |
| CPU, passive OpenMP / block time 0 | NRC 183.823 s; half-life grounded call timed out, total 198.465 s | Reject; no demonstrated improvement |
| Metal, answer ceiling 256, old behavior | NRC 8.155 s, still exactly 53 answer tokens | No token saving; keep 512 to avoid new truncation risk |
| Metal, concise prompt only, old summary | NRC 7.040 s / 18 answer tokens; half-life 9.825 s / 29 tokens | Adopt concise instructions, not a smaller ceiling |
| Metal, deterministic summary only, old prompt | NRC 8.109 s; repeat 1.980 s; follow-up 14.126 s | Adopt removal of summary generation |
| Metal, later old-behavior control | NRC 28.138 s, still 53 answer tokens | Confirms substantial workload variance |

These are serial exploratory comparisons, not randomized trials. The 8.155 s versus 28.138 s controls generated the same answer token count; the difference cannot be credited to lowering the token ceiling. The stronger evidence for the selected changes is fewer output tokens, one fewer model call, preserved KV reuse, and correct final outputs. A two-thread trial was canceled before a completed measurement and provides no evidence. A later CPU control repeat and two-passage prompt trial were queued but not run after the user prioritized the demo; no result is claimed for them. An earlier combined concise prompt passed supported questions but failed missing-fact classification; it is retained as `metal-combined`, not represented as the selected prompt.


## Smaller-model comparisons and source review

The failed 1.5B trial used [Qwen2.5-1.5B Instruct Q4_K_M](https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/blob/dd26da440ef0330c47919d1ecae0966d24022222/qwen2.5-1.5b-instruct-q4_k_m.gguf), SHA-256 `6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e`. Its 1.831 GiB sampled peak and roughly 3–6 s supported-question times were attractive, but all seven supported/repeat/follow-up cases omitted citations even after the corrective call. The validator withheld the answers. Only four unsupported/fallback cases passed. It was rejected for the demo; fast invalid answers are not successes.

The selected demo GGUF is [ggml-org's Qwen3-1.7B Q4_K_M](https://huggingface.co/ggml-org/Qwen3-1.7B-GGUF/blob/daeb8e2d528a760970442092f6bf1e55c3b659eb/Qwen3-1.7B-Q4_K_M.gguf), 1,282,439,264 bytes, SHA-256 `d2387ca2dbfee2ffabce7120d3770dadca0b293052bc2f0e138fdc940d9bc7b5`, Apache-2.0. The same llama.cpp binary, retrieval settings, prompt, output ceiling and validator are used. Only model selection, Metal offload and `--chat-template-kwargs '{"enable_thinking":false}'` differ from the CPU configuration. Thinking is disabled through the model's template, without exposing intermediate or unvalidated text. No dynamic model routing is added.

| Final 1.7B Metal case | HTTP s | Result |
|---|---:|---|
| NRC length | 2.623 | Correct, cited |
| Identical repeat | 0.371 | Correct, cited |
| PWR matrix | 2.326 | Correct, cited |
| PWR manufacturers | 3.185 | Correct, cited |
| Half-life | 3.237 | Correct, alternate source passage cited |
| Hostile-source pressure | 3.492 | Correct, instructions ignored |
| World Cup, general off | 0.031 | Refused without generation |
| Absent contract fees | 0.035 | Refused without generation |
| Absent melting temperature | 4.774 | No document claim or invented temperature |
| General-knowledge fallback | 1.372 | Labeled general answer without citations |
| Conversational PWR follow-up | 8.008 | Correct cited core fact; unnecessary limitation |

The first NRC call used 1,727 input tokens and 20 output tokens, versus 1,723/18 for revised 4B. All standalone supported questions retained the expected evidence. No citation retries or summary calls occurred in the final 1.7B suite; the follow-up added one rewrite. Its total sampled swap-in was 4.7 MiB and swap-out zero, versus 369.5/427.0 MiB for the earlier revised 4B Metal profile. These are system-wide counters and different workload moments, so the swap difference is not a model-only measurement.

The first 1.7B run passed 10/11 strict golden checks. Manual source review found the half-life answer was correct and cited the exact definition on DOE PDF page 36, while the fixture only allowed the summary definition on page 42. The existing `also_evidence` annotation was extended with the exact page-36 text; the original failed record is preserved, and the entire suite was rerun. This is a ground-truth annotation correction, not a weakened citation validator. Earlier notes about losing the half-life evidence with top two referred to the incomplete annotation; page 36 is also valid at rank two. No top-two inference result is claimed.

Manual review also found a remaining 1.7B quality limitation: its follow-up states the correct 17×17 PWR matrix but adds an unnecessary caveat about the exact matrix size. The automated fact/citation checks do not catch that caveat. It is not a missing citation or fabricated matrix, but the smaller model is not claimed to have identical prose quality to 4B. The broader quality and visual-question gates remain open. The smaller candidates were tested with Metal, not qualified on CPU; the user requested the accelerated demo before that additional comparison.

## Measurement interpretation and remaining work

The first live collection's 872 input tokens and the four-document suite's 1,755 legacy input tokens are different workloads; their times are not an apples-to-apples optimization comparison. The latter includes more retrieved material and saved-chat maintenance. For same-workload comparisons use the paired profiles, while retaining the workload-variance caveat.

A timeout is a failed answer. The gateway returns no completed usage or phase timings for that call, so prompt and generation durations are unknown rather than zero. Retrieval capture is independent of the answer result in the later harness: the expected NRC/PWR passages were found even when generation timed out. Older golden-check fields say `evidence_retrieved: false` on a failed answer because the failure payload has no evidence; that does not establish a retrieval miss. Per-call gateway timings do not sum exactly to HTTP wall time: scheduling, serialization, gateway overhead, cancellation and persistence occupy the remainder. Validation times are shown in milliseconds, not seconds.

The remaining CPU bottleneck is prompt evaluation of roughly 1,600–2,100 tokens, with highly variable generation speed and existing system contention/swap. Removing summaries and reducing output help but cannot guarantee fast new-topic prompts. Retrieval and deterministic validation are small enough that replacing Chroma or weakening citation checks is not justified by these measurements. Repeating the identical question is an unusually favorable cache case, not the normal latency for a new question.

The application continues to bind only to loopback and retain its one-job lock. The benchmark uses local embedding/model files and disables model-hub downloads/telemetry during inference. The optional smaller-model staging download is a separate public-weight acquisition step, not a runtime network feature; no document content or questions are submitted remotely. The frozen candidate, reference configuration and release manifest remain unchanged; the explicitly selected developer demo profile is separate.

Qualification still requires the designated 8 GB laptop, the representative 2,000–5,000-page library and 10,000-page stress case, controlled repeated runs, and text/visual/adversarial and longer-conversation quality evaluation. The 16 GB Mac's RSS and optional Metal times cannot establish those gates. No latency target or reference-machine requirement has been relaxed.

<!-- generated measurement tables -->

## Final CPU measurements

The production configuration retains eight CPU threads and zero GPU layers. `final-cpu` uses the actual revised production prompt and summary implementation, not a benchmark override. Requests below include HTTP response and persistence; startup is separate. A failed row is not a correct answer or a sub-30-second success.

| Case | HTTP s | Prompt s | Generation s | Input / answer tokens¹ | Peak RSS MiB | Result |
|---|---:|---:|---:|---:|---:|---|
| c01 | 180.443 | unknown | unknown | unknown | 3278 | failed |
| warm | 11.318 | 0.464 | 10.309 | 1723 / 18 | 3273 | answered |
| c02 | 180.304 | unknown | unknown | unknown | 3357 | failed |
| c03 | 159.327 | 143.371 | 10.453 | 1735 / 38 | 2879 | answered |
| c05 | 134.059 | 126.428 | 7.555 | 2076 / 29 | 2903 | answered |
| i01 | 113.805 | 108.220 | 5.494 | 2142 / 22 | 2951 | answered |
| o01 | 0.059 | 0.000 | 0.000 | 0 / 0 | 2897 | insufficient_evidence |
| o03 | 0.020 | 0.000 | 0.000 | 0 / 0 | 2924 | insufficient_evidence |
| missing | 147.049 | 113.037 | 33.909 | 1909 / 74 | 2964 | insufficient_evidence |
| fallback | 14.493 | 4.922 | 9.244 | 94 / 40 | 2754 | insufficient_evidence |

¹ Input tokens include additional calls, including follow-up rewriting. Answer tokens exclude rewrite/summary output. Prompt/generation columns cover answer calls, including correction or general fallback; the complete additional-call and validation breakdown is in the CSV and per-call JSON.

## Startup, memory and swap comparison

Profiles appear in execution order. Memory includes the benchmark host/embedding/gateway plus model backend. Swap is system-wide actual swap I/O over measured startup and request intervals; fixture-scoring gaps are excluded. It cannot be attributed solely to the model. Used-swap ranges are endpoint observations, not peaks. More swapped-out pages can lower RSS without reducing total memory demand.

| Profile | Ready s | Startup peak MiB | Request peak MiB | Swap in / out MiB | System swap used GiB | Checks passed / measured |
|---|---:|---:|---:|---:|---:|---:|
| baseline | 9.606 | 4879 | 3304 | 675.3 / 735.4 | 7.28–7.70 | 3/3 |
| threads4 | 15.090 | 4580 | 2777 | 1230.8 / 1068.1 | 7.75–7.96 | 2/2 |
| microbatch128 | 11.515 | 4595 | 3579 | 247.1 / 1055.9 | 7.62–8.42 | 0/1 |
| passive | 12.992 | 4733 | 2895 | 1155.7 / 1185.6 | 7.99–8.20 | 1/2 |
| metal-baseline | 6.748 | 3421 | 3559 | 437.2 / 235.9 | 7.76–8.00 | 10/11 |
| metal-combined | 10.700 | 3493 | 3550 | 280.1 / 773.5 | 7.72–8.29 | 10/11 |
| metal-final | 7.584 | 3416 | 3518 | 369.5 / 427.0 | 7.83–8.18 | 11/11 |
| cap256 | 6.303 | 3473 | 3593 | 7.1 / 0.0 | 7.62–7.64 | 1/1 |
| compact-v2 | 4.230 | 3562 | 3710 | 2.6 / 0.0 | 7.62–7.62 | 2/2 |
| summary | 4.271 | 3504 | 3613 | 5.5 / 0.0 | 7.61–7.62 | 3/3 |
| metal-control-repeat | 46.703 | 3246 | 3019 | 60.9 / 0.0 | 7.55–7.61 | 1/1 |
| final-cpu | 23.813 | 4613 | 3357 | 1385.1 / 893.6 | 6.18–7.55 | 8/10 |
| small-metal | 5.307 | 1748 | 1875 | 2.5 / 0.0 | 6.00–6.00 | 4/11 |
| small-diagnostic | 4.476 | 1784 | 1882 | 0.3 / 0.0 | 6.00–6.00 | 0/1 |
| qwen3-small-metal | 4.845 | 2246 | 2349 | 9.3 / 0.0 | 5.94–5.95 | 10/11 |
| qwen3-small-metal-qualified | 5.448 | 2202 | 2318 | 4.7 / 0.0 | 5.88–5.88 | 11/11 |

Early `baseline` startup is the sum of runtime, embedding and store timers because its harness predates the single ready timer. Later profiles measure ready directly. Baseline also has an interrupted manufacturer case outside its three completed rows; the table’s denominator does not turn that interruption into a success. Fresh processes still benefit from OS file caches. The initial already-running NRC-only probes are separate artifacts and are not startup measurements.

## Reproduction and evidence

[Measurements CSV](evidence/2026-11-17/measurements.csv) records every completed request, phase totals, retries/additional calls, token counts, sampled RSS, actual swap I/O and quality results. [Evidence index](evidence/2026-11-17/README.md) links per-call JSON with complete public-fixture answers, citations, hardware, runtime launch arguments, exact prompts and startup records. The [benchmark instructions](../../app/document-qa/backend/secure_qa/answering/benchmarks/README-latency.md) explain preparation and fresh serial runs.

Baseline source commit: `465c7f5c34c926a248257b4d29613dd4a629346f`. The harness freezes its old prompt/summary in `latency_baseline.py`; production uses `e3-rag-2026-11-17.1`. Earlier exploratory records retained the source prompt-version label despite an override; their saved `system_prompt` and SHA-256 identify the actual tested prompt. Later override runs use a `latency-<hash>` label. No report relies on the version label alone.

Regression verification: answering, conversation/history, host integration and runtime evaluation tests passed **117 tests, 1 skipped**, with five third-party deprecation warnings. Existing citation correction, truncation, offline and concurrency checks remain; new tests cover no post-answer summary model call, bounded retained memory and saved history/citations. This is backend verification; no UI or visual-model qualification is claimed.
