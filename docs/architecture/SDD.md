# Secure Local Document-QA System

## System Design Document

### 1. Introduction, Purpose, and Scope

This document defines the implementable design for an offline document-question-answering application installed on one air-gapped laptop. The MVP serves one authorized local user, processes a permanent approved PDF library, and returns grounded answers with expandable page citations. It includes no cloud services, standalone browser interface, externally reachable service, autonomous agents, application authentication, role-based access control, dynamic model routing, or integration with live sensitive systems.

The same user performs two activities in the desktop application: managing the document library and asking questions. These are interface areas, not security roles.

#### 1.1 Design Basis and Traceability

This SDD follows Atlassian’s software design document guidance and the linked engineering guides. Each important MVP behavior is assigned to an owning module and verified through that module’s public interface. Architecture changes must update this SDD or a linked architecture decision record before implementation.

### 2. Principles, Assumptions, and Constraints

- **Offline by construction:** Every dependency, model, asset, and workflow remains local after installation.
- **Evidence first:** Retrieval precedes generation, and document-supported claims require valid citations.
- **Workflow-centered design:** A small set of deep modules hides orchestration and third-party libraries.
- **Replaceable external seams:** Storage, model runtime, and operating-system behavior are accessed through stable interfaces.
- **Deterministic operations:** Collection publication, citation validation, and release verification produce repeatable results.
- **Resource discipline:** One question is processed at a time on the 8 GB reference laptop.
- **Cross-platform behavior:** Windows x86-64, macOS on Apple silicon, and Ubuntu Linux x86-64 receive separate tested packages.

Functional compatibility is required on all three supported platforms. The response-time and memory targets are measured only on the designated reference laptop.

#### 2.1 Assumptions and Dependencies

- The approved corpus contains digitally extractable PDFs and enters through controlled removable media.
- The operating system is configured for full-disk encryption, and the user locks or powers off the laptop when unattended.
- Platform builds include Open WebUI (SvelteKit frontend and Python/FastAPI host), Tauri, Python/PyInstaller, PyMuPDF, Sentence Transformers, llama.cpp, SQLite, and the selected document store.
- The final embedding and answering models may be distributed in the signed release and support the target platforms.

### 3. System Context

A connected staging machine builds and signs platform-specific release bundles. Controlled removable media carries a bundle and approved PDFs to the air-gapped laptop. The installed desktop application performs document publication, retrieval, model inference, citation display, and conversation storage locally. It exposes no externally reachable service.

The operating system provides full-disk encryption through BitLocker, FileVault, or LUKS. SQLite is not independently encrypted in the MVP, and no separate application password is required.

### 4. System Architecture and Interfaces

A pinned Open WebUI fork supplies the SvelteKit interface and Python/FastAPI host inside a custom Tauri desktop shell. Tauri starts and stops the Python host and llama.cpp runtime. The host and model runtime bind only to 127.0.0.1; the UI uses the host through same-origin loopback HTTP. This local transport is not a standalone browser workflow and is not externally reachable. Four dedicated Python workflow modules own product behavior behind the interfaces in this SDD. PyMuPDF, Chroma, llama.cpp, SQLite, Tauri, and operating-system details remain inside implementations or adapters.

*Figure 1. Workflow-centered architecture and external seams.*

#### 4.1 Collection Library

**Interface:** Publish a candidate collection, list available versions, return the active version, and roll back to the previous version.

The module hides PDF validation, extraction, chunking, embedding, indexing, staging, manifest creation, integrity checks, atomic activation, rollback, and cleanup.

**Invariants:**

- A failed or cancelled publication never changes the active collection.
- Only the active and immediately previous collection versions are retained.
- Rejected files are never silently omitted; the user reviews them before publishing the valid remainder.

#### 4.2 Question Answering

**Interface:** Accept a question and active collection version and return a structured answer containing document-supported sections, general-knowledge sections, citations, warnings, evidence mode, model version, collection version, and timing.

The module hides retrieval, relevance filtering, visual-evidence selection, page rendering, prompt construction, inference, and citation validation.

