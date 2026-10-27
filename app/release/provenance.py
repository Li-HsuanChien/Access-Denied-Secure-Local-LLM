"""Record exact source and installer hashes; not a release signature."""
import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--commit', required=True)
    args = parser.parse_args()
    installers = list((ROOT / 'app/desktop/src-tauri/target/release/bundle/nsis').glob('*-setup.exe'))
    if not installers:
        raise SystemExit('No installer was produced')
    hashes = {}
    for path in installers:
        with path.open('rb') as source:
            hashes[path.name] = hashlib.file_digest(source, 'sha256').hexdigest()
    report = {'commit': args.commit, 'platform': 'windows-x86_64', 'profile': 'demo',
              'production_qualified': False, 'installers': hashes}
    dest = ROOT / 'app/release/reports/provenance.json'
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(report, indent=2), encoding='utf-8')


if __name__ == '__main__':
    main()
