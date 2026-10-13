# History host contract (`secure-qa-dev/1`)

Every request uses `{request_id, operation, payload}` at `POST /v1/requests`; unknown operation and payload fields are rejected.

| Operation | Payload | Result |
|---|---|---|
| `history.save` | `conversation_id`, `title`, `answer` | `{saved}`; false when persistence is disabled |
| `history.list` | `{}` | `{conversations: [{conversation_id,title,updated_at,model_id,collection_version}]}` |
| `history.open` | `conversation_id` | `{conversation}` with stored answer or null |
| `history.delete` | `conversation_id` | `{deleted}` |
| `history.clear` | `{}` | `{cleared: true}` |
| `history.enabled` | `{}` | `{enabled}` |
| `history.set_enabled` | `enabled` | `{enabled}` |

Each answer snapshot retains its producing model and collection identifiers, plus the complete structured answer. SQLite storage is local and relies on OS full-disk encryption. See the [Conversation History interface](../../../../../../docs/architecture/SDD.md#43-conversation-history).
