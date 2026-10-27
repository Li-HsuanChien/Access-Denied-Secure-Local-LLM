# ADR 0007: Managed Tauri shell and Windows development CI

Status: approved for the desktop and CI implementation requested on 2026-10-22.

The Tauri 2 shell embeds the existing static Svelte build. Native Rust owns process
startup, readiness, writable application paths, single-instance exclusion and shutdown.
The frontend receives no shell or filesystem capability. The host remains a thin
loopback HTTP adapter. Its exact Tauri origins are allowed alongside developer origins.

A single one-folder PyInstaller payload dispatches to either the host or the existing
runtime gateway. The ingestion package and Chroma dynamic imports must be collected.
Resources are read-only; collections, SQLite and runtime output use application data.
Windows child processes enter a kill-on-close Job Object. Startup refuses occupied
service ports instead of attaching to an unknown service. Closing during startup
also stops owned children. Service failure returns to a local error page.

The initial CI target is Windows x86-64. PRs run checks; main pushes and manual runs
build a **development demo** NSIS installer. Version tags additionally create a draft
prerelease. These deterministic-model artifacts are not signed production releases or
evidence of real-model, 8 GB, cross-platform or network-isolation qualification.
Production distribution still requires SDD section 14 and the trusted pre-install
verifier; this workflow does not publish production releases or install updates.

The packaging command also accepts a staged real-runtime asset directory containing
runtime.toml, bin/llama-server.exe, models/ and embedding/. It never downloads models.
CI caches build dependencies; it does not need private documents or model assets.
Windows installers embed the offline WebView2 installer. Installed applications perform
no setup downloads and do not use the development launcher or Vite.

The same packaging and acceptance scripts run locally and in CI. Acceptance launches
the frozen host to exercise ingestion, citations and persistence, and launches the
native application in a bounded smoke mode to check webview rendering, local HTTP,
startup and process cleanup. This is a smoke gate, not a network traffic audit.

The Windows freezer explicitly collects the current installed Microsoft VC++ runtime
and excludes shadow copies of Windows UCRT. Qualification found an older Java runtime
on PATH could otherwise cause Chroma native upsert to crash. The existing publication
job test also identified that review preceded job reservation; publication now reserves
its job before reviewing PDFs, preserving the existing one-job invariant.

Local user testing must use the staged Qwen3-4B GGUF and MiniLM embeddings, not
the deterministic CI model. `local_model.py` assembles a complete native portable
folder with these assets. Large model assets remain beside the executable rather
than entering the NSIS single-EXE size limit. The payload builder defaults to real
mode and requires explicit `--profile demo` for automated-test packages. A single
file production installer for the large model is not implemented by this preview.
