# Runtime configuration guide

Every setting has a safe default; the shipped `runtime.toml` only pins the model. Settings resolve as
**defaults → `runtime.toml` → command-line flags**, and relative paths are taken from the folder that holds
`runtime.toml`. Run `docqa-runtime doctor` after any change: it checks the file, the binary, the model, RAM, the
port and the frozen release without starting anything.

## The settings that matter on the 8 GB laptop

### Context size (`ctx_size`, `--ctx-size`; default 4096 tokens)

The context window must hold the prompt (system rules, passages, question) plus the answer. Each token of window
costs KV-cache memory on top of the model file. For the release model, Qwen3-4B-Instruct-2507 (36 layers, 8 KV
heads of 128 dimensions, read from the GGUF header), that is **144 KiB per token**:

| `ctx_size` | KV cache | Fits E3's real prompts? |
|---:|---:|---|
| 2048 | 288 MiB | No: the largest real prompt (about 2,100 estimated tokens) plus 512 answer tokens does not fit |
| 3072 | 432 MiB | Barely: about 450 tokens of slack, eaten by any conversation memory (ADR 0005) |
| **4096** | **576 MiB** | **Yes: about 1,500 tokens of headroom (E3, `docs/evidence/e3-context-sizes-2026-10-19.json`). Release setting.** |
| 8192 | 1,152 MiB | Yes, but costs another 576 MiB that the 8 GB budget does not have |

Keep 4096. Question Answering packs passages into `ctx_size − 512 answer tokens − prompt − margin` and reads
`ctx_size` from `/health`, so changing it here changes how many passages it sends. If a prompt is still too long,
the runtime returns 400 `context_length_exceeded` and Question Answering retries with one passage fewer.
llama.cpp caps the window at the model's training length; `/health.model.ctx_size` shows the size in effect.

### Threads (`threads`, `--threads`; default 0 = physical cores)

`0` uses every physical core. On CPUs that mix performance and efficiency cores (Intel 12th gen and later), the
slower cores can hold back each token, so try `threads` = the number of performance cores and compare
`docqa-runtime bench` results. Set it per machine; it is part of the frozen release settings, so record the
choice with `docqa-runtime freeze` once the reference laptop's best value is known.

### One slot and no RAM prompt cache (`parallel = 1`, `cache_ram_mib = 0`)

The product answers one question at a time (SDD §12). llama.cpp b11242 would otherwise run 4 slots and keep up
to 8 GiB of old prompts in RAM (`--cache-ram 8192`), so memory would grow with use. Both are pinned, and the
desktop build refuses a `runtime.toml` without `parallel = 1` (`app/release/build.py`). The single slot still
reuses its own cached system-prompt prefix between questions.

### Port and binding (`[server] host`, `port`; `--host`, `--port`)

The public API listens on `127.0.0.1:8080`; llama-server itself gets a random loopback port
(`backend_port = 0`) and a per-launch key that only the runtime holds. The desktop app passes `--port 8080`
explicitly. A busy port fails at once with exit code 4 and a hint naming the port. Any non-loopback `host` is refused
(exit code 6) unless `allow_remote = true`, which must never be set in the product: it would expose the model,
and any document text sent to it, to the network.

## Every setting

| Section | Key | Default | Flag | What it does |
|---|---|---|---|---|
| server | `host` | `127.0.0.1` | `--host` | Public API bind address; loopback only |
| server | `port` | 8080 | `--port` | Public API port |
| server | `allow_remote` | false | `--allow-remote` | Permit a non-loopback bind. Never in the product |
| backend | `server_bin` | `""` (auto) | `--server-bin` | llama-server path; auto = `bin/llama-server(.exe)`, then PATH; `stub` = simulated |
| backend | `backend_port` | 0 | | llama-server's internal port; 0 = a free loopback port |
| backend | `models_dir` | `models` | `--models-dir` | Folder with `.gguf` files |
| backend | `model` | release model | `--model` | File name, id or path. Pinned; `""` would auto-pick by `quant_preference` |
| backend | `ctx_size` | 4096 | `--ctx-size` | Context window in tokens (above) |
| backend | `threads` | 0 | `--threads` | CPU threads; 0 = physical cores (above) |
| backend | `n_gpu_layers` | 0 | `--gpu-layers` | Layers on a GPU; the reference laptop has none |
| backend | `mmap` / `mlock` | true / false | | Map the model file instead of copying it; don't pin it in RAM |
| backend | `parallel` | 1 | | llama-server slots (above) |
| backend | `cache_ram_mib` | 0 | | llama-server RAM prompt cache (above) |
| backend | `extra_args` | `[]` | | Raw llama-server flags. Empty in the product (the desktop build refuses any) |
| backend | `startup_timeout_s` | 180 | | Time allowed for the model to load before `startup_timeout` |
| backend | `request_timeout_s` | 600 | | Time allowed for one answer before 504 `backend_timeout` |
| backend | `quant_preference` | Q4_K_M first | | Auto-pick order when `model = ""` |
| security | `offline` | true | | Pass `--offline` and strip download settings from llama-server's environment |
| output | `runs_dir` | `runs` | | Logs, baselines, benchmark reports. The desktop app points it at the user-data folder |

## When a setting is wrong

Configuration problems stop the runtime before the model loads, with a stable `code`, a one-line hint and exit
code 2. Examples: `config_unknown_key` (lists the valid keys), `config_type` (`ctx_size = "4096"` with quotes),
`config_port`, `config_ctx` (below 256), `config_parallel`, `config_cache_ram`, `model_not_found` (lists the
models present), `model_invalid` (truncated or not a GGUF file). Too little free RAM for the chosen model is exit
code 5. `docs/api.md` lists every exit code.

## The frozen release

`release-manifest.json` records the model's SHA-256, the llama.cpp build and the settings above that change the
model's output or exposure (`ctx_size`, `threads`, `n_gpu_layers`, `mmap`, `mlock`, `parallel`,
`cache_ram_mib`, `extra_args`, `offline`, `host`, `allow_remote`). `docqa-runtime verify` checks a machine against
it; `doctor` does a quick version. Change one of those settings for the release → run `docqa-runtime freeze`
again and commit the manifest with the evidence for the change. Ports, paths and timeouts are not frozen.
