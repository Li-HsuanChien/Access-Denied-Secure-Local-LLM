# Workflow module guidance

The [PRD](../../../../docs/product/PRD.md) defines product outcomes. The [SDD](../../../../docs/architecture/SDD.md) defines workflow ownership, public interfaces, invariants, data, and test seams. Read both before changing behavior.

Each feature package owns one deep workflow and hides its orchestration and adapters behind a small public interface. Keep cross-feature calls on those public interfaces; do not reach into another feature's storage or private adapters. Keep framework and vendor types out of public interfaces and persistent domain records. Use deterministic fakes for workflow tests and focused integration tests for production adapters.

Place feature tests, wire contracts, and benchmarks in the feature's documented subdirectories. Place cross-workflow integration tests in `tests/integration/`. Preserve atomic collection publication, evidence and citation validation, persistence settings, release rejection behavior, and sanitized diagnostics. Update the SDD or a linked ADR alongside approved design changes.
