# E2 Ingestion: validation, extraction, chunking and the import pipeline

The ingestion workstream of the Secure Local Document-QA System. A PDF goes in;
a verdict, a canonical text stream, and chunks that cite back to exact pages
and rectangles come out, in a sealed directory the document store can publish.

| Piece | Where |
|---|---|
| Chunk and Document schemas | `schemas/chunk.schema.json`, `schemas/document.schema.json`, `src/schema.py` |
| Validation result schema | `schemas/validation_result.schema.json`, `src/validation.py` |
| Validation, extraction, chunking | `src/ingest.py`, `src/sentences.py` |
| Import pipeline and its manifest | `src/pipeline.py`, `schemas/ingest_manifest.schema.json`, `schemas/import_report.schema.json` |
| Fixture set | `fixtures/`, labeled in `manifest.json` |
| Sample corpus and its ingest command | `corpus/corpus.json`, `tools/ingest_corpus.py`, output in `corpus/out/` |
| Sample-document demo | `demo.py` (live), `WALKTHROUGH.md` (written), `walkthrough/chunk_viewer.html` (visual) |
| Tests | `tests/test_contracts.py` (34), `tests/test_chunking.py` (11), `tests/test_pipeline.py` (38), `tests/test_corpus.py` (9) |
| Profiling: time, memory, parser work, output | `tools/profile_ingest.py`, results in `perf/` |

Three ways to walk through one document, for three audiences:

```bash
python3 demo.py                  # live in a terminal, for presenting
python3 demo.py --doc original   # or large, arxiv, scanned, truncated, restricted
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

The NRC baseline is 16,094 characters across 24 pages, small enough to read end
to end. The DOE handbook is 196,665 as a text reflow and 187,221 in its original
typesetting.

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

**One schema change raised with the team:** SDD 5.1 records a Chunk as
carrying a single page number. Chunks span pages. On the NRC baseline fixture
that is wrong for **14 of 18 chunks**, and it holds on dense prose too (39% on
the DOE reflow, 62% on the original DOE typesetting, 24% on the arXiv paper),
because a chunk boundary has no reason to land on a page boundary. The schema
here carries `page_start`, `page_end`, and a `page_spans` list with per-page
offsets and highlight rectangles. The Citation record in SDD 5.1 now allows a
page range; the Chunk record there still says one page number. Numbers and
reasoning are in `WALKTHROUGH.md` section 4.

The four policy decisions below (three still open, the size cap settled) are
configuration in `IngestionPolicy`, not conditionals in the parser. `test_policy_decisions_are_live_knobs` proves
each one flips behavior from config alone.

## From PDF to text stream

`extract()` builds one canonical text stream per document from PyMuPDF layout
spans, so every character offset belongs to a span with a known box. Four things
happen on the way, each because a fixture showed the need:

- **Reading order.** Lines are ordered top to bottom. On a page set in columns
  that alone reads straight across both columns, so a page with a real gutter (a
  strip almost no line crosses, with at least five wide lines on each side) is
  read column by column, with full-width blocks such as a title or abstract
  separating bands. A page too sparse to prove its own columns (a page of
  figures with a caption or two on each side) borrows the gutter the rest of
  the document uses. Pages without columns are untouched.
- **Running headers and footers** are removed by position, never by text alone.
  A line goes only if it sits in the band at the page edge, its text recurs
  there on at least three pages close together, it is not set larger than body
  text, and that edge carries running text on at least half the pages. So a
  section's header that lasts six pages is caught, and a heading that happens to
  top three scattered pages is not. A line whose text also appears further down
  the same page is a row of a table or a log, not a header, and is kept: without
  that, the first three rows of every page of a header-less listing were
  removed. On the original DOE handbook this removes all 776 header and footer
  lines and no body line.
- **Rotated pages.** Boxes are stored in the page as displayed, which is what a
  renderer draws, so a highlight lands on its text when the page carries
  `/Rotate`. Text set at an angle to the rest of a page (a stamp up the margin)
  is placed after the page's own text, where it cannot split a sentence.
- **Unnamed glyphs.** A symbol font with no Unicode map hands back raw control
  codes. Each becomes U+FFFD, one for one, so offsets are unchanged and the
  reader can see a symbol is missing; a line of nothing else is dropped.

## How chunks are cut

A chunk is a run of whole sentences, so a cited chunk reads as a self-contained
passage and a reader can tell where it came from. `plan_cuts()` in
`src/ingest.py` decides every boundary and `src/sentences.py` finds the
sentences.

Where a chunk ends, in order of preference and never past `target_chars`:

1. the last sentence end that fits, even an early one;
2. where the text has no sentences (a table, a contents page, a column of
   labels), the last line end that does not split an item;
3. any line end;
4. a word gap, only when a single line is longer than the budget.

A page break is not a boundary. A period after `Fig.`, an initial, a list
marker, or inside a contents dot leader is not a sentence end; the rules and the
27 hand-labelled cases that pin them are in `tests/test_chunking.py`. A bare
exponent that the layout left on its own line (`1 x 10 atoms/second.` then `6`)
stays with the sentence it belongs to. A chunk gives up its overlap before it
would cut inside a line that fits the budget.

| knob | meaning |
|---|---|
| `target_chars` (1200) | hard upper bound on chunk size; only a folded final tail may exceed it |
| `overlap_chars` (200) | the most text adjacent chunks share, in whole sentences. If the last sentence is longer than this, that one sentence is shared, up to half the chunk |
| `min_chunk_chars` (100) | the least new text a chunk adds, and the size below which a final tail is folded in |
| `respect_sentence_boundaries` | `False` cuts on whole lines instead |
| `sorted_reading_order`, `strip_running_headers` | the two extraction switches above |

Every field is hashed into `config_id`, which is part of every chunk ID, so
changing any of them, or `chunker_version`, changes every ID.

## The import pipeline

`src/pipeline.py` is the flow from "these files" to "a directory the document
store may publish". Try it on any PDFs:

```bash
python3 -m src.pipeline ingest fixtures/large/large_doe_nuclear_physics_v1_original.pdf \
    fixtures/corrupt/corrupt_truncated_50pct.pdf fixtures/protected/protected_user_password.pdf \
    --out /tmp/e2-demo --accept-rejections
