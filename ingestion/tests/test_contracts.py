"""
Contract tests for the E2 schemas.

These cover the criteria the timeline actually gates on:

  Week 1  "Schemas contain stable document/chunk IDs, page, text,
           offsets/provenance, checksum/metadata"
  Week 3  "Same file/config yields same IDs; chunk text/page/offsets are stable"
  Week 6  "Mapping survives reindex/versioning"

Run:  python3 tests/test_contracts.py
"""
from __future__ import annotations

import json
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from jsonschema import Draft202012Validator
from referencing import Registry, Resource

from src.ingest import chunks, extract, validate
from src.schema import ChunkerConfig, Document, citation_targets
from src.validation import IngestionPolicy, Outcome

FIX = ROOT / 'fixtures'
NORMAL = FIX / 'normal' / 'normal_nrc_reactor_concepts_ch01.pdf'
LARGE = FIX / 'large' / 'large_doe_nuclear_physics_v1.pdf'
ARXIV = FIX / 'layout' / 'layout_arxiv_two_column_2112.11583.pdf'
ACCEPTING = [NORMAL, LARGE, ARXIV]


def _registry():
    reg = Registry()
    for name in ('document', 'chunk', 'validation_result'):
        s = json.loads((ROOT / 'schemas' / f'{name}.schema.json').read_text())
        reg = reg.with_resource(s['$id'], Resource.from_contents(s))
    return reg


REGISTRY = _registry()


def validator_for(name):
    schema = json.loads((ROOT / 'schemas' / f'{name}.schema.json').read_text())
    return Draft202012Validator(schema, registry=REGISTRY)


# ---------------------------------------------------------------------------
def test_chunks_conform_to_schema():
    v = validator_for('chunk')
    total = 0
    for path in ACCEPTING:
        for c in chunks(path):
            errors = sorted(v.iter_errors(c.to_dict()), key=lambda e: e.path)
            assert not errors, f'{path.name} chunk {c.ordinal}: {errors[0].message}'
            total += 1
    return f'{total} chunks conform'


def test_validation_results_conform_to_schema():
    v = validator_for('validation_result')
    n = 0
    for path in sorted(FIX.rglob('*.pdf')):
        errors = sorted(v.iter_errors(validate(path).to_dict()), key=lambda e: e.path)
        assert not errors, f'{path.name}: {errors[0].message}'
        n += 1
    return f'{n} validation results conform'


def test_same_file_and_config_yield_same_ids():
    """Week 3: same file/config yields same IDs."""
    for path in ACCEPTING:
        a = [c.chunk_id for c in chunks(path)]
        b = [c.chunk_id for c in chunks(path)]
        assert a == b, f'{path.name}: chunk IDs are not reproducible'
        assert len(set(a)) == len(a), f'{path.name}: duplicate chunk IDs'
    return 'chunk IDs reproduce exactly across runs'


def test_reindex_preserves_ids():
    """Week 6: source mapping survives reindex. A re-import must not renumber anything."""
    with tempfile.TemporaryDirectory() as tmp:
        copy = Path(tmp) / 'renamed_on_reimport.pdf'
        shutil.copy(NORMAL, copy)
        before = {c.chunk_id: (c.char_start, c.char_end, c.page_start) for c in chunks(NORMAL)}
        after = {c.chunk_id: (c.char_start, c.char_end, c.page_start) for c in chunks(copy)}
    assert before == after, 'chunk identity changed when the file was re-imported under a new name'
    return f'{len(before)} chunk IDs survive re-import under a different filename'


def test_document_id_is_content_addressed():
    a = Document.make_id(NORMAL.read_bytes())
    b = Document.make_id(NORMAL.read_bytes())
    c = Document.make_id(ARXIV.read_bytes())
    assert a == b and a != c
    return 'document IDs are content-addressed'


def test_config_change_changes_every_id():
    """Changing chunk boundaries must change identity; stale IDs would point at moved text."""
    base = {c.chunk_id for c in chunks(NORMAL, ChunkerConfig())}
    wider = {c.chunk_id for c in chunks(NORMAL, ChunkerConfig(target_chars=1800))}
    assert not (base & wider), 'chunk IDs collided across different chunker configs'
    return f'{len(base)} vs {len(wider)} chunks, no ID collisions across configs'


def test_offsets_reconstruct_chunk_text():
    """Provenance integrity: offsets must index the canonical stream exactly."""
    for path in ACCEPTING:
        text, _, doc = extract(path)
        doc.close()
        for c in chunks(path):
            assert text[c.char_start:c.char_end] == c.text, \
                f'{path.name} chunk {c.ordinal}: offsets do not reproduce the chunk text'
    return 'offsets reproduce chunk text on every chunk'


