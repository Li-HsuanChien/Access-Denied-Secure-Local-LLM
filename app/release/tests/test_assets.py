"""Build assets cannot become executable payloads without integrity/path checks."""
import hashlib
import io
from pathlib import Path
import stat
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from assets import fetch_file, unpack_runtime
from assemble import archive_package, assemble, validate_destination


class AssetIntegrityTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.target = self.root / 'model.gguf'
        self.content = b'verified-model-bytes'
        self.sha = hashlib.sha256(self.content).hexdigest()

    def test_verified_cache_works_offline(self):
        self.target.write_bytes(self.content)
        with patch('assets.urllib.request.urlopen', side_effect=AssertionError('Must not use network')):
            fetch_file('https://example.invalid/model', self.target, self.sha, offline=True)
        self.assertEqual(self.target.read_bytes(), self.content)

    def test_offline_missing_or_modified_asset_is_refused(self):
        for content in (None, b'corrupt'):
            if content is not None:
                self.target.write_bytes(content)
            with self.assertRaisesRegex(ValueError, 'Missing or modified'):
                fetch_file('https://example.invalid/model', self.target, self.sha, offline=True)

    def test_bad_download_does_not_replace_existing_file_or_leave_partial(self):
        self.target.write_bytes(b'previous')
        with patch('assets.urllib.request.urlopen', return_value=io.BytesIO(b'bad-download')):
            with self.assertRaisesRegex(ValueError, 'checksum mismatch'):
                fetch_file('https://example.invalid/model', self.target, self.sha)
        self.assertEqual(self.target.read_bytes(), b'previous')
        self.assertFalse(self.target.with_name('model.gguf.partial').exists())

    def test_verified_download_is_published(self):
        with patch('assets.urllib.request.urlopen', return_value=io.BytesIO(self.content)):
            fetch_file('https://example.invalid/model', self.target, self.sha)
        self.assertEqual(self.target.read_bytes(), self.content)

    def test_runtime_archive_rejects_unsafe_paths_and_links(self):
        for name in ('../outside.dll', '/outside.dll', 'C:/outside.dll', 'folder\\..\\outside.dll', 'link.dll'):
            with self.subTest(name=name):
                archive = self.root / 'runtime.zip'
                with zipfile.ZipFile(archive, 'w') as bundle:
                    entry = zipfile.ZipInfo(name)
                    if name == 'link.dll':
                        entry.external_attr = (stat.S_IFLNK | 0o777) << 16
                    bundle.writestr(entry, b'bad')
                with self.assertRaisesRegex(ValueError, 'Unsafe'):
                    unpack_runtime(archive, self.root / 'bin')
                self.assertFalse((self.root / 'bin').exists())

    def test_runtime_extracts_server_and_dlls_without_other_programs(self):
        archive = self.root / 'runtime.zip'
        with zipfile.ZipFile(archive, 'w') as bundle:
            bundle.writestr('runtime\\llama-server.exe', b'server')
            bundle.writestr('runtime\\backend.dll', b'library')
            bundle.writestr('runtime\\other.exe', b'other')
        unpack_runtime(archive, self.root / 'bin')
        self.assertEqual({f.name for f in (self.root / 'bin').iterdir()}, {'llama-server.exe', 'backend.dll'})


class PackageBoundaryTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)

    def test_demo_payload_is_rejected_before_existing_app_is_changed(self):
        payload = self.root / 'payload'
        payload.mkdir()
        (payload / 'profile.json').write_text('{"mode":"demo"}')
        destination = self.root / 'dist/app'
        destination.mkdir(parents=True)
        sentinel = destination / 'keep.txt'
        sentinel.write_text('existing')
        with patch('assemble.RELEASE', self.root):
            with self.assertRaisesRegex(ValueError, 'never the demo'):
                assemble(self.root / 'app.exe', payload, destination)
        self.assertEqual(sentinel.read_text(), 'existing')

    def test_output_cannot_replace_dist_root_or_escape_it(self):
        with patch('assemble.RELEASE', self.root):
            for target in (self.root / 'dist', self.root / 'outside', self.root / 'dist/../outside'):
                with self.subTest(target=target), self.assertRaises(ValueError):
                    validate_destination(target)

    def test_archive_roundtrip_preserves_model_and_versioned_folder(self):
        app = self.root / 'DocQA-0.1.0'
        (app / 'payload/models').mkdir(parents=True)
        (app / 'app.exe').write_bytes(b'executable')
        (app / 'payload/models/model.gguf').write_bytes(b'weights')
        archive = archive_package(app)
        self.assertEqual(archive.name, 'DocQA-0.1.0.zip')
        with zipfile.ZipFile(archive) as bundle:
            self.assertEqual(bundle.read('DocQA-0.1.0/payload/models/model.gguf'), b'weights')
        checksum = archive.with_suffix('.zip.sha256').read_text().split()[0]
        self.assertEqual(checksum, hashlib.sha256(archive.read_bytes()).hexdigest())
