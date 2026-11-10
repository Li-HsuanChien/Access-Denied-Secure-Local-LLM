# Single-answer chat implementation plan

Approved design: the single-answer chat mockup reviewed in this conversation.

Goal: show one answer labeled by its evidence basis, with lightweight source quote previews.

Architecture: Python answering owns exclusive document/general selection. The chat formatter preserves cited document claims or general text, plus meaningful limits and warnings, without competing section headings. Original validated payloads remain unchanged by presentation edits. History follows the same selection rule while retaining its own markup. Quote previews use existing citation payloads and defer PDF loading until requested.

- [x] Add regression tests for exclusive answer selection, fallback, and quote-first interaction; run and observe failures.
- [x] Update answering prompts/service and chat formatting; label the answer from its validated payload.
- [x] Implement accessible quote pop-ups with close, Escape, outside dismissal and focus restoration; reuse the PDF viewer on demand.
- [x] Update History, PRD, SDD and React contracts for approved behavior.
- [x] Run answering tests, frontend tests, type checking and production build; inspect the UI if browser tooling is available.

Constraints: offline only; loopback only; no new runtime dependencies; preserve citation validation, immutable history, one-job serialization and unrelated working files.

Validation: 205 frontend tests passed; TypeScript check and production build passed. Answering suite: 50 tests run, one optional test skipped, no failures. Browser checks at 1440px and 390px verified exclusive basis labels, quote positioning, Escape focus restoration, deferred PDF requests and general-knowledge fallback. Existing build chunk-size warnings remain.
