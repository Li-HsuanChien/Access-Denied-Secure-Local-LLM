"""
Old vs new E3 ingest_corpus: identical review, chunks and text; time and parser work.

Run it on a checkout that has E2-Chunking merged into main and the patch applied,
with the unpatched corpus.py saved beside it as secure_qa/library/_corpus_before.py.
Remove that copy afterwards.

  python3 ingestion/integration/e3_bench.py <backend folder> <output.json>

perf/e3_handoff.json holds the recorded result.
"""
import json, statistics, subprocess, sys, time
from pathlib import Path
BACKEND = Path(sys.argv[1]); REPO = BACKEND.parents[2]
FIX = REPO / 'ingestion' / 'fixtures'
REAL = [FIX/'normal'/'normal_nrc_reactor_concepts_ch01.pdf', FIX/'large'/'large_doe_nuclear_physics_v1.pdf',
        FIX/'layout'/'layout_arxiv_two_column_2112.11583.pdf', FIX/'adversarial'/'adversarial_prompt_injection.pdf']
ALL = sorted(FIX.rglob('*.pdf'))
CHILD = r'''
import json, sys, time, hashlib, resource
sys.path.insert(0, sys.argv[1])
which, keep, paths = sys.argv[2], sys.argv[3] == '1', sys.argv[4:]
import pymupdf
counts = {'documents_opened': 0, 'text_pages_built': 0}
_i, _t = pymupdf.Document.__init__, pymupdf.Page.get_textpage
def ci(self, *a, **k):
    counts['documents_opened'] += 1; return _i(self, *a, **k)
def ct(self, *a, **k):
    counts['text_pages_built'] += 1; return _t(self, *a, **k)
pymupdf.Document.__init__, pymupdf.Page.get_textpage = ci, ct
pymupdf.TOOLS.mupdf_display_errors(False); pymupdf.TOOLS.mupdf_display_warnings(False)
import importlib
mod = importlib.import_module('secure_qa.library.' + ('_corpus_before' if which == 'before' else 'corpus'))
t = time.perf_counter()
r = mod.ingest_corpus(paths, keep_text=keep)
secs = time.perf_counter() - t
d = r.to_dict(); d['summary'].pop('elapsed_s', None)
out = {'report': d, 'chunks': [c.__dict__ if hasattr(c, '__dict__') else str(c) for c in r.chunks],
       'documents': r.documents,
       'sources': {k: [hashlib.sha256(v.text.encode()).hexdigest(), v.page_bounds] for k, v in sorted(r.sources.items())},
       'source_paths': {k: str(v) for k, v in r.source_paths.items()}}
blob = json.dumps(out, sort_keys=True, default=str)
print(json.dumps({'seconds': secs, 'work': counts, 'digest': hashlib.sha256(blob.encode()).hexdigest(),
                  'chunks': len(r.chunks), 'rss_mb': resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 2**20}))
'''
def run(which, keep, paths):
    p = subprocess.run([sys.executable, '-c', CHILD, str(BACKEND), which, '1' if keep else '0', *map(str, paths)],
                       capture_output=True, text=True, cwd=BACKEND)
    if p.returncode: raise SystemExit(p.stderr[-3000:])
    return json.loads(p.stdout.strip().splitlines()[-1])
rows = {}
for label, paths in (('real corpus (4 PDFs)', REAL), ('all 16 fixtures', ALL)):
    for keep in (False, True):
        res = {w: [run(w, keep, paths) for _ in range(3)] for w in ('before', 'after')}
        same = len({r['digest'] for w in res for r in res[w]}) == 1
        med = {w: statistics.median(r['seconds'] for r in res[w]) for w in res}
        rss = {w: max(r['rss_mb'] for r in res[w]) for w in res}
        key = f'{label}, keep_text={keep}'
        rows[key] = {'identical_output': same, 'chunks': res['after'][0]['chunks'],
                     'seconds': {w: round(med[w], 3) for w in med}, 'peak_rss_mb': {w: round(rss[w], 1) for w in rss},
                     'work': {w: res[w][0]['work'] for w in res}}
        print(key, json.dumps(rows[key]), flush=True)
Path(sys.argv[2]).write_text(json.dumps(rows, indent=2) + '\n')
