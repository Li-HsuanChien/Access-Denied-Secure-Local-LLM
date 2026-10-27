# E2 Ingestion: how it is tested, and what the tests measure

E2 turns candidate PDFs into validated, chunked, traceable text for the document
store. This page describes how that work is tested and gives the numbers from
one full run of the test suite.

Measured on 27 October 2026 on branch `E2-Chunking` (commit `1c18893` plus the
week 6 changes), with Python 3.14.4 and PyMuPDF 1.28.2 on macOS. Code coverage
was last measured on 20 October, before the week 6 changes.

## Summary

| Metric | Result |
|---|---|
| Automated tests | 92 |
| Passed | 90 |
| Failed | 0 |
| Skipped | 2 (they need a checkout of the E3 document store) |
| Statement coverage | 87.0% (1,885 of 2,166 statements), as of 20 October |
| Branch coverage | 84.8% (619 of 730 branches), as of 20 October |
| Fixture PDFs exercised | 16, in 9 categories |
| Sample corpus | 3 documents, 179 pages, 262 chunks; 7 bad files rejected, each with its reason |
| Chunks checked end to end | 3,915, each traced back to its page and offsets |
| Rerun consistency | A fresh corpus ingest reproduces the committed manifest and summary byte for byte |
| Corpus import | 1.12 s and a 9.3 MB Python heap peak, down from 1.37 s and 12.0 MB, with identical output |
| Test code | 2,665 lines, against 4,085 lines of source |
| Time for the whole suite | about 2 minutes on a laptop |

## The four test suites

| Suite | Tests | What it covers | Time |
|---|---|---|---|
| `tests/test_contracts.py` | 34 | Schemas, stable IDs, provenance, validation verdicts, damaged files | 62 s |
| `tests/test_chunking.py` | 11 | Where chunks begin and end | 3 s |
| `tests/test_pipeline.py` | 38 (36 run, 2 skipped) | The import flow from files to a sealed, verified run | 29 s |
| `tests/test_corpus.py` | 9 | The corpus ingest: rejects, counts, checksums, rerun consistency | 16 s |

Each suite is a plain Python script with no test framework. Every test prints
one line of evidence when it passes, so the output is a record of what was
measured and not only a count of green ticks. For example:

```
PASS  test_normal_pdfs_extract_page_text
      269 of 275 pages across 4 documents yield text; the other 6 are blank in the PDF
```

## How the tests are designed

**Real documents, not mocks.** The tests run against a committed corpus of 16
PDFs. Each one is labelled in `manifest.json` with the outcome it must produce.

| Category | Files | Expected outcome |
|---|---|---|
| Normal, large, two-column layout, oversized, adversarial | 6 | accept |
| Corrupt | 3 | reject |
| Not a PDF | 2 | reject |
| Password protected | 1 | reject |
| Scanned (no text layer) | 1 | reject |
| Depends on a policy decision still open (corrupt, protected, scanned) | 3 | either, by configuration |

**Outputs are checked against published schemas.** Every chunk, validation
result, manifest and report is validated against the JSON Schema files that the
other workstreams code against.

**Results are recomputed independently.** A chunk is not trusted because the
chunker produced it. The tests re-read the source PDF, slice the text at the
recorded offsets, and compare. Checksums and IDs are recomputed from the bytes
on disk.

**Everything is run twice.** The same file and settings must give the same IDs,
the same offsets and the same highlight rectangles on a second run, and a whole
import must give a byte-identical result from a different folder and input order.

**Committed output is the oracle for the corpus.** The corpus summary and
manifest are committed. The corpus tests ingest again into an empty directory
and require those files back exactly, so any change that moves a chunk fails
until the outputs are regenerated and the new counts and checksums are reviewed.

**Failures are injected on purpose.** The pipeline tests fill the disk, kill the
process part-way, cancel mid-batch, flip bits in a finished run and make the
parser raise, then check that nothing half-written is ever accepted.

**Rules about text are pinned by hand-labelled cases.** The sentence detector is
checked against 27 cases labelled by hand before it is trusted on real documents.

## Results against the acceptance criteria

### Week 2: extraction, explicit errors, testable chunk size and overlap

