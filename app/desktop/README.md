# Desktop shell

Scaffold only. This area will contain the Tauri shell described in the [SDD](../../docs/architecture/SDD.md). Its future `src-tauri/` tree owns approved application paths, platform packaging, the Python host and llama.cpp lifecycle, readiness, and shutdown. The bundled webview will load the local React interface through loopback-only services; no service is externally reachable. No executable desktop code is present.
