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
