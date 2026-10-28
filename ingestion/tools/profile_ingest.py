"""
Profile the import pipeline: time, peak memory, parser work and output, per target.

Week 6 asks for a baseline, an optimization patch, and a before/after
comparison of resource use and output integrity on the same inputs. This is
the instrument for all three. Each target is imported (prepare, commit, then a
deep verify) in a fresh Python process, so a target's peak memory is its own
and not left over from the one before.

For each target it records:

  time      wall seconds per phase (median of --repeat runs) and CPU seconds
  memory    peak resident set size of the process, and the peak of Python's own
            heap (tracemalloc, measured in a separate run because it slows
            everything down)
  work      how many times the parser opened a document and built a text page;
            "repeated parsing" is a number here, not a judgement
  output    pages, chunks, the manifest and chunk-set SHA-256s, and every reject
            with its reason and failed check. Two profiles with the same output
            block produced the same run, byte for byte.
  disk      the sealed run's size by kind of file, the peak under the import root
            during an import and during a rerun, and what the root holds after an
            import that follows a killed one. Measured in a separate process,
            because the sampler thread would disturb the timings.

Targets: the NRC chapter (normal), the arXiv paper (two-column layout), the DOE
handbook in its original typesetting (large), the 1,200-page synthetic file
(oversized), and the whole sample corpus from corpus/corpus.json, which carries
the seven files that must be rejected.

Usage:
  python3 tools/profile_ingest.py --label patched          # writes perf/patched.json
  python3 tools/profile_ingest.py --label baseline --code <ingestion/ of another checkout>
  python3 tools/profile_ingest.py --compare perf/baseline.json perf/patched.json
"""
from __future__ import annotations

import argparse
import json
import os
import platform
import statistics
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PERF = ROOT / 'perf'

TARGETS = {
    'normal': ['fixtures/normal/normal_nrc_reactor_concepts_ch01.pdf'],
    'layout': ['fixtures/layout/layout_arxiv_two_column_2112.11583.pdf'],
    'large': ['fixtures/large/large_doe_nuclear_physics_v1_original.pdf'],
    'oversized': ['fixtures/oversized/oversized_1200_pages.pdf'],
    'corpus': None,                          # every file in corpus/corpus.json
}
DESCRIPTIONS = {
    'normal': 'NRC Reactor Concepts ch. 1',
    'layout': 'arXiv two-column paper',
    'large': 'DOE handbook, original typesetting',
    'oversized': '1,200-page synthetic document',
    'corpus': 'sample corpus: 3 documents and 7 files to reject',
}

# The child process. It imports src/ from the code directory it is given, so
# the same instrument measures any checkout.
CHILD = r'''
import json, os, resource, sys, tempfile, time, tracemalloc
from pathlib import Path
code, traced, paths = sys.argv[1], sys.argv[2] == '1', sys.argv[3:]
sys.path.insert(0, code)
import pymupdf
from src import pipeline as P

counts = {'documents_opened': 0, 'text_pages_built': 0}
_init, _textpage = pymupdf.Document.__init__, pymupdf.Page.get_textpage
def _counted_init(self, *a, **k):
    counts['documents_opened'] += 1
    return _init(self, *a, **k)
def _counted_textpage(self, *a, **k):
    counts['text_pages_built'] += 1
    return _textpage(self, *a, **k)
pymupdf.Document.__init__, pymupdf.Page.get_textpage = _counted_init, _counted_textpage
P._silence_mupdf()

def rss() -> int:
    peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return peak if sys.platform == 'darwin' else peak * 1024     # bytes on macOS, KiB on Linux

work, seconds = {}, {}
with tempfile.TemporaryDirectory(prefix='e2-profile-') as root:
    if traced:
        tracemalloc.start()
    baseline_rss = rss()
    cpu0 = time.process_time()
    t = time.perf_counter()
    review = P.prepare(paths, root)
    seconds['prepare'] = time.perf_counter() - t
    work['prepare'] = dict(counts)
    t = time.perf_counter()
    run = P.commit(review, acknowledge_rejections=review.confirmation_token)
    seconds['commit'] = time.perf_counter() - t
    peak_import = tracemalloc.get_traced_memory()[1] if traced else None
    rss_import = rss()
    before = dict(counts)
    t = time.perf_counter()
    verified = P.verify(run.path, deep=True)
    seconds['verify_deep'] = time.perf_counter() - t
    work['verify_deep'] = {k: counts[k] - before[k] for k in counts}
    cpu = time.process_time() - cpu0
    m = run.manifest
    leftovers = sorted(str(p.relative_to(root)) for p in Path(root).rglob('*')
                       if run.path not in (p, *p.parents) and p != run.path.parent)
    print(json.dumps({
        'seconds': seconds, 'cpu_seconds': cpu,
        'peak_rss_bytes': {'start': baseline_rss, 'after_import': rss_import, 'after_verify': rss()},
        'python_heap_peak_bytes': peak_import,
        'work': work,
        'leftovers': leftovers,
        'output': {
            'run_id': m['seal']['run_id'],
            'manifest_sha256': m['seal']['manifest_sha256'],
            'chunk_set_sha256': m['integrity']['chunk_set_sha256'],
            'verified': verified.ok,
            'checks': f"{sum(c['ok'] for c in verified.checks)}/{len(verified.checks)}",
            'documents': [{'source_filename': d['source_filename'], 'pages': d['page_count'],
                           'chunks': d['chunk_count'], 'text_sha256': d['text_sha256'],
                           'chunk_set_sha256': d['chunk_set_sha256']} for d in m['documents']],
            'rejected': [{'source_filename': r['source_filename'], 'reject_reason': r['reject_reason'],
                          'failed_check': r['failed_check']} for r in m['rejected']],
            'totals': {k: m['totals'][k] for k in ('accepted', 'rejected', 'duplicates', 'pages', 'chunks')},
        },
    }))
'''

