"""
Run normal, duplicate, large and invalid PDFs through the candidate build.

This is the week 7 demonstration, and it fails if the build stops being safe to
hand over. The inputs are read-only copies, so a build that tried to write to a
source would be caught. In one import, and then a rerun of it, it checks that:

  outcomes     every file lands as manifest.json labels it, and the same bytes
               under a second name become one document with an alias
  confirmed    rejected files stop the seal until the user confirms them
  sealed       the run passes a deep verify, which reads every document again
  provenance   the first, middle and last chunk of each document trace back to
               the staged PDF, its page and its offsets (tests/test_pipeline.py
               traces every chunk of the full corpus)
  rerun        the same inputs reuse the sealed run under the same run ID, and a
               leftover from a killed import is removed along the way
  sources      every input keeps its bytes, size, modified time and mode, and
               nothing new appears beside them
  root         only the run, the lock and the journal stay behind

Usage:
  python3 tools/candidate_run.py           # writes perf/candidate.json and perf/CANDIDATE.md
  python3 tools/candidate_run.py --check   # writes nothing; exit 1 if any check fails
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import resource
import shutil
import sys
import tempfile
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from src import pipeline as P

PERF = ROOT / 'perf'
NORMAL = 'fixtures/normal/normal_nrc_reactor_concepts_ch01.pdf'
DUPLICATE_NAME = 'same_bytes_under_another_name.pdf'
# (kind, fixture). A label of decision_required has no outcome to check against;
# those two are here because they are damaged and protected inputs that must stay untouched.
INPUTS = [
    ('normal', NORMAL),
    ('large', 'fixtures/large/large_doe_nuclear_physics_v1_original.pdf'),
    ('large', 'fixtures/oversized/oversized_1200_pages.pdf'),
    ('invalid', 'fixtures/corrupt/corrupt_truncated_50pct.pdf'),
    ('invalid', 'fixtures/corrupt/corrupt_header_only.pdf'),
    ('invalid', 'fixtures/corrupt/corrupt_empty.pdf'),
    ('invalid', 'fixtures/corrupt/corrupt_bad_xref.pdf'),
    ('invalid', 'fixtures/protected/protected_user_password.pdf'),
    ('invalid', 'fixtures/protected/protected_owner_password_no_extract.pdf'),
    ('invalid', 'fixtures/scanned/scanned_no_text_layer.pdf'),
    ('invalid', 'fixtures/nonpdf/nonpdf_zip_container_renamed.pdf'),
    ('invalid', 'fixtures/nonpdf/nonpdf_plaintext_renamed.pdf'),
]


def _tree_bytes(path: Path) -> int:
    total = 0
    for folder, _, files in os.walk(path):
        for name in files:
            try:
                total += os.lstat(os.path.join(folder, name)).st_size
            except OSError:                    # removed while it was being walked
                pass
    return total


class _DiskPeak:
    """Samples a folder's size while the block runs. Sampled, so a slight underestimate."""

    def __init__(self, path: Path):
        self.path, self.peak, self._done = path, 0, threading.Event()

    def _sample(self) -> None:
        while not self._done.wait(0.05):
            self.peak = max(self.peak, _tree_bytes(self.path))

    def __enter__(self) -> '_DiskPeak':
        self._thread = threading.Thread(target=self._sample, daemon=True)
        self._thread.start()
        return self

    def __exit__(self, *exc) -> None:
        self._done.set()
        self._thread.join()
        self.peak = max(self.peak, _tree_bytes(self.path))


def _snapshot(folder: Path) -> dict:
    return {p.name: (hashlib.sha256(p.read_bytes()).hexdigest(), p.stat().st_size,
                     p.stat().st_mtime_ns, p.stat().st_mode) for p in sorted(folder.iterdir())}


def _mb(size: int) -> float:
    return round(size / 2**20, 1)


