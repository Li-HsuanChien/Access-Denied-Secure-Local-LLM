# Ingestion optimization: week 7

Candidate build against the end of week 6 (`905a75b`), on the same five targets. Rerun with:

```
python3 tools/profile_ingest.py --label week7
python3 tools/profile_ingest.py --label week7_before --code <ingestion/ folder of the older checkout>
python3 tools/profile_ingest.py --compare perf/week7_before.json perf/week7.json
python3 tools/candidate_run.py
```

## Result

- **The largest saving is in the hand-off to E3, and it isn't applied yet.** E3's
  `ingest_corpus()` parses each PDF two or three times. A one-file patch cuts the real
  corpus from 3.07 s to 1.08 s with identical output. The code belongs to E3, so it is
  waiting in `integration/`.
- **E2's own import time did not change.** Differences in the table below are within
  run-to-run noise. Week 6 already removed the repeated parsing, and what remains is
  mostly MuPDF building each page's text dictionary.
- **Memory fell a little on large files.** The Python heap peak on 1,200 pages went from
  56.0 MB to 51.7 MB (-8%), and on the DOE handbook from 9.3 MB to 8.9 MB.
- **A killed import no longer costs disk.** The import root after one went from double
  the run's size to the run's size, for example 20.49 MB to 10.25 MB on 1,200 pages.
- **The output is byte-identical** on all five targets: same run IDs and same rejects.

## What changed

| Change | Effect |
|---|---|
| Chunk files are encoded and written in batches of 256 | The heap peak on large files now comes from extraction. The disk is checked as the file grows. Bytes written are unchanged |
| `prepare()` removes interrupted attempts before its disk check | Leftovers stop using disk, and no longer count against the space check |
| `prune()` is guarded | It refuses during an open import, and for an empty or unknown `keep` or a damaged kept run |
| PyMuPDF is the only runtime requirement | See `../DEPENDENCIES.md` |

## Hand-off to E3

Measured on a scratch merge of `E2-Chunking` and `origin/main` at `79042fb`. Medians of
3 runs, with identical output in every row. Raw results are in `e3_handoff.json`.

| Input | `keep_text` | Time before | after | Documents opened before | after | Text pages before | after |
|---|---|---|---|---|---|---|---|
| Real corpus, 4 PDFs | False | 2.26 s | 1.09 s | 8 | 4 | 270 | 135 |
| Real corpus, 4 PDFs | True | 3.07 s | 1.08 s | 12 | 4 | 405 | 135 |
| All 16 fixtures | False | 26.58 s | 16.36 s | 21 | 13 | 3,167 | 1,630 |
| All 16 fixtures | True | 39.26 s | 13.65 s | 29 | 13 | 4,704 | 1,630 |

Peak RSS did not change beyond noise. See `../integration/README.md` for the patch.

## Options measured or considered, and not taken

| Option | Why not |
|---|---|
| `slots=True` on the extractor's span, line and page records | Saves only 2.5 MB on 1,200 pages |
| Generating chunks lazily | No lower peak: extraction sets it, and batched writing already covers the chunk stage |
| Streaming extraction page by page | Column layout and running-header removal need all pages' lines together, and changing that would change the text |
| Parsing page batches in several processes | Multiplies RAM, complicates the frozen build, and typical documents take under 2 s |
| Different MuPDF extraction flags | Would change every chunk |

## Still costs something

- **A rerun repeats the whole import.** Reuse is detected at the seal, by comparing run
  IDs, so an unchanged rerun parses everything again and briefly needs twice the run's
  disk: 20.49 MB on 1,200 pages, and about 16 s against 13.5 s for the candidate set
  with the disk sampler running. Detecting reuse early would have to trust
  version strings over the output itself, so this needs a team decision.
- **The journal is never rotated.** `journal.jsonl` grows with every import: 1.2 KB for a one-file import, and more for a batch. It's
  a record, not a temporary file, so it was left alone.
- **Extraction sets the memory peak**, at about 52 MB of heap on 1,200 pages. Nothing
  above 1,200 pages has been measured, and the PRD expects 2,000 to 5,000 in total.

## Candidate build

`CANDIDATE.md` has the full result: 13 normal, duplicate, large and invalid files, 9 of 9
checks passed.

