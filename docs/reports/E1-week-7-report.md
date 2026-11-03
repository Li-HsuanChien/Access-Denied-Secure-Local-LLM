# E1 LLM runtime: Week 7 report (Otto Slade)

**Status, 2026-11-03.** The runtime is packaged as a release candidate inside the desktop app with its frozen
release, and the checksums and versions are recorded and cross-checked. The pins for Windows, macOS and Linux
are recorded, and there are installation and startup instructions. **Not done: the clean-machine launch test.**
Rust isn't installed on the dev machine, so the Tauri shell can't be built there, and the attempt to build and
launch the frozen payload stopped when the disk filled (1.3 GB free; the build needs about 6–8 GB). macOS and
Linux are not run.

## Against the plan

| Definition of Done | State |
|---|---|
| Release-candidate runtime package | The desktop package (`app/release/`) now stages `release-manifest.json` beside `runtime.toml` in `payload/runtime/`, so the packaged runtime reports `/health.release.matches_manifest: true`. Before this, every package reported `release.manifest: false` |
| Checksums and config versions recorded | Model SHA-256, llama.cpp build and frozen settings are recorded in the manifest and in the package's `provenance.json` (`runtime_release`). The build refuses to package if `runtime.toml`, the manifest and `assets.lock.json` disagree. A release test checks the committed files on every PR, including the runtime's own pins in `shortlist.json` |
| Installation/startup instructions | [`docs/install.md`](../../app/document-qa/backend/secure_qa/answering/llama_cpp/docs/install.md) (in the runtime folder): desktop package; standalone Windows; macOS Apple silicon and Linux x64 with checksum steps; start/stop; upgrades; every startup error code |
| Clean launch on target platforms | **Not shown.** CI's real-model smoke test now also runs `verify` inside the package and checks `/health.release`. It hasn't run yet, because CI packages only on pushes to `main`. Windows standalone runtime: run with real weights. macOS/Linux: same code and pinned builds, **not run** |
| No accidental external dependency | The packaged runtime uses only payload files; `--offline`, loopback, and `verify` confirm the files. Installs and builds download only pinned, checksum-verified files |

## Error handling and upgrade issues closed

- **Template config run directly.** The packaged `runtime.toml` is a template (`runs_dir = "__DOCQA_USER_DATA__"`).
  Run outside the app, the runtime would have tried to create that folder in the read-only install. It now stops
  with `config_unresolved_template` and says how to run it.
- **Startup failures reach the supervisor.** `up --ready-file` used to be written only on success. It now also
  gets `{"status": "error", "exit_code", "error": {code, message, hint}}`, config errors included
  (`contract/ready-error.schema.json`).
- **Platform-wrong hint.** `backend_not_runnable` always gave Windows advice. It now gives `chmod +x` /
  macOS quarantine advice off Windows.
- **Half-done upgrades.** The model, llama.cpp and settings are pinned in four files; the build and a release
  test now refuse any disagreement. The upgrade steps are in `install.md`.
- **Old build path.** `build_exe.ps1 -Zip` breaks on files over 2 GB; the docs now point to
  `app/release/package.ps1 -Zip` (ZIP64) instead.

## Handoffs

| For | Item |
|---|---|
| Desktop (Rust) | When the runtime exits at startup, the shell shows a generic error. The runtime prints a `code` and `hint`, and `--ready-file` writes them as JSON. The shell could pass `--ready-file <data>/runtime-ready.json` and show the hint (e.g. `insufficient_ram`: close other apps) |
| Release | Merge E1 into `main` so the next CI package includes the manifest and the new acceptance checks; CI is the first real clean-machine run |
| E3 | Unchanged from Weeks 3–6: refusal retries, and `X-Request-ID` + cancel in `LlamaCppGatewayRuntime` |

## To finish the demo

1. On the build machine, free about 8 GB of disk, install Rust, then `./app/release/package.ps1`. It builds,
   stages the manifest, and runs the extended real smoke test.
2. Or merge `E1-LLM/Runtime` into `main`; the **Package desktop** workflow builds and tests on a clean Windows runner.
3. macOS/Linux: follow `docs/install.md` on a Mac and a Linux machine; record `verify` and `doctor` output.
