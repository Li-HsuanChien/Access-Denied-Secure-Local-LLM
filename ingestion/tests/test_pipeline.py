"""
Pipeline tests for the Week 4 E2 deliverable, grouped by the acceptance phrase each one proves:

  A  "Valid files produce manifest + chunks"
  B  "invalid files fail before indexing"
  C  "checksums ... are present"
  D  "source/page provenance are present"
  E  determinism (SDD 2: deterministic operations)
  F  failure handling the SDD names (9, 6.3, 15)
  G  the demo

Run:  python3 tests/test_pipeline.py            (all)
      python3 tests/test_pipeline.py killed     (only tests whose name contains 'killed')
"""
from __future__ import annotations

import ast
import importlib.util
import io
import json
import logging
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from jsonschema import Draft202012Validator
from referencing import Registry, Resource

from src import pipeline as P
from src.ingest import chunks, extract, validate
from src.schema import ChunkerConfig, Document
from src.validation import IngestionPolicy, RejectReason

# In the repository these are ROOT/fixtures and ROOT/manifest.json. The design prototype lives
# outside the repository and reads the fixtures in place.
FIX = Path(os.environ.get('E2_FIXTURES', ROOT / 'fixtures'))
FIXTURE_MANIFEST = Path(os.environ.get('E2_FIXTURE_MANIFEST', FIX.parent / 'manifest.json'))
E3_LIBRARY = Path(os.environ.get('E3_LIBRARY', ROOT.parent / 'no-e3-checkout'))

NORMAL = FIX / 'normal' / 'normal_nrc_reactor_concepts_ch01.pdf'
LARGE = FIX / 'large' / 'large_doe_nuclear_physics_v1.pdf'
ORIGINAL = FIX / 'large' / 'large_doe_nuclear_physics_v1_original.pdf'
ARXIV = FIX / 'layout' / 'layout_arxiv_two_column_2112.11583.pdf'
ADVERSARIAL = FIX / 'adversarial' / 'adversarial_prompt_injection.pdf'
OVERSIZED = FIX / 'oversized' / 'oversized_1200_pages.pdf'
TRUNCATED = FIX / 'corrupt' / 'corrupt_truncated_50pct.pdf'
NOT_PDF = FIX / 'nonpdf' / 'nonpdf_plaintext_renamed.pdf'
LOCKED = FIX / 'protected' / 'protected_user_password.pdf'
ACCEPTING = [NORMAL, LARGE, ORIGINAL, ARXIV]

TMP = Path(tempfile.mkdtemp(prefix='e2-pipeline-tests-'))


def _registry():
    reg = Registry()
    for path in sorted((ROOT / 'schemas').glob('*.schema.json')):
        s = json.loads(path.read_text())
        reg = reg.with_resource(s['$id'], Resource.from_contents(s))
    return reg


REGISTRY = _registry()


def validator_for(name):
    schema = json.loads((ROOT / 'schemas' / f'{name}.schema.json').read_text())
    return Draft202012Validator(schema, registry=REGISTRY)


def fresh(name: str) -> Path:
    path = TMP / name
    shutil.rmtree(path, ignore_errors=True)
    return path


class _Capture(logging.Handler):
    def __init__(self):
        super().__init__()
        self.lines: list[str] = []

    def emit(self, record):
        self.lines.append(record.getMessage())


_CORPUS = {}


def corpus():
    """All 16 fixtures through the pipeline once, with every log line captured."""
    if not _CORPUS:
        root = fresh('corpus')
        handler = _Capture()
        P.log.addHandler(handler)
        P.log.setLevel(logging.DEBUG)
        try:
            review = P.prepare(sorted(FIX.rglob('*.pdf')), root)
            snapshot = review.to_dict()
            run = P.commit(review, acknowledge_rejections=review.confirmation_token)
        finally:
            P.log.removeHandler(handler)
        _CORPUS.update(root=root, review=snapshot, run=run, log='\n'.join(handler.lines))
    return _CORPUS


_SMALL = {}


def small():
    """Two accepted documents and two rejected ones: quick to copy and damage."""
    if not _SMALL:
        root = fresh('small')
        review = P.prepare([NORMAL, ADVERSARIAL, NOT_PDF, LOCKED], root)
        _SMALL['run'] = P.commit(review, acknowledge_rejections=review.confirmation_token)
    return _SMALL['run']


# ---------------------------------------------------------------------------
# A  "Valid files produce manifest + chunks"
# ---------------------------------------------------------------------------
def test_valid_files_produce_a_sealed_run_with_manifest_and_chunks():
    root = fresh('valid')
    run = P.ingest(ACCEPTING, root)
    m = run.manifest
    assert run.path.name == run.run_id == m['seal']['run_id']
    assert (run.path / 'manifest.json').is_file() and (run.path / 'report.json').is_file()
    assert m['totals']['accepted'] == len(ACCEPTING) and m['totals']['rejected'] == 0
    assert m['review'] == {'confirmation_required': False, 'confirmation_token': None}
    for d in m['documents']:
        lines = (run.path / d['files']['chunks']['path']).read_bytes().count(b'\n')
        assert lines == d['chunk_count'] >= 1
    assert P.list_runs(root) == [run.run_id]
    assert not [p for p in (root / 'runs').iterdir() if p.name.startswith('.partial-')]
    return (f'{m["totals"]["accepted"]} valid PDFs -> {run.run_id}: manifest + '
            f'{m["totals"]["chunks"]} chunks over {m["totals"]["pages"]} pages')


def test_pipeline_chunks_equal_the_reference_chunker():
    """The pipeline's single extraction must write exactly what chunks(path) returns."""
    run = corpus()['run']
    by_name = {d['source_filename']: d for d in run.manifest['documents']}
    total = 0
    for path in ACCEPTING:
        d = by_name[path.name]
        written = list(run.iter_chunks(d['document_id']))
        expected = [c.to_dict() for c in chunks(path)]
        assert written == expected, f'{path.name}: pipeline chunks differ from chunks()'
        total += len(written)
    return f'{total} chunks on disk are identical, field for field, to chunks() on {len(ACCEPTING)} documents'


def test_outputs_conform_to_their_schemas():
    run = corpus()['run']
    counts = {}
    def must(name, obj, label):
        errors = sorted(validator_for(name).iter_errors(obj), key=lambda e: list(e.path))
        assert not errors, f'{label}: {errors[0].message} at {list(errors[0].path)}'
        counts[name] = counts.get(name, 0) + 1
    must('ingest_manifest', run.manifest, 'manifest.json')
    must('import_report', run.report, 'report.json')
    for record in run.documents:
        must('document', record, record['document_id'])
    for d in run.manifest['documents']:
        must('extraction', json.loads((run.path / d['files']['extraction']['path']).read_bytes()),
             d['document_id'])
    chunk_validator = validator_for('chunk')
    n = 0
    for c in run.iter_chunks():
        error = next(chunk_validator.iter_errors(c), None)
        assert error is None, f'chunk {c["chunk_id"]}: {error.message}'
        n += 1
    return (f'manifest, report, {counts["document"]} documents, {counts["extraction"]} page tables '
            f'and {n} chunk lines conform')


