# Library behavior tests

These tests cover the store contract (`test_store.py`), versioned publication, rollback, retention, recovery, candidate cancellation and source snapshot staging (`test_versions.py`), and PDF review/confirmation (`test_workflow.py`) through the public interfaces. Most use `FakeEmbedder`; `RealModelTest` runs only when `models/all-MiniLM-L6-v2` is present.

`fixtures/e2/` holds files vendored from E2's branch; see its README.
