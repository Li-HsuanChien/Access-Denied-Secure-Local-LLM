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

from src.ingest import _boundaries, chunks, extract, validate
from src.schema import ChunkerConfig, Document, citation_targets
from src.validation import CheckStatus, IngestionPolicy, Outcome, RejectReason

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
    deferred = [f['id'] for f in manifest['fixtures']
                if f['expected_outcome'] == 'decision_required']
    asserted = len(manifest['fixtures']) - len(deferred)
    return (f'{asserted} fixtures validate as labeled, '
            f'{len(deferred)} deferred pending the open decisions')


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


# ---------------------------------------------------------------------------
# Week 2  "chunk size/overlap behavior is testable"
#
# The chunker is naive on purpose, but naive is not the same as unspecified.
# These pin the two knobs E3 will tune against, so replacing the chunker with a
# sentence-aware one cannot quietly change what target_chars and overlap_chars
# mean.
# ---------------------------------------------------------------------------
SIZE_CONFIGS = [
    ChunkerConfig(),
    ChunkerConfig(target_chars=600, overlap_chars=100),
    ChunkerConfig(target_chars=2400, overlap_chars=400),
    ChunkerConfig(target_chars=1200, overlap_chars=0),
]


def _stream(path):
    text, _, doc = extract(path)
    doc.close()
    return text


def test_chunk_size_respects_the_target():
    """
    target_chars is a budget, not a suggestion. Only the final chunk may exceed
    it, and only because a tail shorter than min_chunk_chars is folded back in
    rather than emitted as a runt.
    """
    checked = 0
    for cfg in SIZE_CONFIGS:
        cs = chunks(NORMAL, cfg)
        assert cs, f'config {cfg.config_id} produced no chunks'
        for c in cs[:-1]:
            size = c.char_end - c.char_start
            assert size <= cfg.target_chars, (
                f'chunk {c.ordinal} is {size} chars, over target {cfg.target_chars}')
        budget = cfg.target_chars + cfg.min_chunk_chars
        tail = cs[-1].char_end - cs[-1].char_start
        assert tail <= budget, f'final chunk is {tail} chars, over budget {budget}'
        checked += len(cs)
    return f'{checked} chunks stay within target across {len(SIZE_CONFIGS)} configs'


