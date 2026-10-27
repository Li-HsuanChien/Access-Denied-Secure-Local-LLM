"""Release inputs reject unsafe real-runtime configurations before assembly."""
import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('release_build', Path(__file__).resolve().parents[1] / 'build.py')
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)


class AssetValidationTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        for folder in ['bin', 'models', 'embedding']:
            (self.root / folder).mkdir()
        (self.root / 'bin' / ('llama-server.exe' if build.sys.platform == 'win32' else 'llama-server')).touch()
        (self.root / 'models/test.gguf').touch()
        (self.root / 'embedding/modules.json').write_text('[]')
        self.config = '[server]\nhost="127.0.0.1"\n[security]\noffline=true\n[backend]\nparallel=1\nmodel="test.gguf"\n'

    def validate(self, config):
        (self.root / 'runtime.toml').write_text(config)
        return build.validate_assets(self.root)

    def test_local_complete_assets_pass(self):
        self.assertEqual(self.validate(self.config)['backend']['model'], 'test.gguf')

    def test_remote_online_parallel_and_extra_args_are_rejected(self):
        for config in [self.config.replace('127.0.0.1', '0.0.0.0'),
                       self.config.replace('offline=true', 'offline=false'),
                       self.config.replace('parallel=1', 'parallel=2'),
                       self.config + 'extra_args=["--host", "0.0.0.0"]\n',
                       self.config.replace('test.gguf', '../test.gguf')]:
            with self.subTest(config=config), self.assertRaises(ValueError):
                self.validate(config)

    def test_missing_embedding_is_rejected(self):
        (self.root / 'embedding/modules.json').unlink()
        with self.assertRaises(ValueError):
            self.validate(self.config)
