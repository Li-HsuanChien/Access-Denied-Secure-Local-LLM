"""Conversation persistence. Database details stay private to this module.

A conversation is a thread: an ordered list of turns (user and assistant
messages) plus a running `summary` that lets the answering workflow give the
model memory of earlier turns without replaying the whole thread (SDD §4.3,
§8). Assistant turns also keep the full structured answer snapshot, so a thread
can be reopened with its citations and evidence intact.

The legacy single-answer interface (`save`/`open[...]["answer"]`) is preserved
on top of the thread model so existing callers and the host wire contract keep
working; new callers use the turn-level methods (`append_turn`, `recent_turns`,
`get_summary`/`set_summary`).
"""

from __future__ import annotations

import json
import sqlite3
import threading
from pathlib import Path

SCHEMA_VERSION = "2"


class ConversationHistory:
    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._db = sqlite3.connect(self.path, check_same_thread=False)
        self._db.row_factory = sqlite3.Row
        self._lock = threading.RLock()
        with self._lock:
            self._migrate()
            self._db.executescript("""
                CREATE TABLE IF NOT EXISTS preferences (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS conversations (
                    conversation_id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    model_id TEXT,
                    collection_version TEXT,
                    summary TEXT NOT NULL DEFAULT ''
                );
                CREATE TABLE IF NOT EXISTS messages (
                    message_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    conversation_id TEXT NOT NULL,
                    ordinal INTEGER NOT NULL,
                    role TEXT NOT NULL,
                    content TEXT NOT NULL,
                    answer_json TEXT,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
                CREATE INDEX IF NOT EXISTS messages_by_conversation ON messages(conversation_id, ordinal);
                INSERT OR IGNORE INTO preferences VALUES ('enabled', 'true');
            """)
            self._db.execute("INSERT INTO preferences VALUES ('schema_version', ?) "
                             "ON CONFLICT(key) DO UPDATE SET value=excluded.value", (SCHEMA_VERSION,))
            self._db.commit()

    # --- migration ----------------------------------------------------------------------

    def _migrate(self) -> None:
        """Upgrade the pre-thread schema (one answer snapshot per conversation row)."""
        tables = {r[0] for r in self._db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if "conversations" not in tables:
            return
        columns = {r["name"] for r in self._db.execute("PRAGMA table_info(conversations)")}
        if "summary" in columns:
            return  # already the thread schema
        # Old schema had conversations(conversation_id,title,updated_at,model_id,collection_version,answer_json).
        self._db.execute("ALTER TABLE conversations RENAME TO conversations_legacy")
        self._db.executescript("""
            CREATE TABLE conversations (
                conversation_id TEXT PRIMARY KEY, title TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                model_id TEXT, collection_version TEXT, summary TEXT NOT NULL DEFAULT '');
            CREATE TABLE messages (
                message_id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id TEXT NOT NULL, ordinal INTEGER NOT NULL,
                role TEXT NOT NULL, content TEXT NOT NULL, answer_json TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
        """)
        for row in self._db.execute("SELECT * FROM conversations_legacy"):
            self._db.execute(
                "INSERT INTO conversations (conversation_id,title,updated_at,model_id,collection_version,summary) "
                "VALUES (?,?,?,?,?,'')",
                (row["conversation_id"], row["title"], row["updated_at"], row["model_id"], row["collection_version"]))
            answer = _loads(row["answer_json"])
            question = (answer.get("question") if isinstance(answer, dict) else None) or row["title"]
            self._db.execute("INSERT INTO messages (conversation_id,ordinal,role,content) VALUES (?,0,'user',?)",
                             (row["conversation_id"], question))
            self._db.execute("INSERT INTO messages (conversation_id,ordinal,role,content,answer_json) VALUES (?,1,'assistant','',?)",
                             (row["conversation_id"], row["answer_json"]))
        self._db.execute("DROP TABLE conversations_legacy")
        self._db.commit()

    # --- persistence toggle -------------------------------------------------------------

    def enabled(self) -> bool:
        with self._lock:
            return self._db.execute("SELECT value FROM preferences WHERE key='enabled'").fetchone()[0] == "true"

    def set_enabled(self, enabled: bool) -> None:
        with self._lock, self._db:
            self._db.execute("UPDATE preferences SET value=? WHERE key='enabled'", ("true" if enabled else "false",))

    # --- thread writes ------------------------------------------------------------------

    def ensure_conversation(self, conversation_id: str, title: str | None = None) -> None:
        """Create the thread if it does not exist yet (no-op when it does)."""
        with self._lock, self._db:
            self._db.execute(
                "INSERT INTO conversations (conversation_id,title) VALUES (?,?) ON CONFLICT(conversation_id) DO NOTHING",
                (conversation_id, title or "New conversation"))

    def append_turn(self, conversation_id: str, role: str, content: str, answer: dict | None = None) -> bool:
        """Append one message to the thread; False when persistence is disabled.

        The first user turn names an untitled thread. Assistant turns may carry
        the full structured answer, whose model and collection ids are pinned on
        the conversation row.
        """
        with self._lock, self._db:
            if not self.enabled():
                return False
            exists = self._db.execute("SELECT title FROM conversations WHERE conversation_id=?", (conversation_id,)).fetchone()
            if exists is None:
                title = _title_from(content) if role == "user" else "New conversation"
                self._db.execute("INSERT INTO conversations (conversation_id,title) VALUES (?,?)", (conversation_id, title))
            elif role == "user" and exists["title"] in ("", "New conversation"):
                self._db.execute("UPDATE conversations SET title=? WHERE conversation_id=?", (_title_from(content), conversation_id))
            ordinal = self._db.execute("SELECT COALESCE(MAX(ordinal)+1,0) FROM messages WHERE conversation_id=?",
                                       (conversation_id,)).fetchone()[0]
            model = (answer or {}).get("model") or {}
            self._db.execute(
                "INSERT INTO messages (conversation_id,ordinal,role,content,answer_json) VALUES (?,?,?,?,?)",
                (conversation_id, ordinal, role, content, json.dumps(answer) if answer is not None else None))
            self._db.execute(
                "UPDATE conversations SET updated_at=CURRENT_TIMESTAMP, "
                "model_id=COALESCE(?,model_id), collection_version=COALESCE(?,collection_version) WHERE conversation_id=?",
                (model.get("model_id"), (answer or {}).get("collection_version"), conversation_id))
            return True

    def set_summary(self, conversation_id: str, summary: str) -> None:
        with self._lock, self._db:
            self._db.execute("UPDATE conversations SET summary=? WHERE conversation_id=?", (summary, conversation_id))

    def rename(self, conversation_id: str, title: str) -> bool:
        with self._lock, self._db:
            return self._db.execute("UPDATE conversations SET title=?, updated_at=CURRENT_TIMESTAMP WHERE conversation_id=?",
                                    (title, conversation_id)).rowcount > 0

    def save(self, conversation_id: str, title: str, answer: dict) -> bool:
        """Legacy single-answer save: replace the thread with one Q/A turn pair.

        Preserved for the `history.save` wire op and existing callers; new code
        uses `append_turn`. False means persistence is disabled.
        """
        with self._lock, self._db:
            if not self.enabled():
                return False
            question = (answer.get("question") if isinstance(answer, dict) else None) or title
            model = answer.get("model") or {}
            self._db.execute(
                "INSERT INTO conversations (conversation_id,title,model_id,collection_version,summary) VALUES (?,?,?,?,'') "
                "ON CONFLICT(conversation_id) DO UPDATE SET title=excluded.title, updated_at=CURRENT_TIMESTAMP, "
                "model_id=excluded.model_id, collection_version=excluded.collection_version",
                (conversation_id, title, model.get("model_id"), answer.get("collection_version")))
            self._db.execute("DELETE FROM messages WHERE conversation_id=?", (conversation_id,))
            self._db.execute("INSERT INTO messages (conversation_id,ordinal,role,content) VALUES (?,0,'user',?)",
                             (conversation_id, question))
            self._db.execute("INSERT INTO messages (conversation_id,ordinal,role,content,answer_json) VALUES (?,1,'assistant','',?)",
                             (conversation_id, json.dumps(answer)))
            return True

    # --- thread reads -------------------------------------------------------------------

    def recent_turns(self, conversation_id: str, limit: int = 6) -> list[dict]:
        """The last `limit` messages in chronological order (oldest first)."""
        with self._lock:
            rows = self._db.execute(
                "SELECT role, content, answer_json FROM messages WHERE conversation_id=? ORDER BY ordinal DESC LIMIT ?",
                (conversation_id, limit)).fetchall()
        turns = [{"role": r["role"], "content": r["content"],
                  **({"answer": _loads(r["answer_json"])} if r["answer_json"] else {})} for r in reversed(rows)]
        return turns

    def get_summary(self, conversation_id: str) -> str:
        with self._lock:
            row = self._db.execute("SELECT summary FROM conversations WHERE conversation_id=?", (conversation_id,)).fetchone()
            return row["summary"] if row else ""

    def list(self) -> list[dict]:
        with self._lock:
            return [dict(row) for row in self._db.execute(
                "SELECT conversation_id,title,updated_at,model_id,collection_version FROM conversations ORDER BY updated_at DESC")]

    def open(self, conversation_id: str) -> dict | None:
        """The full thread: conversation fields, `summary`, ordered `messages`, and
        `answer` (the latest assistant answer) for the legacy single-answer contract."""
        with self._lock:
            row = self._db.execute("SELECT * FROM conversations WHERE conversation_id=?", (conversation_id,)).fetchone()
            if row is None:
                return None
            messages = [dict(m) | {"answer": _loads(m["answer_json"])} for m in self._db.execute(
                "SELECT ordinal,role,content,answer_json,created_at FROM messages WHERE conversation_id=? ORDER BY ordinal",
                (conversation_id,))]
        latest = next((m["answer"] for m in reversed(messages) if m["role"] == "assistant" and m["answer"] is not None), None)
        for m in messages:
            m.pop("answer_json", None)
        return dict(row) | {"messages": messages, "answer": latest}

    def delete(self, conversation_id: str) -> bool:
        with self._lock, self._db:
            self._db.execute("DELETE FROM messages WHERE conversation_id=?", (conversation_id,))
            return self._db.execute("DELETE FROM conversations WHERE conversation_id=?", (conversation_id,)).rowcount > 0

    def clear(self) -> None:
        with self._lock, self._db:
            self._db.execute("DELETE FROM messages")
            self._db.execute("DELETE FROM conversations")

    def close(self) -> None:
        self._db.close()


def _title_from(content: str) -> str:
    text = " ".join(content.split())
    return (text[:120] or "New conversation")


def _loads(blob):
    if not blob:
        return None
    try:
        return json.loads(blob)
    except (json.JSONDecodeError, TypeError):
        return None
