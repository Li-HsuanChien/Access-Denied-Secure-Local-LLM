# Conversation History

`ConversationHistory` owns local SQLite persistence for answer snapshots. Its host contract is documented in [`wire/README.md`](wire/README.md). Each answer snapshot retains its model and collection identifiers; SQLite data relies on operating-system full-disk encryption. Save failures are surfaced to Chat without discarding the current answer. See the [SDD](../../../../../docs/architecture/SDD.md#43-conversation-history).
