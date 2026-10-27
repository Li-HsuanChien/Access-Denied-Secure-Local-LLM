"""Package the staged local model into a native, portable Windows app. No downloads."""
from __future__ import annotations

import json
from pathlib import Path
import shutil
import subprocess
import sys
import tomllib
from assemble import assemble

ROOT = Path(__file__).resolve().parents[2]
RELEASE = ROOT / 'app/release'
RUNTIME = ROOT / 'app/document-qa/backend/secure_qa/answering/llama_cpp'
ASSETS = RELEASE / 'build/local-model-assets'
DEST = RELEASE / 'dist/Secure-Local-DocQA'


def main():
    config = tomllib.loads((RUNTIME / 'runtime.toml').read_text(encoding='utf-8'))
    model = config['backend']['model']
    if Path(model).name != model:
        raise SystemExit('Configure a staged model filename under the runtime models directory')
    binary = ROOT / 'app/desktop/src-tauri/target/release/secure-local-docqa.exe'
    if not binary.is_file():
        raise SystemExit('Build the native Tauri executable first')
    required = [RUNTIME / 'models' / model, RUNTIME / 'bin/llama-server.exe', ROOT / 'models/all-MiniLM-L6-v2/modules.json']
    for path in required:
        if not path.is_file():
            raise SystemExit(f'Required local asset is missing: {path}')
    ASSETS.mkdir(parents=True, exist_ok=True)
    (ASSETS / 'models').mkdir(exist_ok=True)
    shutil.copy2(RUNTIME / 'runtime.toml', ASSETS / 'runtime.toml')
    shutil.copy2(RUNTIME / 'models' / model, ASSETS / 'models' / model)
    shutil.copytree(RUNTIME / 'bin', ASSETS / 'bin', dirs_exist_ok=True)
    shutil.copytree(ROOT / 'models/all-MiniLM-L6-v2', ASSETS / 'embedding', dirs_exist_ok=True)
    subprocess.run([sys.executable, str(RELEASE / 'build.py'), '--profile', 'real', '--assets', str(ASSETS)], check=True)
    assemble(binary, ROOT / 'app/desktop/src-tauri/resources', DEST)
    print(json.dumps({'application': str(DEST / binary.name), 'model': model, 'profile': 'real'}, indent=2))


if __name__ == '__main__':
    main()
