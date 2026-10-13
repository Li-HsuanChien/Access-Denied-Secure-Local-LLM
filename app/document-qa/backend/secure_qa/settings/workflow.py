"""Persistent general-knowledge preference; readiness is supplied by live health checks."""

from __future__ import annotations

import sqlite3
from pathlib import Path


class Settings:
    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with sqlite3.connect(self.path) as db:
            db.execute("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
            db.execute("INSERT OR IGNORE INTO settings VALUES ('general_knowledge','true')")

    def read(self) -> dict:
        with sqlite3.connect(self.path) as db:
            value = db.execute("SELECT value FROM settings WHERE key='general_knowledge'").fetchone()[0]
        return {"general_knowledge": value == "true"}

    def update(self, *, general_knowledge: bool) -> dict:
        with sqlite3.connect(self.path) as db:
            db.execute("UPDATE settings SET value=? WHERE key='general_knowledge'", ("true" if general_knowledge else "false",))
        return self.read()
