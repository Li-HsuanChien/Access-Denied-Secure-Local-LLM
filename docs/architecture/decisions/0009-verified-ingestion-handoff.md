# ADR 0009: Ingestion owns import; the library consumes verified sealed runs

**Status:** Accepted; supersedes the direct `validate()`/`chunks()` handoff in [ADR 0004](0004-e3-document-store-on-e2-ingestion.md). The browser-upload wire and [source PDF caching](0006-cache-source-pdfs-for-citation-viewing.md) remain in effect.

**Date:** 2026-10-27

## Context

The application used ingestion's PDF functions but bypassed `ingestion/src/pipeline.py`. `library/corpus.py` orchestrated validation and chunking itself and passed mutable original paths to source caching. This bypassed ingestion's immutable staging, duplicate handling, import confirmation record, sealed manifest, verification, recovery and disk-space checks. A selected file changed after review could therefore produce a cached source that did not match the indexed text.

## Decision

`ingestion/` owns the entire PDF import pipeline: copy/checksum, validate, extract, chunk, review, confirm rejected files, seal, verify, discard and recover. The library adapter in `secure_qa/library/imports.py` is its sole product consumer. It keeps ingestion types private and maps review candidates and verified output into library-owned records.

1. `library.review` decodes uploaded PDFs into temporary transport files. `Publisher.review()` calls ingestion `prepare()` using `<store>/imports`. Ingestion makes its own immutable copies and performs validation, extraction and chunking in one pipeline pass. The host removes transport files immediately, including on error.
2. One pending review is retained. The UI sees accepted files, all rejected selections (including duplicate rejected files), warnings and the opaque review ID. The ingestion review retains its OS import lock until commit/discard. A replacement discards the old review and invalidates its host IDs.
3. `library.publish` requires confirmation when any selection is rejected. The adapter passes the matching ingestion confirmation token to `commit()`, which writes the report and manifest and verifies/seals the run. This does not activate a searchable collection.
4. The adapter always opens the sealed run through `load_run()` with verification enabled. The library consumes `Run.documents`, `Run.iter_chunks()` and `Run.source_path()`; partial builds and corrupted runs never reach indexing. It does not invoke the low-level validation/chunking functions.
5. The library retains embedding, indexing, append-to-library behavior, source caching, stored-index verification, search smoke testing, catalog activation, snapshot retention, retrieval selection and confirmed deletion. Verification of import artifacts and verification of the stored index remain separate checks. Appending an import verifies the combined collection; its checksum is not equated with the incoming run's checksum.
6. The library import report retains the ingestion run ID, sealed manifest hash and manifest alongside its existing summary. Reports are written and flushed before catalog activation. Source caching reads the verified staged PDFs, never the mutable original selections. Catalog replacement is the commit point: a subsequent directory-sync error logs `catalog_directory_sync_failed` and preserves the committed index, sources and report rather than deleting them. Such an error weakens crash durability but does not undo a visible commit.

## Lifecycle, failures and privacy

- Before activation, import, report, source-cache, embedding or index failure leaves the active collection unchanged. An indexing failure retains the sealed run for retry within the same host session. Each retry calls `load_run()` again; it neither reprocesses PDFs nor trusts cached chunk lists.
- After success, the adapter prunes the sealed run. The durable source PDFs already belong to the library's active/previous retention policy. There is no second long-lived PDF archive under imports.
- Replacement, explicit discard, matched cancellation of a pending review/failed publication, shutdown and successful confirmed deletion discard pending imports. Unknown cancellation targets cannot discard another review. Startup calls ingestion recovery, prunes abandoned sealed runs, and removes transient quarantine copies. Restart requires a fresh review; durable cross-restart import resume is not introduced.
- Ingestion recovery and pruning operate only in the application-owned import workspace. Unknown unrelated paths are not treated as imported documents. The source cache remains governed by existing library deletion/retention rules. Confirmed deletion invalidates any pending import that could reintroduce the deleted PDF.
- The host serializes review/publication/document changes with its existing job gate. Active collection reads remain available while a review awaits confirmation. Cancellation during synchronous indexing/activation returns `cancelled: false`; this change does not claim asynchronous publication progress or mid-flight cancellation. Ingestion's own progress/cancellation hooks remain available for a future host job interface.
- Ingestion failures expose stable codes with sanitized messages; parser exception text and filesystem paths are not sent to the frontend. No outbound network behavior or new listener is added.

## Compatibility and verification

The browser request/response shapes stay unchanged. Old published collections and reports remain readable; existing collections do not require migration or reimport. New reports add ingestion provenance. The benchmark helper `ingest_corpus()` uses the same sealed handoff in a temporary workspace, requires explicit confirmation for mixed accepted/rejected inputs, and may inspect verified source text for citation oracles.

Regression coverage includes immutable reviewed bytes, deduplication, rejection confirmation/provenance, rejected duplicates, corruption refusal, retry without reprocessing, lock release, replacement, deletion cleanup, disk-full staging, crash recovery, report-write failure and post-commit directory-sync failure. Loopback integration exercises upload, review, confirmation, publication, source PDF bytes, cited answering, cancellation and deletion. Ingestion contract/chunking/pipeline suites and library/answering real-fixture tests cover the shared output contract. Frozen desktop and real answering-model qualification remain separate release gates.
