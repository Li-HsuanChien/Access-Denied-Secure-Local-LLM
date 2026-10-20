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
import re
import shutil
import sys
import tempfile
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import pymupdf
from jsonschema import Draft202012Validator
from referencing import Registry, Resource

from src.ingest import _merge_rects, chunks, extract, process, validate
from src.schema import ChunkerConfig, Document, citation_targets
from src.validation import CheckStatus, IngestionPolicy, Outcome, RejectReason

FIX = ROOT / 'fixtures'
NORMAL = FIX / 'normal' / 'normal_nrc_reactor_concepts_ch01.pdf'
LARGE = FIX / 'large' / 'large_doe_nuclear_physics_v1.pdf'
ORIGINAL = FIX / 'large' / 'large_doe_nuclear_physics_v1_original.pdf'
ARXIV = FIX / 'layout' / 'layout_arxiv_two_column_2112.11583.pdf'
ACCEPTING = [NORMAL, LARGE, ORIGINAL, ARXIV]


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


# MuPDF prints its diagnostics straight to the terminal. The damaged files
# below draw plenty; the tests read them through the library instead.
pymupdf.TOOLS.mupdf_display_errors(False)
pymupdf.TOOLS.mupdf_display_warnings(False)


# ---------------------------------------------------------------------------
# hand-built PDFs, for damage no fixture file carries
# ---------------------------------------------------------------------------
def _raw_pdf(objects: list[bytes]) -> bytes:
    """A PDF with a correct xref table from object bodies numbered 1, 2, 3..."""
    out, offsets = bytearray(b'%PDF-1.4\n'), []
    for number, body in enumerate(objects, 1):
        offsets.append(len(out))
        out += b'%d 0 obj\n' % number + body + b'\nendobj\n'
    xref = len(out)
    out += b'xref\n0 %d\n0000000000 65535 f \n' % (len(objects) + 1)
    for offset in offsets:
        out += b'%010d 00000 n \n' % offset
    out += b'trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n' % (len(objects) + 1, xref)
    return bytes(out)


def _pdf_stream(data: bytes) -> bytes:
    return b'<< /Length %d >>\nstream\n' % len(data) + data + b'\nendstream'


_HELVETICA = b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'


def _prose(page: int) -> bytes:
    lines = b''.join(b'(Page %d line %d. The primary loop carries heat to the steam generator.) Tj T* '
                     % (page, n) for n in range(1, 13))
    return b'BT /F1 11 Tf 72 720 Td 14 TL ' + lines + b'ET'


def _pdf_claiming(real: int, claimed: int) -> bytes:
    """`real` pages of text under a page tree whose /Count says `claimed`."""
    kids = b' '.join(b'%d 0 R' % (4 + 2 * i) for i in range(real))
    objects = [b'<< /Type /Catalog /Pages 2 0 R >>',
               b'<< /Type /Pages /Kids [' + kids + b'] /Count %d >>' % claimed, _HELVETICA]
    for i in range(real):
        objects.append(b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources '
                       b'<< /Font << /F1 3 0 R >> >> /Contents %d 0 R >>' % (5 + 2 * i))
        objects.append(_pdf_stream(_prose(i + 1)))
    return _raw_pdf(objects)


def _pdf_with_special_page(pages: int, special: int | None, content: bytes) -> bytes:
    """`pages` pages of prose; page `special` (1-based) has `content` instead. A
    Type3 font with made-up glyph names and no ToUnicode map is on hand as /T3."""
    def glyph(width: int) -> bytes:
        return _pdf_stream(b'600 0 50 0 550 700 d1 50 0 %d 700 re f' % width)
    type3 = (b'<< /Type /Font /Subtype /Type3 /FontBBox [0 0 600 700] '
             b'/FontMatrix [0.001 0 0 0.001 0 0] '
             b'/CharProcs << /glyphA 7 0 R /glyphB 8 0 R /glyphC 9 0 R >> '
             b'/Encoding << /Type /Encoding /Differences [1 /glyphA /glyphB /glyphC] >> '
             b'/FirstChar 1 /LastChar 3 /Widths [600 600 600] /Resources << >> >>')
    kids = b' '.join(b'%d 0 R' % (10 + i) for i in range(pages))
    objects = [b'<< /Type /Catalog /Pages 2 0 R >>',
               b'<< /Type /Pages /Kids [' + kids + b'] /Count %d >>' % pages,
               _HELVETICA, type3, _pdf_stream(_prose(0)), _pdf_stream(content),
               glyph(500), glyph(300), glyph(150)]
    for i in range(pages):
        objects.append(b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources '
                       b'<< /Font << /F1 3 0 R /T3 4 0 R >> >> /Contents %d 0 R >>'
                       % (6 if i + 1 == special else 5))
    return _raw_pdf(objects)