**Invariants:**

- Every claim labeled as document-supported cites retrieved evidence.
- General model knowledge is visibly labeled and never receives document citations.
- No more than two page images are supplied for automatic visual analysis.

#### 4.3 Conversation History

**Interface:** Save, list, load, delete, clear, and disable conversation persistence. The module hides the SQLite schema and migrations.

**Invariants:**

- Disabling persistence prevents new conversations from being written.
- Each saved answer records the collection version and model version that produced it.

#### 4.4 Release Verification

**Interface:** Verify a release bundle and return verified release metadata or a rejection. The module hides checksum calculation, signature validation, platform matching, and verification logging.

**Invariant:** An unsigned, modified, corrupt, or wrong-platform bundle cannot be installed.

#### 4.5 External Seams and Adapters

- **Document-store seam:** Chroma is the selected production document-store adapter for the single-worker MVP; workflow tests use a deterministic fake adapter. Revisit this choice through an SDD update or ADR if it fails qualification.
- **Model-runtime seam:** llama.cpp is the production adapter; tests use a deterministic fake that returns controlled outputs.
- **Platform-operations seam:** Tauri commands and Windows, macOS, and Linux adapters provide approved paths, atomic file operations, free-space checks, sidecar lifecycle management, and installation integration.
- PDF processing remains inside the Collection Library and Question Answering implementations unless a second genuine implementation requires a new seam.
- LangChain Core may be used internally when it reduces orchestration code, but LangChain objects must not appear in workflow interfaces or persistent records.

#### 4.6 Frontend-to-Host HTTP Contract

The Svelte frontend sends versioned same-origin HTTP requests to the Python host, with a request ID, operation name, and validated payload. The host returns progress events followed by one result or error associated with that request ID; cancellation targets the request ID. Schemas reject unknown operations or fields. The Python host and llama.cpp listener bind only to 127.0.0.1, and the Tauri shell manages their lifecycle. No listener binds to a non-loopback address, and the application does not support a standalone browser workflow.

### 5. Data Design

A collection is a complete searchable snapshot of approved PDFs and their derived data. Each version contains the source PDFs, manifest, extraction metadata, chunks, embeddings, document index, and import report.

#### 5.1 Persistent Records

- **Collection version:** Version ID, status, creation time, document manifest, embedding-model version, chunking configuration, and integrity checksum.
- **Document:** Stable ID derived from file checksum, display title, original filename, page count, and import warnings.
- **Chunk:** Stable ID, document ID, page number, chunk order, extracted text, text coordinates when reliable, and embedding.
- **Conversation:** Conversation ID, title, creation and update times, collection version, and persistence setting.
- **Message:** Question or answer, timestamp, model version, latency, evidence mode, and warnings.
- **Citation:** Document ID, page number, supporting chunk IDs, and text or visual evidence classification.  Note that citation payload carries page range plus per-page spans. Allow page ranges and add hyperlink to first page of page range
- **Operational event:** Event type, timestamp, duration, version identifiers, evidence IDs, and sanitized error details.

Stable identifiers make benchmark results and citations reproducible. Historical conversations retain their original collection version even after a new collection is published.

### 6. Collection Publication Workflow

*Figure 2. Staged and atomic collection publication.*

#### 6.1 Validate and Review

The user selects PDFs in the Library screen. The application copies them to staging, computes checksums, and validates type, readability, extractable text, page count, and basic size limits. Password-protected, corrupt, scanned-only, oversized, and non-PDF files are rejected for the MVP.

The review screen lists accepted files, rejected files, warnings, page counts, and rejection reasons. If any file is rejected, explicit user confirmation is required before publishing the valid remainder.

#### 6.2 Build and Verify

For accepted files, the application extracts page text and text coordinates, creates stable chunks, generates embeddings, and builds the candidate document store. It writes a manifest and import report, verifies counts and checksums, and runs a search smoke test before activation.

The active collection remains available throughout this work. Only one publication job may run at a time. The interface shows the current phase, completed files, processed pages, warnings, and elapsed time.