python3 -m src.pipeline verify /tmp/e2-demo/runs/run_<id> --deep
python3 -m src.pipeline show   /tmp/e2-demo/runs/run_<id> --chunk 12
```

`ingest` prints each stage: stage, validate, extract, chunk, review, seal and
verify, then traces one chunk back to its file, pages, offsets and rectangles
and recomputes each link from the staged PDF. Without `--accept-rejections` a
batch containing a rejected file stops at the review, seals nothing and exits 2.

What happens to a batch:

1. **Stage.** Each file is read once: copied into the attempt directory while
   its SHA-256 is computed. The staged name is `sources/<document_id>.pdf`,
   derived from the content, never from the name the file arrived with. The
   same bytes supplied twice are one document; the other names are kept as
   aliases.
2. **Validate, extract, chunk** from a single extraction (`process()` in
   `src/ingest.py`), so the text that was validated is the text that was chunked.
3. **Review.** `prepare()` returns a `Review`: every candidate with its verdict,
   reason and warnings. If anything was rejected, `commit()` needs the review's
   confirmation token, which is a hash of the rejected set (SDD 6.1: the user
   confirms before the valid remainder is published).
4. **Seal.** `commit()` writes the manifest last, re-verifies the directory from
   the bytes on disk, and renames it to `runs/run_<first 16 hex of the manifest
   hash>/`. The same files under the same configuration always seal to the same
   run ID.

```
<root>/
  ingest.lock        one import per root at a time
  journal.jsonl      operational events: ids, counts, codes, timings. No filenames, no text.
  runs/run_<id>/
    manifest.json    documents, rejected files, policy, chunker config, checksums, seal
    report.json      per-candidate verdicts and the full validation results
    documents.jsonl  one Document record per accepted document
    sources/<document_id>.pdf
    chunks/<document_id>.jsonl      one Chunk per line, in order
    extraction/<document_id>.json   page table: offsets, sizes, which pages have text
