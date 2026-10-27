# Library behavior tests

These tests cover the store contract (`test_store.py`), versioned publication, rollback, retention and recovery (`test_versions.py`), and corpus ingestion, the publication workflow, integrity checks and search diagnostics (`test_publication.py`) through the public interfaces. Most use `FakeEmbedder`; `RealModelTest` runs only when `models/all-MiniLM-L6-v2` is present. `test_publication.py` runs E2's real `validate()` and `chunks()` over its fixture PDFs, so it needs PyMuPDF and skips without it.

`fixtures/e2/` holds files vendored from E2's branch; see its README.
