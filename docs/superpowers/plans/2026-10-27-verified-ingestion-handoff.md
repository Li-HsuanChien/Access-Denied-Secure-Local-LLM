# Verified ingestion handoff implementation plan

**Goal:** Make ingestion/ own PDF import and have the library consume verified sealed runs.

**Architecture:** Preserve the browser-upload wire. A library adapter manages ingestion prepare/commit/load/discard and maps results into library records. The library retains embedding, append publication, source caching, index verification and activation. Import working files are transient: retain a failed sealed import for in-session retry, remove it after success, cancellation, replacement, deletion or shutdown, and recover abandoned work on startup.

**Tech stack:** Python, PyMuPDF, Chroma, unittest; existing offline dependencies only.

**Spec:** Approved design in this chat; architecture decision 0009 records the implemented ownership and lifecycle.

## Constraints

- Loopback only; no network calls or downloads.
- Rejected files require explicit confirmation before sealing the accepted remainder.
- Index failure leaves the active collection unchanged; every retry re-verifies the sealed run.
- Keep imported types inside the adapter and preserve the existing library wire.
- Deletion must not leave a second PDF copy in transient imports.

## Tasks

- [x] Add regression tests in library/tests/test_publication.py for immutable staged inputs, duplicate files, sealing/confirmation, corrupted retry refusal, retry without reprocessing, discard/replacement, recovery and deletion cleanup. Run against the old implementation to confirm missing behavior.
- [x] Add library/imports.py: prepare imports using pipeline.prepare; expose library-owned review records; seal with the matching confirmation token; load only through pipeline.load_run; map chunks/documents/source paths; discard attempts and prune transient runs through ingestion's public lifecycle functions. Preserve the benchmark corpus helper using this adapter.
- [x] Update library/publication.py to own one pending review, serialize review/publish/discard/delete, retry sealed imports, clean successful imports, and clean abandoned imports at startup/shutdown. Keep collection publication atomic and retain ingestion provenance in library reports.
- [x] Update backend/dev_host.py to discard replaced reviews, remove uploaded bytes after ingestion staging, discard pending work on cancel/close, and expose stable ingestion error codes. Extend host integration tests for full upload/review/confirm/index/source/answer/delete flow.
- [x] Update SDD sections 4.1, 5, 6 and library/ingestion documentation; add ADR 0009 superseding the old direct-function handoff. No product scope change.
- [x] Run library, host integration, answering real-fixture golden tests and ingestion suites. Review the diff and record any unavailable release/model qualification.

## Verification results

- Library/store/version/publication and answering golden suites: 61 tests passed (real PDF fixtures; local real embedding tests and deterministic answering runtime).
- Loopback host integration and readiness: 29 tests passed, including upload/review/confirmation/publication/source retrieval/cited answer/deletion and cancellation/error paths.
- Ingestion pipeline: 36/36 passed with E3_LIBRARY set to the current library; no compatibility skips.
- Ingestion schema/validation contracts: 32/32 passed.
- Ingestion chunking: 11/11 passed.
- Total: 169 tests passed. `git diff --check` clean.
- Regression tests were observed failing before fixes. Independent review identified a post-commit directory-sync cleanup regression; it was reproduced, corrected and re-reviewed with no remaining blocking findings.
- Frozen desktop bundle and real answering-model qualification were not run. Existing third-party PyMuPDF deprecation and SQLite resource warnings remain visible in the test runs; they do not fail these suites.
