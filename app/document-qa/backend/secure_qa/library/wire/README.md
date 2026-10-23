# Library messages

The local host accepts `{request_id, operation, payload}` and returns `{request_id, operation, result}`. Errors return `{request_id, error: {code, message, hint}}` with a non-2xx status. Unknown operations/fields and incorrect types are rejected. All operations remain behind loopback and origin checks.

| Operation | Payload | Result |
|---|---|---|
| `library.review` | `{files: [{name, data}]}` (base64 PDF bytes) | `{review_id, accepted: [{name, size}], rejected: [{name, reason}], warning, requires_confirmation}` |
| `library.publish` | `{review_id, confirmed?: boolean}` | `{version_id, document_count, chunk_count}` for the combined library |
| `library.versions` | `{}` | `{active, versions: [{version_id, status, created_at, document_count, chunk_count, documents}]}` |
| `library.set_document_enabled` | `{version_id, document_id, enabled: boolean}` | `{enabled: boolean}` |
| `library.delete_document` | `{version_id, document_id, confirmed: boolean}` | `{deleted: true, version_id}` |
| `library.integrity` | `{}` | `{version_id, ok, expected_chunks, stored_chunks, expected_documents, stored_documents, expected_integrity_sha256, stored_integrity_sha256, problems}` |
| `library.rollback` | `{}` | `{version_id}` (legacy compatibility; no UI control) |
| `library.status` | `{target_request_id}` | `{stage, done, total}` (no incremental progress yet) |
| `library.cancel` | `{target_request_id}` | `{cancelled: false}` (not yet supported) |

Document summaries are `{document_id, source_filename, display_title, page_count, enabled}`. Knowledge Collections displays only the active library's individual documents, not snapshot versions. The Library owns the mutable enabled state, and all files default to enabled on first import. Cached PDF previews use the existing read-only `GET /v1/source?document_id=...&version=...` route; toggles do not affect preview access.

Uploads add to the active library; they do not remove existing PDFs. Matching content IDs replace the same document rather than adding a duplicate. Unchanged document vectors and cached sources are copied without regenerating their embeddings. Failure leaves the active snapshot and selection unchanged.

Selection and deletion require a current snapshot ID and manifest document ID. An outdated snapshot or unknown document returns HTTP 409 `stale_document`; refresh before retrying. Delete requires `confirmed: true` or returns HTTP 409 `confirmation_required`. Invalid types/missing fields return HTTP 400 `invalid_request`. Publication, mutation, rollback, and answering share a nonblocking job gate; overlapping operations return HTTP 409 `busy`. The gate always releases on error.

Deletion atomically activates a verified snapshot without the target PDF, then prunes prior snapshots, cached PDFs, and obsolete import reports so rollback cannot restore the removed document. History text is not deleted. Cached previews tied to pruned versions become unavailable. Deleting the final PDF leaves an empty library ready for future uploads. These are application deletion semantics, not secure disk erasure.

See [document management and retrieval selection](../../../../../../docs/architecture/retrieval-selection-design.md) for storage and retrieval rules. Publication is synchronous; progress and cancellation remain planned work.