def test_page_spans_tile_the_chunk():
    """Every character of a chunk is attributed to exactly one page, with no gaps."""
    for path in ACCEPTING:
        for c in chunks(path):
            assert c.page_spans[0].char_start == c.char_start
            assert c.page_spans[-1].char_end == c.char_end
            for a, b in zip(c.page_spans, c.page_spans[1:]):
                assert a.char_end == b.char_start, \
                    f'{path.name} chunk {c.ordinal}: gap between page spans'
                assert b.page_number > a.page_number
    return 'page spans tile every chunk contiguously'


def test_citations_resolve_to_pages_in_range():
    for path in ACCEPTING:
        doc_pages = validate(path).document['page_count']
        for c in chunks(path):
            for t in citation_targets(c):
                assert 1 <= t.page_number <= doc_pages
                if t.coordinates_reliable:
                    assert t.highlight_rects, 'reliable coordinates but no rectangles'
                    for x0, y0, x1, y1 in t.highlight_rects:
                        assert x1 > x0 and y1 > y0, 'degenerate highlight rectangle'
                        assert 0 <= x0 and x1 <= t.page_width + 1
                        assert 0 <= y0 and y1 <= t.page_height + 1
    return 'every citation resolves to an in-range page and a drawable rectangle'


def test_outcomes_match_manifest():
    """The corpus is only useful if the validator agrees with how it is labeled."""
    manifest = json.loads((ROOT / 'manifest.json').read_text())
    policy = IngestionPolicy()
    mismatches = []
    for f in manifest['fixtures']:
        result = validate(ROOT / f['path'], policy)
        expected = f['expected_outcome']
        actual = result.outcome.value
        if expected == 'accept' and actual == 'rejected':
            mismatches.append((f['id'], expected, actual, result.reject_detail))
        elif expected == 'reject' and actual != 'rejected':
            mismatches.append((f['id'], expected, actual, None))
        elif expected == 'reject' and result.reject_reason.value != f['reject_reason']:
            mismatches.append((f['id'], f['reject_reason'], result.reject_reason.value, None))
    assert not mismatches, f'manifest disagrees with validator: {mismatches}'
    return f'{len(manifest["fixtures"])} fixtures validate as the manifest labels them'


def test_policy_decisions_are_live_knobs():
    """Each open decision must change behavior from config alone, with no code change."""
    oversized = FIX / 'oversized' / 'oversized_1200_pages.pdf'
    restricted = FIX / 'protected' / 'protected_owner_password_no_extract.pdf'
    mixed = FIX / 'scanned' / 'scanned_mixed_text_and_image_pages.pdf'
    xref = FIX / 'corrupt' / 'corrupt_bad_xref.pdf'

    # Decision 4: the size cap
    assert validate(oversized, IngestionPolicy(max_pages=2000)).outcome != Outcome.REJECTED
    assert validate(oversized, IngestionPolicy(max_pages=1000)).outcome == Outcome.REJECTED

    # Decision 2: extraction restriction
    assert validate(restricted, IngestionPolicy(extraction_restricted='reject')).outcome == Outcome.REJECTED
    assert validate(restricted, IngestionPolicy(extraction_restricted='ignore')).outcome != Outcome.REJECTED

    # Decision 3: partial scan tolerance
    assert validate(mixed, IngestionPolicy()).outcome == Outcome.ACCEPTED_WITH_WARNINGS
    assert validate(mixed, IngestionPolicy(min_pages_with_text_ratio_reject=0.9)).outcome == Outcome.REJECTED

    # Decision 1: repaired documents
    assert validate(xref, IngestionPolicy(repaired_document='accept_with_warning')).outcome != Outcome.REJECTED
    assert validate(xref, IngestionPolicy(repaired_document='reject')).outcome == Outcome.REJECTED
    return 'all four open decisions flip behavior from config alone'


def test_truncation_is_caught_despite_correct_page_count():
    """
    The finding that motivates min_chars_per_page_when_repaired: a truncated file
    reports the same page count as the healthy original, so only text density
    separates them.
    """
    truncated = FIX / 'corrupt' / 'corrupt_truncated_50pct.pdf'
    healthy = validate(NORMAL)
    broken = validate(truncated)
    assert healthy.document['page_count'] == 24
    assert broken.outcome == Outcome.REJECTED
    assert broken.reject_reason.value == 'corrupt'
    # And confirm the page count really was identical, which is the trap.
    import pymupdf
    assert pymupdf.open(truncated).page_count == 24
    return 'truncated file rejected despite reporting a full 24-page count'


TESTS = [v for k, v in sorted(globals().items()) if k.startswith('test_')]

if __name__ == '__main__':
    failed = 0
    for fn in TESTS:
        try:
            detail = fn()
            print(f'  PASS  {fn.__name__}\n        {detail}')
        except AssertionError as e:
            failed += 1
            print(f'  FAIL  {fn.__name__}\n        {e}')
        except Exception as e:
            failed += 1
            print(f'  ERROR {fn.__name__}\n        {type(e).__name__}: {e}')
    print(f'\n{len(TESTS) - failed}/{len(TESTS)} passed')
    sys.exit(1 if failed else 0)
