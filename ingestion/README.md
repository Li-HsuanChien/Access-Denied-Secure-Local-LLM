# E2 Ingestion: schemas and fixture corpus

Week 1 deliverable for the Secure Local Document-QA System: *"Versioned Chunk
schema + validation result schema + test document fixture set."*

| Piece | Where |
|---|---|
| Chunk and Document schemas | `schemas/chunk.schema.json`, `schemas/document.schema.json`, `src/schema.py` |
| Validation result schema | `schemas/validation_result.schema.json`, `src/validation.py` |
| Fixture set | `fixtures/`, labeled in `manifest.json` |
| Sample-document demo | `demo.py` (live), `WALKTHROUGH.md` (written), `walkthrough/chunk_viewer.html` (visual) |
| Contract tests | `tests/test_contracts.py` (12 tests) |

Three ways to walk through one document, for three audiences:

```bash
python3 demo.py                  # live in a terminal, for presenting
python3 demo.py --doc large      # or arxiv, scanned, truncated, restricted
python3 demo.py --full-text      # dump the entire character stream too
```

`WALKTHROUGH.md` is the written version. `walkthrough/chunk_viewer.html` is the
visual one: the whole character stream with every chunk boundary, overlap region
and page break drawn on it.

## Reading the raw text

Every chunk offset indexes into one canonical text stream, and that stream is on
disk so provenance is checkable by hand. If a chunk claims `char_start: 534`,
open the file, seek to 534, read the same characters.

```bash
python3 tools/export_text.py
```

| file | contents |
|---|---|
| `walkthrough/text/<name>.text.txt` | the raw stream. Offsets are exact against this file. |
| `walkthrough/text/<name>.pages.txt` | the same text with page markers, for reading. Markers shift offsets, so never measure against this one. |
| `walkthrough/text/<name>.offsets.json` | page boundary table and totals. |

The NRC baseline is 18,938 characters across 24 pages, small enough to read end
to end. The DOE handbook is 201,287.

## Schemas

`src/schema.py` holds the dataclasses and is the source of truth; the JSON
Schema files describe the same objects for E3's index adapter and E4's mock
contracts. `tests/test_contracts.py` validates emitted objects against the JSON
Schemas, so the two representations cannot drift apart.

Identity is content-addressed and deterministic:

```
document_id = doc_ + sha256(file bytes)[:24]
chunk_id    = chk_ + sha256(document_id | chunker_config_id | char_start | char_end)[:24]
```

Not insertion order, not a UUID, not a timestamp. Re-importing the same file
under a different name reproduces every ID exactly, which is what lets a
citation stored in conversation history resolve after a collection is
republished. Changing chunk size or overlap changes every ID, which is correct,
because the boundaries moved.

**One schema change to raise with the team:** SDD 5.1 records a Chunk as
carrying a single page number. Chunks span pages. On the NRC baseline fixture
that is wrong for **18 of 19 chunks**, and it holds on dense prose too (46% on
the DOE handbook, 32% on the arXiv paper), because a chunk boundary has no
reason to land on a page boundary. The schema here carries `page_start`,
`page_end`, and a `page_spans` list with per-page offsets and highlight
rectangles. Per SDD 17.2 this needs an SDD update before implementation, and it
changes the citation payload E3 finalizes in Week 6. Numbers and reasoning are
in `WALKTHROUGH.md` section 4.

The four open policy decisions below are configuration in `IngestionPolicy`,
not conditionals in the parser. `test_policy_decisions_are_live_knobs` proves
each one flips behavior from config alone.

## Fixture corpus

Covers *"a representative document fixture set including normal, large,
malformed, and protected PDFs."*

Domain is nuclear engineering, matching the PRD's stated collection of "public
IAEA or comparable documents." All source material is U.S. Government public
domain or a public preprint, so nothing here carries redistribution risk.

Reject categories follow SDD 6.1 exactly: **password-protected, corrupt,
scanned-only, oversized, and non-PDF**.

## Layout