DISK_CHILD = r'''
import json, os, shutil, sys, tempfile, threading
from pathlib import Path
code, paths = sys.argv[1], sys.argv[2:]
sys.path.insert(0, code)
from src import pipeline as P

def size(path):
    total = 0
    for folder, _, files in os.walk(path):
        for name in files:
            try:
                total += os.lstat(os.path.join(folder, name)).st_size
            except OSError:                    # removed while it was being walked
                pass
    return total

def imported(root):
    """Import, returning the run and the largest size seen under the root meanwhile."""
    peak, done = [0], threading.Event()
    def sample():
        while not done.wait(0.02):
            peak[0] = max(peak[0], size(root))
    thread = threading.Thread(target=sample, daemon=True)
    thread.start()
    run = P.ingest(paths, root, acknowledge_rejections=True)
    done.set()
    thread.join()
    return run, max(peak[0], size(root))

with tempfile.TemporaryDirectory(prefix='e2-profile-disk-') as root:
    run, peak = imported(root)
    files = {'sources': size(run.path / 'sources'), 'chunks': size(run.path / 'chunks'),
             'extraction': size(run.path / 'extraction')}
    files['other'] = size(run.path) - sum(files.values())
    after = size(root)
    again, rerun_peak = imported(root)
    assert again.reused and again.run_id == run.run_id
    shutil.copytree(run.path, Path(root) / 'runs' / '.partial-20260101T000000Z-1-killed')
    imported(root)
    print(json.dumps({'run': files, 'import_peak': peak, 'root_after_import': after,
                      'rerun_peak': rerun_peak, 'root_after_killed_import': size(root)}))
'''


def _paths(name: str) -> list[str]:
    files = TARGETS[name]
    if files is None:
        corpus = json.loads((ROOT / 'corpus' / 'corpus.json').read_text())
        files = [e['path'] for e in corpus['documents'] + corpus['intake_checks']]
    return [str(ROOT / f) for f in files]


def _child(code: Path, paths: list[str], traced: bool) -> dict:
    done = subprocess.run([sys.executable, '-c', CHILD, str(code), '1' if traced else '0', *paths],
                          capture_output=True, text=True, cwd=tempfile.gettempdir())
    if done.returncode != 0:
        raise SystemExit(f'profiling run failed:\n{done.stderr[-2000:]}')
    return json.loads(done.stdout.strip().splitlines()[-1])


def _disk(code: Path, paths: list[str], repeat: int) -> dict:
    """Sizes do not vary between runs. The peaks are sampled, so keep the highest."""
    runs = []
    for _ in range(repeat):
        done = subprocess.run([sys.executable, '-c', DISK_CHILD, str(code), *paths],
                              capture_output=True, text=True, cwd=tempfile.gettempdir())
        if done.returncode != 0:
            raise SystemExit(f'disk measurement failed:\n{done.stderr[-2000:]}')
        runs.append(json.loads(done.stdout.strip().splitlines()[-1]))
    mb = lambda b: round(b / 2**20, 2)
    return {'run_mb': {k: mb(v) for k, v in runs[0]['run'].items()},
            'import_peak_mb': mb(max(r['import_peak'] for r in runs)),
            'root_after_import_mb': mb(runs[0]['root_after_import']),
            'rerun_peak_mb': mb(max(r['rerun_peak'] for r in runs)),
            'root_after_killed_import_mb': mb(runs[0]['root_after_killed_import'])}


