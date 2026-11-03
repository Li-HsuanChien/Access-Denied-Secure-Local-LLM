# Installing and starting the runtime

**End users don't install the runtime separately.** It ships inside the desktop app: Qwen3-4B Q4_K_M,
llama.cpp b11242 and the frozen configuration are in the app's `payload/runtime/` folder, and the app starts and
stops the runtime itself. Build or download that package as described in
[`app/release/README.md`](../../../../../../release/README.md) (Windows x64 today).

This page is for running the runtime on its own: development, benchmarking on the reference laptop, or a target
the desktop package doesn't cover yet. Every path ends with the same check, `docqa-runtime verify`, which
confirms the machine has exactly the frozen model, engine and settings in [`../release-manifest.json`](../release-manifest.json).

| Target | Runtime package | Status |
|---|---|---|
| Windows x64 | Inside the desktop package; or standalone, below | Desktop package built and smoke-tested by the release pipeline. Standalone runtime run with real weights on Windows 11 |
| macOS Apple silicon | Standalone, below | Same code, llama.cpp `macos-arm64` build pinned. **Not yet run by E1**; desktop packaging is pending (SDD §14) |
| Linux x64 | Standalone, below | Same code, llama.cpp `ubuntu-x64` build pinned. **Not yet run by E1**; desktop packaging is pending (SDD §14) |

## What gets installed, and how it is checked

| Item | Pinned in | Checked by |
|---|---|---|
| Qwen3-4B-Instruct-2507 Q4_K_M, 2,497,280,736 bytes | `models/shortlist.json`, `app/release/assets.lock.json`, `release-manifest.json` | SHA-256 at download (`fetch_models.ps1`, `assets.py`) and by `docqa-runtime verify` |
| llama.cpp b11242 (commit 526c43b8f), one build per platform | `models/shortlist.json` (`llama_cpp.assets`), `assets.lock.json` (Windows) | SHA-256 at download; `verify` checks the build number and commit |
| Runtime settings (context 4096, 1 slot, no RAM cache, offline, loopback) | `runtime.toml`, frozen in `release-manifest.json` | `verify`, `doctor`; the release build refuses a mismatch |

The release tests (`app/release/tests/test_build.py`) fail if these files disagree, so an upgrade can't ship
half-done.

## Windows x64, standalone

Needs Python 3.11+. On a machine with internet access, from this folder:

```powershell
python -m venv .venv
.venv\Scripts\pip install -e .
scripts\windows\fetch_runtime.ps1                  # llama.cpp b11242 -> bin\
scripts\windows\fetch_models.ps1 -Model qwen3-4b-2507 -Quant Q4_K_M   # -> models\, SHA-256 checked
.venv\Scripts\docqa-runtime verify                 # must end "Matches the frozen release."
```

