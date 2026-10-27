"""Project source -> tested real-model native package. Called locally and by CI."""
from __future__ import annotations

import argparse
import os
from pathlib import Path
import subprocess
import sys

from assets import ROOT, RELEASE, prepare_assets
from assemble import assemble, archive_package, validate_destination


def run(command, *, cwd=ROOT):
    print('Running: ' + ' '.join(map(str, command)), flush=True)
    subprocess.run(list(map(str, command)), cwd=cwd, check=True)


def checks():
    frontend = ROOT / 'app/document-qa/frontend'
    npm = 'npm.cmd' if os.name == 'nt' else 'npm'
    run([npm, 'run', 'check'], cwd=frontend)
    run([npm, 'run', 'test:frontend'], cwd=frontend)
    run([sys.executable, '-m', 'unittest', 'discover', '-s', 'secure_qa', '-t', '.', '-p', 'test_*.py'],
        cwd=ROOT / 'app/document-qa/backend')
    run([sys.executable, '-m', 'unittest', 'discover', '-s', 'app/release/tests', '-v'])
    run(['cargo', 'fmt', '--manifest-path', 'app/desktop/src-tauri/Cargo.toml', '--check'])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=RELEASE / 'dist/Secure-Local-DocQA')
    parser.add_argument('--asset-cache', type=Path, default=RELEASE / 'build/asset-cache')
    parser.add_argument('--offline-assets', action='store_true')
    parser.add_argument('--checks-only', action='store_true')
    parser.add_argument('--skip-checks', action='store_true', help='Local iteration only; CI always runs checks')
    parser.add_argument('--skip-native-test', action='store_true', help='Local iteration only; CI always tests the native app')
    parser.add_argument('--zip', action='store_true', help='Also create a ZIP64 archive and checksum for local sharing')
    args = parser.parse_args()
    if os.name != 'nt':
        parser.error('This packaging target is Windows x64')
    if not args.checks_only:
        args.output = validate_destination(args.output)
    if not args.skip_checks:
        checks()
    if args.checks_only:
        return
    assets = prepare_assets(args.asset_cache.resolve(), offline=args.offline_assets)
    run([sys.executable, RELEASE / 'build.py', '--profile', 'real', '--assets', assets])
    # Build from current source after staging resources; never reuse a stale native executable.
    run(['npm.cmd', 'run', 'build', '--', '--ci', '--no-bundle', '--', '--locked'], cwd=ROOT / 'app/desktop')
    run(['cargo', 'test', '--locked', '--manifest-path', 'app/desktop/src-tauri/Cargo.toml', '--test', 'lifecycle'])
    app = assemble(ROOT / 'app/desktop/src-tauri/target/release/secure-local-docqa.exe',
                   ROOT / 'app/desktop/src-tauri/resources', args.output)
    if not args.skip_native_test:
        run([sys.executable, RELEASE / 'acceptance/real_smoke.py', '--app', app])
    if args.zip:
        print(f'Archive: {archive_package(app)}', flush=True)
    print(f'Real-model native package: {app / "secure-local-docqa.exe"}', flush=True)


if __name__ == '__main__':
    main()