#### 6.3 Publish, Cancel, and Roll Back

Successful publication atomically activates the candidate, moves the former active version to rollback status, and removes versions older than the rollback version. Cancellation or failure records the outcome, discards incomplete staging data, and leaves the active collection unchanged.

Publication supports cancel and restart. Pause and resume are outside the MVP. The application warns before shutdown while publication is active.

### 7. Question Answering and Visual Analysis

*Figure 3. Retrieval, automatic visual evidence, generation, and citation validation.*

#### 7.1 Retrieval

Each question is searched against the active collection. The retriever returns ranked text chunks and their document, page, and coordinate metadata. A configurable minimum relevance threshold excludes weak evidence. The benchmark dataset is used to tune the threshold, which is frozen for the final release.

If no chunk meets the threshold, the application states that the collection lacks sufficient evidence and produces no document-supported section. General model knowledge may still be shown.

#### 7.2 Automatic Visual Evidence

A deterministic visual-evidence selector examines the question and retrieved page metadata. When visual interpretation is indicated, the application renders and supplies at most two relevant PDF pages to the same multimodal answering model. Ordinary text questions do not render or attach page images.

Visual retrieval depends on surrounding extractable text because the MVP has no separate visual index. If the relevant page cannot be found through text retrieval, the answer discloses that limitation.

#### 7.3 Answer Structure and Citations

General model knowledge is enabled by default and may be disabled by the user. Every answer may contain three visibly distinct parts:

- **From your documents:** Factual claims supported by the active collection, each with one or more citations.
- **General model knowledge:** Uncited content explicitly labeled as not verified against the document collection.
- **Limitations and uncertainty:** Missing, conflicting, weak, or visually inaccessible evidence.

Every citation identifies the document and page and expands into an on-demand rendering of the source page. When reliable text coordinates are available, the supporting passage is highlighted. Page images are rendered locally and cached rather than duplicated for the full collection.

After generation, the application verifies that document citations refer to evidence actually supplied to the model. Invalid or missing citations trigger one corrective generation attempt. If validation still fails, unsupported document claims are withheld and the interface explains the failure; correctly labeled general knowledge may remain.

#### 7.4 User Interface Design

The Tauri application has persistent navigation for Library, Chat, History, and Settings. Library moves through PDF selection, validation review, publication progress, and completion. Chat shows the answer first and keeps citations compact until the user expands one into a source-page panel. History supports open, delete, clear-all, and persistence settings.

- Show one primary action per workflow step and use plain-language labels rather than implementation terms.
- During publication, show the current phase, completed files or pages, warnings, elapsed time, and a cancel action.
- Keep the current answer visible if saving fails, and pair each error with an actionable next step.
- Support keyboard navigation, visible focus, semantic labels, adequate contrast, and screen-reader announcements for progress and errors.
- Disable or queue a second question while generation is active; the MVP processes one question at a time.

### 8. Conversation Storage and Privacy

Conversation history persists across restarts in SQLite by default. Users may delete one conversation, clear all history, or disable persistence. Persistent data remains on operating-system-encrypted storage; application-level database encryption and password recovery are outside the MVP.

Conversation records contain questions, answers, citations, collection versions, model versions, evidence modes, warnings, and timings. Diagnostic logs do not duplicate complete questions, answers, or document text.

### 9. Error Handling and Recovery

- **Import errors:** Identify the file and reason, allow reviewed publication of valid files, and preserve the active collection.
- **Insufficient disk space:** Stop before building or activating a candidate and report the required and available space.
- **Model-load failure:** Keep the library available, disable answering, and display a recoverable error.
- **Retrieval failure:** Return no document-supported answer and record a sanitized diagnostic event.
- **Citation failure:** Retry once, then withhold unsupported document claims.
- **History failure:** Keep the current answer visible, warn that it was not saved, and avoid silently discarding it.
- **Unexpected shutdown:** Recover the last active collection and remove or quarantine incomplete staging data on next startup.
- **Release failure:** Reject invalid signatures, checksums, platform identifiers, or incomplete bundles without an override.

