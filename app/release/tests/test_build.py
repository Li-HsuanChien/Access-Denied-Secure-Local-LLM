"""Release inputs reject unsafe real-runtime configurations before assembly."""
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('release_build', Path(__file__).resolve().parents[1] / 'build.py')
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)

ROOT = Path(__file__).resolve().parents[3]
RUNTIME = ROOT / 'app/document-qa/backend/secure_qa/answering/llama_cpp'
EMPTY_SHA = hashlib.sha256(b'').hexdigest()


def write_manifest(folder, model, sha=EMPTY_SHA, tag='b11242', **config):
    manifest = {'model': {'file': model, 'sha256': sha}, 'llama_cpp': {'tag': tag},
                'config': {'parallel': 1, 'host': '127.0.0.1', 'offline': True, **config}}
    (Path(folder) / build.MANIFEST).write_text(json.dumps(manifest))
    return manifest


def lock_for(model, sha=EMPTY_SHA, version='b11242'):
    return {'answering': {'name': model, 'sha256': sha}, 'runtime': {'version': version}}


class RuntimeReleaseTest(unittest.TestCase):
    """Model, llama.cpp and frozen settings must agree across runtime.toml, the manifest and the asset lock."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        (self.root / 'models').mkdir()
        (self.root / 'models/m.gguf').write_bytes(b'')
        (self.root / 'runtime.toml').write_text('[server]\nhost="127.0.0.1"\n[backend]\nparallel=1\nmodel="m.gguf"\n'
                                                '[security]\noffline=true\n')
        write_manifest(self.root, 'm.gguf')

    def test_matching_release_passes(self):
        self.assertEqual(build.check_runtime_release(self.root, lock_for('m.gguf'), hash_model=True)['model']['file'], 'm.gguf')

    def test_missing_manifest_is_refused(self):
        (self.root / build.MANIFEST).unlink()
        with self.assertRaisesRegex(ValueError, 'docqa-runtime freeze'):
            build.check_runtime_release(self.root, None)

    def refused(self, needle, lock):
        with self.assertRaisesRegex(ValueError, needle):
            build.check_runtime_release(self.root, lock)

    def test_manifest_for_another_model_is_refused(self):
        write_manifest(self.root, 'other.gguf')
        self.refused('runtime.toml model', lock_for('m.gguf'))

    def test_lock_with_other_weights_or_engine_is_refused(self):
        self.refused('answering model', lock_for('m.gguf', sha='0' * 64))
        self.refused('llama.cpp b11300', lock_for('m.gguf', version='b11300'))

    def test_changed_frozen_setting_is_refused(self):
        write_manifest(self.root, 'm.gguf', ctx_size=4096)
        toml = self.root / 'runtime.toml'
        toml.write_text(toml.read_text().replace('parallel=1', 'parallel=1\nctx_size=8192'))
        self.refused('ctx_size', lock_for('m.gguf'))

    def test_modified_weights_are_refused_when_hashing(self):
        (self.root / 'models/m.gguf').write_bytes(b'changed')
        build.check_runtime_release(self.root, None)            # names and settings alone still agree
        with self.assertRaisesRegex(ValueError, 'SHA-256'):
            build.check_runtime_release(self.root, None, hash_model=True)


class RepositoryReleaseConsistencyTest(unittest.TestCase):
    """The committed release inputs agree with each other, so an upgrade can't ship half-done."""

    def test_runtime_toml_manifest_lock_and_shortlist_agree(self):
        lock = json.loads((ROOT / 'app/release/assets.lock.json').read_text(encoding='utf-8'))
        manifest = build.check_runtime_release(RUNTIME, lock)        # runtime.toml + manifest + lock
        shortlist = json.loads((RUNTIME / 'models/shortlist.json').read_text(encoding='utf-8'))
        self.assertEqual(shortlist['llama_cpp']['tag'], lock['runtime']['version'])
        windows = shortlist['llama_cpp']['assets']['windows-x86_64']
        self.assertEqual(windows['sha256'], lock['runtime']['sha256'])
        self.assertTrue(lock['runtime']['url'].endswith('/' + windows['file']))
        pinned = {f['file']: f.get('sha256') for c in shortlist['candidates'] for f in c['files'].values()}
        self.assertEqual(pinned.get(manifest['model']['file']), manifest['model']['sha256'])


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
        write_manifest(self.root, 'test.gguf')

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
