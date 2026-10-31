# Ingestion dependencies, for E4 packaging

Ingestion needs one third-party package at runtime: **PyMuPDF 1.28.2**. Everything else
it imports is in the Python standard library.

| Package | Version | Needed for | Ship it? |
|---|---|---|---|
| PyMuPDF | 1.28.2 | Reading PDFs, in `src/ingest.py` | Yes |
| jsonschema | 4.26.0 | E2's tests | No, not for ingestion |
| pikepdf | 10.15.0 | Building and checking fixtures | No |
| reportlab | 5.0.1 | Building fixtures | No |

`requirements.txt` now holds only the runtime package. The other three moved to
`requirements-dev.txt`, which includes it. `app/` does not reference either file: E4's
build installs PyMuPDF from the root `requirements.txt`, which has the same pin.

## Keep the pin exact

Chunk IDs are a function of the extracted text, and a different PyMuPDF can order or
split that text differently. Upgrading can change every chunk ID, so the root
`requirements.txt`, `app/release/requirements-demo.txt` and `ingestion/requirements.txt`
need to move together, followed by a rerun of the E2 tests and `tools/ingest_corpus.py --check`.

## How this was checked

1. **Runtime install.** A new virtual environment with only `requirements.txt` installed
   sealed the NRC chapter as `run_0a4c3d9fc18b5dfe`, the same run as the full environment,
   and passed the deep verify.
2. **Frozen build.** PyInstaller 6.16.0 with hooks-contrib 2026.9, E4's pinned versions,
   froze a small test program with the spec's hidden imports (`ingestion.src.ingest`,
   `ingestion.src.schema`, and the `ingestion.src` submodules). The frozen program sealed
   the same run ID and passed the deep verify. None of the three development packages
   ended up in the bundle.

Both ran on macOS arm64 with Python 3.14.4. **The Windows build was not tested**, and
`package.ps1` builds for Windows, so E4's build should repeat the check there. Sealing
any fixture and comparing the run ID is enough: the NRC chapter should give the ID above.

## What it adds to the package

Measured on the macOS test build, which came to 70 MB in total.

| File in `pymupdf/` | Size |
|---|---|
| `libmupdf.dylib` | 33.2 MB |
| `_mupdf.so` | 13.4 MB |
| `libmupdfcpp.so` | 1.9 MB |
| `_extra.so` | 0.2 MB |

The spec does not need to name PyMuPDF. PyInstaller found these files from the
`ingestion.src.ingest` import. Sizes on Windows will differ.

## Decision needed: PyMuPDF's licence

PyMuPDF's package metadata states "Dual Licensed - GNU AFFERO GPL 3.0 or Artifex
Commercial License". A packaged release distributes it, so the team should confirm which
licence the release ships under and what that requires. This has not been decided here.