```

**Invalid files fail before indexing.** A rejected file's staged copy is deleted
the moment it is rejected, it produces no chunk file, and the manifest lists it
under `rejected` with its checksum, reason and failed check. `verify()` checks
the sealed directory holds nothing it cannot attribute to an accepted document.

**Nothing half-written is ever a run.** An attempt lives in `runs/.partial-*`
until it is sealed. `load_run()` refuses anything that is not sealed or that
fails verification. A full disk, a cancellation or an error removes the
attempt. `recover()`, for startup after a crash, deletes interrupted attempts
and nothing else: a `run_*` directory that no longer verifies is moved to
`quarantine/` with its PDFs, because it may be a good run that was damaged
later, and a folder the pipeline did not create is left alone.

**A failure that is not the file's fault is not a verdict on the file.** An
exception from the caller's progress or cancel callback, or a failure to write
the staged copy, ends the import with its own error. Neither is recorded as a
corrupt PDF.

**Hand-off to the document store (E3).** `load_run(path)` returns a `Run`;
`run.documents` and `run.iter_chunks()` yield exactly the Document and Chunk
dictionaries the schemas describe, and `run.source_path(document_id)` is the
PDF a citation renders its page from. `integrity.chunk_set_sha256` in the
manifest uses the same formula as E3's collection integrity hash, so E3 can
compare what it indexed against what E2 sealed.

Embedding, indexing and activating a collection version are E3's. This module
stops at a verified directory.

## The sample corpus

`corpus/corpus.json` lists the collection E2 hands to indexing, and
`tools/ingest_corpus.py` is the one command that ingests it:

```bash
python3 tools/ingest_corpus.py           # ingest, seal, deep-verify; writes corpus/out/
python3 tools/ingest_corpus.py --check   # ingest again from scratch; exit 1 unless the output is identical
```

It runs the import pipeline above over every listed file as one batch, seals the
run under `corpus/runs/` and verifies it, re-extracting every PDF. It then
writes three files to `corpus/out/`: the sealed run's `manifest.json` byte for
byte, `summary.json` with the counts, checksums, versions and every reject, and
`SUMMARY.md`, the same for reading. None of them holds a path, a time or a
machine detail, so the same corpus, code and settings always give the same
bytes. `tests/test_corpus.py` ingests into a fresh directory and requires the
committed outputs back exactly. A change to extraction or chunking therefore
fails that test until the outputs are regenerated, and the regeneration shows
up in review as a diff of the counts and checksums.

**Version 1 is small.** It holds the three real documents E2 has: the NRC
Reactor Concepts chapter (24 pages), the arXiv two-column paper (13) and the DOE
handbook in its original typesetting (142). That is 179 pages, well short of the
2,000 to 5,000 pages the PRD expects of the initial collection. Adding a
document is one entry in `corpus.json` (path, SHA-256, size, source and
licence), then rerunning the command. The DOE reflow, the 1,200-page synthetic
file and the adversarial document are fixtures, not collection documents: the
first two repeat text already in the corpus, and the third is a test for
E3 and E5.

**Rejects are part of the batch on purpose.** The batch also carries the seven
fixtures labelled `reject`, so every run shows how a reject is explained: a
reason from the SDD 6.1 vocabulary, the check that failed and a sentence of
detail. A file is rejected only if the corpus list expects it, for the reason
the list gives. Any other outcome stops the run before anything is sealed: a
document rejected, a bad file accepted, a reject for another reason, or a file
whose bytes no longer match its checksum. That expectation stands in for the
user's confirmation of the rejected set. No reject reaches the sealed run.

`corpus/runs/` keeps only the run just sealed. A rerun after a change to the
code or the corpus removes the earlier runs, each about 10 MB.

## Time and memory

`tools/profile_ingest.py` imports a fixed set of targets, each in a fresh
process, and records the time, the peak RSS, the Python heap peak, how often
MuPDF opened a document and built a text page, and fingerprints of the output.
Pointed at an older checkout with `--code`, it measures that code on the same
files, and `--compare` then lists both side by side, exiting 1 if any output
differs:

```bash
python3 tools/profile_ingest.py --label patched
python3 tools/profile_ingest.py --label baseline --code <ingestion/ folder of the older checkout>
python3 tools/profile_ingest.py --compare perf/baseline.json perf/patched.json
```

The current figures, on an M-series Mac (macOS 26, Python 3.14, PyMuPDF
1.28.2), medians of 3 runs. Import is prepare and commit; the deep verify
re-extracts every accepted PDF and is timed separately.

| Target | Pages | Chunks | Import | Deep verify | Peak RSS | Python heap peak |
|---|---|---|---|---|---|---|
| NRC chapter | 24 | 18 | 0.10 s | 0.09 s | 65 MB | 3.4 MB |
| arXiv two-column paper | 13 | 50 | 0.18 s | 0.16 s | 74 MB | 4.6 MB |
| DOE handbook, original | 142 | 194 | 0.83 s | 0.80 s | 80 MB | 9.3 MB |
| Synthetic, 1,200 pages | 1,200 | 3,409 | 7.49 s | 7.43 s | 154 MB | 56.0 MB |
| Sample corpus, 10 files | 179 | 262 | 1.12 s | 1.05 s | 85 MB | 9.3 MB |

The interpreter and PyMuPDF take 59 to 64 MB of RSS before the first file is
read. Most of the remaining time is MuPDF building each page's text dictionary,
about 6 of the 7.5 seconds on 1,200 pages. `perf/REPORT.md` compares these
figures with the code as it stood before the week 6 changes. The import is
17 to 20% faster on real documents, the heap peak is 19 to 22% lower on the
larger ones, and the output is identical.

## Known limitations

What a reader of the chunks will still run into, most serious first. None of
these is a cut in the wrong place; they are about the text itself.

- **Exponents and subscripts are out of place.** PDF sets them on their own
  baseline and they arrive as separate lines, so `1 x 10⁶ atoms/second` reads
  `1 x 10 atoms/second.` with a `6` after it (35 places in the original DOE
  handbook). A chunk is never cut between the two, but the number still reads
  wrong. Putting them back inline needs a decision on notation (`10^6`), since
  the character that would mark it is not in the PDF.
- **Display equations are flattened** to one fragment per line, with operators
  that were drawn as lines (fraction bars) missing.
- **Symbols from fonts with no Unicode map.** Greek letters in the original DOE
  handbook come out as U+FFFD, all alike. In the DOE reflow the source text
  layer itself has wrong letters for them (`I` for alpha, `)` for sigma).
- **Floats inside sentences.** On the two-column paper a figure caption or a
  table sits where it was typeset, which is often in the middle of a body
  sentence; the sentence is then split around it. A page with two stacked
  two-column zones (acknowledgments above references) is read as one zone.
- **Figure labels** on the NRC slides come out as a column of short lines in no
  useful order, attached to the first sentence that follows them.
- **Line-end hyphens are kept as printed** (`real-` / `izing`), so a plain
  keyword search for a hyphenated word can miss. They are not joined because
  the stream cannot tell `ramifi-` / `cations` from a real compound broken at
  its hyphen, such as `self-` / `contained`. Ligatures, which used to have the
  same effect (`ﬁ`), are expanded to letters since `refchunk-3.1.0`.
- **Highlights are whole spans.** The first and last highlighted line of a chunk
  can include a few words outside it.
- **English only.** The abbreviation and sentence-opener lists are English.
- **Strict on two points by choice.** A file whose `%PDF-` header is not at
  byte 0 is rejected as not a PDF, and a rebuilt document with any empty page is
  rejected even if that page was blank by design.
- **No OCR.** A scanned page is reported, never read.

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
schemas/       JSON Schema for Document, Chunk, ValidationResult, and the
               pipeline's manifest, import report, review and extraction records
src/
  schema.py        dataclasses, ID derivation, citation targets
  validation.py    outcome/reason vocabulary, checks, IngestionPolicy
  ingest.py        validate(), extract(), chunks(), and process() which does all three in one pass
  sentences.py     sentence boundaries and line-cut grading
  pipeline.py      the import flow: stage, validate, chunk, review, seal, verify
tests/
  test_contracts.py    34 tests: schemas, IDs, provenance, validation outcomes, damaged files
  test_chunking.py     11 tests: where chunks begin and end
  test_pipeline.py     38 tests: the import flow against its acceptance criteria
  test_corpus.py        9 tests: the corpus ingest, its rejects and its rerun consistency
corpus/
  corpus.json      the sample corpus: documents and intake checks, with checksums
  out/             generated by tools/ingest_corpus.py: manifest, summary, SUMMARY.md
  runs/            the sealed run, rebuilt by the command (not committed)
perf/          profiles from tools/profile_ingest.py: baseline.json, patched.json, REPORT.md
fixtures/
  normal/       baseline happy path
  large/        the DOE handbook twice: a 96-page text reflow and the 142-page original
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
  ingest_corpus.py           ingests corpus/corpus.json and writes corpus/out/
  profile_ingest.py          times and measures an import per target; compares two profiles
manifest.json                the labeled corpus: 16 fixtures, expected outcomes, checksums
probe_results.json           raw measurement output
```

