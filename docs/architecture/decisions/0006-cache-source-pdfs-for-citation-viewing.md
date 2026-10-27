# ADR 0006: Cache source PDFs and serve them for in-app citation viewing

**Status: active; reflected in the [System Design Document](../SDD.md) §4.1, §4.2, §4.6, §7.3, §10.**
**Date:** 2026-10-22.

## Context

Citations already carry exact location data — page number and per-line `highlight_rects` in
PDF points, computed by E2 ingestion and passed through verbatim into every `Citation.pages[i]`.
But a citation could only open a text modal (quote + page number): there was no way to see it in
the real PDF. [ADR 0004](0004-e3-document-store-on-e2-ingestion.md) deliberately stopped a
version from staging source PDF bytes (line 24), leaving the originals only in the user's
`--corpus` folder and flagging that "any future feature that re-renders a full source page …
must read from that folder; its availability is now a product assumption to confirm."

The product wants modern reference behavior: click a citation → open the source PDF at the cited
page with the sentence highlighted, offline.

## Decision

- **Cache source PDF bytes at publish, in the collection store.** `CollectionVersions.publish`
  accepts `sources` (document_id → PDF path/bytes) and stages them to
  `<store>/sources/<version_id>/<document_id>.pdf`; `recover()` keeps sources only for the
  retained (active + previous) versions, matching the existing collection retention policy. The
  bytes come from the `--corpus` originals at publish time (via `corpus.py` →
  `CorpusReview.source_paths`). This reverses the "no source bytes in a version" part of ADR 0004
  for the documents a collection actually publishes; the geometry-in-chunks decision stands.
- **Serve them over the existing loopback host, read-only.** A new `GET /v1/source?document_id=
  …&version=…` route streams `application/pdf` from the cached file, behind the same loopback/
  origin guard as every other request. `document_id` is validated against a conservative charset
  and must be a document of the named version (the store resolves the path itself), so a client
  id cannot traverse outside the version's own folder. No new listener; logs never carry ids or
  filenames.
- **Render client-side with the bundled pdf.js, not server-rendered page images.** The frontend
  already ships `common/PDFViewer.svelte` (pdf.js → `<canvas>` + text layer, with page jump).
  The citation modal fetches the cached bytes and renders the page, drawing the sentence
  highlight from the backend `highlight_rects` when `coordinates_reliable`, else by matching the
  quote in the text layer. This refines SDD §7.3's "page images rendered locally and cached":
  pages are rendered in-app on demand rather than rasterized and stored as PNGs.

## Why this shape

Caching at publish keeps the viewer fully offline and independent of whether the `--corpus`
folder is still present later (important for the packaged Tauri app), resolving the open product
assumption ADR 0004 raised. Serving bytes to in-canvas pdf.js — rather than a raw PDF in an
`<iframe>`/`<embed>` — satisfies the frontend CSP (`frame-src 'none'`, `object-src 'none'`;
`img-src`/`connect-src` permit fetched bytes) and keeps the untrusted PDF out of an active-content
frame (SDD §10). Reusing the already-bundled viewer avoids new dependencies.

## Consequences

- A published version now also stores one PDF per document under `sources/<version_id>/`;
  storage grows by roughly the corpus size for the retained versions only. Caching is
  best-effort per document — a document whose source is unavailable at publish simply isn't
  cached, and its citation falls back to the text-only modal.
- The loopback transport gains a non-envelope read route (`GET /v1/source`) alongside
  `GET /health`; the `POST /v1/requests` envelope is unchanged.
- The future packaged Python/Tauri host must mount the same route; it is written as a thin
  adapter over `CollectionVersions.source_path`.
- Room-uploaded PDFs (the per-room document feature) cache under
  `sources/room_<conversation_id>/` and reuse this route and viewer unchanged.
