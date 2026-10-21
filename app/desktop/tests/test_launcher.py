"""Focused tests for launcher's frontend install receipt."""

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


LAUNCH_PATH = Path(__file__).resolve().parents[3] / "launch.py"
SPEC = importlib.util.spec_from_file_location("docqa_launcher", LAUNCH_PATH)
launcher = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(launcher)


class FrontendInstallReceiptTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.frontend = Path(self.temp.name)
        (self.frontend / "package.json").write_text('{"name":"qa"}')
        (self.frontend / "package-lock.json").write_text('{"lockfileVersion":3}')
        self.node = "v20.11.1"
        self.platform = "linux"
        self.arch = "x64"

    def tearDown(self):
        self.temp.cleanup()

    def install(self):
        return launcher.ensure_frontend_deps(
            frontend_dir=self.frontend,
            node_version=self.node,
            platform=self.platform,
            architecture=self.arch,
        )

    def packages(self):
        for name in ("react", "react-dom", "vite"):
            path = self.frontend / "node_modules" / name
            path.mkdir(parents=True, exist_ok=True)
            (path / "package.json").write_text("{}")

    def successful_npm_ci(self, *_args, **_kwargs):
        self.packages()

    def test_missing_install_runs_npm_ci_and_records_receipt(self):
        with patch.object(launcher, "run", side_effect=self.successful_npm_ci) as run:
            self.install()
        run.assert_called_once_with(launcher.npm_cmd("ci"), cwd=self.frontend)
        receipt = self.frontend / "node_modules" / launcher.INSTALL_RECEIPT
        self.assertTrue(receipt.is_file())
        self.assertEqual(list(receipt.parent.glob(".launcher-receipt-*")), [])
        self.assertEqual(json.loads(receipt.read_text())["fingerprint"], launcher.install_fingerprint(
            self.frontend, self.node, self.platform, self.arch
        ))

    def test_existing_legacy_modules_without_receipt_reinstall(self):
        self.packages()
        with patch.object(launcher, "run", side_effect=self.successful_npm_ci) as run:
            self.install()
        run.assert_called_once()

    def test_matching_receipt_skips_network_install(self):
        self.packages()
        receipt = self.frontend / "node_modules" / launcher.INSTALL_RECEIPT
        receipt.parent.mkdir(parents=True, exist_ok=True)
        receipt.write_text(json.dumps({"format": launcher.INSTALL_RECEIPT_FORMAT,
                                      "fingerprint": launcher.install_fingerprint(
                                          self.frontend, self.node, self.platform, self.arch)}))
        with patch.object(launcher, "run", side_effect=self.successful_npm_ci) as run:
            self.install()
        run.assert_not_called()

    def test_manifest_lock_node_platform_or_arch_change_reinstalls(self):
        self.packages()
        with patch.object(launcher, "run", side_effect=self.successful_npm_ci):
            self.install()
        changes = (
            lambda: (self.frontend / "package.json").write_text('{"name":"changed"}'),
            lambda: (self.frontend / "package-lock.json").write_text('{"lockfileVersion":2}'),
            lambda: setattr(self, "node", "v22.1.0"),
            lambda: setattr(self, "platform", "darwin"),
            lambda: setattr(self, "arch", "arm64"),
        )
        for change in changes:
            change()
            with self.subTest(change=change), patch.object(launcher, "run", side_effect=self.successful_npm_ci) as run:
                self.install()
                run.assert_called_once()
            with patch.object(launcher, "run", side_effect=self.successful_npm_ci):
                self.install()

    def test_node_patch_and_minor_versions_with_same_major_keep_receipt(self):
        self.packages()
        with patch.object(launcher, "run", side_effect=self.successful_npm_ci):
            self.install()
        self.node = "v20.19.4"
        with patch.object(launcher, "run") as run:
            self.install()
        run.assert_not_called()

    def test_missing_required_package_reinstalls(self):
        self.packages()
        with patch.object(launcher, "run", side_effect=self.successful_npm_ci):
            self.install()
        (self.frontend / "node_modules" / "vite").rename(self.frontend / "node_modules" / "vite-missing")
        with patch.object(launcher, "run", side_effect=self.successful_npm_ci) as run:
            self.install()
        run.assert_called_once()

    def test_failed_install_removes_stale_receipt(self):
        self.packages()
        with patch.object(launcher, "run", side_effect=self.successful_npm_ci):
            self.install()
        receipt = self.frontend / "node_modules" / launcher.INSTALL_RECEIPT
        (self.frontend / "package.json").write_text('{"name":"changed"}')
        with patch.object(launcher, "run", side_effect=SystemExit(1)):
            with self.assertRaises(SystemExit):
                self.install()
        self.assertFalse(receipt.exists())

    def test_successful_npm_ci_without_required_packages_does_not_write_receipt(self):
        with patch.object(launcher, "run"):
            with self.assertRaises(SystemExit):
                self.install()
        modules = self.frontend / "node_modules"
        self.assertFalse((modules / launcher.INSTALL_RECEIPT).exists())

    def test_atomic_receipt_replace_failure_cleans_temporary_file(self):
        with patch.object(launcher, "run", side_effect=self.successful_npm_ci):
            with patch.object(launcher.os, "replace", side_effect=OSError("replace failed")):
                with self.assertRaises(OSError):
                    self.install()
        modules = self.frontend / "node_modules"
        self.assertFalse((modules / launcher.INSTALL_RECEIPT).exists())
        self.assertEqual(list(modules.glob(".launcher-receipt-*")), [])

    def test_unsupported_node_major_is_rejected_during_prerequisite_check(self):
        with patch.object(launcher, "step"), patch.object(launcher, "ok"), patch.object(launcher, "fail", side_effect=SystemExit(1)):
            with patch.object(launcher.shutil, "which", side_effect=("/node", "/npm")):
                with patch.object(launcher.subprocess, "run", return_value=SimpleNamespace(returncode=0, stdout="v23.0.0")):
                    with self.assertRaises(SystemExit):
                        launcher.check_prerequisites()

    def test_windows_npm_command_construction_is_preserved(self):
        with patch.object(launcher, "IS_WINDOWS", True):
            self.assertEqual(launcher.npm_cmd("ci"), ["cmd", "/c", "npm", "ci"])


if __name__ == "__main__":
    unittest.main()
