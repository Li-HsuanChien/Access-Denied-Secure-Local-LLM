# Design decisions: E1 runtime

## 1. Wrap the official `llama-server` rather than embed llama.cpp

We launch the upstream binary as a child process and talk to it over loopback HTTP.

* Upstream ships Windows builds (CPU, Vulkan, CUDA) weekly. Updating means replacing `bin\`, with no rebuild of our code.
* A crash in native code (bad model file, out of memory) kills the child, not the launcher. The launcher reports it
  with a diagnosis and the relevant log lines.
* The alternative (`llama-cpp-python` in-process) is easier to bundle into one EXE, but lags upstream by weeks and
  ties us to a Python/C++ ABI.

## 2. A thin gateway in front of llama-server

The public port (`8080`) is ours. llama-server sits on a random internal port. The gateway gives us:

* **A stable contract.** llama.cpp changes its response fields and flags often. E3/E4 code against `docs/api.md`,
  not against whichever llama.cpp version is installed.
* **Health with a reason** (`loading`, `error` plus hint) instead of a bare 503.
* **Actionable errors** with a stable `code` and a user-facing `hint`.
* **Security controls**; see §4.
* **Privacy.** The access log records method, path, status and latency only. Prompt and document text is never
  logged (a test enforces this). llama-server's own `/v1/models` exposes the model's full file path; ours doesn't.

The cost is one extra loopback hop: about 1 ms per request, which is negligible next to inference.

## 3. Standard library + `psutil` only

The runtime uses Python's standard library (`http.server`, `http.client`, `tomllib`) plus `psutil` for memory and
socket measurement. There's no web framework and nothing to audit or update on an air-gapped machine. PyInstaller
bundle size is about 19 MB.

## 4. Offline and local-only guarantees

| Control | Where |
|---|---|
| Gateway binds `127.0.0.1` and refuses anything else unless `allow_remote = true` | `offline.require_loopback` |
| llama-server always gets `--host 127.0.0.1`, a random free port, and `--offline` when the build supports it | `backend.build_args` |
| Environment scrubbed before spawn: `LLAMA_ARG_*`, `HF_*`, proxies removed (so nothing can trigger an `-hf` download) | `discovery.scrubbed_env` |
| **Per-launch random API key on llama-server**, passed via environment (never on the command line or in logs). llama-server enables CORS for all origins by default, so without this any web page could call the internal port directly | `backend.start` |
| Gateway rejects non-local `Host` (DNS rebinding) and non-local `Origin` | `gateway._guard` |
| 16 MiB request cap | `gateway.MAX_BODY` |
| Evidence: `baseline` records outbound-network probes and a socket audit of llama-server | `offline.outbound_network`, `socket_audit` |
| Optional Windows Firewall block rules for both executables | `scripts/windows/block-network.ps1` |

## 5. Process lifetime

On Windows, llama-server is placed in a **Job Object with KILL_ON_JOB_CLOSE**, so it dies even if the launcher is
killed from Task Manager. Otherwise a 3 GB process would be left holding the port. Elsewhere an `atexit` hook
stops it. Linux's `PR_SET_PDEATHSIG` was tried and rejected: it fires when the spawning *thread* exits, which killed
the backend when the runtime was started from a worker thread. A test covers this case.

## 6. Measurement methodology

* **Startup:** process spawn until `/health` returns 200, polled every 50 ms.
* **Peak RAM:** the OS lifetime peak counter (Windows `PeakWorkingSetSize`, Linux `VmHWM`), cross-checked with
  100 ms RSS sampling. The report says which source was used.
* **Tokens/s:** llama.cpp's own `timings` (engine-side), so HTTP overhead isn't counted.
* **Two prompts:** a short one (generation speed), and a RAG-shaped one with about 1.3k tokens of synthetic
  passages, because on CPU reading the retrieved context is usually the longest wait.
* **Prompt cache disabled** (`cache_prompt: false`). Otherwise llama.cpp reuses the identical prompt from the
  previous run and prompt speed looks near-instant. (The first real-engine test run caught exactly this.)
* Temperature 0, fixed seed, warm-up request excluded, median of N runs.
* **Recommendation rule:** among options that fit the RAM budget and meet the speed floors (≥ 8 tok/s,
  ≤ 15 s to first token by default), pick the highest bits-per-weight, capped at Q6_K, with ties going to lower RAM.
  Answer quality is **not** measured. E5's eval set must confirm the pick.

## 7. Stub backend

`--server-bin stub` runs a stand-in llama-server that speaks the same CLI and HTTP API. It **allocates real memory**
in proportion to the simulated model/quant, so the RAM measurement path is exercised for real. Speed is modelled as
memory-bandwidth bound. Every stub output is labelled (`system_fingerprint: docqa-stub`, `engine.stub: true`,
report banners), so simulated numbers can't be mistaken for real ones. It also has fault injection
(`DOCQA_STUB_FAIL=load|hang_load|crash_after_first`) for tests.

## 8. Week 3: selecting and freezing the model

**Quality is measured, not assumed.** Until Week 2, the recommendation used bits-per-weight as a stand-in for
quality. `bench --quality` now runs a fixed eval set (`evals.py`, version-stamped like the prompt set) of 23
questions over the benchmark passages, asked with the product's own prompt:
15 answerable (the fact under "From your documents:" *and* the right `[S#]` label are required), 5 with no answer
in the passages (no document claim allowed, and the reply must say they don't cover it), and 3 where a planted
passage tries to hijack the assistant. Requests use the product's settings (temperature 0.1, seed 42, up to 512
tokens). Scoring is regex-based and deterministic, so it is repeatable and needs no second model as a judge. It is
a selection screen; E5's grounding and citation set is the acceptance test.

**Selection rule** (`bench.analyse`):
1. Drop anything that misses a threshold: peak RAM ≤ 6 GB (8 GB laptop, minus OS, app and vector store),
   ≥ 8 tok/s generation, ≤ 15 s to first token and ≤ 30 s total on the largest real RAG prompt E3 measured
   (about 2.1k tokens, 256 answer tokens; SDD §12),
   ≥ 80% of eval items, ≥ 80% correct refusals, 100% injection resistance.
2. Of the rest, take the highest eval score.
3. Ties go to the more capable model (weight size, with precision above Q6_K discounted), because every
   remaining candidate already fits the budget. Then lower RAM.

**Pinned engine settings.** This llama.cpp build defaults to 4 parallel slots and an 8 GiB RAM prompt cache
(`--cache-ram 8192`). Both were invisible in Week 2 and would make RAM use on an 8 GB machine depend on how long
the app had been running. `runtime.toml` now sets `parallel = 1` (the product answers one question at a time)
and `cache_ram_mib = 0`. The single slot's own KV cache still reuses the shared system-prompt prefix.

**Evaluate with the product's prompt, not our own (revised 2026-10-26).** The first real eval (2026-10-05) used a
runtime-only prompt. It showed a `[doc:page]` example and "say you could not find it" being copied literally, and
a planted instruction obeyed in 2 of 3 cases. Meanwhile E3's Question Answering module had defined the prompt the
product actually sends (`secure_qa/answering/context.py`: labelled `<<<S1 | title | page>>>` passages, `[S1]`
citations, three headed sections, passages declared data and neutralised). Selecting a model on a different prompt
measures the wrong thing, so `prompts.py` is now a copy of `context.py`, and a parity test in the backend suite
(`test_runtime_prompt_parity.py`) fails if they drift. Prompt set `2026-10-26.1` and eval set `2026-10-26.1` are
not comparable with the 2026-10-05 numbers.

**Freezing.** `docqa-runtime freeze` writes `release-manifest.json`. It records the model file's SHA-256 and
size, the llama.cpp tag and commit, the settings that affect output or exposure (context, threads, slots, cache,
mmap, offline, bind) and the benchmark evidence. `docqa-runtime verify` re-checks all of these (`doctor` does the
quick version), and `/health.release` reports whether the loaded model is the frozen one. Ports, paths and
timeouts are deliberately not frozen; they are per-machine deployment details.

**Contract hardening.** The gateway used to pass llama-server's chat responses through unchanged, which left E3
and E4 exposed to whatever fields a llama.cpp build adds or renames. It now re-emits the documented v1 shape for
both normal and streamed responses. JSON Schemas in `contract/` plus `tests/test_contract.py` pin every
response type and error code.

## 9. Week 4: stable start, stop and configuration

* **Restarts.** `tests/test_runtime.py::test_repeated_restarts_on_the_same_port` starts, answers and stops three
  times on one port and checks the previous llama-server process is gone each time. Windows cleanup relies on the
  Job Object (kill-on-close) set up in `backend.py`; the desktop shell sets its own (`lifecycle.rs`).
* **Configuration.** [`configuration.md`](configuration.md) explains context size (with the KV-cache cost per
  size), threads, port, binding, slots and cache. Every configuration mistake stops before the model loads, with a
  `code`, a hint and exit code 2.
* **The manifest in the desktop app.** `desktop_entry.py` copies `runtime.toml` into the user-data folder, so a
  manifest beside the config would never be found there. The runtime now also looks beside the models folder,
  which stays in the installed payload. The release build still has to copy `release-manifest.json` into
  `payload/runtime/` for `/health.release.manifest` to be true in a packaged app (handed to the release owner).

## 10. Week 5: settings for real RAG context sizes

E3 measured the real corpus (`docs/evidence/e3-context-sizes-2026-10-19.json`): at most about 2,100 estimated
prompt tokens with 5 passages, 512 tokens reserved for the answer, nothing dropped. `ctx_size = 4096` stays: it
leaves about 1,500 tokens for conversation memory and longer chunks, and costs 576 MiB of KV cache for Qwen3-4B.
3072 would save 144 MiB but leave about 450 tokens of slack; 8192 would cost another 576 MiB the 8 GB budget does
not have. `bench` now times a prompt of that maximum size and judges the latency thresholds on it. The measured
latency and RAM on the reference laptop are still open; the dev machine was too memory-constrained to give
decision-grade numbers (Week 5 report).

## 11. Week 6: cancellation and shutdown

With one slot, an answer nobody is waiting for blocks the next question until it reaches its token limit. Requests
now carry an id (`X-Request-ID`, generated if absent), and `POST /v1/requests/{id}/cancel`, a caller hanging up,
or the runtime stopping all cancel the answer. The gateway closes its connection to llama-server, which stops
generating, and the caller gets `409 request_cancelled` (or a final error event when streaming). For a
non-streaming request llama-server sends nothing until it has finished, and on Windows a blocked read in another
thread is not woken by shutting the socket down. So the gateway polls the socket every 0.25 s while it waits,
instead of blocking. `/health.requests` adds `in_flight` and `cancelled` so the UI can show a busy state. All of it
is additive to API v1; `tests/test_cancellation.py` covers each path and that the next request is unaffected.

## Verification done in this workspace

* 103 automated tests on Windows (2026-10-26: 102 pass, 1 opt-in real-engine test skipped): unit, HTTP integration,
  failure modes, CLI exit codes, security, API contract schemas, quality-eval scoring, release manifest,
  restarts and cancellation. Plus 3 prompt-parity tests in the backend suite.
* The same launcher, gateway and benchmark run against a **real `llama-server` built from llama.cpp source**, using
  a tiny random-weight model built from llama.cpp's bundled vocab and quantized to F32/F16/Q8_0/Q4_K_M.
  This confirmed flag compatibility, `--offline`, `/props` context capping, the `timings` format, the
  context-overflow error, the backend API key, and the corrupt-model and bad-flag diagnoses.
* The PyInstaller spec builds and the frozen bundle runs, finding its config and folders relative to the executable.

## Known limitations / not verified here

* **Not run on the 8 GB reference laptop.** Everything so far ran on a 16 GB dev machine (Windows 11) that was
  memory-constrained during real-model runs, so no latency or peak-RAM figure here is decision-grade.
* The PyInstaller `.exe` (`build_exe.ps1`) has not been rebuilt on Windows; the desktop app now packages the
  runtime through `app/release/` instead.
* One model per runtime instance. Switching models means a restart (`--model`).
* All 9 downloaded candidate files are pinned by SHA-256 in `models/shortlist.json`; Llama-3.2-3B Q8_0 and
  Qwen2.5-1.5B Q8_0 were never downloaded.