## Limits of this evidence

- **No E5 regression suite exists** on `main` at `79042fb`. E2's suites and E3's library
  suite stood in for it.
- **E3's real-embedding tests did not run.** Of 122 E3 tests, 115 passed and 7 skipped:
  6 need the embedding model and 1 needs E1's runtime.
- **Compare times only within one report.** The week 6 code took 12.60 s on 1,200 pages
  here and 7.49 s in `REPORT.md`, on the same laptop. The cause wasn't established.
- **macOS only.** Nothing here was run on Windows.

## Measurements

Before: `905a75b`. After: `905a75b+uncommitted src/ changes`. Medians of 3 runs per target, each in a fresh process, on macOS-26.6.2 (arm64), Python 3.14.4, PyMuPDF 1.28.2.

### Time

| Target | Pages | Chunks | Import before | Import after | Change | Deep verify before | after | Change |
|---|---|---|---|---|---|---|---|---|
| normal | 24 | 18 | 0.18 s | 0.16 s | -11% | 0.16 s | 0.13 s | -21% |
| layout | 13 | 50 | 0.30 s | 0.29 s | -5% | 0.25 s | 0.23 s | -8% |
| large | 142 | 194 | 1.45 s | 1.21 s | -16% | 1.22 s | 1.18 s | -3% |
| oversized | 1,200 | 3,409 | 12.60 s | 12.40 s | -2% | 12.03 s | 13.16 s | +9% |
| corpus | 179 | 262 | 1.78 s | 1.83 s | +3% | 1.55 s | 1.82 s | +17% |

### Memory

| Target | Peak RSS before | after | Change | Python heap peak before | after | Change |
|---|---|---|---|---|---|---|
| normal | 71.2 MB | 67.1 MB | -6% | 4.7 MB | 4.7 MB | +0% |
| layout | 76.4 MB | 77.3 MB | +1% | 4.9 MB | 4.9 MB | +0% |
| large | 82.0 MB | 81.0 MB | -1% | 9.3 MB | 8.9 MB | -4% |
| oversized | 149.5 MB | 142.1 MB | -5% | 56.0 MB | 51.7 MB | -8% |
| corpus | 87.9 MB | 87.4 MB | -1% | 9.3 MB | 8.9 MB | -4% |

Peak RSS is measured at the end of the import, before the deep verify. The interpreter and PyMuPDF alone take 60 to 66 MB of it before the first file is read, varying from one process to the next, so an RSS change of a few MB on a small file is noise. The Python heap peak (tracemalloc) does not vary between runs.

### Parser work

| Target | Documents opened before | after | Text pages built before | after |
|---|---|---|---|---|
| normal | 1 | 1 | 24 | 24 |
| layout | 1 | 1 | 13 | 13 |
| large | 1 | 1 | 148 | 148 |
| oversized | 1 | 1 | 1,200 | 1,200 |
| corpus | 7 | 7 | 278 | 278 |

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

### Disk

| Target | Sealed run | of which sources | Import peak before | after | Rerun peak before | after | Root after a killed import, before | after |
|---|---|---|---|---|---|---|---|---|
| normal | 1.29 MB | 1.23 MB | 1.29 MB | 1.29 MB | 2.52 MB | 2.52 MB | 2.58 MB | 1.29 MB |
| layout | 4.43 MB | 4.31 MB | 4.44 MB | 4.44 MB | 8.88 MB | 8.75 MB | 8.88 MB | 4.44 MB |
| large | 3.88 MB | 3.36 MB | 3.88 MB | 3.88 MB | 7.76 MB | 7.76 MB | 7.76 MB | 3.88 MB |
| oversized | 10.24 MB | 2.50 MB | 10.24 MB | 10.24 MB | 20.49 MB | 20.49 MB | 20.49 MB | 10.25 MB |
| corpus | 9.61 MB | 8.90 MB | 9.63 MB | 9.63 MB | 19.25 MB | 19.25 MB | 19.26 MB | 9.64 MB |

Peaks are sampled about every 20 ms, so they can slightly undercount. "Root after a killed import" plants a copy of the run as a leftover attempt, then imports again, and measures what remains under the import root.

