# Ingestion integration notes for E3 and E4

Week 7 merged `E2-Chunking` with `origin/main` at `79042fb` in a scratch checkout
and ran both sides together. It found five defects. Three are fixed in
`ingestion/`. The other two are in `app/`, which E3 and E4 own, so they are
prepared and tested here but not applied. Nothing on `main` has been changed.

| # | Defect | Owner | State |
|---|---|---|---|
| 1 | `ingest_corpus()` reads each PDF two or three times | E3 | Patch below, not applied |
| 2 | The E2 fixtures vendored in `app/` are out of date | E3, and E4 ships them | Commands below, not applied |
| 3 | Merging this branch conflicted in the root `.gitignore` | E2 | Fixed |
| 4 | A killed import's folder stayed until something called `recover()` | E2 | Fixed |
| 5 | `prune()` could delete runs during an open import, or all of them after a mistyped name | E2 | Fixed |

## 1. Read each PDF once (E3)

`secure_qa/library/corpus.py` calls `validate()`, then `chunks()`, then `extract()`
when `keep_text` is set. Each one opens and parses the whole PDF again.
`ingest.process()`, already on `main`, returns all three from one reading.

From the repository root:

```
git apply ingestion/integration/e3_corpus_process.patch
```

The patch changes only `corpus.py`. Results on the merged checkout, with output
identical in all four cases:

| Input | `keep_text` | Time before | Time after | Text pages built before | after |
|---|---|---|---|---|---|
| Real corpus, 4 PDFs, 282 chunks | False | 2.26 s | 1.09 s | 270 | 135 |
| Real corpus, 4 PDFs, 282 chunks | True | 3.07 s | 1.08 s | 405 | 135 |
| All 16 fixtures, 3,915 chunks | False | 26.58 s | 16.36 s | 3,167 | 1,630 |
| All 16 fixtures, 3,915 chunks | True | 39.26 s | 13.65 s | 4,704 | 1,630 |

Peak memory did not change beyond run-to-run noise. E3's suite gives the same result
with the patch: 122 tests run, 115 passed, 7 skipped, none failed. Six of the skips
need the embedding model, which was not downloaded, and one needs E1's runtime, so
retrieval with real embeddings was not exercised. The golden evidence queries still
find their text, 13 of 13, at 282 chunks under `cfg_baa3dd28b8db`.

`e3_bench.py` here reproduces the table, and `perf/e3_handoff.json` is its output.

## 2. Refresh the vendored fixtures (E3)

`secure_qa/library/tests/fixtures/e2/` was copied at E2 commit `36fda65`. It holds
19 chunks from chunker `refchunk-1.0.0`; E2 now produces 18 from `refchunk-3.1.0`.
E3's tests pass against the old copies, so nothing fails, but they test a chunker
that no longer exists. E4's `docqa-service.spec` also bundles this folder into the
release.

From the repository root:

```
E2=ingestion/walkthrough
F=app/document-qa/backend/secure_qa/library/tests/fixtures/e2
cp $E2/all_chunks.json $F/nrc_all_chunks.json
cp $E2/text/normal_nrc_reactor_concepts_ch01.text.txt $F/nrc_text.txt
cp $E2/text/normal_nrc_reactor_concepts_ch01.offsets.json $F/nrc_offsets.json
```

Then update the commit hash and the chunk count (18) in that folder's `README.md`.
`chunk.schema.json` and `nrc_document.json` are unchanged. With the refreshed copies
and the patch together, E3's suite gives the same result: 122 run, 115 passed, 7 skipped.

That README also says to delete the copies and point the tests at E2's files once
`E2-Chunking` is merged. That remains the better end state, but E4's spec would need
to bundle the new location.

## 3 to 5. Fixed on the E2 side

- **Merge conflict.** The ignore rule for `corpus/runs/` moved to
  `ingestion/.gitignore`, and the root `.gitignore` is back to the merge base.
  `git merge-tree` against `origin/main` now reports no conflicts.
- **Killed imports.** `prepare()` now removes `runs/.partial-*` folders as soon as it
  holds the lock, before the disk check, so the leftover no longer counts against the
  space needed. It does not follow symbolic links or touch anything else. Each removal
  is recorded in the journal.
- **`prune()`.** It takes the lock and raises `Busy` while an import is open. It raises
  `ValueError` for an empty or unknown `keep`, and `IntegrityError` if a run in `keep`
  fails its seal. Nothing is deleted in those cases.

E3 calls neither `prepare()` nor `prune()`, so none of these three changes its code.

## Regression suite

The plan lists an E5 regression suite as an input to this work. There isn't one on
`main` at `79042fb`, so E2's own suites and E3's library suite were the regression gate.
When E5's suite exists, it should be run against this branch.

The dependency list for packaging is in `../DEPENDENCIES.md`.
