# Settings host contract (`secure-qa-dev/1`)

Every request uses `{request_id, operation, payload}` at `POST /v1/requests`; unknown operation and payload fields are rejected.

| Operation | Payload | Result |
|---|---|---|
| `settings.get` | `{}` | `{general_knowledge}` |
| `settings.update` | `general_knowledge` | `{general_knowledge}` persisted locally |

Readiness is derived from `GET /health` and is never stored as a preference. History persistence is changed only through the History operation. Defaults are general knowledge enabled and history persistence enabled. See the [Local Settings interface](../../../../../../docs/architecture/SDD.md#44-local-settings).
