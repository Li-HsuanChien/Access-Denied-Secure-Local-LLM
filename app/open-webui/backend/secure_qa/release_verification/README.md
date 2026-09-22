# Release Verification

Scaffold only. This module owns manifest, signature, checksum, and platform checks. Its implementation must be packaged in a separately trusted pre-install verifier; an installed startup check may reuse the same rules. See the [interface](../../../../../docs/superpowers/specs/2026-09-22-secure-local-document-qa-codebase-design.md#44-release-verification).
