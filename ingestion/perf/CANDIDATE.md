# Candidate build run

Written by `python3 tools/candidate_run.py`. Run `run_b3ed0f274f4475cf`, e2-pipeline-1.0.0, on macOS-26.6.2 (arm64), Python 3.14.4.

13 files in, 4 accepted, 1 duplicate, 8 rejected; 1,390 pages and 3,639 chunks.

## Checks

| Check | Result | Detail |
|---|---|---|
| confirmed | pass | 8 rejected files stopped the seal until confirmed |
| outcomes | pass | 13 files as labelled |
| duplicate | pass | one document for two names; alias ['same_bytes_under_another_name.pdf'] |
| sealed | pass | deep verify 19/19, run run_b3ed0f274f4475cf |
| provenance | pass | 12 chunks traced to their page and offsets |
| rerun | pass | reused run_b3ed0f274f4475cf |
| leftover | pass | a killed import's folder was removed by the next import |
| sources | pass | 13 read-only files unchanged in bytes, size, modified time and mode |
| root | pass | only the run, the lock and the journal |

## Measured

| Measure | Value |
|---|---|
| Import, all files | 13.55 s |
| Rerun, reusing the run | 15.96 s |
| Peak RSS of the whole session | 142.1 MB |
| Input files | 17.3 MB |
| Sealed run | 16.7 MB |
| Disk peak, import | 16.7 MB |
| Disk peak, rerun | 33.5 MB |
| Import root afterwards | 16.7 MB |

Times were taken with the disk sampler running, which walks the import root every 50 ms, so they are slower than `perf/week7.json` and only meaningful here. The session's peak RSS includes the deep verify and the traces.

## Files

| File | Kind | Label | Outcome | Reason |
|---|---|---|---|---|
| normal_nrc_reactor_concepts_ch01.pdf | normal | accept | accepted |  |
| large_doe_nuclear_physics_v1_original.pdf | large | accept | accepted |  |
| oversized_1200_pages.pdf | large | accept | accepted |  |
| corrupt_truncated_50pct.pdf | invalid | reject | rejected | corrupt |
| corrupt_header_only.pdf | invalid | reject | rejected | corrupt |
| corrupt_empty.pdf | invalid | reject | rejected | corrupt |
| corrupt_bad_xref.pdf | invalid | decision_required | accepted_with_warnings |  |
| protected_user_password.pdf | invalid | reject | rejected | password_protected |
| protected_owner_password_no_extract.pdf | invalid | decision_required | rejected | password_protected |
| scanned_no_text_layer.pdf | invalid | reject | rejected | scanned_only |
| nonpdf_zip_container_renamed.pdf | invalid | reject | rejected | non_pdf |
| nonpdf_plaintext_renamed.pdf | invalid | reject | rejected | non_pdf |
| same_bytes_under_another_name.pdf | duplicate | duplicate of the normal file | duplicate |  |