```
schemas/       JSON Schema for Document, Chunk, ValidationResult
src/
  schema.py        dataclasses, ID derivation, citation targets
  validation.py    outcome/reason vocabulary, checks, IngestionPolicy
  ingest.py        reference validate() and chunks()
tests/
  test_contracts.py    12 contract tests
fixtures/
  normal/       baseline happy path
  large/        96-page dense technical text
  layout/       two-column academic paper
  corrupt/      4 distinct corruption modes
  protected/    2 encryption modes
  scanned/      2 no-text-layer modes
  nonpdf/       2 wrong-format modes
  oversized/    1,200-page scale case
  adversarial/  embedded-instruction document (for E3/E5, ingests normally)
walkthrough/   generated demo artifacts: JSON objects, full text, chunk viewer
demo.py        live terminal walkthrough
tools/
  build_large_from_text.py   rebuilds the DOE fixture from its text extraction
  export_text.py             writes the full character stream to walkthrough/text/
  build_chunk_viewer.py      renders the stream with chunk boundaries drawn on it
  generate_fixtures.py       regenerates every derived fixture
  probe_fixtures.py          measures actual parser behavior, writes probe_results.json
  build_manifest.py          merges descriptors + measurements into manifest.json
  build_walkthrough.py       regenerates WALKTHROUGH.md from live output
manifest.json                the labeled corpus: 15 fixtures, expected outcomes, checksums
probe_results.json           raw measurement output
```

```bash
pip install pymupdf pikepdf reportlab jsonschema
python3 tests/test_contracts.py      # 12/12
python3 tools/build_walkthrough.py   # regenerates the demo
```

Three source documents are committed as-is. Everything else is derived, so the
corpus reproduces from those three files plus `tools/`:

```bash
python3 tools/generate_fixtures.py
python3 tools/probe_fixtures.py
python3 tools/build_manifest.py
```

**Regeneration is behavior-stable, not byte-stable.** A clean re-run reproduces
all 15 fixtures with identical parser behavior, but only 8 of 15 are
byte-identical: ReportLab stamps a creation date and pikepdf salts each
encryption, so those files get new checksums every run. Commit the fixture
binaries and treat the committed SHA-256s as the regression baseline. Do not
regenerate as part of CI and then compare against the manifest, or 7 fixtures
will fail for no reason.

## What the corpus contains

15 fixtures: 4 must accept, 7 must reject, 4 need a rule from E2 before they
have an expected outcome.

| Fixture | Category | Expected | Detection signal |
|---|---|---|---|
| `normal_nrc_reactor_concepts_ch01` | normal | accept | baseline |
| `large_doe_nuclear_physics_v1` | large | accept | baseline |
| `layout_arxiv_two_column_2112.11583` | layout | accept | baseline |
| `corrupt_truncated_50pct` | corrupt | **reject** | `is_repaired` + text-yield collapse |
| `corrupt_bad_xref` | corrupt | *decision* | `is_repaired`, text complete |
| `corrupt_header_only` | corrupt | reject | open raises |
| `corrupt_empty` | corrupt | reject | size == 0 |
| `protected_user_password` | protected | reject | `needs_pass` |
| `protected_owner_password_no_extract` | protected | *decision* | permission bits |
| `scanned_no_text_layer` | scanned | reject | zero chars, normal page count |
| `scanned_mixed_text_and_image_pages` | scanned | *decision* | per-page text yield |
| `nonpdf_zip_container_renamed` | nonpdf | reject | magic bytes |
| `nonpdf_plaintext_renamed` | nonpdf | reject | magic bytes |
| `oversized_1200_pages` | oversized | *decision* | page/byte cap, not yet set |
| `adversarial_prompt_injection` | adversarial | accept | must not be filtered |

## Three findings that change how validation gets written

Measured with PyMuPDF 1.28.2, the extraction library named in SDD 11. Full
numbers in `probe_results.json`.

**1. A truncated PDF reports a full page count and silently loses 91% of its text.**
`corrupt_truncated_50pct.pdf` is half a file. PyMuPDF auto-repairs it, reports
the same **24 pages** as the healthy original, and recovers **1,632 of 18,609
characters** — 3 pages with text, 21 empty. A page-count check passes it. It
would validate, chunk, index, and then fail to answer anything about the missing
91%, with nothing anywhere in the pipeline indicating a problem. This is the
worst failure mode available to a RAG system, because it presents as success.

Validation must check a per-page text yield, not just that the document opened
and has pages.

**2. `is_encrypted` does not detect the extraction-restricted document.**
`protected_owner_password_no_extract.pdf` forbids text extraction. PyMuPDF
reports `needs_pass=False`, `is_encrypted=False`, and extracts all 18,609
characters anyway — permission bits are advisory, and the empty user password
already decrypted the file. The only signal is the permission bitfield
(`permissions == -1044`, `PDF_PERM_COPY` clear).

