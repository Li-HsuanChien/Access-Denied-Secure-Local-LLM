"""Build the desktop's complete local Python payload; no model downloads.

Run with the project Python environment from any directory. The same command is
used by GitHub Actions. --assets is required for --profile real.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tomllib

ROOT = Path(__file__).resolve().parents[2]
RELEASE = ROOT / 'app/release'
PAYLOAD = ROOT / 'app/desktop/src-tauri/resources'


def validate_assets(assets: Path) -> dict:
    config = tomllib.loads((assets / 'runtime.toml').read_text(encoding='utf-8'))
    if config.get('server', {}).get('host') != '127.0.0.1' or config.get('server', {}).get('allow_remote', False):
        raise ValueError('Runtime must bind only to 127.0.0.1')
    if config.get('security', {}).get('offline') is not True:
        raise ValueError('Runtime must be offline')
    backend = config.get('backend', {})
    if backend.get('parallel') != 1 or backend.get('extra_args'):
        raise ValueError('Runtime must use one slot and no extra CLI overrides')
    model = backend.get('model', '')
    if not model or Path(model).name != model or not (assets / 'models' / model).is_file():
        raise ValueError('Stage the configured GGUF under models/')
    if not (assets / 'embedding/modules.json').is_file():
        raise ValueError('Stage the complete embedding model under embedding/')
    binary = 'llama-server.exe' if sys.platform == 'win32' else 'llama-server'
    if not (assets / 'bin' / binary).is_file():
        raise ValueError(f'Stage bin/{binary} and its native dependencies')
    lock = assets / 'assets.lock.json'
    check_runtime_release(assets, json.loads(lock.read_text(encoding='utf-8')) if lock.is_file() else None)
    return config


MANIFEST = 'release-manifest.json'


def check_runtime_release(runtime: Path, lock: dict | None, *, hash_model: bool = False) -> dict:
    """The runtime's frozen release (E1's release-manifest.json) must describe exactly what this build ships.

    It must name the model file runtime.toml configures and, when the asset lock is present, the lock's model
    SHA-256 and llama.cpp version; its frozen settings must match runtime.toml. Upgrading the model, llama.cpp or a
    frozen setting therefore needs runtime.toml, assets.lock.json and `docqa-runtime freeze` in the same change.
    """
    path = runtime / MANIFEST
    if not path.is_file():
        raise ValueError(f'Stage {MANIFEST} (the runtime\'s frozen release, written by `docqa-runtime freeze`) '
                         'beside runtime.toml')
    manifest = json.loads(path.read_text(encoding='utf-8'))
    config = tomllib.loads((runtime / 'runtime.toml').read_text(encoding='utf-8'))
    settings = {**config.get('server', {}), **config.get('backend', {}), **config.get('security', {})}
    model = manifest['model']
    problems = []
    if settings.get('model') != model['file']:
        problems.append(f"runtime.toml model is {settings.get('model')!r}, the manifest froze {model['file']!r}")
    if lock is not None:
        if lock['answering']['name'] != model['file'] or lock['answering']['sha256'] != model['sha256']:
            problems.append('assets.lock.json answering model/SHA-256 differ from the manifest')
        if lock['runtime']['version'] != manifest['llama_cpp'].get('tag'):
            problems.append(f"assets.lock.json ships llama.cpp {lock['runtime']['version']}, "
                            f"the manifest froze {manifest['llama_cpp'].get('tag')}")
    drift = sorted(k for k, v in manifest.get('config', {}).items() if k in settings and settings[k] != v)
    if drift:
        problems.append('runtime.toml differs from the frozen settings: ' + ', '.join(drift))
    if hash_model and not problems:
        staged = runtime / 'models' / model['file']
        with staged.open('rb') as source:
            if hashlib.file_digest(source, 'sha256').hexdigest() != model['sha256']:
                problems.append(f"{staged.name} does not match the manifest SHA-256")
    if problems:
        raise ValueError('Runtime release manifest does not match this build: ' + '; '.join(problems) +
                         '. Re-run `docqa-runtime freeze` and update assets.lock.json in the same change.')
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--profile', choices=['demo', 'real'], default='real')
    parser.add_argument('--assets', type=Path)
    args = parser.parse_args()
    if args.profile == 'real':
        if args.assets is None:
            parser.error('--profile real requires --assets')
        config = validate_assets(args.assets)
    # The destination is constant and verified before any recursive cleanup.
    if PAYLOAD.resolve().parent != (ROOT / 'app/desktop/src-tauri').resolve():
        raise RuntimeError('Unsafe payload destination')
    env = {**os.environ, 'DOCQA_BUILD_PROFILE': args.profile}
    subprocess.run([sys.executable, '-m', 'PyInstaller', '--noconfirm', '--clean',
        '--distpath', str(RELEASE / 'dist'), '--workpath', str(RELEASE / 'build'),
        str(RELEASE / 'docqa-service.spec')], cwd=ROOT, env=env, check=True)
    if PAYLOAD.exists():
        shutil.rmtree(PAYLOAD)
    shutil.copytree(RELEASE / 'dist/host', PAYLOAD / 'host')
    if args.profile == 'real':
        shutil.copytree(args.assets, PAYLOAD / 'runtime')
        # Logs belong in user data, never the installed resource directory.
        # The gateway accepts overrides only for select flags, so stage a template;
        # the desktop entry resolves this sentinel before loading the config.
        config['output'] = {'runs_dir': '__DOCQA_USER_DATA__'}
        text = (PAYLOAD / 'runtime/runtime.toml').read_text(encoding='utf-8')
        import re
        text = re.sub(r'(?m)^runs_dir\s*=.*$', 'runs_dir = "__DOCQA_USER_DATA__"', text)
        if '[output]' not in text:
            text += '\n[output]\nruns_dir = "__DOCQA_USER_DATA__"\n'
        (PAYLOAD / 'runtime/runtime.toml').write_text(text, encoding='utf-8')
    (PAYLOAD / 'profile.json').write_text(json.dumps({'mode': args.profile, 'development_preview': True}), encoding='utf-8')
    files = {}
    for path in sorted(PAYLOAD.rglob('*')):
        if path.is_file():
            with path.open('rb') as source:
                files[path.relative_to(PAYLOAD).as_posix()] = hashlib.file_digest(source, 'sha256').hexdigest()
    (PAYLOAD / 'checksums.json').write_text(json.dumps(files, indent=2), encoding='utf-8')
    print(f'Staged {args.profile} development payload at {PAYLOAD}')


if __name__ == '__main__':
    main()