_UNNAMED_GLYPHS = (b'BT /T3 16 Tf 72 720 Td 22 TL '
                   + b'<01020301020302010302010302010203> Tj T* ' * 20 + b'ET')


def _listing_pdf(path: Path, pages: int, header: str | None = None, rows: int = 46) -> list[str]:
    """Pages of same-shaped rows from the top margin down, optionally under a
    running header set at the same leading. Returns the rows written."""
    doc, written = pymupdf.open(), []
    for p in range(pages):
        page, y = doc.new_page(), 72
        if header is not None:
            page.insert_text((72, y), f'{header}   Page {p + 1}', fontsize=10)
            y += 14
        for r in range(rows):
            n = p * rows + r
            written.append(f'Run {6300 + n} completed in {(n * 37 % 990) / 10 + 1:4.1f} s '
                           f'with {n % 4} errors.')
            page.insert_text((72, y + 14 * r), written[-1], fontsize=10)
    doc.save(path)
    doc.close()
    return written


def _failing(result):
    """The check a rejection rests on."""
    return [c for c in result.checks if c.status is CheckStatus.FAIL][-1]


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
        result = validate(path)
        errors = sorted(v.iter_errors(result.to_dict()), key=lambda e: e.path)
        assert not errors, f'{path.name}: {errors[0].message}'
        # A verdict on a labelled fixture has to come from a check that
        # decided, never from the catch-all that turns a crash into "corrupt".
        crashed = [c.check_id for c in result.checks
                   if isinstance(c.observed, dict) and c.observed.get('unguarded')]
        assert not crashed, f'{path.name}: verdict came from the backstop, not from a check'
        n += 1
    return f'{n} validation results conform, none decided by the catch-all'


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
    return 'all four policy decisions, three open and the settled size cap, flip behavior from config alone'


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
    # Rejected by the check that looks for truncation, for the reason it gives,
    # and not by anything that merely happened to fail.
    check = _failing(broken)
    assert check.check_id == 'structural_integrity', check.check_id
    assert check.observed['repaired'] and check.observed['unreadable_pages'], check.observed
    assert check.observed['pages_with_text'] == 3 and check.observed['pages'] == 24, check.observed
    # And confirm the page count really was identical, which is the trap.
    reopened = pymupdf.open(truncated)
    count = reopened.page_count
    reopened.close()
    assert count == 24
    return ('truncated file rejected despite reporting a full 24-page count: '
            '3 of 24 pages came back with text')


