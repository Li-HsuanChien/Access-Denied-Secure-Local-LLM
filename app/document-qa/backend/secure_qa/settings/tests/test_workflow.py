import tempfile
import unittest
from pathlib import Path

from secure_qa.settings import Settings


class SettingsTest(unittest.TestCase):
    def test_general_knowledge_preference_persists_across_instances(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "settings.sqlite3"
            settings = Settings(path)
            settings.update(general_knowledge=False)
            self.assertFalse(Settings(path).read()["general_knowledge"])
