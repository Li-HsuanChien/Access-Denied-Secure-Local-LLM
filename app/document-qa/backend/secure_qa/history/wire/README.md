# History host contract (`secure-qa-dev/1`)

Every request uses `{request_id, operation, payload}` at `POST /v1/requests`; unknown operation and payload fields are rejected.

| Operation | Payload | Result |
|---|---|---|
| `history.save` | `conversation_id`, `title`, `answer` | `{saved}`; false when persistence is disabled |
| `history.list` | `{}` | `{conversations: [{conversation_id,title,updated_at,model_id,collection_version}]}` |
| `history.open` | `conversation_id` | `{conversation}` with ordered `messages`, running `summary`, and the latest `answer` (or null) |
| `history.delete` | `conversation_id` | `{deleted}` |
| `history.clear` | `{}` | `{cleared: true}` |
| `history.enabled` | `{}` | `{enabled}` |
| `history.set_enabled` | `enabled` | `{enabled}` |

A conversation is a thread: an ordered list of user/assistant turns plus a running `summary`. Assistant turns retain their producing model and collection identifiers plus the complete structured answer. The multi-turn memory is driven by `answering.ask` carrying an optional `conversation_id` (it appends the turns and maintains the summary); `history.save` remains for the legacy single-answer path. SQLite storage is local and relies on OS full-disk encryption. See the [Conversation History interface](../../../../../../docs/architecture/SDD.md#43-conversation-history) and [ADR 0005](../../../../../../docs/architecture/decisions/0005-per-conversation-context-management.md).