def _revision(code: Path) -> str:
    try:
        rev = subprocess.run(['git', 'rev-parse', '--short', 'HEAD'], cwd=code,
                             capture_output=True, text=True, check=True).stdout.strip()
        dirty = subprocess.run(['git', 'status', '--porcelain', '--', 'src'], cwd=code,
                               capture_output=True, text=True, check=True).stdout.strip()
        return rev + ('+uncommitted src/ changes' if dirty else '')
    except (OSError, subprocess.CalledProcessError):
        return 'unknown'


def profile(code: Path, repeat: int, names: list[str]) -> dict:
    import pymupdf
    out = {
        'code_revision': _revision(code),
        'host': {'platform': platform.platform(terse=True), 'machine': platform.machine(),
                 'python': platform.python_version(), 'pymupdf': pymupdf.VersionBind,
                 'cpus': os.cpu_count()},
        'repeat': repeat,
        'targets': {},
    }
    for name in names:
        paths = _paths(name)
        runs = [_child(code, paths, traced=False) for _ in range(repeat)]
        traced = _child(code, paths, traced=True)
        first = runs[0]
        outputs = {json.dumps(r['output'], sort_keys=True) for r in runs + [traced]}
        phases = first['seconds'].keys()
        out['targets'][name] = {
            'description': DESCRIPTIONS[name],
            'files': len(paths),
            'seconds': {p: round(statistics.median(r['seconds'][p] for r in runs), 3) for p in phases},
            'cpu_seconds': round(statistics.median(r['cpu_seconds'] for r in runs), 3),
            'peak_rss_mb': {
                'after_import': round(max(r['peak_rss_bytes']['after_import'] for r in runs) / 2**20, 1),
                'after_verify': round(max(r['peak_rss_bytes']['after_verify'] for r in runs) / 2**20, 1),
                'interpreter_at_start': round(first['peak_rss_bytes']['start'] / 2**20, 1),
            },
            'python_heap_peak_mb': round(traced['python_heap_peak_bytes'] / 2**20, 1),
            'work': first['work'],
            'leftovers': first['leftovers'],
            'output_identical_across_runs': len(outputs) == 1,
            'output': first['output'],
            'disk': _disk(code, paths, repeat),
        }
        t = out['targets'][name]
        print(f'{name:<10} {t["seconds"]["prepare"] + t["seconds"]["commit"]:6.2f}s import '
              f'{t["seconds"]["verify_deep"]:6.2f}s verify  {t["peak_rss_mb"]["after_import"]:6.1f} MB rss  '
              f'{t["python_heap_peak_mb"]:6.1f} MB heap  {t["output"]["totals"]["chunks"]:>5} chunks',
              flush=True)
    return out


def _pct(before: float, after: float) -> str:
    if not before:
        return 'n/a'
    change = (after - before) / before * 100
    return f'{change:+.0f}%'