```bash
pip install -r requirements.txt      # PyMuPDF is pinned: chunk IDs depend on the extractor
python3 tests/test_contracts.py      # 34/34, about a minute (it reads the 1,200-page fixture)
python3 tests/test_chunking.py       # 11/11
python3 tests/test_pipeline.py       # 38/38; two of them need E3_LIBRARY=<E3 checkout>/secure_qa/library
                                     # and are reported as SKIPPED without it
python3 tests/test_corpus.py         # 9/9
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
the derived fixtures with identical parser behavior, but not byte for byte:
ReportLab stamps a creation date and pikepdf salts each encryption, so those
files get new checksums every run. Commit the fixture binaries and treat the
committed SHA-256s as the regression baseline. Do not regenerate as part of CI
and then compare against the manifest, or those fixtures will fail for no reason.

## What the corpus contains

16 fixtures: 5 must accept, 7 must reject, 4 need a rule from E2 before they
have an expected outcome.

| Fixture | Category | Expected | Detection signal |
|---|---|---|---|
| `normal_nrc_reactor_concepts_ch01` | normal | accept | baseline |
| `large_doe_nuclear_physics_v1` | large | accept | baseline |
| `large_doe_nuclear_physics_v1_original` | large | accept | real typesetting: blank pages, a rotated page, per-section headers |
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
| `oversized_1200_pages` | oversized | accept | under the 2,000-page / 200 MB cap (decision 4, settled) |
| `adversarial_prompt_injection` | adversarial | accept | must not be filtered |

## Findings that shaped validation

Measured with PyMuPDF 1.28.2, the extraction library named in SDD 11. Full
numbers in `probe_results.json`. These are raw parser counts, taken before
running headers are removed, so they are a little higher than the canonical
stream's (the NRC baseline is 18,609 characters raw and 16,094 in the stream).

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

**4. Characters per page cannot be the truncation test.** The truncated NRC
fixture is caught by a low average because that document is sparse. The first
30% of the DOE reflow is 20 pages of 96 and still averages 490 characters per
page across all 96, so it was accepted with the message "text recovery looks
complete". The rule now is about pages, not density: a document the parser had
to rebuild is accepted with a warning only if every page came back with text.
If any page came back empty it is rejected as corrupt, and the detail says how
many pages survived. (This also rejects a rebuilt document whose empty pages
were blank by design. After a repair the two cannot be told apart, and a false
rejection is the safe mistake.)

**5. The page count is a claim, not a measurement.** A file whose page index
says 20 over 12 real pages was accepted as a clean 20-page document, and one
that says 3 as a clean 3-page document with nine pages silently missing.
Neither is "repaired" as far as the parser is concerned. Every declared page is
now loaded by number, the count is checked again after reading, and any parser
complaint about the page index rejects the file.

**6. A page can be damaged and still yield text.** A content stream cut off
half-way gives back the lines before the cut, so the page counts as a page with
text and the file as intact. What the parser printed about that page is the
only evidence. It is now read for every page: the file is accepted with a
`pages_damaged` warning that names the page. Likewise a page set in a font with
no Unicode map is visible to a reader and empty to search; it is reported as
unreadable, not counted among the blank pages.

## Policy decisions: three awaiting sign-off, one settled

Each open one is a fixture sitting at `decision_required` in the manifest, and
each is a field of `IngestionPolicy` with the recommended value as its default, so the
code behaves one defined way today and changing the decision is a one-line
change. Under the defaults `corrupt_bad_xref` and `scanned_mixed` are accepted
with a warning, `protected_owner_password_no_extract` is rejected, and
`oversized_1200_pages` is accepted (the cap is 2,000 pages and 200 MB). The policy in force is recorded in every validation result and every
run manifest. A misspelt setting raises `ValueError` when the policy is built;
it used to select the permissive branch without a word.

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
4. **The size cap** (`oversized_1200_pages`). **Settled on 2026-10-20:** the
   cap stays at 2,000 pages and 200 MB, both checked. A 1,200-page file ingests
   without trouble, so nothing technical calls for a lower number, and 2,000
   pages is above any single document expected in a 2,000 to 5,000-page
   collection. The fixture is now labelled `accept`; `max_pages=1000` still
   rejects it, which the live-knobs test keeps proving.

## Notes on individual fixtures

**The NRC baseline is text-sparse** — about 670 characters per page once
running headers are removed (775 raw), because the manual is slide-style with
labeled diagrams. Any chunk size above ~800
characters will span pages on this document. That makes it the fixture that
proves chunk provenance is tracked per page rather than per document, which is
the Week 3 criterion (*"chunk text/page/offsets are stable"*).

**The DOE fixture is a text reflow, not original typesetting.** It arrived as an
extracted-text file rather than a PDF, so pages were reconstructed from the DOE
footer convention (`NP-01 Page 12 Rev. 0`); fixture page N corresponds to module
page N, and page provenance is therefore meaningful. Original tables and figures
are not preserved, and it covers modules NP-01 and NP-02 only. Layout-sensitive
extraction is covered by the NRC and arXiv fixtures instead.

**The original DOE handbook sits beside it.** `large_doe_nuclear_physics_v1_original.pdf`
is the same two modules in their 1993 typesetting, 142 pages. It was added, not
swapped in, because a different file is a different `document_id` and so
different chunk IDs, and because the pair is the same content in two
typesettings: a difference between them isolates a layout effect. It carries
what the reflow cannot: six intentionally blank pages (4, 6, 8, 10, 12, 94), one
landscape page stored rotated 90 degrees (36), headers that change per module
and per section, tables, equations set in symbol fonts, and nuclide notation
whose superscripts and subscripts extract as separate lines.

**The arXiv paper is the reading-order case.** Two columns, 23 embedded images.
Naive extraction interleaves the columns and produces chunks whose text is real
but whose sentence order is wrong — which is invisible in a chunk count and
obvious in an answer. Compare extracted order against the rendered page.

**The oversized fixture carries per-page markers** of the form `marker-0042-xray`,
so retrieval tests can target an exact deep page and prove provenance survives a
long document. Each marker is a sentence in the page body; in the running
header, where it used to be, it was stripped with the header on every page. It
is also a usable component of the 10,000-page stress corpus due in Week 8.

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
| DOE-HDBK-1019/1-93 Vol.1 (reflow and original) | U.S. Department of Energy | U.S. Government work, public domain; the original is marked "Approved for public release; distribution is unlimited" |
| arXiv:2112.11583 | arXiv preprint | verify per-paper license before redistributing |

Every fixture in `manifest.json` carries a SHA-256, byte size, page count, and
`derived_from` pointer.
