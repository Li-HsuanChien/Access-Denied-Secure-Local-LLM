"""
Tests for the corpus ingest (tools/ingest_corpus.py), against the week 5
acceptance criteria: the corpus completes with explainable rejects, counts and
checksums are recorded, and a rerun produces consistent output.

The oracle for "consistent" is the committed output in corpus/out/: a fresh
ingest into an empty directory must reproduce it byte for byte. So a change to
extraction or chunking that moves any chunk fails here until the outputs are
regenerated, and the regeneration shows up in review as a diff.

Run:  python3 tests/test_corpus.py
"""
from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / 'tools'))

import ingest_corpus as C
from src import pipeline as P
from src.validation import RejectReason

P._silence_mupdf()
CORPUS = C.load_corpus()
COMMITTED = {name: (C.OUT / name).read_bytes() for name in ('manifest.json', 'summary.json', 'SUMMARY.md')}
SUMMARY = json.loads(COMMITTED['summary.json'])


def test_a_fresh_run_reproduces_the_committed_outputs():
    """Rerun produces consistent output: a new directory, the same bytes."""
    with tempfile.TemporaryDirectory() as scratch:
        fresh = C.outputs(CORPUS, Path(scratch))
    differ = [name for name in COMMITTED if fresh[name] != COMMITTED[name]]
    assert not differ, (f'a fresh ingest differs from corpus/out/ in {differ}; '
                        f'rerun python3 tools/ingest_corpus.py and review the diff')
    return (f'{SUMMARY["run_id"]} reproduced in a fresh directory: '
            f'manifest, summary and SUMMARY.md byte-identical')


def test_ingesting_twice_into_one_root_reuses_the_sealed_run():
    with tempfile.TemporaryDirectory() as scratch:
        first, _ = C.ingest(CORPUS, Path(scratch))
        second, _ = C.ingest(CORPUS, Path(scratch))
        assert second.run_id == first.run_id and second.reused, 'the second ingest sealed a new run'
        assert P.list_runs(scratch) == [first.run_id], P.list_runs(scratch)
    return f'the second ingest resolves to {first.run_id}; one sealed run on disk'


def test_every_reject_is_explained():
    """Each reject names a reason from the SDD vocabulary, the check that failed, and why."""
    vocabulary = {r.value for r in RejectReason}
    expected = {e['sha256']: e for e in CORPUS['intake_checks']}
    assert len(SUMMARY['rejects']) == len(expected), 'a reject is missing, or an extra file was rejected'
    for r in SUMMARY['rejects']:
        assert r['reject_reason'] in vocabulary, r
        assert r['reject_reason'] == expected[r['checksum_sha256']]['expected_reject_reason'], r
        assert r['failed_check'] and r['reject_detail'], f'{r["source_filename"]}: unexplained reject'
    reasons = sorted({r['reject_reason'] for r in SUMMARY['rejects']})
    return f'{len(SUMMARY["rejects"])} rejects, each with a reason, a failed check and a detail: {reasons}'


def test_rejected_files_never_reach_the_run():
    with tempfile.TemporaryDirectory() as scratch:
        run, verification = C.ingest(CORPUS, Path(scratch))
        assert verification.ok, verification.failed()
        staged = {p.name for p in (run.path / 'sources').iterdir()}
        chunk_files = {p.name for p in (run.path / 'chunks').iterdir()}
    accepted = {d['document_id'] for d in SUMMARY['documents']}
    assert staged == {f'{d}.pdf' for d in accepted}, staged
    assert chunk_files == {f'{d}.jsonl' for d in accepted}, chunk_files
    return (f'{len(accepted)} staged PDFs and {len(chunk_files)} chunk files, all accepted documents; '
            f'0 from the {len(SUMMARY["rejects"])} rejects')


def test_counts_and_checksums_are_recorded():
    """The summary's totals add up from its rows, and agree with the sealed manifest."""
    manifest = json.loads(COMMITTED['manifest.json'])
    t, docs = SUMMARY['totals'], SUMMARY['documents']
    assert t['accepted'] == len(docs) == len(CORPUS['documents'])
    assert t['rejected'] == len(SUMMARY['rejects'])
    assert t['files'] == t['accepted'] + t['rejected'] + t['duplicates']
    assert t['pages'] == sum(d['pages'] for d in docs) == sum(e['pages'] for e in CORPUS['documents'])
    assert t['chunks'] == sum(d['chunks'] for d in docs) == manifest['totals']['chunks']
    assert SUMMARY['run_id'] == manifest['seal']['run_id'] == 'run_' + SUMMARY['manifest_sha256'][:16]
    assert SUMMARY['chunk_set_sha256'] == manifest['integrity']['chunk_set_sha256']
    listed = {e['sha256'] for e in CORPUS['documents']}
    assert {d['checksum_sha256'] for d in docs} == listed, 'the run holds other bytes than the corpus lists'
    for d in docs:
        assert len(d['checksum_sha256']) == len(d['text_sha256']) == len(d['chunk_set_sha256']) == 64, d
    return (f'{t["accepted"]} documents, {t["pages"]} pages and {t["chunks"]} chunks add up; '
            f'source, text and chunk-set checksums recorded for each')


TESTS = [v for k, v in sorted(globals().items()) if k.startswith('test_')]

if __name__ == '__main__':
    failed = 0
    for fn in TESTS:
        try:
            detail = fn()
            print(f'  PASS  {fn.__name__}\n        {detail}')
        except AssertionError as e:
            failed += 1
            print(f'  FAIL  {fn.__name__}\n        {str(e)[:900]}')
        except Exception as e:
            failed += 1
            print(f'  ERROR {fn.__name__}\n        {type(e).__name__}: {e}')
    print(f'\n{len(TESTS) - failed}/{len(TESTS)} passed')
    sys.exit(1 if failed else 0)