def test_pipeline_outcomes_match_the_labelled_corpus():
    """Every fixture ends up where manifest.json says it should."""
    labels = json.loads(FIXTURE_MANIFEST.read_text())['fixtures']
    rows = {c['source_filename']: c for c in corpus()['review']['candidates']}
    asserted = 0
    for f in labels:
        row = rows[Path(f['path']).name]
        if f['expected_outcome'] == 'accept':
            assert row['disposition'].startswith('accepted'), f'{f["id"]} was {row["disposition"]}'
        elif f['expected_outcome'] == 'reject':
            assert row['disposition'] == 'rejected' and row['reject_reason'] == f['reject_reason'], \
                f'{f["id"]}: {row["disposition"]} {row["reject_reason"]}'
        else:
            continue
        asserted += 1
    t = corpus()['review']['totals']
    return (f'{asserted} labelled fixtures land as labelled; under the default policy '
            f'{t["accepted"]} of {t["candidates"]} are accepted and {t["rejected"]} rejected')


# ---------------------------------------------------------------------------
# B  "invalid files fail before indexing"
# ---------------------------------------------------------------------------
def test_rejected_files_leave_nothing_in_the_run():
    run, review = corpus()['run'], corpus()['review']
    rejected = [c for c in review['candidates'] if c['disposition'] == 'rejected']
    assert rejected, 'corpus no longer contains a rejected fixture'
    files = {p.relative_to(run.path).as_posix() for p in run.path.rglob('*') if p.is_file()}
    accepted_ids = {d['document_id'] for d in run.manifest['documents']}
    chunk_owners = {c['document_id'] for c in run.iter_chunks()}
    assert chunk_owners == accepted_ids, 'a chunk belongs to something other than an accepted document'
    vocabulary = {r.value for r in RejectReason}
    listed = {r['checksum_sha256'] for r in run.manifest['rejected']}
    for c in rejected:
        would_be = Document.id_from_checksum(c['checksum_sha256'])
        assert would_be not in accepted_ids
        assert not [f for f in files if would_be in f], f'{c["source_filename"]} left a file behind'
        assert c['checksum_sha256'] in listed, f'{c["source_filename"]} was dropped without a record'
        assert c['reject_reason'] in vocabulary and c['reject_detail']
        assert c['chunk_count'] is None and c['document_id'] is None
    assert len(files) == 3 * len(accepted_ids) + 3, 'unexpected file in the run directory'
    return (f'{len(rejected)} rejected files: 0 staged copies, 0 chunk files, 0 of {len(chunk_owners)} '
            f'chunk owners; each is listed with a reason')


def test_rejections_need_confirmation_before_sealing():
    """SDD 6.1: explicit confirmation before publishing the valid remainder."""
    root = fresh('confirm')
    review = P.prepare([NORMAL, NOT_PDF], root)
    assert review.state == 'awaiting_confirmation' and review.requires_confirmation
    assert review.totals['accepted'] == 1 and review.totals['rejected'] == 1
    errors = sorted(validator_for('import_review').iter_errors(review.to_dict()), key=lambda e: list(e.path))
    assert not errors, errors[0].message
    assert P.job_active(root), 'an open review must hold the job lock'
    for attempt in (None, 'ack_0000000000000000'):
        try:
            P.commit(review, acknowledge_rejections=attempt)
            raise AssertionError('sealed without the confirmation token')
        except P.ConfirmationRequired as exc:
            assert exc.review is review
    assert P.list_runs(root) == [], 'a run was sealed before confirmation'
    try:
        P.load_run(review.partial_dir)
        raise AssertionError('an unconfirmed attempt was loadable')
    except P.RunNotComplete:
        pass
    token = review.confirmation_token
    run = P.commit(review, acknowledge_rejections=token)
    assert run.manifest['review'] == {'confirmation_required': True, 'confirmation_token': token}
    assert run.report['confirmation']['acknowledged'] is True
    assert not P.job_active(root)

    # ingest() without the flag: the caller gets the review, the disk gets nothing.
    other = fresh('confirm2')
    try:
        P.ingest([NORMAL, NOT_PDF], other)
        raise AssertionError('ingest() published past a rejection')
    except P.ConfirmationRequired as exc:
        assert [c.disposition for c in exc.review.candidates] == ['accepted', 'rejected']
    assert P.list_runs(other) == [] and list((other / 'runs').iterdir()) == []
    return 'no token, wrong token and ingest() without the flag all seal nothing; the right token seals'


def test_nothing_accepted_seals_nothing():
    root = fresh('none')
    review = P.prepare([NOT_PDF, LOCKED, TRUNCATED], root)
    assert review.state == 'nothing_accepted' and review.totals['accepted'] == 0
    try:
        P.commit(review, acknowledge_rejections=review.confirmation_token)
        raise AssertionError('sealed a run with no documents')
    except P.NothingAccepted:
        pass
    P.discard(review, 'nothing_accepted')
    assert P.list_runs(root) == [] and list((root / 'runs').iterdir()) == []
    return '3 rejected of 3: state nothing_accepted, commit refuses, nothing on disk'


def test_parser_crash_is_a_rejection_not_a_failed_import():
    """
    validate() promises not to raise, and the pipeline does not rely on the
    promise: a file that makes it raise anyway is one bad file, and the rest
    of the batch still imports.
    """
    real = P.process

    def crashing(path, *args, **kwargs):
        if kwargs.get('source_filename') == ADVERSARIAL.name:
            raise RuntimeError('the parser fell over')
        return real(path, *args, **kwargs)

    P.process = crashing
    try:
        review = P.prepare([ADVERSARIAL, NORMAL], fresh('crash'), durable=False)
    finally:
        P.process = real
    by_name = {c.source_filename: c for c in review.candidates}
    crashed = by_name[ADVERSARIAL.name]
    assert crashed.disposition == 'rejected' and crashed.reject_reason == 'corrupt'
    assert crashed.validation['checks'][-1]['observed'] == {'exception': 'RuntimeError'}
    assert by_name[NORMAL.name].disposition == 'accepted'
    assert not (review.partial_dir / 'sources' /
                f'{Document.id_from_checksum(crashed.checksum_sha256)}.pdf').exists()
    P.discard(review)
    return 'a file that makes process() raise is rejected as corrupt, unstaged, and its neighbour is accepted'


def test_a_failing_callback_is_not_recorded_as_a_corrupt_file():
    """
    The caller's progress and cancel callbacks run while a file is being read.
    An exception out of one of them says nothing about that file. It used to be
    caught with the parser's and written down as "The file is damaged".
    """
    root = fresh('hook')
    calls = []

    def progress(update):
        calls.append(update)
        if len(calls) == 1:
            raise ConnectionError('the progress window went away')

    try:
        review = P.prepare([NORMAL, ADVERSARIAL], root, progress=progress, durable=False)
    except ConnectionError:
        review = None
    if review is not None:
        verdicts = {c.source_filename: c.disposition for c in review.candidates}
        P.discard(review)
        raise AssertionError(f'the import carried on with {verdicts}')
    assert not P.job_active(root) and not list((root / 'runs').glob('.partial-*'))
    last = json.loads((root / 'journal.jsonl').read_text().splitlines()[-1])
    assert last['event'] == 'run_discarded' and last['error'] == 'ConnectionError', last
    return 'the callback\'s own exception ends the import; no file is blamed and nothing is left behind'


