# Desktop shell guidance

Follow the [PRD](../../docs/product/PRD.md) and [SDD](../../docs/architecture/SDD.md), especially the system context, platform-operations seam, local host transport, security, packaging, and cross-platform acceptance requirements.

Place Tauri shell, native capabilities, approved app-data path resolution, Open WebUI and llama.cpp lifecycle, startup/shutdown, and installer integration here. The shell coordinates processes and platform operations through narrow interfaces. Local service listeners must bind to `127.0.0.1` only; never expose them on a network interface or add network dependencies.

Put shell tests in `tests/` and startup/resource benchmarks in `benchmarks/`. Qualify functional behavior on all supported platforms and measure latency/memory only on the designated reference laptop, as the SDD specifies. Update the SDD or a linked ADR before implementing an approved architecture change.