def test_a_truncated_document_is_rejected_however_dense_it_is():
    """
    Average characters per page cannot be the truncation test. A text-dense
    document keeps a healthy average after losing most of its pages: the first
    30% of the DOE reflow is 20 pages of 96 and still 490 characters per page
    overall. It used to be accepted with the message "text recovery looks
    complete". A rebuilt document with pages that came back empty is rejected,
    and the recoverable kind of damage (every page still has its text) is not.
    """
    work = Path(tempfile.mkdtemp(prefix='e2-truncated-'))
    try:
        raw, seen = LARGE.read_bytes(), []
        for share in (30, 50, 80, 97):
            cut = work / f'dense_{share}.pdf'
            cut.write_bytes(raw[:len(raw) * share // 100])
            result = validate(cut)
            assert result.outcome is Outcome.REJECTED and result.reject_reason is RejectReason.CORRUPT, (
                f'first {share}% of the DOE reflow: {result.outcome.value}')
            check = _failing(result)
            assert check.check_id == 'structural_integrity' and check.observed['unreadable_pages'], (
                f'{share}%: rejected by {check.check_id} {check.observed}')
            assert result.document is None and process(cut).chunks is None
            seen.append(f'{share}%: {check.observed["pages_with_text"]} of 96 pages')
        nearly = work / 'dense_99.pdf'
        nearly.write_bytes(raw[:len(raw) * 99 // 100])       # only the xref table is gone
        kept = validate(nearly)
        assert kept.outcome is Outcome.ACCEPTED_WITH_WARNINGS, kept.outcome.value
        assert [w['code'] for w in kept.warnings] == ['structure_repaired']
    finally:
        shutil.rmtree(work, ignore_errors=True)
    return f'rejected at {"; ".join(seen)}. With only the xref lost, accepted with a warning'


def test_declared_page_count_must_match_the_pages_read():
    """
    The page count is read before any page is. A file whose page index says 20
    over 12 real pages used to be accepted as a clean 20-page document, and one
    whose index says 3 as a clean 3-page document with nine pages of text
    silently dropped. Neither file is "repaired" as far as the parser is
    concerned, so nothing else catches them.
    """
    work = Path(tempfile.mkdtemp(prefix='e2-count-'))
    try:
        for claimed in (20, 3):
            path = work / f'claims_{claimed}.pdf'
            path.write_bytes(_pdf_claiming(12, claimed))
            result = validate(path)
            assert result.outcome is Outcome.REJECTED and result.reject_reason is RejectReason.CORRUPT, (
                f'12 pages under /Count {claimed}: {result.outcome.value}')
            assert _failing(result).check_id == 'structural_integrity'
            assert 'unguarded' not in _failing(result).observed
        honest = work / 'claims_12.pdf'
        honest.write_bytes(_pdf_claiming(12, 12))
        result = validate(honest)
        assert result.outcome is Outcome.ACCEPTED and result.document['page_count'] == 12
        text, pages, doc = extract(honest)
        doc.close()
        assert len(pages) == 12 and 'Page 12 line 12.' in text
    finally:
        shutil.rmtree(work, ignore_errors=True)
    return 'a page index that overstates or understates the pages is rejected as corrupt; an honest one is accepted'


def test_a_page_of_unnamed_glyphs_is_not_called_blank():
    """
    A page set in a font with no Unicode map yields lines of U+FFFD, which the
    stream leaves out. The page is visible to a reader and invisible to search,
    so it must be named, not counted among the blank pages.
    """
    work = Path(tempfile.mkdtemp(prefix='e2-glyphs-'))
    try:
        mixed = work / 'page_15_unnamed.pdf'
        mixed.write_bytes(_pdf_with_special_page(30, 15, _UNNAMED_GLYPHS))
        result = validate(mixed)
        observed = next(c for c in result.checks if c.check_id == 'text_yield').observed
        assert result.outcome is Outcome.ACCEPTED_WITH_WARNINGS, result.outcome.value
        assert observed['unreadable_pages'] == [15] and observed['blank_pages'] == [], observed
        assert result.warnings[0]['code'] == 'pages_without_text' and result.warnings[0]['pages'] == [15]

        alone = work / 'only_unnamed.pdf'
        alone.write_bytes(_pdf_with_special_page(1, 1, _UNNAMED_GLYPHS))
        result = validate(alone)
        assert result.outcome is Outcome.REJECTED and 'are blank' not in result.reject_detail, (
            result.reject_detail)

        empty = work / 'page_15_empty.pdf'
        empty.write_bytes(_pdf_with_special_page(30, 15, b''))
        result = validate(empty)
        observed = next(c for c in result.checks if c.check_id == 'text_yield').observed
        assert result.outcome is Outcome.ACCEPTED and observed['blank_pages'] == [15], observed
    finally:
        shutil.rmtree(work, ignore_errors=True)
    return 'a page of glyphs with no names warns as unreadable; a page with nothing on it is still blank'


def test_a_damaged_page_that_kept_some_text_is_named():
    """
    A page whose content stream ends half way yields some text, so it counts as
    a page with text, and the file is not "repaired": its xref is fine. What
    the parser said about that page is the only evidence, and it used to be
    read only for pages that came back empty.
    """
    work = Path(tempfile.mkdtemp(prefix='e2-damaged-'))
    try:
        def build(path: Path, damage: int | None) -> None:
            doc = pymupdf.open()
            for p in range(1, 9):
                page = doc.new_page()
                for n in range(1, 41):
                    page.insert_text((54, 56 + 16 * n), f'The reactor coolant pump {p} line {n} '
                                     f'maintains flow through the core.', fontsize=8)
            for page in doc:
                page.clean_contents()
            if damage is not None:
                xref = doc[damage - 1].get_contents()[0]
                packed = zlib.compress(doc.xref_stream(xref))
                doc.update_stream(xref, packed[:len(packed) // 2], compress=False)
                doc.xref_set_key(xref, 'Filter', '/FlateDecode')
            doc.save(path, garbage=0, deflate=False)
            doc.close()

        build(work / 'intact.pdf', None)
        build(work / 'page_5_cut.pdf', 5)
        intact, cut = validate(work / 'intact.pdf'), validate(work / 'page_5_cut.pdf')
        assert intact.outcome is Outcome.ACCEPTED and intact.warnings == []
        assert cut.outcome is Outcome.ACCEPTED_WITH_WARNINGS, cut.outcome.value
        assert [(w['code'], w['pages']) for w in cut.warnings] == [('pages_damaged', [5])], cut.warnings
        observed = next(c for c in cut.checks if c.check_id == 'text_yield').observed
        assert observed['damaged_pages'] == [5] and observed['empty_pages'] == []
    finally:
        shutil.rmtree(work, ignore_errors=True)
    return 'a page cut off part-way is accepted with a pages_damaged warning naming it; its intact twin is clean'


def test_settings_are_checked_when_they_are_made():
    """
    A misspelt policy value used to select the permissive branch without a
    word, and a chunk size of zero produced almost no chunks without an error.
    """
    refused = 0
    for make in (lambda: IngestionPolicy(repaired_document='rejcet'),
                 lambda: IngestionPolicy(extraction_restricted='deny'),
                 lambda: IngestionPolicy(min_pages_with_text_ratio_warn=95),
                 lambda: IngestionPolicy(max_pages=-1),
                 lambda: ChunkerConfig(target_chars=0),
                 lambda: ChunkerConfig(target_chars=-5),
                 lambda: ChunkerConfig(overlap_chars=-1),
                 lambda: ChunkerConfig(min_chunk_chars=1.5)):
        try:
            make()
        except ValueError:
            refused += 1
    assert refused == 8, f'{8 - refused} nonsense settings were accepted'
    # A file refused for its size in bytes says so, and does not quote the page limit.
    result = validate(NORMAL, IngestionPolicy(max_bytes=1000))
    assert result.reject_reason is RejectReason.OVERSIZED
    assert 'bytes' in result.reject_detail and 'page' not in result.reject_detail, result.reject_detail
    return '8 nonsense settings raise ValueError; a byte-size rejection names the byte limit'


# ---------------------------------------------------------------------------
# Week 2  "chunk size/overlap behavior is testable"
#
# These pin what target_chars, overlap_chars and min_chunk_chars mean, so a
# change to how boundaries are chosen cannot quietly change the knobs E3 tunes
# against. Where the boundaries fall is tested in test_chunking.py.
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


def test_overlap_is_bounded_and_shared_verbatim():
    """
    overlap_chars is the most text adjacent chunks share, in whole sentences.
    When the last sentence is itself longer than that window, that one sentence
    is shared rather than nothing, so the overlap can exceed overlap_chars; it
    never exceeds half the chunk. Whatever is shared is the same characters in
    both chunks - the tail of one, the head of the next - because retrieval
    dedupes against it.
    """
    text = _stream(NORMAL)
    pairs = shared = 0
    for cfg in SIZE_CONFIGS:
        cs = chunks(NORMAL, cfg)
        for a, b in zip(cs, cs[1:]):
            overlap = a.char_end - b.char_start
            assert 0 <= overlap <= (a.char_end - a.char_start) // 2, (
                f'chunks {a.ordinal}->{b.ordinal} overlap {overlap} of a '
                f'{a.char_end - a.char_start}-char chunk')
            assert b.char_start > a.char_start and b.char_end > a.char_end, 'chunker failed to advance'
            assert cfg.overlap_chars or overlap == 0, 'overlap with overlap_chars=0'
            if overlap:
                piece = text[b.char_start:a.char_end]
                assert a.text.endswith(piece), 'overlap is not the tail of the earlier chunk'
                assert b.text.startswith(piece), 'overlap is not the head of the later chunk'
                shared += 1
            pairs += 1
    return f'{pairs} adjacent pairs, {shared} share text, none more than half a chunk'


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
    Every page of an accepted document that has something on it contributes
    text, and the per-page offsets tile the canonical stream exactly. A page
    that silently extracts to nothing is the failure mode behind the truncated
    fixture, so a page without text must be blank in the PDF itself: no image
    on it either. The original DOE handbook has six such pages.
    """
    total_pages = blank_pages = 0
    for path in ACCEPTING:
        text, pages, doc = extract(path)
        page_count = doc.page_count
        doc.close()
        assert len(pages) == page_count, (
            f'{path.name}: extracted {len(pages)} pages, PDF reports {page_count}')
        lost = [p.number for p in pages if not p.has_text and p.images]
        assert not lost, f'{path.name}: pages that draw an image but yielded no text: {lost}'
        assert validate(path).warnings == [], f'{path.name}: accepted with warnings'
        blank = [p.number for p in pages if not p.has_text]
        assert pages[0].char_start == 0, f'{path.name}: stream does not start at page one'
        assert pages[-1].char_end == len(text), f'{path.name}: stream ends before the last page'
        for a, b in zip(pages, pages[1:]):
            assert b.char_start == a.char_end, (
                f'{path.name}: page offsets leave a gap at page {b.number}')
        total_pages += len(pages)
        blank_pages += len(blank)
    return (f'{total_pages - blank_pages} of {total_pages} pages across {len(ACCEPTING)} documents '
            f'yield text; the other {blank_pages} are blank in the PDF')


def test_pages_without_text_are_always_on_record():
    """
    Nothing is lost silently. The text_yield check lists every page without
    text whatever its verdict, says so in its message, and warns whenever such
    a page draws an image, because that page exists for a reader and not for
    search.
    """
    result = validate(ORIGINAL)
    check = next(c for c in result.checks if c.check_id == 'text_yield')
    assert check.observed['empty_pages'] == [4, 6, 8, 10, 12, 94], check.observed
    assert check.observed['blank_pages'] == [4, 6, 8, 10, 12, 94], check.observed
    assert check.observed['image_only_pages'] == check.observed['unreadable_pages'] == []
    assert check.status is CheckStatus.PASS and 'blank' in check.message, check.message
    assert 'All pages' not in check.message, 'blank pages reported as having text'
    assert result.outcome is Outcome.ACCEPTED

    # The same six blank pages are a warning once they are more of the document
    # than the policy tolerates.
    strict = validate(ORIGINAL, IngestionPolicy(min_pages_with_text_ratio_warn=0.99))
    assert strict.outcome is Outcome.ACCEPTED_WITH_WARNINGS
    assert strict.warnings[0]['pages'] == [4, 6, 8, 10, 12, 94]

    mixed = validate(FIX / 'scanned' / 'scanned_mixed_text_and_image_pages.pdf')
    check = next(c for c in mixed.checks if c.check_id == 'text_yield')
    assert check.status is CheckStatus.WARN
    assert check.observed['image_only_pages'] == check.observed['empty_pages'] == [2, 6, 10, 14, 18, 22]
    assert check.observed['blank_pages'] == []
    assert mixed.warnings[0]['pages'] == [2, 6, 10, 14, 18, 22]

    # One scanned page in a long document is under any ratio threshold, and
    # still has to be named.
    import pymupdf
    with tempfile.TemporaryDirectory() as td:
        src = pymupdf.open(ORIGINAL)
        scan = src[24].get_pixmap(dpi=50)
        page = src[24]
        page.clean_contents()
        for xref in page.get_contents():
            src.update_stream(xref, b'')
        page.insert_image(page.rect, pixmap=scan)
        one = Path(td) / 'one_scanned_page.pdf'
        src.save(one)
        src.close()
        result = validate(one)
    check = next(c for c in result.checks if c.check_id == 'text_yield')
    assert check.observed['image_only_pages'] == [25], check.observed
    assert check.status is CheckStatus.WARN and result.outcome is Outcome.ACCEPTED_WITH_WARNINGS
    assert 25 in result.warnings[0]['pages']
    return 'blank pages are counted, image-only pages always warn, both are listed'


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
    # The vocabulary E4 renders from is the one in the published schema.
    schema = json.loads((ROOT / 'schemas' / 'validation_result.schema.json').read_text())
    vocabulary = {r for r in schema['properties']['reject_reason']['enum'] if r}
    assert vocabulary == {r.value for r in RejectReason}, 'schema and RejectReason disagree'
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


def test_ligatures_are_expanded():
    """
    A font's 'fi' or 'ff' glyph reaches the stream as two letters, not as one
    presentation-form code point (U+FB00 to U+FB06). Left in, "ﬁnd" matches
    neither "find" in a keyword search nor in most embedding vocabularies; E3
    found it in 46 of 309 chunks of the arXiv paper.
    """
    ligature = re.compile('[ﬀ-ﬆ]')
    expanded = 0
    for path in ACCEPTING:
        text = _stream(path)
        found = ligature.findall(text)
        assert not found, f'{path.name}: {len(found)} ligature code points, e.g. {found[:3]}'
        expanded += text.count('fi') + text.count('ff') + text.count('fl')
    assert expanded, 'no fi/ff/fl at all: the fixtures no longer exercise this'
    return f'no ligature code points in {len(ACCEPTING)} documents; {expanded} fi/ff/fl pairs read as letters'


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


def test_rows_of_a_listing_are_not_stripped_as_headers():
    """
    Digits collapse to '#' when lines are compared across pages, so every row
    of a log or a numeric table has one key, and the first three rows of each
    page of a header-less listing used to be removed as a "running header".
    A header's text does not also fill the page behind it.
    """
    work = Path(tempfile.mkdtemp(prefix='e2-listing-'))
    try:
        bare = work / 'listing.pdf'
        rows = _listing_pdf(bare, 5)
        text, _, doc = extract(bare)
        doc.close()
        kept = [line for line in text.split('\n') if line.strip()]
        assert kept == rows, f'{len(rows) - len(kept)} of {len(rows)} listing rows were stripped'

        # A real running header set at the same leading as the rows under it:
        # the header goes, and takes no row with it.
        headed = work / 'headed_listing.pdf'
        rows = _listing_pdf(headed, 5, header='Facility Operations Log')
        text, _, doc = extract(headed)
        doc.close()
        kept = [line for line in text.split('\n') if line.strip()]
        assert kept == rows, (f'{len(rows) - len([r for r in rows if r in kept])} rows lost, '
                              f'{sum("Facility" in k for k in kept)} header lines kept')
    finally:
        shutil.rmtree(work, ignore_errors=True)
    return '230 rows of a header-less listing all survive; under a real header only the 5 header lines go'


def test_highlights_cover_every_span_of_the_chunk():
    """
    A highlight has to cover the text it cites. Merging span boxes into one box
    per line used to drop whatever lay to the left when two spans of a line
    differed in height by a fraction of a point: 25 spans on the NRC fixture,
    including the first 309 points of a body line.
    """
    assert _merge_rects([[54.0, 587.9, 363.1, 601.2], [363.1, 587.8, 380.0, 601.2]]) == [
        [54.0, 587.8, 380.0, 601.2]], 'two spans of one line did not merge into one box'
    assert len(_merge_rects([[82.1, 162.8, 107.8, 170.3], [347.1, 161.5, 372.7, 170.5]])) == 2, (
        'two labels across a figure were bridged into one box')
    spans_seen = boxes = 0
    for path in ACCEPTING:
        _, pages, doc = extract(path)
        doc.close()
        by_number = {p.number: p for p in pages}
        for c in chunks(path):
            for ps in c.page_spans:
                boxes += len(ps.highlight_rects)
                for span in by_number[ps.page_number].spans:
                    if span.start < ps.char_end and span.end > ps.char_start:
                        spans_seen += 1
                        assert any(r[0] - .02 <= span.bbox[0] and r[1] - .02 <= span.bbox[1]
                                   and r[2] + .02 >= span.bbox[2] and r[3] + .02 >= span.bbox[3]
                                   for r in ps.highlight_rects), (
                            f'{path.name} chunk {c.ordinal} page {ps.page_number}: '
                            f'a span at {span.bbox} is outside every highlight box')
    return f'{spans_seen} spans across {len(ACCEPTING)} documents each lie inside one of {boxes} highlight boxes'


def test_a_sparse_page_follows_the_columns_of_its_document():
    """
    Page 5 of the two-column paper is mostly figures: four lines of text in its
    left column, too few to prove a gutter by themselves. Read top to bottom,
    the sentence that runs over from page 4 came out with its end before its
    middle. Such a page borrows the gutter the rest of the document uses.
    """
    text, pages, doc = extract(ARXIV)
    doc.close()
    page5 = text[pages[4].char_start:pages[4].char_end]
    middle, end = page5.find('Szilard in real-'), page5.find('izing 2n neutron production')
    assert 0 <= middle < end, f'page 5 is still read across its columns ({middle}, {end})'
    # A one-column document has no gutter to lend, and is left exactly as sorted.
    plain, _, doc = extract(NORMAL)
    doc.close()
    assert plain.index('The purpose of a nuclear power plant') < plain.index('HYDROELECTRIC PLANT')
    return 'on the figure page the carried-over sentence reads middle, then end'


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
