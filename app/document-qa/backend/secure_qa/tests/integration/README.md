# Workflow integration tests

These tests check the loopback HTTP contract between the host and the five workflow interfaces described in the [SDD](../../../../../../docs/architecture/SDD.md). Feature-owned adapter tests live in each module's `tests/`; Tauri process lifecycle tests live under `app/desktop/tests/`.

`test_dev_host.py` covers health, the `answering.ask` envelope, rejection of unknown operations and fields, Host and Origin checks, CORS for local frontends, and the loopback-only bind.

`test_workflow_host.py` checks the feature operation envelopes and dispatch for local History, Settings, and Library contracts.
