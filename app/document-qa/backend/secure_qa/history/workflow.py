"""Conversation persistence. Database details stay private to this module."""

from __future__ import annotations

import json
import sqlite3
import threading
from pathlib import Path


class ConversationHistory:
    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._db = sqlite3.connect(self.path, check_same_thread=False)
        self._db.row_factory = sqlite3.Row
        self._lock = threading.RLock()
        self._db.executescript("""
            CREATE TABLE IF NOT EXISTS preferences (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS conversations (
                conversation_id TEXT PRIMARY KEY, title TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                model_id TEXT, collection_version TEXT, answer_json TEXT NOT NULL
            );
            INSERT OR IGNORE INTO preferences VALUES ('enabled', 'true');
        """)
        self._db.commit()

    def enabled(self) -> bool:
        with self._lock:
            return self._db.execute("SELECT value FROM preferences WHERE key='enabled'").fetchone()[0] == "true"

    def set_enabled(self, enabled: bool) -> None:
        with self._lock, self._db:
            self._db.execute("UPDATE preferences SET value=? WHERE key='enabled'", ("true" if enabled else "false",))

    def save(self, conversation_id: str, title: str, answer: dict) -> bool:
        """Save without changing the caller's current answer; False means persistence is disabled."""
        with self._lock, self._db:
            if not self.enabled():
                return False
            model = answer.get("model") or {}
            self._db.execute("""INSERT INTO conversations
                (conversation_id,title,model_id,collection_version,answer_json) VALUES (?,?,?,?,?)
                ON CONFLICT(conversation_id) DO UPDATE SET title=excluded.title, updated_at=CURRENT_TIMESTAMP,
                model_id=excluded.model_id, collection_version=excluded.collection_version, answer_json=excluded.answer_json""",
                (conversation_id, title, model.get("model_id"), answer.get("collection_version"), json.dumps(answer)))
            return True

    def list(self) -> list[dict]:
        with self._lock:
            return [dict(row) for row in self._db.execute("SELECT conversation_id,title,updated_at,model_id,collection_version FROM conversations ORDER BY updated_at DESC")]

    def open(self, conversation_id: str) -> dict | None:
        with self._lock:
            row = self._db.execute("SELECT * FROM conversations WHERE conversation_id=?", (conversation_id,)).fetchone()
            return dict(row) | {"answer": json.loads(row["answer_json"])} if row else None

    def delete(self, conversation_id: str) -> bool:
        with self._lock, self._db:
            return self._db.execute("DELETE FROM conversations WHERE conversation_id=?", (conversation_id,)).rowcount > 0

    def clear(self) -> None:
        with self._lock, self._db:
            self._db.execute("DELETE FROM conversations")

    def close(self) -> None:
        self._db.close()