| Criterion | Evidence from the run |
|---|---|
| Normal PDFs extract page text | 269 of 275 pages across 4 documents yield text; the other 6 are blank in the PDF itself and are recorded as such |
| Unreadable, encrypted and malformed inputs return explicit errors | 8 rejections each carry a reason from the published vocabulary, a detail message and the check that failed |
| Truncated files are caught | A dense handbook cut to 30%, 50%, 80% and 97% of its bytes is rejected every time; a second truncated file is rejected even though it still reports its full 24-page count |
| Chunk size is testable | 83 chunks across 4 configurations all stay within the size limit |
| Overlap is testable | 79 adjacent pairs checked: 55 share text, none more than half a chunk, and the shared text is identical in both |

### Week 3: deterministic IDs and stable provenance

| Criterion | Evidence from the run |
|---|---|
| Same file and settings yield the same IDs | Chunk IDs reproduce exactly across runs; 18 IDs survive re-import under a different filename |
| A settings change changes every ID | 18 chunks against 11 under a second configuration, with no ID in common |
| Chunk text, page and offsets are stable | 18 chunks reproduce exactly, including 529 highlight rectangles |
| Offsets point at the right text | Offsets reproduce the chunk text on every chunk; page spans cover every chunk with no gap |
| Boundary tests pass | 8,696 cuts across 4 documents and 5 configurations: none falls inside a line, and no chunk begins or ends inside a word |
| Chunks end where sentences end | 4,348 chunk ends checked against 5 kinds of false boundary (such as "Fig."), with none found; 91% to 100% of chunks end on terminal punctuation, depending on the document |

### Week 4: the import pipeline

| Criterion | Evidence from the run |
|---|---|
| Valid files produce a manifest and chunks | 4 valid PDFs produce one sealed run: a manifest and 475 chunks over 275 pages |
| The pipeline agrees with the reference chunker | The 475 chunks on disk are identical, field for field, to the chunker's direct output |
| Invalid files fail before indexing | 8 rejected files leave 0 staged copies and 0 chunk files; each is listed with its reason |
| Checksums are present and correct | 25 files re-hashed (24,957,881 bytes) and 3,915 chunk checksums and IDs recomputed, all matching |
| Source and page provenance are present | 3,915 chunks traced: the document ID is recomputed from the stored PDF, and 5,609 per-page text slices reproduce the chunk text exactly |
| Damage is detected | 9 kinds of damage to a finished run each fail verification on the expected check |
| Interrupted imports leave nothing usable | A killed process leaves no manifest and nothing loadable; recovery removes the leftovers and leaves finished runs alone |
| Imports are reproducible | The same inputs from a different folder and in a different order give the same run ID, with 11 files byte-identical |
| Document text stays out of logs | 70 log lines searched for 11,745 text windows, 8 titles and 16 filenames: none present |

### Week 5: the corpus run

| Criterion | Evidence from the run |
|---|---|
| The corpus completes | 10 files in one batch: 3 documents accepted (179 pages, 262 chunks), sealed as `run_1474c5fc384c4b66` and deep-verified, 19 of 19 checks |
| Rejects are explainable | 7 rejects, each with a reason from the SDD vocabulary (`corrupt`, `non_pdf`, `password_protected`, `scanned_only`), the check that failed and a sentence of detail |
| Rejects do not reach indexing | The sealed run holds 3 staged PDFs and 3 chunk files, all from accepted documents, and none from the 7 rejects |
| An unexplained outcome stops the run | A bad file expected to pass, and a reject for the wrong reason, both stop the batch with nothing sealed; so does a file whose bytes no longer match its recorded SHA-256 |
| Counts and checksums are recorded | Totals add up from the per-document rows and agree with the sealed manifest; source, text and chunk-set SHA-256s are recorded for each document |
| A rerun produces consistent output | A fresh ingest into an empty directory reproduces the committed manifest, summary and `SUMMARY.md` byte for byte; ingesting twice into one directory reuses the sealed run |
| The ingest command is reproducible | `--check` exits 0 against the committed output, and 1, naming the file, after a hand edit to the recorded counts |

The week 5 defect fixes are also tested. Ligatures are now expanded to letters:
none remain in the 4 accepted documents, and 1,123 fi, ff and fl pairs read as
letters. The 1,200-page fixture is accepted under the settled 2,000-page cap,
so 13 fixtures now have a fixed expected outcome instead of 12.

### Week 6: profiling and the first optimization

The same five targets were imported with the code before and after the change,
each in a fresh process, medians of 3 runs: the three corpus documents, the
1,200-page fixture and the whole corpus batch. The full comparison is in
`perf/REPORT.md`.

