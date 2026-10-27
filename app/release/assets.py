"""Connected build-machine asset preparation. Never imported by the installed app."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import time
import tomllib
import urllib.error
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[2]
RELEASE = ROOT / 'app/release'
LOCK = RELEASE / 'assets.lock.json'
RUNTIME = ROOT / 'app/document-qa/backend/secure_qa/answering/llama_cpp'


def digest(path: Path) -> str:
    with path.open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def fetch_file(url: str, target: Path, expected: str, *, offline=False, local: Path | None = None) -> Path:
    """Only publish a complete checksum-matching asset; cached files are reverified."""
    if not re.fullmatch(r'[a-f0-9]{64}', expected) or not url.startswith('https://'):
        raise ValueError('Build assets require HTTPS and a pinned SHA-256')
    if target.is_file() and digest(target) == expected:
        return target
    target.parent.mkdir(parents=True, exist_ok=True)
    partial = target.with_name(target.name + '.partial')
    try:
        if local and local.is_file() and digest(local) == expected:
            print(f'Reusing verified local asset: {local.name}', flush=True)
            shutil.copyfile(local, partial)
        elif offline:
            raise ValueError(f'Missing or modified cached asset: {target.name}; prepare assets online first')
        else:
            print(f'Downloading pinned build asset: {target.name}', flush=True)
            for attempt in range(3):
                try:
                    req = urllib.request.Request(url, headers={'User-Agent': 'secure-docqa-build'})
                    with urllib.request.urlopen(req, timeout=60) as response, partial.open('wb') as dest:
                        shutil.copyfileobj(response, dest, length=1024 * 1024)
                    break
                except (OSError, urllib.error.URLError):
                    if attempt == 2:
                        raise
                    time.sleep(2)
        if digest(partial) != expected:
            raise ValueError(f'Build asset checksum mismatch: {target.name}')
        os.replace(partial, target)
        return target
    finally:
        partial.unlink(missing_ok=True)


def unpack_runtime(archive: Path, target: Path) -> None:
    """Extract only the server and its DLLs; reject traversal and ambiguous names."""
    with zipfile.ZipFile(archive) as source:
        selected = {}
        for entry in source.infolist():
            name = entry.filename.replace('\\', '/')
            path = PurePosixPath(name)
            if path.is_absolute() or '..' in path.parts or ':' in name or stat.S_ISLNK(entry.external_attr >> 16):
                raise ValueError('Unsafe runtime archive member')
            if entry.is_dir() or not (path.name.lower().endswith('.dll') or path.name.lower() == 'llama-server.exe'):
                continue
            key = path.name.lower()
            if key in selected:
                raise ValueError('Ambiguous runtime archive member')
            selected[key] = entry
        if 'llama-server.exe' not in selected:
            raise ValueError('Runtime archive does not contain llama-server.exe')
        target.mkdir(parents=True, exist_ok=True)
        for entry in selected.values():
            basename = PurePosixPath(entry.filename.replace('\\', '/')).name
            with source.open(entry) as data, (target / basename).open('wb') as dest:
                shutil.copyfileobj(data, dest)


def prepare_assets(cache: Path, *, offline=False) -> Path:
    lock_bytes = LOCK.read_bytes()
    lock = json.loads(lock_bytes)
    if lock['schema'] != 1 or lock['platform'] != 'windows-x86_64':
        raise ValueError('Unsupported build asset lock')
    key = hashlib.sha256(lock_bytes).hexdigest()
    assets = cache / key / 'runtime'
    assets.mkdir(parents=True, exist_ok=True)
    config = RUNTIME / 'runtime.toml'
    if tomllib.loads(config.read_text(encoding='utf-8'))['backend']['model'] != lock['answering']['name']:
        raise ValueError('runtime.toml and assets.lock.json select different answering models')
    shutil.copy2(config, assets / 'runtime.toml')
    model = lock['answering']
    fetch_file(model['url'], assets / 'models' / model['name'], model['sha256'], offline=offline,
               local=RUNTIME / 'models' / model['name'])
    runtime = lock['runtime']
    archive = fetch_file(runtime['url'], cache / key / 'runtime.zip', runtime['sha256'], offline=offline)
    unpack_runtime(archive, assets / 'bin')
    embedding = lock['embedding']
    for filename, expected in embedding['files'].items():
        path = PurePosixPath(filename)
        if path.is_absolute() or '..' in path.parts or '\\' in filename or ':' in filename:
            raise ValueError('Unsafe embedding asset path')
        url = f'https://huggingface.co/{embedding["repository"]}/resolve/{embedding["revision"]}/{filename}'
        fetch_file(url, assets / 'embedding' / filename, expected, offline=offline)
    shutil.copy2(LOCK, assets / 'assets.lock.json')
    print(f'Verified real-model assets: {assets}', flush=True)
    return assets


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache', type=Path, default=RELEASE / 'build/asset-cache')
    parser.add_argument('--offline', action='store_true')
    args = parser.parse_args()
    prepare_assets(args.cache.resolve(), offline=args.offline)


if __name__ == '__main__':
    main()
