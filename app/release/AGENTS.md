# Release engineering guidance

Follow the [PRD](../../docs/product/PRD.md) and [SDD](../../docs/architecture/SDD.md), especially Release Verification, security/offline operation, model and hardware gates, packaging, and cross-platform acceptance.

Put bundle assembly, manifests, signatures, and pre-install verifier packaging in this area. Build separate platform-matching bundles with all runtime dependencies and models included. Verification must reject unsigned, altered, corrupt, incomplete, or wrong-platform bundles without a bypass; the private signing key must never enter the air-gapped laptop. Do not add runtime downloads, telemetry, or self-updating behavior.

Put verifier packaging tests in `tests/` and full packaged offline acceptance in `acceptance/`. Verify no DNS or outbound connection attempts and no externally reachable listener. Record approved changes to release design in the SDD or a linked ADR.
