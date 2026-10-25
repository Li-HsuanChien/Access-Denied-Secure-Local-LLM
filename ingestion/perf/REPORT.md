# Ingestion profile: before and after the week 6 patch

The same five targets were imported before and after the patch: three real
documents, the 1,200-page synthetic file, and the whole sample corpus with its
seven bad files. Each import ran in a fresh process. The output is identical
before and after, byte for byte. Rerun with:

```
python3 tools/profile_ingest.py --label patched
python3 tools/profile_ingest.py --label baseline --code <ingestion/ folder of the older checkout>
python3 tools/profile_ingest.py --compare perf/baseline.json perf/patched.json
```

`--compare` exits 1 if any target's output differs.

## What the baseline showed (commit 1c18893)

- **Every page was read twice.** Counting a page's images
  (`page.get_image_info()`) makes MuPDF build a second text page with the
  page's images loaded. The import built 2 text pages per page, and so did the
  deep verify. The image count is only ever needed for a page with no text.
- **Most of the time is MuPDF building the text dictionary.** On the 1,200-page
  file that takes about 6 of the 7.7 seconds. The extraction flags decide the
  text, so changing them would change every chunk. They were left alone.
- **The Python heap held extra copies of three things.** On the 1,200-page file
  the heap peaked at 69 MB, against 47 MB of real output: the text, page boxes,
  chunks and highlight rectangles. The extra came from every page's line and
  block structures being kept until the end of extraction (17 MB above what
  survives it), a whole UTF-8 copy of the 3-million-character text made just to
  hash it (9 MB at its peak), and the chunk file joined into one blob on top of
  its lines (8 MB).
- **Two entry points read the whole PDF into memory to hash it.** `validate()`
  without a checksum did, and so did `chunks()`, to make the document ID. The
  import pipeline did not, because it hashes while copying.
- **Duplicates were already handled.** A second copy, of an accepted file or a
  rejected one, is matched by checksum while it is copied, before the parser
  sees it, and is recorded as another name for the first.
- **Temporary files were already cleaned up in the import root**, after a
  seal, a decline, a cancel or a failure. The one leak was in the corpus
  command: every run after a change to the code or the corpus sealed a new run
  under `corpus/runs/` and kept the old ones, about 10 MB each.

## What changed

| Change | Where | Effect |
|---|---|---|
| Count images only on pages without text, after the text is read | `extract_document` | Text pages built per page: 2 → 1, plus 1 for each page without text |
| Release each page's blocks and lines once its spans are made | `extract_document` | Extraction heap peak on 1,200 pages: 69 → 52 MB |
| Hash the text stream in slices, not as one UTF-8 copy | `pipeline._text_sha256` | Removes a 9 MB temporary on 1,200 pages |
| Write chunk lines as a list, without joining them | `prepare`, `_write` | Removes a second copy of the chunk file |
| Hash re-extracted chunks line by line in the deep verify | `verify` | The same, in the verify |
| Hash files in 1 MB blocks in `validate()` and `chunks()` | `_hash_file` | Memory no longer grows with the file size |
| Keep only the run just sealed in `corpus/runs/` | `tools/ingest_corpus.py` | Old runs are removed |
| Remove `_page_lines`, which nothing called | `src/ingest.py` | |

## What did not change, and why

- **The extraction itself.** Flags, reading order and text are untouched, which
  is why every run ID below is the same before and after. `PIPELINE_VERSION`
  and the chunker version are unchanged, so nothing has to be re-indexed.
- **The deep verify still re-extracts every PDF.** That is its purpose: it
  proves the stored chunks still follow from the stored PDF with today's code.
- **`commit()` still checks the run twice.** It hashes the files to write the
  manifest, then `verify()` reads them again before sealing. That second read
  is the independent check, and it costs 0.11 s on the 1,200-page file.

## For E3

E3's indexing code calls `validate()` and then `chunks()` on each document,
and each of those extracts the whole PDF. `process()` returns the validation
result and the chunks from one extraction: same output, half the parsing.

## Measurements

Before: `1c18893`. After: `1c18893+uncommitted src/ changes`. Medians of 3 runs per target, each in a fresh process, on macOS-26.6.2 (arm64), Python 3.14.4, PyMuPDF 1.28.2.

### Time

| Target | Pages | Chunks | Import before | Import after | Change | Deep verify before | after | Change |
|---|---|---|---|---|---|---|---|---|
| normal | 24 | 18 | 0.13 s | 0.10 s | -20% | 0.10 s | 0.09 s | -19% |
| layout | 13 | 50 | 0.18 s | 0.18 s | +1% | 0.16 s | 0.16 s | -1% |
| large | 142 | 194 | 1.01 s | 0.83 s | -17% | 1.00 s | 0.80 s | -19% |
| oversized | 1,200 | 3,409 | 7.70 s | 7.49 s | -3% | 7.68 s | 7.43 s | -3% |
| corpus | 179 | 262 | 1.37 s | 1.12 s | -18% | 1.30 s | 1.05 s | -19% |

### Memory

| Target | Peak RSS before | after | Change | Python heap peak before | after | Change |
|---|---|---|---|---|---|---|
| normal | 69.8 MB | 65.4 MB | -6% | 3.4 MB | 3.4 MB | +0% |
| layout | 75.1 MB | 74.2 MB | -1% | 5.6 MB | 4.6 MB | -18% |
| large | 80.6 MB | 79.5 MB | -1% | 11.9 MB | 9.3 MB | -22% |
| oversized | 170.3 MB | 154.3 MB | -9% | 69.2 MB | 56.0 MB | -19% |
| corpus | 86.3 MB | 85.4 MB | -1% | 12.0 MB | 9.3 MB | -22% |

Peak RSS is measured at the end of the import, before the deep verify. The interpreter and PyMuPDF alone take 59 to 64 MB of it before the first file is read, varying from one process to the next, so an RSS change of a few MB on a small file is noise. The Python heap peak (tracemalloc) does not vary between runs.

### Parser work

| Target | Documents opened before | after | Text pages built before | after |
|---|---|---|---|---|
| normal | 1 | 1 | 48 | 24 |
| layout | 1 | 1 | 26 | 13 |
| large | 1 | 1 | 284 | 148 |
| oversized | 1 | 1 | 2,400 | 1,200 |
| corpus | 7 | 7 | 454 | 278 |

Counted during the import only (prepare and commit). The deep verify opens and reads every accepted document again, on purpose.

### Output integrity

| Target | Run ID before | after | Manifest | Chunk set | Rejects | Deep verify |
|---|---|---|---|---|---|---|
| normal | `run_0a4c3d9fc18b5dfe` | `run_0a4c3d9fc18b5dfe` | identical | identical | identical (0) | 19/19 |
| layout | `run_ec3b993accd81d15` | `run_ec3b993accd81d15` | identical | identical | identical (0) | 19/19 |
| large | `run_5b0394ac8837c56b` | `run_5b0394ac8837c56b` | identical | identical | identical (0) | 19/19 |
| oversized | `run_d4fe78a58ed01dbb` | `run_d4fe78a58ed01dbb` | identical | identical | identical (0) | 19/19 |
| corpus | `run_1474c5fc384c4b66` | `run_1474c5fc384c4b66` | identical | identical | identical (7) | 19/19 |

The run ID is the first 16 hex digits of the manifest SHA-256, and the manifest records every document checksum, page table checksum, chunk-file checksum and the chunk-set digest. The same run ID before and after means the same chunk IDs, text, offsets, pages and highlight rectangles, and the same reject verdicts.

