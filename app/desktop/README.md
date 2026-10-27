# Desktop shell

The Tauri 2 shell embeds the existing Open WebUI static build and supervises the
packaged Python host. The supported local test build is a Windows x64 **development
preview** containing the staged Qwen3-4B Q4_K_M model, llama.cpp and MiniLM
embeddings. It requires no Python, Node, Vite or model downloads on the test
machine. An explicit deterministic demo profile remains available for CI tests.

Build the real-model folder from project source with `./app/release/package.ps1`.
The command prepares dependencies and verified assets, builds the frontend and
native executable, and tests the resulting package. Open
`app/release/dist/Secure-Local-DocQA/secure-local-docqa.exe` and keep its whole
folder together. Import PDFs through Library before asking document questions.

Native Rust owns the application data folder, single-instance guard, loopback
service startup, readiness, failure display and shutdown. Windows Job Objects
stop the entire service tree when the desktop exits. The webview has no shell or
filesystem capability. Ports 8764 (instance ownership), 8765 (host) and, for real
mode, 8080 (runtime) must be available. Existing listeners cause a visible error.

See [release instructions](../release/README.md) for the local build, acceptance
commands, workflow triggers and real-model staging. The implementation decision
and remaining production gates are in [ADR 0007](../../docs/architecture/decisions/0007-desktop-build-and-ci.md),
with real-model push packaging in [ADR 0008](../../docs/architecture/decisions/0008-real-model-push-packaging.md).