def test_a_bad_argument_does_not_leave_the_root_locked():
    """prepare() took the job lock before it looked at its arguments, and kept it when they were bad."""
    root = fresh('badarg')
    try:
        P.prepare([None], root)
        raise AssertionError('prepare([None]) did not raise')
    except TypeError:
        pass
    assert not P.job_active(root), 'the root is still locked'
    run = P.ingest([ADVERSARIAL], root, durable=False)
    assert run.manifest['totals']['accepted'] == 1
    # A Review used as a context manager cannot be forgotten either.
    with P.prepare([ADVERSARIAL], fresh('with'), durable=False) as review:
        held = P.job_active(review.root)
    assert held and not P.job_active(review.root) and not review.partial_dir.exists()
    return 'a TypeError from the argument list leaves the root free; leaving a with-block discards the attempt'


def test_a_failure_to_write_the_staged_copy_is_not_blamed_on_the_file():
    """A full quota or a read-only working folder would otherwise reject every file as "corrupt"."""
    work = fresh('staging')
    work.mkdir(parents=True)
    try:
        P._copy_and_hash(NORMAL, work / 'no-such-folder' / '000000.part', lambda: None, False)
        raise AssertionError('writing into a missing folder did not raise')
    except P.StagingFailed as exc:
        assert exc.code == 'staging_failed' and str(NORMAL) not in str(exc)
    try:
        P._copy_and_hash(work / 'missing.pdf', None, lambda: None, False)
        raise AssertionError('reading a missing source did not raise')
    except OSError:
        pass                                   # the source's own problem: a per-file rejection
    return 'a write failure raises StagingFailed and ends the import; a read failure stays a per-file OSError'