Errors shown to users use plain language and include an actionable next step. Operational logs retain stable error codes for diagnosis.

### 10. Security and Offline Operation

- No runtime network dependency, telemetry, automatic download, or externally reachable listener.
- All release dependencies, models, and assets are included in the signed platform-specific bundle; the application performs no runtime installation or download.
- The Open WebUI host and llama.cpp runtime bind to `127.0.0.1` only. They are reachable to local processes within the operating-system trust model, but are not exposed on a network interface.
- Release manifests list file checksums and are digitally signed on the connected staging machine.
- The installed verification key validates the signature before installation; the private signing key never enters the air-gapped laptop.
- Source PDFs and retrieved content are treated as untrusted data, delimited from model instructions, and cannot grant tools or system access.
- The model receives no browser, shell, network, file-modification, or autonomous action capability.
- Full-disk encryption is required and the user is responsible for locking or powering off the laptop when unattended.

Prompt injection remains a documented risk and benchmark category, not a standalone release gate. Lightweight adversarial tests verify that embedded document instructions do not override answer-format and evidence rules.

### 11. Technology Stack, Decisions, and Trade-offs

- **Core workflow implementation:** Python, packaged as a PyInstaller sidecar.
- **Desktop interface:** A pinned Open WebUI fork supplies a SvelteKit frontend and Python/FastAPI host, packaged inside a custom Tauri desktop shell.
- **PDF processing and page rendering:** PyMuPDF.
- **Embeddings:** A small Sentence Transformers model selected for offline CPU use.
- **Document store:** Chroma, behind the Collection Library adapter seam.
- **Model runtime:** llama.cpp.
- **Answering model:** One benchmark-selected multimodal GGUF model.
- **Conversation history:** SQLite.
- **Encryption at rest:** BitLocker, FileVault, or LUKS.
- **Packaging:** A separate Tauri bundle for each platform containing the matching PyInstaller Python sidecar and llama.cpp binary.
- **Distribution:** Versioned and digitally signed USB release bundle.

Chroma is selected for offline persistence, metadata filtering, atomic collection replacement through versioned snapshots, packaging reliability, memory use, and performance at the 10,000-page stress-test target. The MVP implements only this store. Tauri packages the Open WebUI frontend and manages the local Python host and llama.cpp runtime. The loopback-only HTTP transport is internal to the desktop application; the laptop has no externally reachable service.

Docker, self-updating behavior, and an internal web server are not required.

### 12. Performance and Capacity Requirements

- Reference hardware: 8 GB RAM, integrated graphics, and no dedicated accelerator.
- Straightforward text questions: target response time below 30 seconds.
- Visually complex questions: maximum target response time of two minutes.
- Concurrency: One question or generation job at a time.
- Initial collection: Approximately 2,000 to 5,000 pages.
- Stress-test collection: Up to 10,000 pages.
- Visual evidence: At most two rendered page images per question.

The selected model must fit in memory with the desktop application and active document store. Functional compatibility is tested on all supported platforms; latency and peak-memory qualification occur on the reference laptop.

### 13. Testing, Model Evaluation, and Acceptance

Development follows test-driven vertical slices: one failing behavior test at an agreed seam, the smallest implementation that passes, then cleanup while tests remain green. Tests verify behavior through public interfaces rather than private implementation details. Svelte tests cover user-visible states and accessibility; integration tests cover Tauri-to-host requests and workflow behavior without reaching into workflow internals.

#### 13.1 Agreed Test Seams

- **Collection Library:** Candidate PDFs become a validated searchable collection, or the active version remains unchanged.
- **Question Answering:** A question becomes a structured answer with correct evidence classification, citations, visual limits, and warnings.
- **Conversation History:** Conversations persist, load, delete, clear, or remain unsaved according to settings.
- **Release Verification:** Authentic platform-matching bundles pass; altered, unsigned, corrupt, or wrong-platform bundles fail.
- **Document Store and Model Runtime:** Production adapters receive focused integration tests; workflow tests use deterministic fakes.

#### 13.2 Model Selection

