# Workflow integration tests

These tests check the loopback HTTP contract between the host and the four workflow interfaces described in the [SDD](../../../../../../docs/architecture/SDD.md). Feature-owned adapter tests live in each module's `tests/`; Tauri process lifecycle tests live under `app/desktop/tests/`.

`test_dev_host.py` covers `dev_host.py`, the development stand-in for the Open WebUI host. It checks health, the `answering.ask` envelope, rejection of unknown operations and fields, Host and Origin checks, CORS for local frontends, and the loopback-only bind.
