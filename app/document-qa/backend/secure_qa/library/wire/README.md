# Library host contract (`secure-qa-dev/1`)

Every request uses `{request_id, operation, payload}` at `POST /v1/requests`. The host rejects unknown envelope and payload fields. Binary PDF bytes are base64-encoded and remain local. The body is limited to 150 MiB; a review is limited to 100 MiB of source PDFs.

| Operation | Payload | Result |
|---|---|---|
| `library.review` | `files: [{name, data}]` | `review_id`, accepted `{name,size}` list, rejected `{name,reason}` list, `warning`, `requires_confirmation` |
| `library.publish` | `review_id`, `confirmed` | `version_id`, `document_count`, `chunk_count` |
| `library.status` | `target_request_id` | `null` or `{status,stage,done,total,error?,version_id?}` |
| `library.cancel` | `target_request_id` | `{cancelled}` |
| `library.versions` | `{}` | active version ID and active/previous version summaries |
| `library.rollback` | `{}` | `{version_id}` newly active |

Publication progress is polled by the publication `request_id`. Cancellation is checked between PDF preparations and bounded index batches, before verification, and before catalog activation. Rejections require an explicit `confirmed: true`; a failed or cancelled candidate does not change the active pointer. PDF parsing decisions stay in the Collection Library implementation. See the [Collection Library interface](../../../../../../docs/architecture/SDD.md#41-collection-library).
