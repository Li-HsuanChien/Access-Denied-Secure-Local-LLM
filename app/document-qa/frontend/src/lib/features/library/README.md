# Library frontend

`LibraryView` and `LibraryClient` implement local PDF selection, per-file review with previews, confirmation of accepted remainders, and additive publication. Knowledge Collections lists current PDFs by filename with preview, a persistent Use in answers switch, and a Delete action requiring an explicit Cancel/Confirm delete dialog. Snapshot rollback is no longer shown. Save failures preserve the server state and display an actionable error. The client calls the versioned host contract and never mutates an index. Publication is currently synchronous; status/cancel operations are placeholders, not a cancellable job.

See the [Collection Library design](../../../../../../../docs/architecture/SDD.md#41-collection-library) and [document management design](../../../../../../../docs/architecture/retrieval-selection-design.md).
