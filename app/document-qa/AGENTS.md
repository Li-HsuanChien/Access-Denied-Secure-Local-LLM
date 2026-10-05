# Open WebUI integration guidance

Follow the [PRD](../../docs/product/PRD.md) and [SDD](../../docs/architecture/SDD.md) for user-visible behavior, module interfaces, evidence rules, privacy, accessibility, and offline constraints. The approved architecture uses a pinned Open WebUI fork inside the Tauri application: SvelteKit frontend, Python/FastAPI host, and dedicated `secure_qa` workflow modules.

Keep frontend presentation separate from workflow decisions. The frontend renders workflow results and calls typed host interfaces; Python feature modules own validation, publication, retrieval, answer grounding, citations, persistence, and release verification. Keep host routes thin and route product operations through the owning modules. Open WebUI may provide implementation code, but its generic routes or persistence must not bypass workflow invariants.