To move it to an offline machine, copy this whole folder (with `bin\`, `models\` and `.venv\`) and run `verify`
there. `start.cmd` in this folder creates the environment and starts the runtime with a chat prompt.

`scripts\windows\build_exe.ps1` is the older single-folder runtime build. Its `-Zip` option can't handle files
over 2 GB, and the desktop package replaces it; use `app\release\package.ps1 -Zip` for a shareable archive.

## macOS (Apple silicon) and Linux x64, standalone

Needs Python 3.11+, `curl` and `tar`. From this folder (Linux: use `sha256sum` instead of `shasum -a 256`, and
the `ubuntu-x64` archive and digest from `models/shortlist.json`):

```bash
python3 -m venv .venv && .venv/bin/pip install -e .
curl -L -o /tmp/llama.tar.gz https://github.com/ggml-org/llama.cpp/releases/download/b11242/llama-b11242-bin-macos-arm64.tar.gz
echo "76142db728d264a56da04592d69e4f3bdf798049183ca7c9b0511fbb561458e8  /tmp/llama.tar.gz" | shasum -a 256 -c
mkdir -p bin && tar -xzf /tmp/llama.tar.gz -C bin --strip-components=1
xattr -dr com.apple.quarantine bin          # macOS only: allow the downloaded binaries to run
curl -L -o models/Qwen_Qwen3-4B-Instruct-2507-Q4_K_M.gguf \
  https://huggingface.co/bartowski/Qwen_Qwen3-4B-Instruct-2507-GGUF/resolve/ae44f08e1392f39c0e474af10c3ff8355c8b6688/Qwen_Qwen3-4B-Instruct-2507-Q4_K_M.gguf
echo "2fde00ce69dd4899c70d020845e2638353015bba0fdf161b3eb965f2bca4464e  models/Qwen_Qwen3-4B-Instruct-2507-Q4_K_M.gguf" | shasum -a 256 -c
.venv/bin/docqa-runtime verify
```

If `verify` reports that `bin/llama-server` is missing, list `bin/` and move `llama-server` and its libraries
up one level; the archive's top folder name has varied between llama.cpp releases. Runtime differences off
Windows: there is no Job Object, so llama-server is cleaned up through the process group (the desktop shell
stops the whole group) and on normal exit; if the runtime itself is killed with SIGKILL, stop `llama-server` by
hand. On Apple silicon, set `n_gpu_layers` only after measuring; the frozen release is CPU-only (`0`), and
changing it means `docqa-runtime freeze` and new evidence.

## Starting and stopping

```
docqa-runtime doctor        # pre-flight: config, binary, model, RAM, port, frozen release, network
docqa-runtime up            # prints the endpoints when the model is loaded; Ctrl+C stops it cleanly
docqa-runtime up --json --ready-file ready.json   # for a supervising app: one JSON line, same file
```

The API listens on `http://127.0.0.1:8080` only (`docs/api.md`). Stopping cancels any answer in progress
(callers get `request_cancelled`) and stops llama-server. With networking disabled, run
`docqa-runtime baseline --require-offline` to record the offline evidence.

## Upgrading the model or llama.cpp

Change these in **one** commit, then run the release tests:

1. `models/shortlist.json`: the new file or build and its published SHA-256.
2. `runtime.toml`: `model = "<new file>"` (or a frozen setting).
3. `app/release/assets.lock.json`: the same file, revision, URL and SHA-256.
4. `docqa-runtime bench --quality` on the reference laptop; keep the report under `docs/sample-results/`.
5. `docqa-runtime freeze --evidence runs/<bench folder> --reason "..."` and commit `release-manifest.json`.

A packaged app on an older manifest reports `/health.release.matches_manifest: false` if pointed at new weights.

## When it doesn't start

Every failure prints a stable `code`, a message and a hint, and exits with a code from `docs/api.md`.

| Code | Exit | Usual cause | Fix |
|---|---:|---|---|
| `server_not_found` | 2 | No `bin/llama-server(.exe)` | Run the fetch step for your platform |
| `backend_not_runnable` | 3 | Wrong platform's binary, not executable, quarantined or blocked | See the hint (Unblock on Windows, `chmod +x` / `xattr` on macOS) |
| `model_not_found`, `no_models` | 2 | The pinned GGUF isn't in `models/` | Run the model fetch step; check the file name matches `runtime.toml` |
| `model_invalid`, `model_load_failed` | 2 / 3 | Truncated or corrupt download | Delete it and fetch again; `verify` shows the checksum |
| `insufficient_ram` | 5 | Model + context don't fit this machine | Close other apps; see `docs/configuration.md` |
| `backend_out_of_memory` | 3 | Ran out of memory while loading | Same as above |
| `port_in_use`, `backend_port_in_use` | 4 / 3 | Another runtime (or app) already holds the port | Stop it, or `--port` |
| `remote_bind_refused` | 6 | `host` isn't loopback | Use `127.0.0.1`; never set `allow_remote` in the product |
| `startup_timeout` | 3 | Model load took longer than `startup_timeout_s` | Slow disk or swapping; free memory, or raise the timeout |
| `config_*` | 2 | A mistake in `runtime.toml` | The hint names the key and the valid values |
| `config_unresolved_template` | 2 | Ran the desktop payload's template `runtime.toml` directly | Start it through the app, or copy the file and set `[output] runs_dir` |
| `verify`: SHA-256 / llama.cpp / settings FAIL | 2 | Files or settings differ from the frozen release | Fetch the pinned files again, or freeze a reviewed upgrade |