def compare(before: dict, after: dict) -> tuple[str, bool]:
    """A markdown report of two profiles, and whether every target's output is identical."""
    lines = [
        f'Before: `{before["code_revision"]}`. After: `{after["code_revision"]}`. '
        f'Medians of {after["repeat"]} runs per target, each in a fresh process, on '
        f'{after["host"]["platform"]} ({after["host"]["machine"]}), Python {after["host"]["python"]}, '
        f'PyMuPDF {after["host"]["pymupdf"]}.',
        '',
        '### Time',
        '',
        '| Target | Pages | Chunks | Import before | Import after | Change | Deep verify before | after | Change |',
        '|---|---|---|---|---|---|---|---|---|',
    ]
    same_all = True
    for name, a in after['targets'].items():
        b = before['targets'].get(name)
        if b is None:
            continue
        ib = b['seconds']['prepare'] + b['seconds']['commit']
        ia = a['seconds']['prepare'] + a['seconds']['commit']
        vb, va = b['seconds']['verify_deep'], a['seconds']['verify_deep']
        lines.append(f'| {name} | {a["output"]["totals"]["pages"]:,} | {a["output"]["totals"]["chunks"]:,} '
                     f'| {ib:.2f} s | {ia:.2f} s | {_pct(ib, ia)} | {vb:.2f} s | {va:.2f} s | {_pct(vb, va)} |')
    lines += ['', '### Memory', '',
              '| Target | Peak RSS before | after | Change | Python heap peak before | after | Change |',
              '|---|---|---|---|---|---|---|']
    for name, a in after['targets'].items():
        b = before['targets'].get(name)
        if b is None:
            continue
        rb, ra = b['peak_rss_mb']['after_import'], a['peak_rss_mb']['after_import']
        hb, ha = b['python_heap_peak_mb'], a['python_heap_peak_mb']
        lines.append(f'| {name} | {rb:.1f} MB | {ra:.1f} MB | {_pct(rb, ra)} '
                     f'| {hb:.1f} MB | {ha:.1f} MB | {_pct(hb, ha)} |')
    start = [t['peak_rss_mb']['interpreter_at_start']
             for profile in (before, after) for t in profile['targets'].values()]
    lines += ['', 'Peak RSS is measured at the end of the import, before the deep verify. '
              f'The interpreter and PyMuPDF alone take {min(start):.0f} to {max(start):.0f} MB of it '
              'before the first file is read, varying from one process to the next, so an RSS '
              'change of a few MB on a small file is noise. The Python heap peak (tracemalloc) '
              'does not vary between runs.',
              '', '### Parser work', '',
              '| Target | Documents opened before | after | Text pages built before | after |',
              '|---|---|---|---|---|']
    for name, a in after['targets'].items():
        b = before['targets'].get(name)
        if b is None:
            continue
        wb, wa = b['work']['prepare'], a['work']['prepare']
        lines.append(f'| {name} | {wb["documents_opened"]} | {wa["documents_opened"]} '
                     f'| {wb["text_pages_built"]:,} | {wa["text_pages_built"]:,} |')
    lines += ['', 'Counted during the import only (prepare and commit). The deep verify '
              'opens and reads every accepted document again, on purpose.',
              '', '### Output integrity', '',
              '| Target | Run ID before | after | Manifest | Chunk set | Rejects | Deep verify |',
              '|---|---|---|---|---|---|---|']
    for name, a in after['targets'].items():
        b = before['targets'].get(name)
        if b is None:
            continue
        ob, oa = b['output'], a['output']
        same = ob == oa
        same_all &= same and a['output_identical_across_runs'] and b['output_identical_across_runs']
        rejects = 'identical' if ob['rejected'] == oa['rejected'] else 'DIFFERENT'
        lines.append(f'| {name} | `{ob["run_id"]}` | `{oa["run_id"]}` '
                     f'| {"identical" if ob["manifest_sha256"] == oa["manifest_sha256"] else "DIFFERENT"} '
                     f'| {"identical" if ob["chunk_set_sha256"] == oa["chunk_set_sha256"] else "DIFFERENT"} '
                     f'| {rejects} ({len(oa["rejected"])}) | {oa["checks"]} |')
    lines += ['', 'The run ID is the first 16 hex digits of the manifest SHA-256, and the '
              'manifest records every document checksum, page table checksum, chunk-file '
              'checksum and the chunk-set digest. The same run ID before and after means '
              'the same chunk IDs, text, offsets, pages and highlight rectangles, and the '
              'same reject verdicts.']
    measured = [n for n, a in after['targets'].items()
                if 'disk' in a and 'disk' in before['targets'].get(n, {})]
    if measured:
        lines += ['', '### Disk', '',
                  '| Target | Sealed run | of which sources | Import peak before | after '
                  '| Rerun peak before | after | Root after a killed import, before | after |',
                  '|---|---|---|---|---|---|---|---|---|']
        for name in measured:
            b, a = before['targets'][name]['disk'], after['targets'][name]['disk']
            lines.append(f'| {name} | {sum(a["run_mb"].values()):.2f} MB | {a["run_mb"]["sources"]:.2f} MB '
                         f'| {b["import_peak_mb"]:.2f} MB | {a["import_peak_mb"]:.2f} MB '
                         f'| {b["rerun_peak_mb"]:.2f} MB | {a["rerun_peak_mb"]:.2f} MB '
                         f'| {b["root_after_killed_import_mb"]:.2f} MB | {a["root_after_killed_import_mb"]:.2f} MB |')
        lines += ['', 'Peaks are sampled about every 20 ms, so they can slightly undercount. '
                  '"Root after a killed import" plants a copy of the run as a leftover attempt, '
                  'then imports again, and measures what remains under the import root.']
    return '\n'.join(lines) + '\n', same_all


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0].strip())
    ap.add_argument('--label', help='name of the profile to write to perf/<label>.json')
    ap.add_argument('--code', type=Path, default=ROOT,
                    help='the ingestion/ folder whose src/ is measured (default: this one)')
    ap.add_argument('--repeat', type=int, default=3)
    ap.add_argument('--targets', nargs='+', choices=list(TARGETS), default=list(TARGETS))
    ap.add_argument('--compare', nargs=2, type=Path, metavar=('BEFORE', 'AFTER'))
    args = ap.parse_args(argv)
    if args.compare:
        report, same = compare(*(json.loads(p.read_text()) for p in args.compare))
        print(report)
        return 0 if same else 1
    if not args.label:
        ap.error('give --label, or --compare BEFORE AFTER')
    result = profile(args.code.resolve(), args.repeat, args.targets)
    PERF.mkdir(exist_ok=True)
    (PERF / f'{args.label}.json').write_text(json.dumps(result, indent=2) + '\n')
    print(f'wrote perf/{args.label}.json')
    return 0


if __name__ == '__main__':
    sys.exit(main())
