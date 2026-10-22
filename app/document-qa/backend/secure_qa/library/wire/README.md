# Library messages

The Collection Library operations the frontend calls through the host's SDD §4.6 envelope (`{"request_id", "operation", "payload"}`). The development host (`dev_host.py`) serves them today; the Open WebUI adapter will carry the same shapes. Unknown operations and fields are rejected. Chunk text, highlight data and the user's questions never appear in these results. See the [Collection Library interface](../../../../../../docs/architecture/SDD.md#41-collection-library).

| Operation | Payload | Result |
|---|---|---|
| `library.status` | `{}` | `{active, previous, versions: [Version]}` |
| `library.review` | `{files?: [name]}` | Import review. Nothing is published or changed. |
| `library.publish` | `{files?: [name], confirm_rejects?: bool}` | `{status, message, elapsed_s, review, version, integrity, library}` |
| `library.rollback` | `{}` | `{active, previous, versions}` |
| `library.integrity` | `{}` | The active version re-read from the store and compared with its manifest |

Files are named by file name only and must be PDFs in the host's document folder (`--corpus`); anything else is `unknown_file`. Omitting `files` means every PDF in the folder.

**`library.publish` status:** `published`, `needs_confirmation` (some files were rejected; show the review and ask, then resend with `confirm_rejects: true`; SDD §6.1), `nothing_to_publish` (every file was rejected), `busy` (another publication is running; one at a time, SDD §6.2) or `failed` (the active version is unchanged). These are 200 results, not transport errors.

**Import review** (`review`): `summary {files, accepted, accepted_with_warnings, rejected, pages, chunks, manifest_sha256}` and `files: [{filename, outcome, reject_reason, reject_detail, warnings, checksum_sha256, byte_size, document_id, pages, chunks}]`. `outcome` is `accepted`, `accepted_with_warnings` or `rejected`. `reject_reason` is `password_protected`, `corrupt`, `scanned_only`, `oversized` or `non_pdf` (SDD §6.1), with a plain-language `reject_detail`. `manifest_sha256` is the same for the same files and chunker.

**Version:** `{version_id, status: "active" | "previous", created_at, activated_at, chunk_count, embedding_model, chunker_config_ids, integrity_sha256, documents: [{document_id, display_title, source_filename, page_count}]}`.

**Integrity:** `{version_id, ok, expected_chunks, stored_chunks, expected_documents, stored_documents, expected_integrity_sha256, stored_integrity_sha256, problems}`. `ok` means the stored counts, document set, chunk ids and text checksums match the version's manifest.

**Errors** (HTTP 409, `{request_id, error: {code, message, hint}}`): `no_corpus` (host started without `--corpus`), `unknown_file`, `no_previous_version`, `no_active_collection`.

Not built yet: progress events while a publication runs, and cancellation by request ID (SDD §4.6). `library.publish` returns once, when it finishes.
