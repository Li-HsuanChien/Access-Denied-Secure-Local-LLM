"""Assemble the real-model native folder and record source/asset provenance."""
from __future__ import annotations

from datetime import datetime, timezone
import json
from pathlib import Path
import shutil
import subprocess
import zipfile

from assets import ROOT, RELEASE, digest


def source_revision() -> dict:
    base = ['git', '-c', f'safe.directory={ROOT.as_posix()}', '-C', str(ROOT)]
    head = subprocess.run([*base, 'rev-parse', 'HEAD'], capture_output=True, text=True, check=True).stdout.strip()
    dirty = bool(subprocess.run([*base, 'status', '--porcelain'], capture_output=True, text=True, check=True).stdout.strip())
    return {'commit': head, 'working_tree_dirty': dirty}


def validate_destination(destination: Path) -> Path:
    destination = destination.resolve()
    dist = (RELEASE / 'dist').resolve()
    if not destination.is_relative_to(dist) or destination == dist:
        raise ValueError('Package output must be a subdirectory of app/release/dist')
    import psutil
    for process in psutil.process_iter(['exe']):
        try:
            path = process.info['exe']
            if path and Path(path).resolve().is_relative_to(destination):
                raise ValueError('The output app is running. Close it or choose a different --output directory.')
        except (psutil.AccessDenied, psutil.NoSuchProcess):
            continue
    return destination


def assemble(binary: Path, payload: Path, destination: Path) -> Path:
    destination = validate_destination(destination)
    profile = json.loads((payload / 'profile.json').read_text(encoding='utf-8'))
    if profile.get('mode') != 'real':
        raise ValueError('A user package must contain the real model, never the demo profile')
    if not binary.is_file():
        raise ValueError('Native executable is missing')
    from build import validate_assets
    validate_assets(payload / 'runtime')
    # Only generated output under dist is replaced. Application data is separate.
    if destination.exists():
        shutil.rmtree(destination)
    destination.mkdir(parents=True)
    shutil.copy2(binary, destination / binary.name)
    shutil.copytree(payload, destination / 'payload')
    notices = destination / 'licenses/Open-WebUI'
    notices.mkdir(parents=True)
    for filename in ('LICENSE', 'LICENSE_NOTICE', 'LICENSE_HISTORY', 'UPSTREAM.md'):
        shutil.copy2(ROOT / 'app/document-qa/frontend' / filename, notices / filename)
    (destination / 'README.txt').write_text(
        'Secure Local DocQA - real local-model preview\n\n'
        'Open secure-local-docqa.exe. Keep this entire folder together.\n'
        'Import PDFs through Library before asking document questions.\n'
        'Qwen3-4B Q4_K_M, llama.cpp and MiniLM are bundled. No runtime downloads.\n', encoding='utf-8')
    report = {
        **source_revision(), 'platform': 'windows-x86_64', 'profile': 'real',
        'version': json.loads((ROOT / 'app/desktop/src-tauri/tauri.conf.json').read_text(encoding='utf-8'))['version'],
        'built_at': datetime.now(timezone.utc).isoformat(), 'production_qualified': False,
        'executable_sha256': digest(destination / binary.name),
        'payload_manifest_sha256': digest(destination / 'payload/checksums.json'),
    }
    lock = destination / 'payload/runtime/assets.lock.json'
    if lock.is_file():
        report['asset_lock_sha256'] = digest(lock)
    (destination / 'provenance.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    return destination


def archive_package(app: Path) -> Path:
    """ZIP64 supports the GGUF's >2 GiB size; do not recompress model weights."""
    archive = app.parent / f'{app.name}.zip'
    partial = archive.with_suffix('.zip.partial')
    try:
        with zipfile.ZipFile(partial, 'w', allowZip64=True, compression=zipfile.ZIP_DEFLATED, compresslevel=1) as bundle:
            for file in sorted(app.rglob('*')):
                if file.is_file():
                    method = zipfile.ZIP_STORED if file.suffix in {'.gguf', '.safetensors'} else zipfile.ZIP_DEFLATED
                    bundle.write(file, f'{app.name}/{file.relative_to(app).as_posix()}', compress_type=method)
        partial.replace(archive)
    finally:
        partial.unlink(missing_ok=True)
    archive.with_suffix('.zip.sha256').write_text(f'{digest(archive)}  {archive.name}\n', encoding='utf-8')
    return archive