| Criterion | Evidence from the run |
|---|---|
| Time, peak RAM and chunk counts are recorded | Normal (24 pages, 18 chunks): 0.13 s → 0.10 s, heap peak 3.4 MB → 3.4 MB. Large (142 pages, 194 chunks): 1.01 s → 0.83 s, 11.9 MB → 9.3 MB. 1,200 pages (3,409 chunks): 7.70 s → 7.49 s, 69.2 MB → 56.0 MB, peak RSS 170 MB → 154 MB |
| Repeated parsing is reduced | Text pages built: 2 per page before, 1 per page after, plus 1 for each page with no text (454 → 278 over the corpus); each document is still opened once |
| Deterministic IDs and citation provenance are intact | All 5 targets give the same run ID before and after, so the same manifest, chunk IDs, text, offsets, pages and highlight rectangles; deep verification passes 19 of 19 checks on each |
| Invalid files fail clearly | The 7 corpus rejects are identical before and after, each with its reason, failed check and detail |
| Duplicate files are handled | Of 4 files, a second copy of an accepted file and of a rejected file are matched by checksum and never parsed; each is recorded as another name for the first |
| Temporary files are cleaned up | After a seal with rejects and a duplicate, a reused run, a decline at review and an import with nothing accepted, the import root holds only `runs/`, `ingest.lock` and `journal.jsonl` |
| Stale corpus runs are removed | An ingest after an earlier run leaves `run_1474c5fc384c4b66` as the only run under `corpus/runs/` |
| Each page is read once | 24 text pages for 24 pages, 148 for 142 (6 without text) and 30 for 24 (6 scanned); the scanned pages still report their images |

## Code coverage

Measured with coverage.py 7.16.2 over all four suites on 20 October, at the
end of week 5. It has not been measured since the week 6 changes.

| Module | Role | Statements | Statement coverage | Branch coverage |
|---|---|---|---|---|
| `src/validation.py` | Verdicts and policy | 73 | 100% | 100% |
| `src/sentences.py` | Sentence boundaries | 208 | 98.6% | 97.4% |
| `src/schema.py` | Chunk and document objects | 113 | 97.3% | 87.5% |
| `src/ingest.py` | Extraction, validation, chunking | 703 | 94.3% | 93.5% |
| `tools/ingest_corpus.py` | The corpus ingest command | 131 | 87.0% | 72.9% |
| `src/pipeline.py` | Import flow | 938 | 76.8% | 70.5% |
| **Total** | | **2,166** | **87.0%** | **84.8%** |

The figure for `pipeline.py` understates what is tested. Of its 218 unmeasured
statements, 160 are the command-line front end. Two tests do run it, but in a
separate process that the coverage tool was not set up to follow. Outside the
command-line code, 92.5% of the module's statements are covered.

## How to reproduce

From the `ingestion/` folder, with the packages in `requirements.txt` installed:

```
python3 tests/test_contracts.py
python3 tests/test_chunking.py
python3 tests/test_pipeline.py
python3 tests/test_corpus.py
python3 tools/ingest_corpus.py --check
```

Each script exits with a non-zero status if any test fails. The lines beginning
`MuPDF error` in the first script's output are expected: they come from the
deliberately corrupt fixtures.

## What the tests do not cover

- **A full-size corpus.** The sample corpus is 179 pages, well short of the
  2,000 to 5,000 pages the PRD expects of the initial collection. The command
  and its tests do not change with size, but nothing has been measured at that
  scale yet.
- **Integration with the document store.** Two tests check that a sealed run
  meets E3's publication rules. They are skipped unless `E3_LIBRARY` points at
  an E3 checkout, and they were skipped in this run.
- **Retrieval quality.** Nothing here measures whether chunks are retrieved well.
  That is E3's golden set, which has to be re-run whenever the chunker changes.
- **Scanned documents.** PDFs with no text layer are detected and rejected; there
  is no OCR, so nothing is tested beyond that verdict.
- **Three open policy decisions.** Three fixtures have no fixed expected outcome
  until the team decides how to treat them. The tests show that each decision
  can be switched by configuration, not which setting is right.
- **Other platforms.** The run above is on macOS only, and E2 has no
  continuous integration yet, so the suites run when someone runs them.
- **Speed and memory at scale.** `tools/profile_ingest.py` measures one machine
  and files up to 1,200 pages, not a batch at the 2,000 to 5,000 pages the PRD
  expects. The test suites do not time anything, so a slowdown fails no test;
  it shows only when the profile is rerun and compared.