def run_candidate(work: Path) -> dict:
    labels = {f['path']: f for f in json.loads((ROOT / 'manifest.json').read_text())['fixtures']}
    sources, root = work / 'sources', work / 'import'
    sources.mkdir()
    kinds = {}
    for kind, fixture in INPUTS:
        shutil.copy2(ROOT / fixture, sources / Path(fixture).name)
        kinds[Path(fixture).name] = kind
    shutil.copy2(ROOT / NORMAL, sources / DUPLICATE_NAME)
    kinds[DUPLICATE_NAME] = 'duplicate'
    paths = sorted(sources.iterdir())
    for path in paths:
        os.chmod(path, 0o444)
    os.chmod(sources, 0o555)

    checks: list[dict] = []
    def check(name: str, ok: bool, detail: str) -> None:
        checks.append({'check': name, 'ok': bool(ok), 'detail': detail})

    try:
        before = _snapshot(sources)
        started = time.perf_counter()
        with _DiskPeak(root) as first_disk:
            review = P.prepare(paths, root)
            try:
                P.commit(review)
                refused = False
            except P.ConfirmationRequired:
                refused = not list((root / 'runs').glob('run_*'))
            run = P.commit(review, acknowledge_rejections=review.confirmation_token)
        import_seconds = time.perf_counter() - started
        check('confirmed', refused, f'{review.totals["rejected"]} rejected files stopped the seal until confirmed')

        # Outcomes, against the labels.
        rows = {c.source_filename: c for c in review.candidates}
        wrong, table = [], []
        for kind, fixture in INPUTS:
            name, label = Path(fixture).name, labels[fixture]
            row = rows[name]
            table.append({'file': name, 'kind': kind, 'label': label['expected_outcome'],
                          'disposition': row.disposition, 'reject_reason': row.reject_reason})
            if label['expected_outcome'] == 'accept' and not row.disposition.startswith('accepted'):
                wrong.append(name)
            if label['expected_outcome'] == 'reject' and (
                    row.disposition != 'rejected' or row.reject_reason != label['reject_reason']):
                wrong.append(name)
        twin = rows[DUPLICATE_NAME]
        table.append({'file': DUPLICATE_NAME, 'kind': 'duplicate', 'label': 'duplicate of the normal file',
                      'disposition': twin.disposition, 'reject_reason': twin.reject_reason})
        check('outcomes', not wrong, f'{len(table)} files as labelled' if not wrong else f'wrong: {wrong}')
        same = [d for d in run.manifest['documents'] if d['source_filename'] == Path(NORMAL).name
                or DUPLICATE_NAME in (d['source_filename'], *d['aliases'])]
        check('duplicate', twin.disposition != 'rejected' and len(same) == 1
              and run.manifest['totals']['duplicates'] == 1,
              f'one document for two names; alias {same[0]["aliases"] if same else same}')

        verified = P.verify(run.path, deep=True)
        passed = sum(c['ok'] for c in verified.checks)
        check('sealed', verified.ok, f'deep verify {passed}/{len(verified.checks)}, run {run.run_id}')

        traced, broken = 0, []
        keys = ('staged_sha256_matches', 'text_checksum_matches', 'stream_slice_matches', 'stream_sha256_matches')
        for doc in run.manifest['documents']:
            for ordinal in sorted({0, doc['chunk_count'] // 2, doc['chunk_count'] - 1}):
                found = P.trace(run, doc['document_id'], ordinal)
                traced += 1
                if not all(found[k] for k in keys) or not found['spans']:
                    broken.append((doc['source_filename'], ordinal))
        check('provenance', not broken, f'{traced} chunks traced to their page and offsets'
              if not broken else f'broken: {broken}')

        # A rerun, with a killed import's leftover waiting for it.
        dead = root / 'runs' / f'{P.PARTIAL_PREFIX}killed-import'
        shutil.copytree(run.path / 'chunks', dead)
        started = time.perf_counter()
        with _DiskPeak(root) as rerun_disk:
            again = P.ingest(paths, root, acknowledge_rejections=True)
        rerun_seconds = time.perf_counter() - started
        check('rerun', again.reused and again.run_id == run.run_id,
              f'reused {again.run_id}' if again.reused else f'sealed a second run {again.run_id}')
        check('leftover', not dead.exists(), 'a killed import\'s folder was removed by the next import')

        after = _snapshot(sources)
        changed = sorted(k for k in before if after.get(k) != before[k])
        check('sources', after == before and set(after) == {p.name for p in paths},
              f'{len(paths)} read-only files unchanged in bytes, size, modified time and mode'
              if not changed else f'changed: {changed}')

        left = sorted(str(p.relative_to(root)) for p in root.iterdir()) + \
            sorted(f'runs/{p.name}' for p in (root / 'runs').iterdir())
        check('root', left == ['ingest.lock', 'journal.jsonl', 'runs', f'runs/{run.run_id}'],
              'only the run, the lock and the journal' if len(left) == 4 else f'also: {left}')

        return {
            'run_id': run.run_id,
            'pipeline_version': run.manifest['pipeline_version'],
            'totals': {k: run.manifest['totals'][k]
                       for k in ('accepted', 'rejected', 'duplicates', 'pages', 'chunks')},
            'files': table,
            'checks': checks,
            'measured': {
                'import_seconds': round(import_seconds, 2),
                'rerun_seconds': round(rerun_seconds, 2),
                'peak_rss_mb': _mb(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
                                   * (1 if sys.platform == 'darwin' else 1024)),
                'input_mb': _mb(sum(p.stat().st_size for p in paths)),
                'run_mb': _mb(_tree_bytes(run.path)),
                'import_disk_peak_mb': _mb(first_disk.peak),
                'rerun_disk_peak_mb': _mb(rerun_disk.peak),
                'root_after_mb': _mb(_tree_bytes(root)),
            },
            'host': {'platform': platform.platform(terse=True), 'machine': platform.machine(),
                     'python': platform.python_version()},
        }
    finally:
        os.chmod(sources, 0o755)


def _markdown(result: dict) -> str:
    m, t = result['measured'], result['totals']
    lines = [
        '# Candidate build run',
        '',
        f'Written by `python3 tools/candidate_run.py`. Run `{result["run_id"]}`, '
        f'{result["pipeline_version"]}, on {result["host"]["platform"]} ({result["host"]["machine"]}), '
        f'Python {result["host"]["python"]}.',
        '',
        f'{len(result["files"])} files in, {t["accepted"]} accepted, {t["duplicates"]} duplicate, '
        f'{t["rejected"]} rejected; {t["pages"]:,} pages and {t["chunks"]:,} chunks.',
        '',
        '## Checks',
        '',
        '| Check | Result | Detail |',
        '|---|---|---|',
    ]
    lines += [f'| {c["check"]} | {"pass" if c["ok"] else "FAIL"} | {c["detail"]} |' for c in result['checks']]
    lines += [
        '',
        '## Measured',
        '',
        '| Measure | Value |',
        '|---|---|',
        f'| Import, all files | {m["import_seconds"]} s |',
        f'| Rerun, reusing the run | {m["rerun_seconds"]} s |',
        f'| Peak RSS of the whole session | {m["peak_rss_mb"]} MB |',
        f'| Input files | {m["input_mb"]} MB |',
        f'| Sealed run | {m["run_mb"]} MB |',
        f'| Disk peak, import | {m["import_disk_peak_mb"]} MB |',
        f'| Disk peak, rerun | {m["rerun_disk_peak_mb"]} MB |',
        f'| Import root afterwards | {m["root_after_mb"]} MB |',
        '',
        'Times were taken with the disk sampler running, which walks the import root every '
        '50 ms, so they are slower than `perf/week7.json` and only meaningful here. The '
        'session\'s peak RSS includes the deep verify and the traces.',
        '',
        '## Files',
        '',
        '| File | Kind | Label | Outcome | Reason |',
        '|---|---|---|---|---|',
    ]
    lines += [f'| {f["file"]} | {f["kind"]} | {f["label"]} | {f["disposition"]} | {f["reject_reason"] or ""} |'
              for f in result['files']]
    return '\n'.join(lines) + '\n'


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0].strip())
    ap.add_argument('--check', action='store_true', help='write nothing; exit 1 if any check fails')
    args = ap.parse_args(argv)
    with tempfile.TemporaryDirectory(prefix='e2-candidate-') as work:
        result = run_candidate(Path(work))
    for c in result['checks']:
        print(f'  {"PASS" if c["ok"] else "FAIL"}  {c["check"]:<11} {c["detail"]}')
    failed = [c['check'] for c in result['checks'] if not c['ok']]
    print(f'{len(result["checks"]) - len(failed)}/{len(result["checks"])} checks passed; run {result["run_id"]}')
    if not args.check:
        PERF.mkdir(exist_ok=True)
        (PERF / 'candidate.json').write_text(json.dumps(result, indent=2) + '\n')
        (PERF / 'CANDIDATE.md').write_text(_markdown(result))
        print('wrote perf/candidate.json and perf/CANDIDATE.md')
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
