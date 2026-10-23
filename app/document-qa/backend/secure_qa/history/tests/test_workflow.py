import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from secure_qa.history import ConversationHistory


class ConversationHistoryTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.history = ConversationHistory(Path(self.temp.name) / "history.sqlite3")

    def tearDown(self):
        self.history.close()
        self.temp.cleanup()

    def test_saved_answers_keep_model_and_collection_versions_and_can_be_opened(self):
        answer = {"question": "What is local?", "model": {"model_id": "m1"}, "collection_version": "v3"}
        self.history.save("c1", "Question", answer)
        self.assertEqual(self.history.list()[0]["conversation_id"], "c1")
        self.assertEqual(self.history.open("c1")["answer"], answer)

    def test_disabling_persistence_prevents_saves_and_clear_removes_records(self):
        self.history.set_enabled(False)
        self.assertFalse(self.history.save("c1", "Question", {"collection_version": "v1"}))
        self.history.set_enabled(True)
        self.history.save("c1", "Question", {"collection_version": "v1"})
        self.history.clear()
        self.assertEqual(self.history.list(), [])

    def test_delete_removes_one_conversation(self):
        self.history.save("c1", "one", {"collection_version": "v1"})
        self.history.save("c2", "two", {"collection_version": "v2"})
        self.history.delete("c1")
        self.assertEqual([row["conversation_id"] for row in self.history.list()], ["c2"])

    def test_append_turn_builds_an_ordered_thread_and_names_it_from_the_first_user_turn(self):
        self.history.append_turn("t1", "user", "What is the dose limit?")
        self.history.append_turn("t1", "assistant", "", answer={"question": "What is the dose limit?",
                                                                 "model": {"model_id": "m1"}, "collection_version": "v3"})
        self.history.append_turn("t1", "user", "And for workers?")
        turns = self.history.recent_turns("t1", limit=10)
        self.assertEqual([t["role"] for t in turns], ["user", "assistant", "user"])
        self.assertEqual(turns[0]["content"], "What is the dose limit?")
        self.assertEqual(turns[1]["answer"]["collection_version"], "v3")
        row = self.history.list()[0]
        self.assertEqual(row["title"], "What is the dose limit?")
        self.assertEqual(row["model_id"], "m1")
        self.assertEqual(row["collection_version"], "v3")

    def test_recent_turns_window_keeps_the_latest_in_chronological_order(self):
        for i in range(5):
            self.history.append_turn("t1", "user", f"q{i}")
        self.assertEqual([t["content"] for t in self.history.recent_turns("t1", limit=2)], ["q3", "q4"])

    def test_summary_round_trips_and_open_returns_messages_and_latest_answer(self):
        self.history.append_turn("t1", "user", "q1")
        self.history.append_turn("t1", "assistant", "", answer={"question": "q1", "status": "answered"})
        self.history.set_summary("t1", "User asked q1; answered.")
        self.assertEqual(self.history.get_summary("t1"), "User asked q1; answered.")
        opened = self.history.open("t1")
        self.assertEqual(opened["summary"], "User asked q1; answered.")
        self.assertEqual(len(opened["messages"]), 2)
        self.assertEqual(opened["answer"]["status"], "answered")

    def test_disabled_persistence_blocks_append(self):
        self.history.set_enabled(False)
        self.assertFalse(self.history.append_turn("t1", "user", "q1"))
        self.assertEqual(self.history.list(), [])

    def test_migrates_legacy_single_answer_schema(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        path = Path(temp.name) / "legacy.sqlite3"
        legacy = sqlite3.connect(path)
        legacy.executescript("""
            CREATE TABLE preferences (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE conversations (conversation_id TEXT PRIMARY KEY, title TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, model_id TEXT, collection_version TEXT, answer_json TEXT NOT NULL);
            INSERT INTO preferences VALUES ('enabled','true');
        """)
        legacy.execute("INSERT INTO conversations (conversation_id,title,model_id,collection_version,answer_json) VALUES (?,?,?,?,?)",
                       ("old1", "Legacy question", "m0", "v1", json.dumps({"question": "Legacy question", "status": "answered"})))
        legacy.commit()
        legacy.close()

        migrated = ConversationHistory(path)
        self.addCleanup(migrated.close)
        self.assertEqual(migrated.list()[0]["conversation_id"], "old1")
        opened = migrated.open("old1")
        self.assertEqual(opened["answer"]["question"], "Legacy question")
        self.assertEqual([m["role"] for m in opened["messages"]], ["user", "assistant"])
        self.assertEqual(migrated.get_summary("old1"), "")
