# Access-Denied-Secure-Local-LLM

Develop and evaluate a locally deployed AI platform for organizations that cannot use public AI services because of sensitive, proprietary, export-controlled, security-related, privacy-protected, or otherwise restricted information.

The repository contains the product and architecture specifications plus early implementation prototypes for PDF ingestion, retrieval and answering, and local model serving. The integrated desktop application and release packages are not yet complete.

- [Product requirements](docs/product/PRD.md)
- [System design](docs/architecture/SDD.md)
- [Historical codebase design](docs/superpowers/specs/2026-09-22-secure-local-document-qa-codebase-design.md)
- [ADR 0001: Offline Open WebUI in Tauri](docs/architecture/decisions/0001-open-webui-offline.md)
- [ADR 0002: Feature-first source layout](docs/architecture/decisions/0002-feature-first-layout.md)
- [Application layout](app/README.md)
- [Desktop shell](app/desktop/README.md)
- [Document-QA application](app/document-qa/README.md)
- [Release area](app/release/README.md)
- [E1 LLM runtime report](docs/reports/E1-runtime-report.md) (runtime adapter: [llama_cpp](app/document-qa/backend/secure_qa/answering/llama_cpp/README.md))
