# ADR 0004: Document store runs on E2's real ingestion; corpus-folder library wire

**Status: active; reflected in the [System Design Document](../SDD.md).**
**Date:** 2026-10-22.

## Context

Two work streams built the Collection Library / document-store feature in parallel after a shared ancestor. An earlier main integration grew a `library/workflow.py` `CollectionLibrary` driven by a base64-upload wire (`library.review {name,data}`, `library.publish {review_id, confirmed}`, `library.cancel`, progress-by-request-id), and chunked PDFs with `library/synthetic.py` — a placeholder that emitted no real page geometry (`highlight_rects=[]`, `coordinates_reliable=False`). The E2 stream delivered the real ingestion pipeline (validate → extract → chunk → seal, `refchunk-3.0.0`, with page coordinates). The E3 stream built the document store on that real pipeline: `corpus.py` (consumes E2's `validate()`/`chunks()`), `publication.py` (`Publisher`: review → confirm → publish → integrity → activate, one job at a time), `search_trace.py`, and integrity checks in `versions.py`, behind a corpus-folder wire (files named from a configured `--corpus` folder).

The two could not both stand. The placeholder chunker bypassed E2's evidence geometry, which the product's citation highlighting depends on.

## Decision

- E2 owns ingestion (`ingestion/`); E3 owns the document store (`secure_qa/library/`). The store runs on E2's real pipeline through `corpus.py`; `synthetic.py` is retained only as deterministic test/fake data for the golden collection and tests.
- Retire `library/workflow.py` (`CollectionLibrary`) and the base64-upload library wire. The host library operations are `library.review`, `library.publish` (`{files, confirm_rejects}`), `library.status`, `library.rollback`, and `library.integrity`; files are named from the host's `--corpus` folder. Progress events and cancellation are deferred, not implemented.
- Keep the orthogonal Conversation History and Local Settings features and their `history.*`/`settings.*` host operations; E3's stream merely never implemented them.
- Keep main's newer answering/llama.cpp runtime; take only E3's answering benchmarks (real-corpus golden set + end-to-end demo).

## Consequences

- The E4 Open WebUI frontend's library/upload page speaks the retired upload wire and must be reworked to the corpus-folder contract. That rework is E4 follow-up, out of scope for this change. The answering, history, and settings frontend paths are unaffected; `launch.py` is unaffected.
- Under `refchunk-3.0.0`, golden query `c10` falls just under the `min_score` floor (4th at 0.358) and is recorded as a `known_gap` alongside `c09`/`c11`; the min_score/fusion decision for noisy two-column arXiv text is deferred to the benchmark owner (E5).
- `library/chunk.py` stays a field-for-field mirror of E2's `ingestion/src/schema.py` v1.0.0; `corpus.py` normalizes E2 chunks through `Chunk.from_dict(c.to_dict())`, so the store keeps one chunk type and does not import `ingestion`. A verified E2 run's 3915 chunks load through it unchanged and reproduce E2's manifest integrity hash.
- A version no longer stages the source PDF bytes (the retired upload path's `_write_sources`); it keeps per-page highlight geometry in its chunks, and the originals stay in the user's `--corpus` folder. Any future feature that re-renders a full source page (rather than drawing stored highlight rects) must read from that folder; its availability is now a product assumption to confirm with the SDD owner.