def test_overlap_covers_the_configured_window():
    """
    Overlap is now sentence-aligned, so it is a floor rather than an exact
    figure: the chunk starts at the sentence boundary at or before
    (previous_end - overlap_chars), which can only reach further back, never
    less far. The shared region is still the same characters in both - the tail
    of one, the head of the next - because retrieval dedupes against it.

    The window is also capped at half the previous chunk. Without that, a chunk
    shorter than overlap_chars would step back as far as it stepped forward and
    the cursor would crawl one character at a time.
    """
    text = _stream(NORMAL)
    pairs = 0
    for cfg in SIZE_CONFIGS:
        cs = chunks(NORMAL, cfg)
        for a, b in zip(cs, cs[1:]):
            overlap = a.char_end - b.char_start
            floor = min(cfg.overlap_chars, (a.char_end - a.char_start) // 2)
            assert overlap >= floor, (
                f'chunks {a.ordinal}->{b.ordinal} overlap {overlap}, floor {floor}')
            assert b.char_start > a.char_start, 'chunker failed to advance'
            if overlap:
                shared = text[b.char_start:a.char_end]
                assert a.text.endswith(shared), 'overlap is not the tail of the earlier chunk'
                assert b.text.startswith(shared), 'overlap is not the head of the later chunk'
            pairs += 1
    return f'{pairs} adjacent pairs overlap by at least the configured window'


def test_zero_overlap_produces_a_clean_partition():
    """With overlap disabled the chunks are a partition: no gaps, no duplication."""
    cfg = ChunkerConfig(overlap_chars=0)
    text = _stream(NORMAL)
    cs = chunks(NORMAL, cfg)
    for a, b in zip(cs, cs[1:]):
        assert b.char_start == a.char_end, f'gap or overlap at chunk {b.ordinal}'
    assert ''.join(c.text for c in cs) == text, 'concatenated chunks do not rebuild the stream'
    return f'{len(cs)} chunks partition the stream exactly, reproducing it verbatim'


def test_chunks_cover_the_whole_stream():
    """
    No character of the extracted stream is unreachable. A dropped region would
    be text the user can see in the PDF and the system can never retrieve.
    """
    text = _stream(NORMAL)
    for cfg in SIZE_CONFIGS:
        cs = chunks(NORMAL, cfg)
        assert cs[0].char_start == 0, 'stream does not start at the first chunk'
        assert cs[-1].char_end == len(text), 'stream is truncated at the last chunk'
        assert [c.ordinal for c in cs] == list(range(len(cs))), 'ordinals are not contiguous'
        for a, b in zip(cs, cs[1:]):
            assert b.char_start <= a.char_end, f'gap before chunk {b.ordinal}'
    return f'stream of {len(text)} chars fully covered under every config'


def test_chunker_progresses_when_overlap_exceeds_chunk_size():
    """
    The obvious way to hang this loop: set overlap_chars at or above the chunk
    size, so stepping back by the full overlap never advances the cursor. The
    step is clamped to at least one character, and overlap degrades to whatever
    the chunk can give rather than stalling.
    """
    cfg = ChunkerConfig(target_chars=300, overlap_chars=250)
    text = _stream(NORMAL)
    cs = chunks(NORMAL, cfg)
    assert cs, 'degenerate config produced no chunks'
    steps = [b.char_start - a.char_start for a, b in zip(cs, cs[1:])]
    assert min(steps) >= 1, f'chunker failed to advance (min step {min(steps)})'
    assert cs[-1].char_end == len(text), 'degenerate config lost the tail of the stream'
    for a, b in zip(cs, cs[1:]):
        assert b.char_start <= a.char_end, 'degenerate config opened a gap'
    return f'{len(cs)} chunks, min forward step {min(steps)}, full coverage held'


# ---------------------------------------------------------------------------
# Week 2  "normal PDFs extract page text; unreadable/encrypted/malformed
#          inputs return explicit errors"
# ---------------------------------------------------------------------------
def test_normal_pdfs_extract_page_text():
    """
    Every page of an accepted document contributes text, and the per-page
    offsets tile the canonical stream exactly. A page that silently extracts to
    nothing is the failure mode behind the truncated fixture, so absence of text
    is never allowed to pass unnoticed on a document we accept.
    """
    total_pages = 0
    for path in ACCEPTING:
        text, pages, doc = extract(path)
        page_count = doc.page_count
        doc.close()
        assert len(pages) == page_count, (
            f'{path.name}: extracted {len(pages)} pages, PDF reports {page_count}')
        blank = [p.number for p in pages if not p.has_text]
        assert not blank, f'{path.name}: pages with no extracted text: {blank}'
        assert pages[0].char_start == 0, f'{path.name}: stream does not start at page one'
        assert pages[-1].char_end == len(text), f'{path.name}: stream ends before the last page'
        for a, b in zip(pages, pages[1:]):
            assert b.char_start == a.char_end, (
                f'{path.name}: page offsets leave a gap at page {b.number}')
        total_pages += len(pages)
    return f'{total_pages} pages across {len(ACCEPTING)} documents all yield text'


def test_rejections_carry_an_explicit_reason_and_detail():
    """
    "Explicit" means three things, and a rejection is only actionable with all
    of them: a reason from the closed SDD 6.1 vocabulary for E4 to render, a
    human-readable detail naming the file's actual problem (SDD 9), and at least
    one failing check recording what was observed against what was expected.

    validate() also has to survive input that is not a PDF at all. Rejection is
    data, not an exception.
    """
    manifest = json.loads((ROOT / 'manifest.json').read_text())
    vocabulary = {r.value for r in RejectReason}
    rejected = 0
    for f in manifest['fixtures']:
        result = validate(ROOT / f['path'])
        if result.outcome is not Outcome.REJECTED:
            assert result.reject_reason is None, (
                f'{f["id"]} was not rejected but carries reason {result.reject_reason}')
            continue
        rejected += 1
        assert result.reject_reason is not None, f'{f["id"]} rejected with no reason'
        assert result.reject_reason.value in vocabulary, (
            f'{f["id"]} rejected with {result.reject_reason.value}, outside SDD 6.1')
        assert result.reject_detail and result.reject_detail.strip(), (
            f'{f["id"]} rejected with no human-readable detail')
        failing = [c for c in result.checks if c.status is CheckStatus.FAIL]
        assert failing, f'{f["id"]} rejected with no failing check to point at'

    with tempfile.TemporaryDirectory() as td:
        junk = Path(td) / 'not_really.pdf'
        junk.write_bytes(b'\x00\xff' * 512)
        result = validate(junk)
        assert result.outcome is Outcome.REJECTED, 'random bytes were not rejected'
        assert result.reject_reason is not None, 'random bytes rejected without a reason'
    return f'{rejected} rejections carry a vocabulary reason, a detail and a failing check'


# ---------------------------------------------------------------------------
# Week 3  "same file/config yields same IDs; chunk text/page/offsets are
#          stable; overlap/boundary tests pass"
# ---------------------------------------------------------------------------
def test_provenance_is_identical_across_runs():
    """
    The Week 3 demo, as an assertion: process the same document twice and every
    field a citation depends on must match - not just the ID, but the text, the
    offsets, the pages, and the highlight rectangles inside each page span.

    IDs matching while rectangles drifted would be the worst outcome: a citation
    that resolves and points somewhere wrong.
    """
    first, second = chunks(NORMAL), chunks(NORMAL)
    assert len(first) == len(second), 'chunk count is not reproducible'
    rects = 0
    for a, b in zip(first, second):
        assert a.chunk_id == b.chunk_id
        assert a.text == b.text and a.text_checksum_sha256 == b.text_checksum_sha256
        assert (a.char_start, a.char_end) == (b.char_start, b.char_end)
        assert (a.page_start, a.page_end) == (b.page_start, b.page_end)
        assert len(a.page_spans) == len(b.page_spans)
        for p, q in zip(a.page_spans, b.page_spans):
            assert p.page_number == q.page_number
            assert (p.char_start, p.char_end) == (q.char_start, q.char_end)
            assert (p.page_char_start, p.page_char_end) == (q.page_char_start, q.page_char_end)
            assert p.coordinates_reliable == q.coordinates_reliable
            assert p.highlight_rects == q.highlight_rects, 'highlight rectangles drifted'
            rects += len(p.highlight_rects)
    return f'{len(first)} chunks reproduce exactly, including {rects} highlight rectangles'


def test_chunks_never_split_a_word():
    """
    No chunk may begin or end in the middle of a word. This is the floor for
    'the chunk reads as text': a fragment starting 'ctrical generator' is
    useless to a reader and misleading to an embedding.
    """
    for path in ACCEPTING:
        text = _stream(path)
        for c in chunks(path):
            if c.char_start > 0:
                assert not (text[c.char_start - 1].isalnum() and text[c.char_start].isalnum()), \
                    f'{path.name} chunk {c.ordinal} starts mid-word'
            if c.char_end < len(text):
                assert not (text[c.char_end - 1].isalnum() and text[c.char_end].isalnum()), \
                    f'{path.name} chunk {c.ordinal} ends mid-word'
    return 'no chunk begins or ends inside a word, across all three documents'


def test_chunks_begin_on_sentence_boundaries():
    """
    Chunk starts land on a sentence or paragraph boundary wherever the text has
    one. Blocks with no sentence structure at all - a column of figure labels,
    a table - fall back to the word boundary, so this is a strong majority
    rather than an absolute.
    """
    for path in ACCEPTING:
        text = _stream(path)
        allowed = set(_boundaries(text))
        cs = chunks(path)
        on = sum(1 for c in cs if c.char_start in allowed)
        assert on / len(cs) >= 0.9, (
            f'{path.name}: only {on}/{len(cs)} chunks start on a sentence boundary')
    return 'at least 90% of chunks start on a sentence or paragraph boundary'


def test_running_headers_are_stripped():
    """
    The repeated header and footer are removed from the canonical stream.

    Left in, they appear once per page inside chunk text - 13% of the NRC
    stream - polluting every embedding with the same boilerplate and spending
    context budget E3 needs for actual content.
    """
    kept, _, doc = extract(NORMAL, strip_boilerplate=False)
    doc.close()
    stripped = _stream(NORMAL)
    header = 'Reactor Concepts Manual'
    footer = 'USNRC Technical Training Center'
    assert kept.count(header) >= 20, 'fixture no longer has a repeating header to strip'
    assert stripped.count(header) == 0, 'running header survived into the stream'
    assert stripped.count(footer) == 0, 'running footer survived into the stream'
    # Body text must not be collateral damage.
    assert 'The purpose of a nuclear power plant' in stripped
    assert 'HYDROELECTRIC PLANT' in stripped
    saved = len(kept) - len(stripped)
    return f'{saved} chars of running boilerplate removed ({100 * saved // len(kept)}% of the raw stream)'


def test_reading_order_follows_the_page():
    """
    Body text precedes the page footer, which is what reading order means and
    what content-stream order does not guarantee. Before sorting, the NRC footer
    was emitted before the body paragraph on all 24 pages.
    """
    text, pages, doc = extract(NORMAL, strip_boilerplate=False)
    doc.close()
    page1 = text[pages[0].char_start:pages[0].char_end]
    body = page1.index('The purpose of a nuclear power plant')
    footer = page1.index('USNRC Technical Training Center')
    assert body < footer, 'footer still precedes the body text on page 1'
    return 'body text precedes the page footer in the extracted stream'


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