An `is_encrypted` check misses this file completely. For a product whose premise
is handling controlled material, extracting from a document that forbids
extraction is a defensible thing to *decide*, but not to do by accident.

**3. `is_repaired` fires on both a recoverable file and an unrecoverable one.**
`corrupt_bad_xref.pdf` also sets `is_repaired=True`, but its text comes back
byte-identical to the healthy original. So the flag alone cannot separate "fixed
it, no harm done" from "lost most of the document." The pair has to be
distinguished by text yield, which is why both fixtures exist.

## Four decisions E2 owes before Week 2

Each is a fixture sitting at `decision_required` in the manifest. Week 2's
acceptance criterion is *"unreadable/encrypted/malformed inputs return explicit
errors,"* which cannot be tested until these are settled.

1. **Repaired-but-complete PDFs** (`corrupt_bad_xref`) — accept with a warning,
   or reject as corrupt? Recommend accept-with-warning recorded in the import
   report; rejecting discards a document the parser read perfectly. Whatever is
   chosen must still reject `corrupt_truncated_50pct`, which carries the
   identical `is_repaired` signal.
2. **Extraction-restricted PDFs** (`protected_owner_password`) — honor the
   document's stated restriction, or the parser's technical capability? This
   belongs in the SDD, not in parser code.
3. **Partially-scanned PDFs** (`scanned_mixed`, 18 of 24 pages with text) — what
   per-document threshold, and does the import report name the dropped pages?
   Recommend accept-with-warning plus an explicit page list, so QA can tell a
   parser bug from a scan without reopening the source.
4. **The size cap** (`oversized_1200_pages`) — page count, byte size, or both,
   and at what number? Currently unset, which is why this fixture has no fixed
   expected outcome.

## Notes on individual fixtures

**The NRC baseline is text-sparse** — about 775 characters per page, because the
manual is slide-style with labeled diagrams. Any chunk size above ~800
characters will span pages on this document. That makes it the fixture that
proves chunk provenance is tracked per page rather than per document, which is
the Week 3 criterion (*"chunk text/page/offsets are stable"*).

**The DOE fixture is a text reflow, not original typesetting.** It arrived as an
extracted-text file rather than a PDF, so pages were reconstructed from the DOE
footer convention (`NP-01 Page 12 Rev. 0`); fixture page N corresponds to module
page N, and page provenance is therefore meaningful. Original tables and figures
are not preserved, and it covers modules NP-01 and NP-02 only. Layout-sensitive
extraction is covered by the NRC and arXiv fixtures instead. If the original PDF
becomes available, swapping it in is a drop-in replacement.

**The arXiv paper is the reading-order case.** Two columns, 23 embedded images.
Naive extraction interleaves the columns and produces chunks whose text is real
but whose sentence order is wrong — which is invisible in a chunk count and
obvious in an answer. Compare extracted order against the rendered page.

**The oversized fixture carries per-page markers** of the form `marker-0042-xray`,
so retrieval tests can target an exact deep page and prove provenance survives a
long document. It is also a usable component of the 10,000-page stress corpus
due in Week 8.

**The adversarial fixture must ingest normally.** It is not a reject case. Page 1
carries a visible instruction block; page 2 hides one in near-white 7pt text that
a human reviewer would miss and the parser reads perfectly. E2 passes by treating
the content as data — silently stripping it would hide the exact behavior E3 and
E5 need to test in Week 8.

## Test passwords

Documented deliberately; these are test files and the passwords are not secrets.

- `protected_user_password.pdf` — user password `fixture-open-2026`
- `protected_owner_password_no_extract.pdf` — opens with an empty user password;
  owner password `fixture-owner-2026`

## Provenance

| Source | Origin | License |
|---|---|---|
| NRC Reactor Concepts Manual Ch.1 | U.S. NRC Technical Training Center | U.S. Government work, public domain |
| DOE-HDBK-1019/1-93 Vol.1 | U.S. Department of Energy | U.S. Government work, public domain |
| arXiv:2112.11583 | arXiv preprint | verify per-paper license before redistributing |

Every fixture in `manifest.json` carries a SHA-256, byte size, page count, and
`derived_from` pointer.
