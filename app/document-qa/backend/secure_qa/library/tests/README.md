# Library behavior tests

These tests cover the store contract (`test_store.py`) and versioned publication, rollback, retention and recovery (`test_versions.py`) through the public interfaces. Most use `FakeEmbedder`; `RealModelTest` runs only when `models/all-MiniLM-L6-v2` is present. Review and cancellation tests arrive with PDF validation.

`fixtures/e2/` holds files vendored from E2's branch; see its README.