def test_a_truncated_dense_file_fails_before_indexing():
    """
    Half of the DOE reflow: 42 of its 96 pages survive, each full of text. It
    used to be accepted with a warning and sealed as a 96-page document.
    """
    work = fresh('dense-src')
    work.mkdir(parents=True)
    cut = work / 'handbook_half.pdf'
    raw = LARGE.read_bytes()
    cut.write_bytes(raw[:len(raw) // 2])
    review = P.prepare([cut, ADVERSARIAL], fresh('dense'), durable=False)
    half = next(c for c in review.candidates if c.source_filename == cut.name)
    assert half.disposition == 'rejected' and half.reject_reason == 'corrupt', half.disposition
    assert '42 of 96 pages' in half.reject_detail, half.reject_detail
    assert review.requires_confirmation
    run = P.commit(review, acknowledge_rejections=review.confirmation_token)
    assert [d['source_filename'] for d in run.manifest['documents']] == [ADVERSARIAL.name]
    entry = run.manifest['rejected'][0]
    assert entry['failed_check'] == 'structural_integrity' and entry['checksum_sha256'] == half.checksum_sha256
    names = [p.name for p in run.path.rglob('*') if p.is_file()]
    assert not any(Document.id_from_checksum(half.checksum_sha256) in n for n in names)
    return 'half a dense handbook is rejected as corrupt (42 of 96 pages), and nothing of it is in the sealed run'


def test_unreadable_and_oversized_sources_are_rejected_without_staging():
    root = fresh('gate')
    missing = TMP / 'does_not_exist.pdf'
    review = P.prepare([missing, NORMAL, ARXIV], root, policy=IngestionPolicy(max_bytes=2_000_000))
    rows = {c.source_filename: c for c in review.candidates}
    assert rows['does_not_exist.pdf'].disposition == 'rejected'
    assert rows['does_not_exist.pdf'].reject_reason == 'corrupt'
    assert rows[ARXIV.name].reject_reason == 'oversized'
    assert rows[ARXIV.name].checksum_sha256, 'an oversized file must still be identified by checksum'
    staged = sorted(p.name for p in (review.partial_dir / 'sources').iterdir())
    assert staged == [f'{rows[NORMAL.name].document_id}.pdf'], staged
    errors = sorted(validator_for('validation_result').iter_errors(rows[ARXIV.name].validation),
                    key=lambda e: list(e.path))
    assert not errors, errors[0].message
    P.discard(review)
    return 'a missing path and a file over max_bytes are rejected with a reason; neither is copied into staging'


def test_unsealed_or_damaged_run_cannot_be_loaded():
    run = small()
    copy = fresh('load') / run.run_id
    shutil.copytree(run.path, copy)
    assert P.load_run(copy).run_id == run.run_id
    (copy / 'manifest.json').rename(copy / 'manifest.json.bak')
    try:
        P.load_run(copy)
        raise AssertionError('loaded a directory with no manifest')
    except P.RunNotComplete:
        pass
    (copy / 'manifest.json.bak').rename(copy / 'manifest.json')
    target = next((copy / 'chunks').iterdir())
    data = bytearray(target.read_bytes())
    data[200] ^= 0x01
    target.write_bytes(bytes(data))
    try:
        P.load_run(copy)
        raise AssertionError('loaded a run with a damaged chunk file')
    except P.IntegrityError:
        pass
    return 'load_run() refuses a directory without a manifest (RunNotComplete) and one with a flipped bit (IntegrityError)'


# ---------------------------------------------------------------------------
# C  "checksums ... are present"
# ---------------------------------------------------------------------------
def test_verify_recomputes_counts_and_checksums():
    run = corpus()['run']
    result = P.verify(run.path)
    assert result.ok, result.failed()
    m = run.manifest
    assert result.stats['chunks'] == m['totals']['chunks'] == sum(1 for _ in run.iter_chunks())
    assert result.stats['pages'] == m['totals']['pages']
    assert result.stats['files'] == 3 * m['totals']['accepted'] + 1
    for d in m['documents']:
        assert d['checksum_sha256'] == d['files']['source']['sha256']
        assert P._sha256_file(run.path / d['files']['source']['path'])[0] == d['checksum_sha256']
    return (f'{len(result.checks)} checks pass: {result.stats["files"]} files re-hashed '
            f'({result.stats["bytes"]:,} bytes), {result.stats["chunks"]} chunk checksums and ids recomputed')


def _reseal(run_dir: Path) -> Path:
    """Make damage look consistent at the file level, the way a careless re-export would."""
    m = json.loads((run_dir / 'manifest.json').read_bytes())
    listed = []
    for d in m['documents']:
        for key in d['files']:
            d['files'][key] = P._file_entry(run_dir, d['files'][key]['path'])
            listed.append(d['files'][key])
    m['documents_file'] = P._file_entry(run_dir, 'documents.jsonl')
    listed.append(m['documents_file'])
    m['integrity']['files_sha256'] = P._files_digest(listed)
    body = {k: v for k, v in m.items() if k != 'seal'}
    m['seal'] = P._seal(body)
    (run_dir / 'manifest.json').write_text(json.dumps(m, indent=2, sort_keys=True) + '\n')
    report = json.loads((run_dir / 'report.json').read_bytes())
    report['manifest_sha256'] = m['seal']['manifest_sha256']
    report['run_id'] = m['seal']['run_id']
    report_body = {k: v for k, v in report.items() if k != 'seal'}
    report['seal'] = {'report_sha256': __import__('hashlib').sha256(P._canon(report_body)).hexdigest()}
    (run_dir / 'report.json').write_text(json.dumps(report, indent=2, sort_keys=True) + '\n')
    final = run_dir.parent / m['seal']['run_id']
    run_dir.rename(final)
    return final


def test_verify_detects_each_kind_of_damage():
    run = small()
    base = fresh('damage')
    base.mkdir(parents=True)
    victim = next(d for d in run.manifest['documents'] if d['source_filename'] == NORMAL.name)
    chunk_file = victim['files']['chunks']['path']

    def rewrite_chunks(path: Path, change):
        lines = [json.loads(line) for line in path.read_bytes().splitlines()]
        lines = change(lines)
        path.write_bytes(b''.join(P._line(c) for c in lines))

    def edit_text(lines):
        lines[3]['text'] = lines[3]['text'][:50] + 'X' + lines[3]['text'][51:]
        return lines

    def move_page(lines):
        lines[5]['page_spans'][0]['page_number'] += 1
        lines[5]['page_start'] += 1
        return lines

    def reassign(lines):
        other = next(d for d in run.manifest['documents'] if d is not victim)
        lines[0]['document_id'] = other['document_id']
        return lines

    def manifest_total(d: Path):
        m = json.loads((d / 'manifest.json').read_bytes())
        m['totals']['chunks'] += 1
        (d / 'manifest.json').write_text(json.dumps(m, indent=2, sort_keys=True) + '\n')

    def flip_source(d: Path):
        p = d / victim['files']['source']['path']
        data = bytearray(p.read_bytes())
        data[len(data) // 2] ^= 0xFF
        p.write_bytes(bytes(data))

    def stray(d: Path):
        rejected = run.manifest['rejected'][0]
        (d / 'chunks' / f'{Document.id_from_checksum(rejected["checksum_sha256"])}.jsonl').write_bytes(b'{}\n')

    cases = [
        ('chunk text edited', lambda d: rewrite_chunks(d / chunk_file, edit_text), False, 'files_present_and_unchanged'),
        ('chunk text edited, files re-hashed', lambda d: rewrite_chunks(d / chunk_file, edit_text), True, 'chunk_text_checksums'),
        ('chunk line removed, files re-hashed', lambda d: rewrite_chunks(d / chunk_file, lambda l: l[:-1]), True, 'chunk_counts'),
        ('page number shifted, files re-hashed', lambda d: rewrite_chunks(d / chunk_file, move_page), True, 'chunk_provenance'),
        ('chunk moved to another document, files re-hashed', lambda d: rewrite_chunks(d / chunk_file, reassign), True, 'chunk_ids'),
        ('source PDF damaged', flip_source, False, 'files_present_and_unchanged'),
        ('manifest total edited', manifest_total, False, 'manifest_seal'),
        ('file for a rejected document added', stray, False, 'rejected_files_absent'),
        ('directory renamed', lambda d: None, False, 'run_directory_name'),
    ]
    caught = []
    for i, (label, damage, reseal, expect) in enumerate(cases):
        d = base / f'case{i}' / run.run_id
        shutil.copytree(run.path, d)
        damage(d)
        if reseal:
            d = _reseal(d)
        if label == 'directory renamed':
            d = d.rename(d.parent / 'run_0000000000000000')
        result = P.verify(d)
        failed = [c['check'] for c in result.failed()]
        assert not result.ok and expect in failed, f'{label}: expected {expect}, failed {failed}'
        caught.append(expect)
    return f'{len(cases)} kinds of damage each fail verify() on the expected check ({len(set(caught))} distinct checks)'


def _e3():
    """E3's Chunk mirror and its integrity formula, loaded from E3's own source files."""
    chunk_py, versions_py = E3_LIBRARY / 'chunk.py', E3_LIBRARY / 'versions.py'
    if not chunk_py.is_file() or not versions_py.is_file():
        return None
    spec = importlib.util.spec_from_file_location('e3_chunk', chunk_py)
    module = importlib.util.module_from_spec(spec)
    sys.modules['e3_chunk'] = module
    spec.loader.exec_module(module)
    tree = ast.parse(versions_py.read_text())
    fn = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == '_integrity')
    scope = {'hashlib': __import__('hashlib'), 'Iterable': object}
    exec(compile(ast.Module([fn], []), str(versions_py), 'exec'), scope)   # noqa: S102 - E3's 3-line function
    return module.Chunk, scope['_integrity']


def test_integrity_value_equals_e3_formula():
    """The manifest's chunk-set digest is the value E3 computes in CollectionVersions._verify."""
    loaded = _e3()
    if loaded is None:
        return 'SKIPPED: E3 library not found (set E3_LIBRARY to secure_qa/library)'
    E3Chunk, e3_integrity = loaded
    run = corpus()['run']
    e3_chunks = [E3Chunk.from_dict(d) for d in run.iter_chunks()]
    theirs = e3_integrity((c.chunk_id, c.text_checksum_sha256) for c in e3_chunks)
    assert theirs == run.manifest['integrity']['chunk_set_sha256']
    return f'E3 _integrity() over {len(e3_chunks)} loaded chunks == manifest chunk_set_sha256 ({theirs[:16]}...)'


def test_e3_publish_preconditions_hold_for_a_sealed_run():
    """Everything CollectionVersions.publish and DocumentStore.index check before writing."""
    loaded = _e3()
    if loaded is None:
        return 'SKIPPED: E3 library not found (set E3_LIBRARY to secure_qa/library)'
    E3Chunk, _ = loaded
    run = P.load_run(corpus()['run'].path)
    e3_chunks = [E3Chunk.from_dict(d) for d in run.iter_chunks()]
    records = {d['document_id']: d for d in run.documents}
    assert e3_chunks, 'publish() needs at least one chunk'
    assert not ({c.document_id for c in e3_chunks} - records.keys()), 'a chunk has no document record'
    assert len({c.chunk_id for c in e3_chunks}) == len(e3_chunks), 'duplicate chunk ids in one index call'
    assert all(c.checksum_ok for c in e3_chunks), 'chunk text does not match its checksum'
    assert [c.to_dict() for c in e3_chunks] == list(run.iter_chunks()), 'E3 round trip changed a chunk'
    for r in records.values():
        assert {'document_id', 'display_title', 'source_filename', 'page_count'} <= r.keys()
    return (f'{len(e3_chunks)} chunks load through E3 Chunk.from_dict, round-trip unchanged, have unique ids, '
            f'valid checksums and a record among {len(records)} documents')


# ---------------------------------------------------------------------------
# D  "source/page provenance are present"
# ---------------------------------------------------------------------------
def test_every_chunk_traces_to_source_page_and_offsets():
    """From the sealed directory alone: chunk -> document -> staged PDF -> page -> characters."""
    run = corpus()['run']
    config = ChunkerConfig(**{k: v for k, v in run.manifest['chunker'].items() if k != 'config_id'})
    chunks_checked = spans_checked = 0
    for d in run.manifest['documents']:
        source = run.path / d['files']['source']['path']
        assert P._sha256_file(source)[0] == d['checksum_sha256']
        assert d['document_id'] == Document.id_from_checksum(d['checksum_sha256'])
        text, pages, handle = extract(source, sort=config.sorted_reading_order,
                                      strip_boilerplate=config.strip_running_headers)
        handle.close()
        page_text = {p.number: text[p.char_start:p.char_end] for p in pages}
        for c in run.iter_chunks(d['document_id']):
            assert text[c['char_start']:c['char_end']] == c['text'], f'{c["chunk_id"]}: offsets'
            for s in c['page_spans']:
                assert 1 <= s['page_number'] <= d['page_count']
                quoted = c['text'][s['char_start'] - c['char_start']:s['char_end'] - c['char_start']]
                assert page_text[s['page_number']][s['page_char_start']:s['page_char_end']] == quoted
                spans_checked += 1
            chunks_checked += 1
    return (f'{chunks_checked} chunks: document id recomputed from the staged PDF, stream offsets and '
            f'{spans_checked} per-page slices reproduce the chunk text exactly')


def test_same_bytes_under_two_names_is_one_document():
    work = fresh('alias-src')
    (work / 'a').mkdir(parents=True)
    (work / 'b').mkdir()
    shutil.copy(NORMAL, work / 'a' / 'zeta_copy.pdf')
    shutil.copy(NORMAL, work / 'b' / 'alpha_copy.pdf')
    review = P.prepare([work / 'a' / 'zeta_copy.pdf', work / 'b' / 'alpha_copy.pdf', NORMAL], fresh('alias'))
    assert [c.disposition for c in review.candidates] == ['accepted', 'duplicate', 'duplicate']
    assert review.state == 'ready', 'a duplicate is not a rejection and needs no confirmation'
    run = P.commit(review)
    m = run.manifest
    assert m['totals'] == {**m['totals'], 'candidates': 3, 'accepted': 1, 'duplicates': 2}
    (d,) = m['documents']
    assert d['source_filename'] == 'alpha_copy.pdf'
    assert d['aliases'] == [NORMAL.name, 'zeta_copy.pdf'] and d['times_supplied'] == 3
    assert len(list((run.path / 'sources').iterdir())) == 1
    ids = [c['chunk_id'] for c in run.iter_chunks()]
    assert len(ids) == len(set(ids)) == d['chunk_count']
    return (f'3 paths, 1 document, 1 staged copy, {len(ids)} unique chunk ids; the other two names are '
            f'recorded as aliases')


def test_a_duplicate_is_never_parsed():
    """A second copy is recognised by its checksum while it is copied, before the parser sees it."""
    work = fresh('dup-parse-src')
    work.mkdir(parents=True)
    shutil.copy(NORMAL, work / 'again.pdf')
    shutil.copy(NOT_PDF, work / 'again_not_a.pdf')
    parsed: list[str] = []
    real = P.process

    def counted(path, *args, **kwargs):
        parsed.append(kwargs.get('source_filename'))
        return real(path, *args, **kwargs)

    P.process = counted
    try:
        review = P.prepare([NORMAL, work / 'again.pdf', NOT_PDF, work / 'again_not_a.pdf'],
                           fresh('dup-parse'))
    finally:
        P.process = real
    assert sorted(parsed) == sorted([NORMAL.name, NOT_PDF.name]), parsed
    assert [c.disposition for c in review.candidates] == ['accepted', 'duplicate', 'rejected', 'duplicate']
    (r,) = review.rejected
    assert r['source_filename'] == 'again_not_a.pdf' and r['aliases'] == [NOT_PDF.name], r
    assert r['times_supplied'] == 2 and review.totals['duplicates'] == 2, (r, review.totals)
    assert sorted(p.name for p in (review.partial_dir / 'sources').iterdir()) == [
        f'{review.documents[0]["document_id"]}.pdf']
    P.discard(review)
    return ('4 files, 2 parsed: a second copy of an accepted file and of a rejected one are both '
            'matched by checksum and recorded as names on the first')


def test_the_import_root_keeps_only_runs_the_lock_and_the_journal():
    """No temporary file outlives the import, whatever its ending."""
    def left(root: Path) -> list[str]:
        sealed = set(P.list_runs(root))         # a sealed run and everything in it is meant to stay
        return sorted(p.relative_to(root).as_posix() for p in root.rglob('*')
                      if not (len(p.relative_to(root).parts) > 1 and p.relative_to(root).parts[1] in sealed))

    expected = ['ingest.lock', 'journal.jsonl', 'runs']
    endings = {}
    root = fresh('tidy-sealed')
    review = P.prepare([NORMAL, NORMAL, NOT_PDF, TRUNCATED], root)
    run = P.commit(review, acknowledge_rejections=review.confirmation_token)
    endings['sealed with rejects and a duplicate'] = (left(root), expected)
    again = P.ingest([NORMAL, NORMAL, NOT_PDF, TRUNCATED], root, acknowledge_rejections=True)
    assert again.reused and P.list_runs(root) == [run.run_id], P.list_runs(root)
    endings['the same inputs again, run reused'] = (left(root), expected)
    root = fresh('tidy-declined')
    P.discard(P.prepare([NORMAL, NOT_PDF], root))
    endings['declined at review'] = (left(root), expected)
    root = fresh('tidy-none')
    P.discard(P.prepare([NOT_PDF, LOCKED], root), 'nothing_accepted')
    endings['nothing accepted'] = (left(root), expected)
    for ending, (found, want) in endings.items():
        assert found == want, f'{ending}: left {found}'
    return f'{len(endings)} endings ({", ".join(endings)}): nothing left but runs/, ingest.lock and journal.jsonl'


def test_two_files_with_one_name_are_two_documents():
    work = fresh('clash-src')
    (work / 'a').mkdir(parents=True)
    (work / 'b').mkdir()
    shutil.copy(NORMAL, work / 'a' / 'report.pdf')
    shutil.copy(ADVERSARIAL, work / 'b' / 'report.pdf')
    run = P.ingest([work / 'a' / 'report.pdf', work / 'b' / 'report.pdf'], fresh('clash'))
    docs = run.manifest['documents']
    assert len(docs) == 2 and {d['source_filename'] for d in docs} == {'report.pdf'}
    assert len({d['document_id'] for d in docs}) == 2
    assert len(list((run.path / 'sources').iterdir())) == 2
    for d in docs:
        assert d['outcome'] == 'accepted_with_warnings'
        assert [w['code'] for w in d['warnings']] == ['filename_shared']
    assert all(r['import_warnings'][-1]['code'] == 'filename_shared' for r in run.documents)
    return '2 different files both named report.pdf: 2 documents, 2 staged copies, each warned filename_shared'


def test_filenames_are_recorded_in_nfc():
    """macOS reports decomposed names; the manifest must not differ by platform for the same file."""
    work = fresh('nfc-src')
    work.mkdir(parents=True)
    decomposed = 'résumé.pdf'
    shutil.copy(ADVERSARIAL, work / decomposed)
    run = P.ingest([work / decomposed], fresh('nfc'))
    name = run.manifest['documents'][0]['source_filename']
    assert name == 'résumé.pdf' and name != decomposed
    assert run.documents[0]['display_title'], 'title lost'
    assert run.source_path(run.manifest['documents'][0]['document_id']).is_file()
    return 'a decomposed (NFD) filename is recorded composed (NFC), 11 characters instead of 13'


def test_pages_without_text_are_always_listed():
    """Blank pages are named in the manifest whatever the warning threshold says."""
    run = corpus()['run']
    d = next(d for d in run.manifest['documents'] if d['source_filename'] == ORIGINAL.name)
    assert d['pages_without_text'] == [4, 6, 8, 10, 12, 94], d['pages_without_text']
    assert d['pages_with_text'] == d['page_count'] - 6
    table = json.loads((run.path / d['files']['extraction']['path']).read_bytes())
    assert [p['page_number'] for p in table['pages'] if not p['has_text']] == d['pages_without_text']
    return (f'{ORIGINAL.name}: pages {d["pages_without_text"]} are recorded as having no text '
            f'(outcome {d["outcome"]}, {len(d["warnings"])} validator warnings)')


# ---------------------------------------------------------------------------
# E  determinism
# ---------------------------------------------------------------------------
def test_same_inputs_give_byte_identical_runs():
    inputs = [NORMAL, ARXIV, ADVERSARIAL, NOT_PDF, TRUNCATED]
    elsewhere = fresh('det-src')
    elsewhere.mkdir(parents=True)
    moved = [Path(shutil.copy(p, elsewhere / p.name)) for p in reversed(inputs)]
    a = P.ingest(inputs, fresh('det-a'), acknowledge_rejections=True)
    time.sleep(1.1)                                   # different second, so any timestamp would show
    b = P.ingest(moved, fresh('det-b'), acknowledge_rejections=True)
    assert a.run_id == b.run_id
    same = []
    for p in sorted(a.path.rglob('*')):
        if not p.is_file():
            continue
        rel = p.relative_to(a.path)
        if rel.as_posix() == 'report.json':
            continue
        assert p.read_bytes() == (b.path / rel).read_bytes(), f'{rel} differs between runs'
        same.append(rel.as_posix())
    assert (a.path / 'report.json').read_bytes() != (b.path / 'report.json').read_bytes()
    manifest_text = (a.path / 'manifest.json').read_text()
    assert str(TMP) not in manifest_text and str(FIX) not in manifest_text, 'an absolute path is in the manifest'
    assert not re.search(r'\d{4}-\d{2}-\d{2}T\d{2}:', manifest_text), 'a timestamp is in the manifest'
    assert re.search(r'\d{4}-\d{2}-\d{2}T\d{2}:', (a.path / 'report.json').read_text())
    return (f'different root, source folder and input order: same {a.run_id}, {len(same)} files byte-identical; '
            f'only report.json differs')


def test_resubmitting_sealed_inputs_reuses_the_run():
    root = fresh('reuse')
    first = P.ingest([NORMAL, ADVERSARIAL], root)
    before = (first.path / 'report.json').read_bytes()
    second = P.ingest([ADVERSARIAL, NORMAL], root)
    assert second.run_id == first.run_id and second.reused and not first.reused
    assert P.list_runs(root) == [first.run_id]
    assert [p.name for p in (root / 'runs').iterdir()] == [first.run_id]
    assert (first.path / 'report.json').read_bytes() == before, 'a sealed run was modified'
    return f'the same inputs again resolve to the sealed {first.run_id}; no second copy, sealed run untouched'


# ---------------------------------------------------------------------------
# F  failure handling
# ---------------------------------------------------------------------------
def _journal(root: Path) -> list[dict]:
    return [json.loads(line) for line in (root / 'journal.jsonl').read_bytes().splitlines()]


def test_insufficient_disk_space_stops_before_copying():
    """SDD 9: stop before building and report the required and available space."""
    root = fresh('nospace')
    try:
        P.prepare([NORMAL, ARXIV], root, disk_free=lambda path: 1_000_000)
        raise AssertionError('started an import that cannot fit')
    except P.InsufficientDiskSpace as exc:
        need = NORMAL.stat().st_size + ARXIV.stat().st_size + P.DISK_RESERVE_BYTES
        assert (exc.required_bytes, exc.available_bytes) == (need, 1_000_000)
        assert f'{need:,}' in str(exc) and '1,000,000' in str(exc)
    assert list((root / 'runs').iterdir()) == []
    last = _journal(root)[-1]
    assert last['event'] == 'run_discarded' and last['reason'] == 'insufficient_disk_space'
    assert last['required_bytes'] == need and last['available_bytes'] == 1_000_000
    return f'needs {need:,} bytes, 1,000,000 free: refused before any copy, both numbers reported and journalled'


def test_disk_filling_mid_run_discards_the_attempt():
    root = fresh('fills')
    calls = []
    def shrinking(path):
        calls.append(1)
        return 10**12 if len(calls) < 3 else 5_000
    try:
        P.prepare([ADVERSARIAL, NORMAL, ARXIV], root, disk_free=shrinking)
        raise AssertionError('kept writing with no space left')
    except P.InsufficientDiskSpace as exc:
        assert exc.available_bytes == 5_000 and exc.required_bytes > P.DISK_RESERVE_BYTES
    assert list((root / 'runs').iterdir()) == [], 'a partial attempt survived'
    assert P.list_runs(root) == []
    P.discard(P.prepare([ADVERSARIAL], root))          # the lock was released
    return 'space ran out before the second document was written: attempt removed, lock released'


def test_cancellation_discards_the_attempt():
    """SDD 6.3: cancellation records the outcome, discards staging, leaves nothing that looks complete."""
    root = fresh('cancel')
    seen = []
    flag, t = threading.Event(), {}
    def press_cancel():
        t['at'] = time.perf_counter()
        flag.set()
    timer = threading.Timer(0.4, press_cancel)        # the user presses Cancel at an arbitrary moment
    timer.start()
    try:
        P.prepare([NORMAL, LARGE, ORIGINAL, OVERSIZED], root, progress=seen.append, cancel=flag.is_set)
        raise AssertionError('ran to completion after cancel')
    except P.Cancelled:
        latency = time.perf_counter() - t['at']
    finally:
        timer.cancel()
    assert latency < 1.0, f'cancel took {latency:.2f}s to take effect'
    assert list((root / 'runs').iterdir()) == []
    last = _journal(root)[-1]
    assert last['event'] == 'run_discarded' and last['reason'] == 'cancelled'
    assert seen[-1].phase == 'validating' and seen[-1].files_done >= 1
    review = P.prepare([ADVERSARIAL], root)            # restart works straight away
    P.discard(review)
    return (f'cancelled at page {seen[-1].pages_done} of the batch: stopped {latency * 1000:.0f} ms later, '
            f'nothing on disk, outcome journalled, restart allowed')


def test_killed_process_leaves_only_recoverable_leftovers():
    """SDD 9, unexpected shutdown: SIGKILL the importer mid-document."""
    root = fresh('killed')
    env = {**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'}
    proc = subprocess.Popen([sys.executable, '-m', 'src.pipeline', 'ingest', str(NORMAL), str(OVERSIZED),
                             '--out', str(root)], cwd=ROOT, env=env,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    deadline = time.time() + 30
    staged = []
    while time.time() < deadline and len(staged) < 2:
        staged = list((root / 'runs').glob('.partial-*/sources/*.pdf')) if (root / 'runs').is_dir() else []
        time.sleep(0.02)
    assert len(staged) == 2, 'the importer never got as far as the second document'
    time.sleep(0.5)
    proc.send_signal(signal.SIGKILL)
    proc.wait()
    leftovers = [p.name for p in (root / 'runs').iterdir()]
    assert len(leftovers) == 1 and leftovers[0].startswith('.partial-')
    assert P.list_runs(root) == [], 'an interrupted attempt is listed as a run'
    partial = root / 'runs' / leftovers[0]
    assert not (partial / 'manifest.json').exists()
    finished_chunks = len(list((partial / 'chunks').iterdir()))
    try:
        P.load_run(partial)
        raise AssertionError('an interrupted attempt was loadable')
    except P.RunNotComplete:
        pass
    found = P.recover(root)
    assert [f['reason'] for f in found] == ['interrupted_attempt'] and found[0]['bytes'] > 0
    assert list((root / 'runs').iterdir()) == []
    run = P.ingest([NORMAL], root)                     # the dead process's lock is not in the way
    assert P.recover(root) == [] and P.list_runs(root) == [run.run_id]
    return (f'killed with {finished_chunks} of 2 documents written: no manifest, not listed, not loadable; '
            f'recover() removed {found[0]["bytes"]:,} bytes and left sealed runs alone')


def test_recover_deletes_only_what_it_knows_is_throwaway():
    """
    recover() used to delete everything under runs/ that was not an intact
    sealed run: a run whose manifest had been damaged went with its only
    staged copy of the PDFs, and so did any folder it did not recognise.
    """
    root = fresh('recover-safe')
    run = P.ingest([ADVERSARIAL], root, durable=False)
    kept = P.ingest([NORMAL], root, durable=False)
    (run.path / 'manifest.json').write_text('{"this is": "no longer the manifest"}')
    foreign = root / 'runs' / 'my-notes'
    foreign.mkdir()
    (foreign / 'keep.txt').write_text('not made by the pipeline')
    partial = root / 'runs' / '.partial-20260101T000000Z-1-abcdef'
    (partial / 'sources').mkdir(parents=True)
    (partial / 'sources' / 'half.pdf').write_bytes(b'%PDF-1.4 half a copy')

    found = {f['name']: f for f in P.recover(root)}
    assert found[run.run_id]['action'] == 'quarantined' and found[run.run_id]['reason'] == 'manifest_seal_mismatch'
    assert found['my-notes']['action'] == 'ignored' and (foreign / 'keep.txt').exists()
    assert found[partial.name]['action'] == 'removed' and not partial.exists()
    assert kept.run_id not in found and P.list_runs(root) == [kept.run_id]
    moved = list((root / 'quarantine').iterdir())
    assert len(moved) == 1 and moved[0].name.startswith(run.run_id)
    assert len(list((moved[0] / 'sources').glob('*.pdf'))) == 1, 'the quarantined run lost its PDF'
    assert [f['action'] for f in P.recover(root)] == ['ignored']
    return ('a damaged run is moved to quarantine/ with its PDF, a foreign folder is left alone, '
            'an interrupted attempt is deleted, and the intact run is untouched')


def test_verify_judges_the_run_and_not_its_surroundings():
    """Three ways an intact run used to fail to load, and one way a broken one crashed instead of failing."""
    run = small()
    copy = fresh('surroundings') / 'runs' / run.run_id
    shutil.copytree(run.path, copy)
    (copy / '.DS_Store').write_bytes(b'\x00\x00\x00\x01Bud1')
    (copy / 'sources' / 'Thumbs.db').write_bytes(b'thumbs')
    assert P.verify(copy).ok, 'a file the operating system added failed an intact run'
    here = os.getcwd()
    os.chdir(copy)
    try:
        assert P.verify('.').ok, 'verify(".") from inside the run did not recognise its name'
        assert P.load_run('.').run_id == run.run_id
    finally:
        os.chdir(here)
    (copy / 'sources' / 'stray.pdf').write_bytes(b'%PDF-1.4')
    assert [c['check'] for c in P.verify(copy).failed()] == ['no_unlisted_files']
    (copy / 'sources' / 'stray.pdf').unlink()

    # Settings are judged as stored: a run sealed by a chunker with different
    # settings fields is still the run it was.
    real = P.ChunkerConfig

    class Tomorrow:
        id_of = staticmethod(real.id_of)

        def __init__(self, **settings):
            raise TypeError('unexpected keyword argument')

    P.ChunkerConfig = Tomorrow
    try:
        assert P.verify(copy).ok, 'verification needs today\'s ChunkerConfig to accept the stored settings'
        first = run.manifest['documents'][0]['document_id']
        assert P.trace(P.load_run(copy), first, 0)['stream_slice_matches']
    finally:
        P.ChunkerConfig = real

    (copy / 'manifest.json').write_text('["valid JSON, but not a manifest"]')
    try:
        P.load_run(copy)
        raise AssertionError('a manifest that is a list was loaded')
    except P.IntegrityError:
        pass
    assert P.recover(copy.parent.parent)[0]['action'] == 'quarantined'
    return ('.DS_Store and Thumbs.db are ignored, a stray PDF is not; "verify ." works; stored settings '
            'verify without today\'s ChunkerConfig; a non-object manifest is an IntegrityError')


def test_cli_reports_mistakes_without_a_traceback():
    env = {**os.environ, 'PYTHONPATH': str(ROOT)}

    def cli(*args):
        return subprocess.run([sys.executable, '-m', 'src.pipeline', *args], cwd=ROOT, env=env,
                              capture_output=True, text=True)

    root = fresh('cli-mistakes')
    for flag, value in (('--target-chars', '0'), ('--overlap-chars', '-5'), ('--max-pages', '-1')):
        done = cli('ingest', str(ADVERSARIAL), '--out', str(root), flag, value)
        assert done.returncode == 64 and 'usage error' in done.stdout, (flag, done.returncode, done.stdout)
        assert 'Traceback' not in done.stderr and not (root / 'runs').exists()
    done = cli('ingest', str(ADVERSARIAL), '--out', str(root), '--max-pages', '1')
    assert done.returncode == 3 and 'oversized' in done.stdout, done.stdout      # 0 used to mean "no limit"
    sealed = cli('ingest', str(ADVERSARIAL), '--out', str(root), '--trace', '999')
    assert sealed.returncode == 0 and 'there is no chunk 999' in sealed.stdout, sealed.stdout + sealed.stderr
    run_dir = root / 'runs' / P.list_runs(root)[0]
    for args in (('show', str(run_dir), '--chunk', '999'), ('show', str(run_dir), '--doc', 'doc_nope')):
        done = cli(*args)
        assert done.returncode == 1 and 'Traceback' not in done.stderr and 'no ' in done.stdout, done.stdout
    return ('nonsense sizes exit 64 before any work; an out-of-range --trace or --chunk and an unknown '
            '--doc are reported in a sentence')


def test_one_job_at_a_time():
    """SDD 6.2: only one publication job may run at a time."""
    root = fresh('busy')
    review = P.prepare([ADVERSARIAL], root)
    for blocked in (lambda: P.prepare([NORMAL], root), lambda: P.recover(root)):
        try:
            blocked()
            raise AssertionError('a second job started while one was open')
        except P.Busy:
            pass
    assert review.partial_dir.is_dir(), 'the open attempt was disturbed'
    P.discard(review)
    P.discard(P.prepare([ADVERSARIAL], root))
    return 'while a review is open, a second prepare() and recover() both raise Busy; after discard they proceed'


def test_logs_contain_no_document_text():
    """SDD 15: operational logs exclude document text. Titles and filenames are kept out too."""
    c = corpus()
    haystack = (c['root'] / 'journal.jsonl').read_text() + '\n' + c['log']
    assert haystack.count('"event"') >= 2 * 16, 'the run logged too little for this test to mean anything'
    windows = 0
    for chunk in c['run'].iter_chunks():
        text = chunk['text']
        for at in (0, len(text) // 2, max(0, len(text) - 24)):
            window = text[at:at + 24]
            if len(window.strip()) >= 16:
                assert window not in haystack, f'chunk text found in the log: {window!r}'
                windows += 1
    for record in c['run'].documents:
        assert record['display_title'] not in haystack, 'a document title was logged'
        assert record['source_filename'] not in haystack, 'a filename was logged'
    for candidate in c['review']['candidates']:
        assert candidate['source_filename'] not in haystack
        if candidate['reject_detail']:
            assert candidate['reject_detail'] not in haystack
    return (f'{haystack.count(chr(10))} log lines searched for {windows} text windows, '
            f'{len(c["run"].documents)} titles and 16 filenames: none present')


def test_parser_diagnostics_stay_off_stdout():
    """MuPDF writes its warnings to the process's stdout unless told not to."""
    env = {**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'}
    out = subprocess.run([sys.executable, '-m', 'src.pipeline', 'ingest', str(TRUNCATED),
                          str(FIX / 'corrupt' / 'corrupt_bad_xref.pdf'), '--out', str(fresh('quiet')),
                          '--accept-rejections'], cwd=ROOT, env=env, capture_output=True, text=True)
    assert out.returncode == 0, out.stdout[-300:] + out.stderr[-300:]
    assert 'MuPDF' not in out.stdout and 'MuPDF' not in out.stderr
    assert 'repair' not in out.stderr
    report = json.loads(next((TMP / 'quiet' / 'runs').glob('run_*/report.json')).read_bytes())
    counts = {c['source_filename']: c['parser_messages'] for c in report['candidates']}
    assert all(n > 0 for n in counts.values()), counts
    return f'no parser output on stdout or stderr; the report keeps the counts only: {counts}'


# ---------------------------------------------------------------------------
# G  the demo
# ---------------------------------------------------------------------------
def test_cli_demo_shows_validation_extraction_chunks_and_trace():
    env = {**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'}
    root = fresh('demo')
    out = subprocess.run([sys.executable, '-m', 'src.pipeline', 'ingest', str(NORMAL), str(NOT_PDF),
                          '--out', str(root), '--accept-rejections'], cwd=ROOT, env=env,
                         capture_output=True, text=True)
    assert out.returncode == 0, out.stdout[-400:] + out.stderr[-400:]
    text = out.stdout
    for needle in ('1. STAGE', '2. VALIDATE', '3. EXTRACT', '4. CHUNK', '5. REVIEW', '6. SEAL', '7. TRACE',
                   'ACCEPTED', 'REJECTED', 'non_pdf', '24 pages', f'{len(chunks(NORMAL))} chunks', 'run_', 'VERIFIED',
                   'page chars', 'rect(s)', 'stream[', '== chunk text'):
        assert needle in text, f'demo output lacks {needle!r}'
    assert text.count('[ok  ]') == 4 and 'FAIL' not in text
    refused = subprocess.run([sys.executable, '-m', 'src.pipeline', 'ingest', str(NORMAL), str(NOT_PDF),
                              '--out', str(fresh('demo2'))], cwd=ROOT, env=env, capture_output=True, text=True)
    assert refused.returncode == 2 and 'Nothing was sealed' in refused.stdout
    nothing = subprocess.run([sys.executable, '-m', 'src.pipeline', 'ingest', str(NOT_PDF),
                              '--out', str(fresh('demo3'))], cwd=ROOT, env=env, capture_output=True, text=True)
    assert nothing.returncode == 3
    run_dir = next((root / 'runs').glob('run_*'))
    verified = subprocess.run([sys.executable, '-m', 'src.pipeline', 'verify', str(run_dir), '--deep'],
                              cwd=ROOT, env=env, capture_output=True, text=True)
    assert verified.returncode == 0 and 'VERIFIED' in verified.stdout
    return ('ingest prints validation, chunk counts, seal, verify and a 4-point trace (exit 0); '
            'exit 2 when a rejection is unconfirmed, 3 when nothing is accepted; verify --deep exits 0')


TESTS = [v for k, v in sorted(globals().items()) if k.startswith('test_')]

if __name__ == '__main__':
    only = sys.argv[1] if len(sys.argv) > 1 else ''
    selected = [fn for fn in TESTS if only in fn.__name__]
    failed = skipped = 0
    started = time.perf_counter()
    for fn in selected:
        t = time.perf_counter()
        try:
            detail = fn()
            if str(detail).startswith('SKIPPED'):
                skipped += 1
                print(f'  SKIP  {fn.__name__}\n        {detail}')
                continue
            print(f'  PASS  {fn.__name__}  ({time.perf_counter() - t:.1f}s)\n        {detail}')
        except AssertionError as e:
            failed += 1
            print(f'  FAIL  {fn.__name__}\n        {e}')
        except Exception as e:
            failed += 1
            print(f'  ERROR {fn.__name__}\n        {type(e).__name__}: {e}')
    shutil.rmtree(TMP, ignore_errors=True)
    ran = len(selected) - skipped
    print(f'\n{ran - failed}/{ran} passed in {time.perf_counter() - started:.1f}s'
          + (f'; {skipped} SKIPPED (set E3_LIBRARY to the document store\'s secure_qa/library)'
             if skipped else ''))
    sys.exit(1 if failed else 0)