A candidate model is eligible only if it runs fully offline through llama.cpp, fits within the 8 GB system budget, satisfies citation rules, meets the text and visual latency targets on the reference laptop, and passes stability plus basic adversarial checks.

Among eligible models, select the model with the strongest combined answer correctness, grounding, citation correctness, refusal accuracy, and visual-question accuracy. Report retrieval recall, latency percentiles, peak memory, and tokens per second separately.

Model quality is evaluated with the benchmark suite rather than ordinary unit tests. Benchmark records include the question, expected answer or refusal, evidence identifiers, question type, and visual-evidence expectation.

### 14. Packaging, Release, and Cross-Platform Verification

The build process produces separate release bundles for Windows x86-64, macOS on Apple silicon, and Ubuntu Linux x86-64. Each bundle contains the pinned Open WebUI source revision and built Svelte assets, Tauri shell, platform-matching Python host, llama.cpp binary, model, embedding model, dependencies, verification key, manifest, signature, version, supported-platform identifier, and installation instructions.

Application updates occur outside the running application. The user closes the application and runs the verified installer from controlled removable media.

A release is complete only after packaged acceptance tests pass in network-disabled virtual machines or CI environments on all three platforms. Tests cover Svelte interface behavior, Tauri-to-host messaging, startup, collection loading, document import, retrieval, answering, citation expansion, history, absence of non-loopback listeners, and absence of DNS or outbound connection attempts.

### 15. Operational Logging

Operational logs remain local and contain timestamps, event types, durations, application/model/collection versions, evidence IDs, error codes, and sanitized diagnostic details. They exclude complete questions, answers, and document text. Logs rotate automatically, and the user may export a diagnostic report that excludes sensitive content.

### 16. Risks and Limitations

- Cross-platform packaging may require platform-specific native dependencies and separate troubleshooting.
- Virtual-machine or CI results prove functional compatibility but do not predict physical-device performance.
- Multimodal inference may approach the memory and latency limits on the reference laptop.
- Visual evidence can be missed when nearby text does not identify the relevant page.
- Scanned-only PDFs are unsupported without OCR.
- Full-disk encryption does not protect data while the laptop is unlocked and the application is running.
- Loss or compromise of the release-signing private key disrupts or weakens release trust.
- Prompt injection cannot be eliminated completely; the no-tools architecture limits its consequences.
- The benchmark may not represent every future document collection or question style.

### 17. Glossary and Development Methodology

#### 17.1 Glossary

- **Collection:** An immutable searchable snapshot of approved PDFs and derived data.
- **Grounded claim:** A claim supported by evidence retrieved from the active collection.
- **Citation:** A document-and-page reference tied to supporting text or visual evidence.
- **Module:** Behavior hidden behind one small public interface.
- **Seam:** The location where an interface allows behavior to vary.
- **Adapter:** An implementation that satisfies an interface at a seam.
- **Sidecar:** The packaged Python process invoked locally by the Tauri desktop application.
- **Air-gapped:** Operating without a network connection or runtime dependency on external systems.

#### 17.2 Engineering Guides

Contributors and AI coding agents should use the following engineering guides:

- **Codebase Design skill:** Use deep modules with small interfaces, place seams where behavior genuinely varies, keep implementation details private, and test through the same interfaces used by callers.
- **Test-Driven Development skill:** Work in vertical red-green-refactor slices. Write one failing behavior test at an agreed seam, implement only enough to pass, and keep tests focused on observable behavior rather than internal structure.

Architectural changes must update this SDD or a linked architecture decision record before implementation.

### 18. Out of Scope and Post-MVP Work

- Application authentication, user accounts, roles, document-level permissions, and real identity management.
- Application-level encrypted conversation database and separate application password.
- Fine-tuning, autonomous agents, tools, internet search, cloud services, and dynamic model routing.
- Documents attached directly to individual chats.
- OCR for scanned-only PDFs and a standalone visual index.
- Pause and resume for collection publication.
- Self-updating behavior, multi-device deployment, and live sensitive-system integration.
- Simultaneous implementation of multiple document stores or answering models.
