"""
The single-document half of E2 ingestion: validate(), extract() and chunks(),
and process(), which does all three from one reading of the file. The import
flow across a batch of files is src/pipeline.py.

The canonical text stream
-------------------------
Text is assembled from PyMuPDF layout spans rather than page.get_text(), so
every character offset in a Chunk maps to a span with a known bounding box by
construction. Offsets and highlight rectangles therefore cannot disagree, which
is what SDD 7.3's "highlight the supporting passage" needs and what a separate
offset-then-search-for-coordinates step would keep getting subtly wrong.
"""
from __future__ import annotations

import bisect
import hashlib
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import pymupdf

from .schema import (SCHEMA_VERSION, Chunk, ChunkerConfig, Document, PageSpan,
                     text_checksum)
from .sentences import line_starts, sentence_starts
from .validation import (Check, CheckStatus, IngestionPolicy, Outcome,
                         RejectReason, ValidationResult)

# Bump when a verdict rule or the shape of a check's `observed` changes.
VALIDATOR_VERSION = 'e2-validate-2.0.0'
EXTRACTOR = f'pymupdf/{getattr(pymupdf, "__version__", "unknown")}'
PDF_MAGIC = b'%PDF-'
_HASH_BLOCK = 1 << 20                        # bytes read at a time when hashing a file


# ---------------------------------------------------------------------------
# extraction
# ---------------------------------------------------------------------------
@dataclass
class _Span:
    start: int
    end: int
    bbox: tuple[float, float, float, float]      # on the page as displayed


@dataclass
class _Page:
    number: int          # 1-based
    char_start: int      # offset into the document stream
    char_end: int
    width: float         # as displayed, i.e. after any page rotation
    height: float
    spans: list[_Span]
    images: int = 0      # image blocks drawn on the page; counted only when it yields no text
    undecoded: int = 0   # lines left out because no glyph on them could be named
    damaged: bool = False    # the parser reported damage while reading the page

    @property
    def has_text(self) -> bool:
        return self.char_end > self.char_start


_DIGITS = re.compile(r'\d+')
_WS = re.compile(r'\s+')
# C0 and C1 control codes. A PDF font with no Unicode map hands back the raw
# glyph code, so a Greek letter or an operator set in a symbol font arrives as
# U+0005 or, worse, as a literal newline in the middle of a line.
_CONTROL = re.compile(r'[\x00-\x1f\x7f-\x9f]')
_UNMAPPED = '\ufffd'                         # U+FFFD REPLACEMENT CHARACTER, one code point
# What MuPDF prints when content is lost, as opposed to its remarks on fonts
# and encodings, which a healthy file draws too.
_DAMAGE = re.compile(r'premature end|syntax error|zlib error|page may not be correct|format error'
                     r'|ignoring rest|non-page object|cannot (?:find|load|read)', re.I)
# The parser's page index and the document disagree: the page count is a guess.
_PAGE_TREE = re.compile(r'page tree|claims to have \d+ pages', re.I)


@dataclass(frozen=True)
class _HeaderRules:
    """
    Every threshold the running-header detector uses, in one place.

    All are set on the cautious side: wrongly dropping body text is far worse
    than keeping a header. Changing any of them changes the text stream, so it
    needs a chunker_version bump and the over-stripping tests rerun.
    """
    zone: float = 0.12            # outer fraction of the page a header may sit in
    max_band_rows: int = 3        # a header band is at most this many stacked rows
    row_tolerance: float = 2.0    # pt; lines this close in top AND bottom share a row
    chain_gap: float = 0.3        # a further row joins the band only if it starts within
                                  # this many row-heights of the row outside it
    min_run: int = 3              # pages a line must recur on, close together
    max_run_gap: int = 2          # page distance a run tolerates (blank verso, alternating text)
    min_purity: float = 0.5       # share of pages whose outermost row must be running text
    slot_tolerance: float = 1.5   # pt; how exactly a row must sit on a confirmed header position
                                  # (negative turns the slot rule off)
    max_size_ratio: float = 1.2   # a header is not set larger than this multiple of body text


_RULES = _HeaderRules()


@dataclass
class _Line:
    """One layout line, positioned in its own reading frame."""
    text: str
    pieces: list[tuple[str, tuple]]   # (span text, span box on the page as displayed)
    frame: int | None                 # writing direction: 0 right, 1 down, 2 left, 3 up; None if skewed
    top: float                        # distance from the page edge the text's top faces
    bottom: float
    extent: float                     # page size along that axis
    size: float                       # largest font size on the line


def _running_key(text: str) -> str:
    """
    Normalize a line so the same running header matches across pages.

    Page numbers and dates are the parts that vary, so digits collapse to '#'.
    'USNRC Technical Training Center 1-7 0703' and the same line on page 8
    reduce to one key.
    """
    return _DIGITS.sub('#', _WS.sub(' ', text.strip()).lower())


def _reading_frame(bbox, direction, width: float, height: float):
    """
    Where a line sits relative to the edge its own top faces.

    "Top of the page" for a header means the top as the header's reader holds
    the page, which is neither the stored nor the displayed orientation in
    general: the DOE handbook has a page typeset upright and then rotated a
    quarter turn for display, whose header runs down the right-hand edge of the
    screen. Measuring from the edge the text's top faces is the same number in
    stored and in displayed coordinates, provided the box, the direction and
    the page size are all given in one of them.
    """
    x0, y0, x1, y1 = bbox
    dx, dy = direction
    if abs(dx) >= 0.97:
        return (0, y0, y1, height) if dx > 0 else (2, height - y1, height - y0, height)
    if abs(dy) >= 0.97:
        return (1, width - x1, width - x0, width) if dy > 0 else (3, x0, x1, width)
    return None, 0.0, 0.0, 0.0


# ---- reading order ---------------------------------------------------------
def _gutters(blocks: list[dict], min_lines: int = 5) -> list[tuple[float, float]]:
    """
    The vertical strips that separate text columns, or [] on a one-column page.

    A gutter is a strip almost no line crosses with a real column on each side:
    at least min_lines lines, each at least 22% of the text width. That bar is
    what keeps table cells, list markers and scattered figure labels from being
    read as columns. Lines that run most of the width (a title, an abstract)
    are ignored here; they separate bands and are placed by _by_columns.
    """
    boxes = [line['bbox'] for block in blocks for line in block['lines']
             if line['entry'].frame == 0]
    if len(boxes) < 2 * min_lines:
        return []
    left = min(b[0] for b in boxes)
    width = max(b[2] for b in boxes) - left
    if width <= 0:
        return []
    narrow = [b for b in boxes if b[2] - b[0] < 0.6 * width]
    if len(narrow) < 2 * min_lines:
        return []
    bins = int(width) + 1
    cover = [0] * bins
    for x0, _, x1, _ in narrow:
        for i in range(max(0, int(x0 - left)), min(bins, int(x1 - left) + 1)):
            cover[i] += 1
    crossing = max(2, len(narrow) // 20)        # a centred heading or byline may cross
    found = []
    i, stop = int(0.15 * bins), int(0.85 * bins)
    while i < stop:
        if cover[i] > crossing:
            i += 1
            continue
        j = i
        while j < stop and cover[j] <= crossing:
            j += 1
        g0, g1 = left + i, left + j
        if g1 - g0 >= 6:
            wide = 0.22 * width
            before = sum(1 for b in narrow if b[2] <= g0 + 1 and b[2] - b[0] >= wide)
            after = sum(1 for b in narrow if b[0] >= g1 - 1 and b[2] - b[0] >= wide)
            if before >= min_lines and after >= min_lines:
                found.append((g0, g1))
        i = j
    return found


def _by_columns(blocks: list[dict], gutters: list[tuple[float, float]]) -> list[dict]:
    """Bands separated by blocks that span the columns; inside a band, column by column."""
    def column(block):
        centre = (block['bbox'][0] + block['bbox'][2]) / 2
        return sum(1 for g0, g1 in gutters if centre > (g0 + g1) / 2)

    def spanning(block):
        return any(block['bbox'][0] < g0 - 1 and block['bbox'][2] > g1 + 1 for g0, g1 in gutters)

    ordered: list[dict] = []
    band: list[dict] = []

    def flush():
        band.sort(key=lambda b: (column(b), round(b['bbox'][1], 1), b['bbox'][0]))
        ordered.extend(band)
        band.clear()

    for block in sorted(blocks, key=lambda b: (round(b['bbox'][1], 1), b['bbox'][0])):
        if spanning(block):
            flush()
            ordered.append(block)
        else:
            band.append(block)
    flush()
    return ordered


def _reading_order(blocks: list[dict], used: list | None = None) -> list[dict]:
    """
    Reorder a page's text blocks when part of it is set in columns. `used`, if
    given, receives the gutters the page was split on.

    Sorting by vertical position, which is what sort=True does, reads straight
    across a two-column page and interleaves the columns line by line. Columns
    often begin below a full-width title and abstract, so when the page as a
    whole has no gutter the largest lower part that has one is used, then the
    largest upper part, cutting only at a clean horizontal gap. A page with no
    columns comes back untouched: the same list object.
    """
    def note(gutters):
        if used is not None:
            used.append(tuple(gutters))
        return gutters

    gutters = _gutters(blocks)
    if gutters:
        return _by_columns(blocks, note(gutters))
    by_top = sorted(blocks, key=lambda b: (b['bbox'][1], b['bbox'][0]))
    for cut in range(1, len(by_top)):
        upper, lower = by_top[:cut], by_top[cut:]
        if max(b['bbox'][3] for b in upper) <= min(b['bbox'][1] for b in lower) + 1:
            gutters = _gutters(lower)
            if gutters:
                return _reading_order(upper) + _by_columns(lower, note(gutters))
    for cut in range(len(by_top) - 1, 0, -1):
        upper, lower = by_top[:cut], by_top[cut:]
        if max(b['bbox'][3] for b in upper) <= min(b['bbox'][1] for b in lower) + 1:
            gutters = _gutters(upper)
            if gutters:
                return _by_columns(upper, note(gutters)) + lower
    return blocks


def _set_on(blocks: list[dict], gutter: tuple[float, float]) -> bool:
    """
    True when a page too sparse to prove a gutter by itself is laid out on one
    the rest of the document uses: a wide line ends at the strip, another
    starts at it, and no more lines cross it than _gutters tolerates. A page of
    figures with a caption or two in each column is the case.
    """
    g0, g1 = gutter
    boxes = [line['bbox'] for block in blocks for line in block['lines']
             if line['entry'].frame == 0]
    if not boxes:
        return False
    wide = 0.22 * (max(b[2] for b in boxes) - min(b[0] for b in boxes))
    crossing = sum(1 for b in boxes if b[0] < g0 - 1 and b[2] > g1 + 1)
    ends = any(0 <= g0 + 1 - b[2] <= 4 and b[2] - b[0] >= wide for b in boxes)
    starts = any(0 <= b[0] - (g1 - 1) <= 4 and b[2] - b[0] >= wide for b in boxes)
    return ends and starts and crossing <= max(2, len(boxes) // 20)


# Text only: by default the 'dict' output carries every image's bytes, which
# nothing here reads. Images are counted, and only on pages that yield no text
# (see extract_document).
#
# Ligatures are expanded: a font's single 'fi' glyph comes out as 'f' + 'i',
# not as U+FB01. Kept, the ligature splits the word for search and embedding
# ("ﬁnd" does not match "find"); on the arXiv fixture 113 of them did. The span
# box is the same either way, so highlights are unaffected.
_TEXT_FLAGS = (pymupdf.TEXTFLAGS_DICT & ~pymupdf.TEXT_PRESERVE_IMAGES
               & ~pymupdf.TEXT_PRESERVE_LIGATURES)


def _page_blocks(page, sort: bool) -> tuple[list[dict], int]:
    """
    A page's text blocks, holding the lines that carry ink, and how many lines
    were left out as unreadable glyphs.

    PyMuPDF reports boxes in the page as stored, before any /Rotate. That frame
    is the right one for reading order and for finding margins, because it is
    the one the text is written in. Highlight boxes are drawn over the page as
    displayed, so each span's box is turned to match.

    Two repairs happen here, one length-preserving and one whole-line, so the
    offsets assigned afterwards are never disturbed:

    - control codes inside a span become U+FFFD. They are glyphs the font could
      not name, not whitespace, and left alone a stray '\n' forges a line break
      in the middle of an equation;
    - a line with nothing on it but whitespace and unnamed glyphs is not
      emitted. It has no text to retrieve or cite. It is counted, because a
      page made only of such lines is not blank to the person reading it.
    """
    box = page.cropbox                    # get_text() coordinates are in the unrotated page
    turn = page.rotation_matrix if page.rotation else None
    blocks, undecoded = [], 0
    for block in page.get_text('dict', sort=sort, flags=_TEXT_FLAGS)['blocks']:
        if block.get('type') != 0:            # 0 = text block
            continue
        lines = []
        for line in block['lines']:
            spans = [s for s in line['spans'] if s['text']]
            stored = [(_CONTROL.sub(_UNMAPPED, s['text']), tuple(s['bbox'])) for s in spans]
            text = ''.join(t for t, _ in stored)
            if not text.replace(_UNMAPPED, '').strip():
                undecoded += _UNMAPPED in text
                continue
            bbox = (min(b[0] for _, b in stored), min(b[1] for _, b in stored),
                    max(b[2] for _, b in stored), max(b[3] for _, b in stored))
            frame, top, bottom, extent = _reading_frame(bbox, line['dir'], box.width, box.height)
            pieces = stored if turn is None else [
                (t, tuple((pymupdf.Rect(b) * turn).normalize())) for t, b in stored]
            lines.append({'bbox': bbox, 'entry': _Line(text, pieces, frame, top, bottom, extent,
                                                       max(s['size'] for s in spans))})
        if lines:
            blocks.append({'bbox': tuple(block['bbox']), 'lines': lines})
    return blocks, undecoded


def _in_order(blocks: list[dict]) -> list[_Line]:
    """The lines of a page's blocks, with text set at an angle moved to the end."""
    flat = [line['entry'] for block in blocks for line in block['lines']]
    weight: dict = {}
    for line in flat:
        weight[line.frame] = weight.get(line.frame, 0) + len(line.text)
    main = max(weight, key=weight.get) if weight else 0
    # Text set at an angle to the rest of the page (a stamp up the margin, a
    # diagonal figure label) has no place in the reading order; after the
    # page's own text it cannot split a sentence.
    return ([line for line in flat if line.frame == main]
            + [line for line in flat if line.frame != main])


def _body_size(page_lines: list[list[_Line]]) -> float:
    """The font size most of the document's characters are set in."""
    weight: dict[float, int] = {}
    for lines in page_lines:
        for line in lines:
            weight[line.size] = weight.get(line.size, 0) + len(line.text)
    half, seen = sum(weight.values()) / 2, 0
    for size in sorted(weight):
        seen += weight[size]
        if seen >= half:
            return size
    return 0.0


def _edge_band(lines: list[_Line], indexes: list[int], edge: str,
               rules: _HeaderRules) -> tuple[list[tuple[float, float, list[int]]], bool]:
    """
    The rows a header or footer could occupy at one edge of one page,
    outermost first, as (near, far, line indexes) with distances measured from
    that edge; and whether the band stands clear of what follows it.

    The band starts at the line nearest the edge and continues only through
    rows stacked tightly beneath it, so a two-line header is one band and the
    heading or paragraph that follows after a gap is not in it. A band that
    ends at such a gap is 'clear'. One that was cut off by the row limit or the
    edge of the zone is the top of a paragraph, not a header block.
    """
    def span(i):
        line = lines[i]
        return ((line.top, line.bottom) if edge == 'top'
                else (line.extent - line.bottom, line.extent - line.top))

    band: list[tuple[float, float, list[int]]] = []
    for i in sorted(indexes, key=span):
        near, far = span(i)
        for row in band:
            if (abs(near - row[0]) <= rules.row_tolerance
                    and abs(far - row[1]) <= rules.row_tolerance):
                row[2].append(i)
                break
        else:
            in_zone = near < rules.zone * lines[i].extent
            if not band:
                if not in_zone:
                    return [], True
            else:
                outer = band[-1]
                if near - outer[1] > rules.chain_gap * (outer[1] - outer[0]):
                    return band, True         # a gap: the band is complete
                if len(band) == rules.max_band_rows or not in_zone:
                    return band, False        # still stacked tight: this is body text
            band.append((near, far, [i]))
    return band, True


def _running_lines(page_lines: list[list[_Line]], rules: _HeaderRules = _RULES,
                   trace: dict | None = None) -> dict[tuple[int, int], str]:
    """
    Find running headers and footers. Returns {(page index, line index): why}
    for exactly the lines to leave out of the stream.

    This is text the reader never reads twice but a naive extractor repeats on
    every page, where it lands mid-chunk - often mid-sentence, at a page break -
    pollutes the embedding and burns context budget.

    A line is dropped only where a header actually sits, never by its text
    alone. All of the following must hold, because wrongly dropping body text
    is far worse than keeping a header:

    1. Band. The line is in the outer 12% of the page AND in the band at that
       edge: the row nearest the edge plus rows stacked tightly under it. The
       zone alone is weak evidence - body text starts inside it on most pages.
       A line whose text also appears further into the same page is a row of a
       table or listing, not a header, and is not counted on that page.
    2. Run. Its text (digits collapsed) recurs in that band on at least three
       pages no more than two apart. A section's header lasts a handful of
       pages, so the bar is a run, not a share of the document; a heading that
       happens to top three scattered pages is not a run. In a row that is not
       the outermost one the text must be header text on further evidence too.
    3. Size. It is not set larger than body text. Headings are; headers are not.
    4. Purity. At that edge, the outermost row is running text on at least half
       of the pages that have one. This is what separates a header position
       from the first line of the body in a document with no header at all.

    Two extensions follow from position, not text, and apply only at an edge
    that passed all four:

    - Row. Whatever shares a row with a running line is part of the same
      header: the section name beside the document number, 'Page xii' beside
      'Rev. 0'.
    - Slot. A row sitting exactly where running rows sit on three or more
      pages, and standing clear of the text behind it, is the same template
      element whatever it says.

    Rows are taken from the edge inward and the walk stops at the first row
    that qualifies under neither, so nothing is ever removed from behind text
    that stays.
    """
    if len(page_lines) < rules.min_run:
        return {}
    body = _body_size(page_lines)

    bands = []                                # (page, frame, edge, rows, clear)
    for page, lines in enumerate(page_lines):
        frames: dict[int, list[int]] = {}
        for i, line in enumerate(lines):
            if line.frame is not None:
                frames.setdefault(line.frame, []).append(i)
        for frame, indexes in frames.items():
            for edge in ('top', 'bottom'):
                rows, clear = _edge_band(lines, indexes, edge, rules)
                if rows:
                    bands.append((page, frame, edge, rows, clear))

    def key(page: int, i: int) -> str:
        line = page_lines[page][i]
        return '' if line.size > rules.max_size_ratio * body else _running_key(line.text)

    # Where each key occurs, pooled across frames: a rotated page is still part
    # of the run its neighbours belong to. Occurrences in the outermost row are
    # also kept apart, because that position is the stronger evidence.
    seen: dict[str, dict[str, set[int]]] = {'top': {}, 'bottom': {}}
    seen_outer: dict[str, dict[str, set[int]]] = {'top': {}, 'bottom': {}}
    banded = {'top': set(), 'bottom': set()}  # pages with any band at that edge
    # A header's text does not also fill the page behind it. The rows of a
    # table, a log or a listing all reduce to one key, and without this the
    # first three of every page would pass for a header that recurs.
    in_band: dict[int, set[int]] = {}
    for page, _, _, rows, _ in bands:
        in_band.setdefault(page, set()).update(i for _, _, members in rows for i in members)
    listed: set[tuple[int, str, str]] = set()
    for page, frame, edge, rows, _ in bands:
        behind = {key(page, i) for i, line in enumerate(page_lines[page])
                  if i not in in_band[page] and line.frame == frame}
        listed.update((page, edge, key(page, i)) for _, _, members in rows for i in members
                      if key(page, i) in behind)
    for page, _, edge, rows, _ in bands:
        banded[edge].add(page)
        for depth, (_, _, members) in enumerate(rows):
            for i in members:
                k = key(page, i)
                if k and (page, edge, k) not in listed:
                    seen[edge].setdefault(k, set()).add(page)
                    if depth == 0:
                        seen_outer[edge].setdefault(k, set()).add(page)

    def runs(pages: set[int]) -> set[int]:
        """The pages that belong to a run of min_run or more, at most max_run_gap apart."""
        kept: set[int] = set()
        run: list[int] = []
        for page in sorted(pages) + [None]:
            if run and (page is None or page - run[-1] > rules.max_run_gap):
                if len(run) >= rules.min_run:
                    kept.update(run)
                run = []
            if page is not None:
                run.append(page)
        return kept

    running = {edge: {k: r for k, pages in keys.items() if (r := runs(pages))}
               for edge, keys in seen.items()}
    # Text that may be believed in a row that is NOT the outermost one. Such a
    # row touches the body, so repeating three times is not enough ("Example:"
    # opens three consecutive pages often enough). It must also be header text
    # on other evidence: it runs in the outermost row somewhere, or it is there
    # on at least as many pages as the purity gate asks of the edge.
    trusted = {edge: {k for k, pages in seen[edge].items()
                      if runs(seen_outer[edge].get(k, set()))
                      or len(pages) >= rules.min_purity * len(banded[edge])}
               for edge in seen}

    def runs_here(page: int, edge: str, i: int, depth: int = 0) -> bool:
        k = key(page, i)
        return page in running[edge].get(k, ()) and (depth == 0 or k in trusted[edge])

    def confirmed(page: int, edge: str, members: list[int], depth: int = 0) -> bool:
        return any(runs_here(page, edge, i, depth) for i in members)

    # Purity gate, per frame and edge.
    total: dict[tuple, int] = {}
    pure: dict[tuple, int] = {}
    for page, frame, edge, rows, _ in bands:
        total[frame, edge] = total.get((frame, edge), 0) + 1
        pure[frame, edge] = pure.get((frame, edge), 0) + confirmed(page, edge, rows[0][2])
    is_open = {m for m in total if pure[m] and pure[m] >= rules.min_purity * total[m]}

    # Positions that running rows occupy, for the slot rule.
    slots: dict[tuple, dict[tuple[float, float], set[int]]] = {}
    for page, frame, edge, rows, _ in bands:
        if (frame, edge) not in is_open:
            continue
        for depth, (near, far, members) in enumerate(rows):
            if not confirmed(page, edge, members, depth):
                break
            at = (round(near * 2) / 2, round(far * 2) / 2)
            slots.setdefault((frame, edge), {}).setdefault(at, set()).add(page)

    def on_slot(margin: tuple, near: float, far: float) -> bool:
        pages: set[int] = set()
        for (n, f), where in slots.get(margin, {}).items():
            if abs(n - near) <= rules.slot_tolerance and abs(f - far) <= rules.slot_tolerance:
                pages |= where
        return len(pages) >= rules.min_run

    drop: dict[tuple[int, int], str] = {}
    for page, frame, edge, rows, clear in bands:
        if (frame, edge) not in is_open:
            continue
        for depth, (near, far, members) in enumerate(rows):
            if confirmed(page, edge, members, depth):
                for i in members:
                    drop[page, i] = (f'{edge}:run' if runs_here(page, edge, i, depth)
                                     else f'{edge}:row')
            elif (clear and members is rows[-1][2] and rules.slot_tolerance >= 0
                    and on_slot((frame, edge), near, far)):
                for i in members:
                    drop[page, i] = f'{edge}:slot'
            else:
                break
    if trace is not None:                     # for tests and diagnostics only
        trace.update(body_size=body, bands=total, pure=pure, open=is_open,
                     running=running, slots=slots)
    return drop


def extract(path: Path, *, sort: bool = True,
            strip_boilerplate: bool = True) -> tuple[str, list[_Page], pymupdf.Document]:
    """
    Build the canonical text stream and per-page span index.

    Spans are the unit of assembly, so every character offset maps to a bounding
    box by construction. Dropping a line therefore drops its spans too, and the
    offsets that remain stay consistent with the rectangles that remain - there
    is no second pass that could disagree.

    Running headers are identified by (page, line), not by text, so a body line
    that reads the same as a header is never taken with it.
    """
    doc = pymupdf.open(path)
    try:
        text, pages = extract_document(doc, sort=sort, strip_boilerplate=strip_boilerplate)
    except BaseException:
        _close(doc)
        raise
    return text, pages, doc


def extract_document(doc, *, sort: bool = True, strip_boilerplate: bool = True,
                     on_page=None, said: list | None = None) -> tuple[str, list[_Page]]:
    """
    extract() on a document that is already open, reading each page once.

    on_page(done, total), if given, is called after each page is read, so a
    caller can report progress or stop a long import by raising. `said`, if
    given, receives every line the parser printed while the pages were read.

    Every page the document declares is loaded by number, so a page that is
    not there raises instead of quietly ending the loop.

    Images are counted only on the pages that end up with no text. Counting
    them means MuPDF reads the page a second time with its images loaded, and
    the count is only ever asked of a page with nothing to read.
    """
    total = doc.page_count
    pymupdf.TOOLS.mupdf_warnings()            # start clean: what follows is about these pages
    read = []
    for index in range(total):
        page = doc.load_page(index)
        blocks, undecoded = _page_blocks(page, sort)
        printed = pymupdf.TOOLS.mupdf_warnings()
        if said is not None:
            said.extend(printed.splitlines())
        read.append((blocks, undecoded, bool(_DAMAGE.search(printed)),
                     page.rect.width, page.rect.height))
        if on_page is not None:
            on_page(index + 1, total)

    # Reading order. A page decides for itself where it can; one too sparse to
    # prove its own columns borrows the two-column layout the document uses.
    ordered, found = [], []
    for blocks, *_ in read:
        used: list = []
        ordered.append(_reading_order(blocks, used) if sort else blocks)
        found += [tuple((round(a), round(b)) for a, b in g) for g in used]
    shared = max(sorted(set(found)), key=found.count) if found else ()
    if len(shared) == 1:
        for index, (blocks, *_) in enumerate(read):
            if ordered[index] is blocks and _set_on(blocks, shared[0]):
                ordered[index] = _by_columns(blocks, list(shared))
    layout = [(_in_order(blocks), *rest) for blocks, (_, *rest) in zip(ordered, read)]
    del read, ordered                         # the blocks; their lines live on in layout
    drop = _running_lines([lines for lines, *_ in layout]) if strip_boilerplate else {}

    parts: list[str] = []
    pages: list[_Page] = []
    cursor = 0

    for index, (lines, undecoded, damaged, width, height) in enumerate(layout):
        layout[index] = None                  # a page's lines are spent once its spans are made
        page_start = cursor
        spans: list[_Span] = []
        for number, line in enumerate(lines):
            if (index, number) in drop:
                continue
            for piece_text, bbox in line.pieces:
                parts.append(piece_text)
                spans.append(_Span(cursor, cursor + len(piece_text), bbox))
                cursor += len(piece_text)
            parts.append('\n')
            cursor += 1
        # Only separate pages that actually contributed text. Padding an empty
        # page would give it a non-zero character range, and has_text - which
        # the scanned_only rejection depends on - would report text where there
        # is none.
        if cursor > page_start:
            parts.append('\n')
            cursor += 1
        pages.append(_Page(index + 1, page_start, cursor, width, height, spans, 0,
                           undecoded, damaged))
    for page in pages:
        if not page.has_text:
            page.images = len(doc.load_page(page.number - 1).get_image_info())
    pymupdf.TOOLS.mupdf_warnings()            # the pages were read above; this was a second look
    return ''.join(parts), pages


# ---------------------------------------------------------------------------
# validation
# ---------------------------------------------------------------------------
_TEXT_MARKS = frozenset({'fill-text', 'stroke-text', 'clip-text', 'clip-stroke-text', 'ignore-text'})


def _why_no_text(doc, index: int, undecoded: bool = False) -> str:
    """
    Classify a page that contributed no text to the stream.

      'blank'      nothing is drawn on it (or nothing but the running header and
                   footer that extraction strips), and the parser read it without
                   complaint. Not a loss, so never a warning.
      'image'      an image is drawn but there is no text: a scan, or a figure.
      'drawing'    vector artwork is visibly drawn but there is no text.
      'unreadable' the emptiness is damage, not design: the parser complained
                   while reading the page, or the page box is one no content
                   can land on, or text is drawn where the page is not, or the
                   page shows text none of whose glyphs could be named
                   (`undecoded`).

    Only called on pages without text, so its cost is bounded by how many of
    those there are: one display-list pass per page, plus one thumbnail render
    for the rare page that has vector marks but no image.
    """
    try:
        # mupdf_warnings() flushes MuPDF's pending "... repeated N times..."
        # line before clearing; reset_mupdf_warnings() does not, and that line
        # would then be blamed on this page.
        pymupdf.TOOLS.mupdf_warnings()
        page = doc[index]
        marks = page.get_bboxlog()
        if pymupdf.TOOLS.mupdf_warnings():
            return 'unreadable'
        box = page.rect
        if not (3 <= box.width <= 14400 and 3 <= box.height <= 14400):
            return 'unreadable'             # outside the page sizes the format allows

        def on_page(b) -> bool:
            return b[2] >= box.x0 and b[0] <= box.x1 and b[3] >= box.y0 and b[1] <= box.y1

        if any(kind in _TEXT_MARKS and not on_page(b) for kind, b in marks):
            return 'unreadable'             # text exists but is drawn off the page
        drawn = [kind for kind, b in marks if kind not in _TEXT_MARKS and on_page(b)]
        if not drawn and not undecoded:
            return 'blank'
        if any('image' in kind for kind in drawn):
            return 'image'
        # Vector marks or unnamed glyphs only. The innocent cases are a
        # page-sized white background rectangle and invisible text, which only
        # rendering can tell from something a reader sees.
        zoom = min(0.25, 256 / max(box.width, box.height))
        pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom),
                              colorspace=pymupdf.csGRAY, alpha=False)
        if pix.is_unicolor:
            return 'blank'
        return 'unreadable' if undecoded else 'drawing'
    except Exception:
        return 'unreadable'


def validate(path: str | Path, policy: IngestionPolicy | None = None, *,
             source_filename: str | None = None) -> ValidationResult:
    """
    Validate one candidate file and return a verdict.

    Nothing the PDF parser raises escapes: every parser call is guarded and
    mapped to a failed check, and a backstop catches anything nobody predicted.
    Bad content is a result, never an exception.

    The one thing that does raise is OSError from reading the path itself
    (missing, a directory, no permission). There is no file to give a verdict
    on: no bytes to checksum, and none of the SDD 6.1 reasons would be true of
    it. That is a caller error, not a property of the file.

    source_filename is the name to report when the file is being read from
    somewhere other than where the user put it, such as a staging copy.
    """
    return _validate(path, policy, source_filename=source_filename)


def _hash_file(path: Path) -> tuple[str, int, bytes]:
    """The file's SHA-256, size and first 8 bytes, read in blocks rather than whole."""
    digest, size, head = hashlib.sha256(), 0, b''
    with open(path, 'rb') as handle:
        while block := handle.read(_HASH_BLOCK):
            if not head:
                head = block[:8]
            digest.update(block)
            size += len(block)
    return digest.hexdigest(), size, head


def _validate(path: str | Path, policy: IngestionPolicy | None = None, *,
              source_filename: str | None = None, checksum_sha256: str | None = None,
              byte_size: int | None = None, sort: bool = True, strip_boilerplate: bool = True,
              on_page=None, keep: list | None = None,
              notes: dict | None = None) -> ValidationResult:
    """
    validate() with the seams the import flow needs: a checksum and size already
    computed while the file was copied, the chunker's extraction settings, a
    per-page callback, `keep`, a list that receives (text, pages) when the
    file is accepted so it can be chunked without being read again, and
    `notes`, a dict that receives 'parser_messages': how many lines the parser
    printed about this file.
    """
    policy = policy or IngestionPolicy()
    path = Path(path)
    if checksum_sha256 is None or byte_size is None:
        checksum_sha256, byte_size, head = _hash_file(path)
    else:
        with open(path, 'rb') as handle:
            head = handle.read(8)
    result = ValidationResult(
        schema_version=SCHEMA_VERSION,
        validated_at=datetime.now(timezone.utc).isoformat(timespec='seconds'),
        validator_version=VALIDATOR_VERSION,
        extractor=EXTRACTOR,
        source_path=str(path),
        source_filename=source_filename or path.name,
        byte_size=byte_size,
        checksum_sha256=checksum_sha256,
        outcome=Outcome.ACCEPTED,
        reject_reason=None,
        reject_detail=None,
        checks=[],
        warnings=[],
        policy=policy.to_dict(),
    )
    # An exception out of the caller's own on_page (a request to cancel, say) is
    # not a property of the file. It is noted here so no guard below mistakes it
    # for damage, and passed on unchanged.
    stopped: list[BaseException] = []

    def page_hook(done: int, total: int) -> None:
        try:
            on_page(done, total)
        except BaseException as e:
            stopped.append(e)
            raise

    said: list[str] = []                      # every line the parser printed about this file
    try:
        return _checked(path, head, policy, result, sort, strip_boilerplate,
                        page_hook if on_page is not None else None, keep, stopped, said)
    except MemoryError:
        raise                                 # the machine's condition, not the file's
    except Exception as e:
        if stopped:
            raise
        # Backstop: a parser failure outside every guard below is still a
        # verdict. 'unguarded' marks it, so a test can tell this path from a
        # check that decided, and a bug in this module from a damaged file.
        result.checks[:] = [c for c in result.checks if c.check_id != 'structural_integrity']
        result.checks.append(Check('structural_integrity', CheckStatus.FAIL,
                                   'The PDF parser failed while reading the document.',
                                   observed={'error': type(e).__name__, 'unguarded': True},
                                   expected='parses without error',
                                   reject_reason=RejectReason.CORRUPT))
        result.warnings.clear()
        result.document = None
        result.outcome = Outcome.REJECTED
        result.reject_reason = RejectReason.CORRUPT
        result.reject_detail = 'The file is damaged and could not be read.'
        return result
    finally:
        try:
            said += pymupdf.TOOLS.mupdf_warnings().splitlines()
        except Exception:
            pass
        if notes is not None:
            notes['parser_messages'] = len(said)


def _checked(path: Path, head: bytes, policy: IngestionPolicy, result: ValidationResult,
             sort: bool, strip_boilerplate: bool, on_page, keep: list | None,
             stopped: list, said: list) -> ValidationResult:
    checks, warnings = result.checks, result.warnings
    byte_size = result.byte_size

    def reject(reason: RejectReason, detail: str) -> ValidationResult:
        result.outcome = Outcome.REJECTED
        result.reject_reason = reason
        result.reject_detail = detail
        return result

    # 1. non-empty -------------------------------------------------------
    ok = byte_size > 0
    checks.append(Check('file_nonempty',
                        CheckStatus.PASS if ok else CheckStatus.FAIL,
                        'File has content.' if ok else 'File is zero bytes.',
                        observed=byte_size, expected='> 0',
                        reject_reason=None if ok else RejectReason.CORRUPT))
    if not ok:
        return reject(RejectReason.CORRUPT, 'The file is empty.')

    # 2. magic bytes -----------------------------------------------------
    ok = head[:5] == PDF_MAGIC
    checks.append(Check('magic_bytes',
                        CheckStatus.PASS if ok else CheckStatus.FAIL,
                        'File begins with a PDF header.' if ok else
                        'File is not a PDF regardless of its extension.',
                        observed=head[:5].decode('latin-1'), expected='%PDF-',
                        reject_reason=None if ok else RejectReason.NON_PDF))
    if not ok:
        kind = 'a zip container' if head[:4] == b'PK\x03\x04' else 'not a PDF'
        return reject(RejectReason.NON_PDF, f'The file is {kind}.')

    # 3. parser opens ----------------------------------------------------
    # "Opens" means the parser can read the document's structure, not only its
    # first bytes. A badly truncated file opens and then fails the moment its
    # page tree is touched, so everything needed below is read here, guarded.
    doc = None
    try:
        pymupdf.TOOLS.mupdf_warnings()        # whatever an earlier document left in the buffer
        doc = pymupdf.open(path)
        needs_pass = bool(doc.needs_pass)
        page_count = 0 if needs_pass else doc.page_count
        permissions = 0 if needs_pass else doc.permissions
        if not needs_pass and page_count < 1:
            raise ValueError('the file contains no pages')
    except Exception as e:
        _close(doc)
        checks.append(Check('parser_opens', CheckStatus.FAIL,
                            'The PDF parser could not open the file.',
                            observed=type(e).__name__, expected='opens',
                            reject_reason=RejectReason.CORRUPT))
        return reject(RejectReason.CORRUPT, 'The file could not be parsed as a PDF.')
    checks.append(Check('parser_opens', CheckStatus.PASS, 'The PDF parser opened the file.',
                        observed='opens', expected='opens'))
    try:
        return _examined(doc, needs_pass, page_count, permissions, policy, result, sort,
                         strip_boilerplate, on_page, keep, stopped, said)
    finally:
        _close(doc)                           # on every way out, a cancelled import included


def _examined(doc, needs_pass: bool, page_count: int, permissions: int,
              policy: IngestionPolicy, result: ValidationResult, sort: bool,
              strip_boilerplate: bool, on_page, keep: list | None, stopped: list,
              said: list) -> ValidationResult:
    """Checks 4 to 8, on a document that opened. The caller closes it."""
    checks, warnings = result.checks, result.warnings
    byte_size = result.byte_size

    def reject(reason: RejectReason, detail: str) -> ValidationResult:
        result.outcome = Outcome.REJECTED
        result.reject_reason = reason
        result.reject_detail = detail
        return result

    said += pymupdf.TOOLS.mupdf_warnings().splitlines()     # what opening the file drew

    # 4. password --------------------------------------------------------
    checks.append(Check('no_open_password',
                        CheckStatus.FAIL if needs_pass else CheckStatus.PASS,
                        'The file requires a password to open.' if needs_pass else
                        'No open password required.',
                        observed=needs_pass, expected=False,
                        reject_reason=RejectReason.PASSWORD_PROTECTED if needs_pass else None))
    if needs_pass:
        return reject(RejectReason.PASSWORD_PROTECTED,
                      'The file is password-protected and cannot be read.')

    # 5. size ------------------------------------------------------------
    too_many, too_heavy = page_count > policy.max_pages, byte_size > policy.max_bytes
    too_big = too_many or too_heavy
    checks.append(Check('within_size_limits',
                        CheckStatus.FAIL if too_big else CheckStatus.PASS,
                        'The file exceeds the configured size limit.' if too_big else
                        'Within size limits.',
                        observed={'pages': page_count, 'bytes': byte_size},
                        expected={'max_pages': policy.max_pages, 'max_bytes': policy.max_bytes},
                        reject_reason=RejectReason.OVERSIZED if too_big else None))
    if too_big:
        over = ([f'has {page_count:,} pages, above the {policy.max_pages:,}-page limit']
                if too_many else [])
        over += ([f'is {byte_size:,} bytes, above the {policy.max_bytes:,}-byte limit']
                 if too_heavy else [])
        return reject(RejectReason.OVERSIZED, f'The file {" and ".join(over)}.')

    # 6. extraction permission ------------------------------------------
    # Note: is_encrypted and needs_pass are both False for an owner-password
    # file, so the permission bitfield is the only signal available here.
    extract_allowed = bool(permissions & pymupdf.PDF_PERM_COPY)
    if extract_allowed:
        checks.append(Check('extraction_permitted', CheckStatus.PASS,
                            'The document permits text extraction.',
                            observed=permissions, expected='PDF_PERM_COPY set'))
    elif policy.extraction_restricted == 'reject':
        checks.append(Check('extraction_permitted', CheckStatus.FAIL,
                            'The document forbids text extraction, and policy honors that restriction.',
                            observed=permissions, expected='PDF_PERM_COPY set',
                            reject_reason=RejectReason.PASSWORD_PROTECTED))
        return reject(RejectReason.PASSWORD_PROTECTED,
                      'The document forbids text extraction.')
    else:
        checks.append(Check('extraction_permitted',
                            CheckStatus.SKIPPED if policy.extraction_restricted == 'ignore'
                            else CheckStatus.WARN,
                            'The document forbids text extraction; policy proceeds anyway.',
                            observed=permissions, expected='PDF_PERM_COPY set'))
        if policy.extraction_restricted != 'ignore':
            warnings.append({'code': 'extraction_restricted',
                             'message': 'The document forbids text extraction; it was extracted anyway.'})

    try:
        text, pages = extract_document(doc, sort=sort, strip_boilerplate=strip_boilerplate,
                                       on_page=on_page, said=said)
    except MemoryError:
        raise
    except Exception as e:
        if stopped:
            raise
        # The structure was readable but a page was not. Same verdict as any
        # other damage: the file is rejected, with what failed on record.
        checks.append(Check('structural_integrity', CheckStatus.FAIL,
                            'The document opened but its pages could not be read.',
                            observed={'error': type(e).__name__},
                            expected='every page readable',
                            reject_reason=RejectReason.CORRUPT))
        return reject(RejectReason.CORRUPT,
                      f'The file is damaged: its pages could not be read ({type(e).__name__}).')

    repaired = bool(getattr(doc, 'is_repaired', False))
    # Which pages have text is judged on the stream chunks() will index: after
    # running headers are stripped.
    empty_pages = [p.number for p in pages if not p.has_text]
    pages_with_text = len(pages) - len(empty_pages)
    chars_per_page = len(text) / pages_with_text if pages_with_text else 0.0
    # A page without text is only believed to be blank in a document the parser
    # did not have to rebuild. After a repair, "nothing there" is exactly what
    # a lost page looks like.
    kinds = {n: 'unreadable' if repaired or pages[n - 1].damaged
             else _why_no_text(doc, n - 1, bool(pages[n - 1].undecoded)) for n in empty_pages}
    blank_pages = [n for n in empty_pages if kinds[n] == 'blank']
    unreadable_pages = [n for n in empty_pages if kinds[n] == 'unreadable']
    pages_without_text = [n for n in empty_pages if kinds[n] != 'blank']
    # Pages that kept some text although the parser reported damage on them.
    damaged_pages = [p.number for p in pages if p.damaged and p.has_text]
    content_pages = page_count - len(blank_pages)
    ratio = pages_with_text / content_pages if content_pages else 0.0

    # 7. structural integrity -------------------------------------------
    # Nothing below may call a document complete on the strength of its page
    # count: a truncated file reports the full count, and a damaged page index
    # reports whatever it says.
    def damaged_structure(message: str, observed: dict, expected, detail: str) -> ValidationResult:
        checks.append(Check('structural_integrity', CheckStatus.FAIL, message, observed=observed,
                            expected=expected, reject_reason=RejectReason.CORRUPT))
        return reject(RejectReason.CORRUPT, detail)

    try:
        counted = doc.page_count              # the parser revises this once it walks the pages
    except Exception:
        counted = -1
    if len(pages) != page_count or counted != page_count:
        return damaged_structure(
            'The number of pages the document declares is not the number that could be read.',
            {'declared': page_count, 'read': len(pages), 'after_reading': counted},
            'the declared page count',
            f'The file is damaged: it declares {page_count:,} pages but {len(pages):,} could be read.')
    recovery = {'repaired': repaired, 'chars_per_page': round(chars_per_page, 1),
                'pages': page_count, 'pages_with_text': pages_with_text,
                'unreadable_pages': unreadable_pages}
    if repaired and unreadable_pages:
        # A rebuilt document with pages that came back empty is a truncation,
        # however dense the pages that survived are.
        return damaged_structure(
            'The document was rebuilt by the parser and some of its pages came back empty, '
            'which indicates truncation rather than a recoverable defect.',
            recovery, {'unreadable_pages': []},
            f'The file is damaged: text was recovered from only {pages_with_text:,} of '
            f'{page_count:,} pages.')
    if repaired and chars_per_page < policy.min_chars_per_page_when_repaired:
        return damaged_structure(
            'The document was rebuilt by the parser and most of its text is missing, which '
            'indicates truncation rather than a recoverable defect.',
            recovery, {'chars_per_page': f'>= {policy.min_chars_per_page_when_repaired}'},
            f'The file is damaged: only {len(text):,} characters were recovered '
            f'across {page_count:,} pages.')
    if any(_PAGE_TREE.search(line) for line in said):
        # The page index is inconsistent, so pages may be missing that no
        # count can reveal (an index that lists 3 of 12 pages reads as a
        # complete 3-page document).
        return damaged_structure(
            'The document\'s page index is damaged, so pages may be missing.',
            {**recovery, 'page_index': 'inconsistent'}, {'page_index': 'consistent'},
            'The file is damaged: its page index is inconsistent, so pages may be missing.')
    if not repaired:
        checks.append(Check('structural_integrity', CheckStatus.PASS,
                            'The document structure is intact.',
                            observed=False, expected=False))
    elif policy.repaired_document == 'reject':
        return damaged_structure(
            'The document structure was rebuilt by the parser, and policy rejects repaired '
            'documents.', recovery, {'repaired': False}, 'The file structure is damaged.')
    else:
        checks.append(Check('structural_integrity', CheckStatus.WARN,
                            'The document structure was rebuilt by the parser; every page '
                            'came back with text.',
                            observed=recovery, expected={'repaired': False}))
        warnings.append({'code': 'structure_repaired',
                         'message': 'The document structure was damaged and rebuilt during import.'})

    # 8. text yield --------------------------------------------------
    # Every page without text is put on record, whatever the verdict.
    # empty_pages is all of them; the four lists after it partition it.
    # The ratio is taken over pages that are not blank, so a blank page
    # neither counts against a document nor hides a scanned one. A page
    # that has something on it and yields no text is there for a reader and
    # invisible to search, so it always warns and is always named. So does a
    # page that kept some text although the parser reported damage on it.
    seen = {'pages': page_count, 'pages_with_text': pages_with_text,
            'empty_pages': empty_pages, 'blank_pages': blank_pages,
            'image_only_pages': [n for n in empty_pages if kinds[n] == 'image'],
            'drawing_only_pages': [n for n in empty_pages if kinds[n] == 'drawing'],
            'unreadable_pages': unreadable_pages,
            'damaged_pages': damaged_pages}
    floor, bar = policy.min_pages_with_text_ratio_reject, policy.min_pages_with_text_ratio_warn
    if ratio <= floor:
        all_blank = content_pages == 0
        checks.append(Check('text_yield', CheckStatus.FAIL,
                            'Every page is blank; there is no text to import.' if all_blank else
                            'The document has no extractable text layer and would need OCR, '
                            'which is out of scope.' if not pages_with_text else
                            'Too few of the document\'s pages have extractable text; the rest '
                            'would need OCR, which is out of scope.',
                            observed=seen,
                            expected=f'> {floor:.0%} of non-blank pages',
                            reject_reason=RejectReason.SCANNED_ONLY))
        return reject(RejectReason.SCANNED_ONLY,
                      f'All {page_count} pages are blank.' if all_blank else
                      f'Only {pages_with_text} of {content_pages} non-blank pages contain '
                      f'extractable text.')
    # Blank pages are normal one at a time. When more than the policy allows
    # of a document is blank, that is worth a look too: it is also what a
    # file that lost its page contents looks like.
    thin = pages_with_text / page_count < bar
    if pages_without_text or thin or damaged_pages:
        named = empty_pages if thin else pages_without_text
        checks.append(Check('text_yield', CheckStatus.WARN,
                            'Some pages contain no extractable text and will not be searchable.'
                            if named else
                            'Some pages were damaged and may be missing part of their text.',
                            observed=seen,
                            expected=f'text on every non-blank page, and on >= {bar:.0%} of all pages'))
        if named:
            warnings.append({'code': 'pages_without_text',
                             'message': f'{len(named)} page(s) contain no extractable '
                                        f'text and will not be searchable.',
                             'pages': named})
        if damaged_pages:
            warnings.append({'code': 'pages_damaged',
                             'message': f'{len(damaged_pages)} page(s) were damaged in the file '
                                        f'and may be missing part of their text.',
                             'pages': damaged_pages})
    elif blank_pages:
        checks.append(Check('text_yield', CheckStatus.PASS,
                            f'All {content_pages} non-blank pages contain extractable text; '
                            f'{len(blank_pages)} page(s) are blank.',
                            observed=seen,
                            expected=f'text on every non-blank page, and on >= {bar:.0%} of all pages'))
    else:
        checks.append(Check('text_yield', CheckStatus.PASS,
                            'All pages contain extractable text.',
                            observed=seen,
                            expected=f'text on every non-blank page, and on >= {bar:.0%} of all pages'))

    meta = doc.metadata or {}
    document = Document(
        document_id=Document.id_from_checksum(result.checksum_sha256),
        checksum_sha256=result.checksum_sha256,
        source_filename=result.source_filename,
        display_title=(str(meta.get('title') or '').strip()
                       or Path(result.source_filename).stem),
        page_count=page_count,
        byte_size=byte_size,
        pdf_version=meta.get('format'),
        extractor=EXTRACTOR,
        import_warnings=warnings,
    )
    result.document = document.to_dict()
    result.outcome = Outcome.ACCEPTED_WITH_WARNINGS if warnings else Outcome.ACCEPTED
    if keep is not None:
        keep.append((text, pages))
    return result


def _close(doc) -> None:
    """Close a document that may be half-open or already broken."""
    try:
        if doc is not None:
            doc.close()
    except Exception:
        pass


# ---------------------------------------------------------------------------
# chunking
# ---------------------------------------------------------------------------
def _last(points: list[int], above: int, upto: int) -> int | None:
    """The largest point with above < point <= upto."""
    i = bisect.bisect_right(points, upto) - 1
    return points[i] if i >= 0 and points[i] > above else None


def _first(points: list[int], frm: int, below: int) -> int | None:
    """The smallest point with frm <= point < below."""
    i = bisect.bisect_left(points, frm)
    return points[i] if i < len(points) and points[i] < below else None


def plan_cuts(text: str, config: ChunkerConfig) -> list[tuple[int, int, str]]:
    """
    Decide where every chunk starts and ends: (char_start, char_end, end_kind).

    A pure function of the text and the config, so the boundary policy can be
    tested on a string without a PDF.

    Where a chunk ENDS, in order of preference, never past cursor + target_chars:
      'sentence'   the last sentence end in the budget. An early one is kept:
                   a short chunk of whole sentences beats a full one that
                   stops inside a table.
      'line'       no sentence end in reach (a table, a contents page, a column
                   of labels): the last line end that does not split a unit.
      'weak-line'  the last line end of any kind.
      'word'       one line is longer than the budget: the last word gap.
                   Before that, the chunk gives up its overlap and starts where
                   the last one ended, which makes room for a line that fits
                   in target_chars but not in what the overlap left of it.
      'hard'       one word is longer than the budget.
      'document'   the end of the text, including a folded-in runt tail.

    Where the NEXT chunk starts: at the earliest sentence start within
    overlap_chars of the end, so the shared text is whole sentences and at most
    overlap_chars long. If the last sentence alone is longer than that, exactly
    that one sentence is shared, provided it is no more than half the chunk.
    A chunk that ended on a line end shares whole lines instead.
    """
    n = len(text)
    if not text.strip():
        return []
    target, overlap, minimum = config.target_chars, config.overlap_chars, config.min_chunk_chars
    sent = sentence_starts(text) if config.respect_sentence_boundaries else [0, n]
    lines, good = line_starts(text)
    good_set = set(good)

    out: list[tuple[int, int, str]] = []
    cursor = prev_end = 0
    while cursor < n:
        budget = min(cursor + target, n)
        progress = max(cursor, prev_end)            # a chunk must add text
        above = max(progress, min(progress + minimum, budget) - 1)  # ... preferably `minimum` of it
        if budget >= n:
            end, kind = n, 'document'
        else:
            end, kind = _last(sent, above, budget), 'sentence'
            if end is None:
                g, a = _last(good, above, budget), _last(lines, above, budget)
                if g is not None and (g - cursor) * 4 >= target:
                    end, kind = g, 'line'           # a clean line end is worth a shorter chunk
                elif a is not None:
                    end, kind = a, ('line' if a == g else 'weak-line')
            if end is None:
                end, kind = _last(sent, progress, budget), 'sentence'
            if end is None:
                a = _last(lines, progress, budget)
                if a is not None:
                    end, kind = a, ('line' if a in good_set else 'weak-line')
            if end is None and cursor < progress:
                cursor = progress               # no overlap this once, then look again
                continue
            if end is None:
                gap = text.rfind(' ', progress + 1, budget)
                end, kind = (gap + 1, 'word') if gap != -1 else (budget, 'hard')
        if n - end < minimum:
            end, kind = n, 'document'               # fold a runt tail into the last chunk
        out.append((cursor, end, kind))
        if end >= n:
            break

        size = end - cursor
        back = min(overlap, size // 2)              # never give back more than half the chunk
        lo = end - back
        if back <= 0:
            nxt = end
        else:
            nxt = _first(sent, lo, end)
            if nxt is None and kind == 'sentence':
                last = _last(sent, cursor, lo)      # the chunk's final sentence starts before the window
                nxt = last if last is not None and end - last <= size // 2 else end
            elif nxt is None:
                nxt = _first(good, lo, end)
                if nxt is None:
                    nxt = _first(lines, lo, end)
                if nxt is None and kind in ('word', 'hard'):
                    gap = text.find(' ', lo, end)
                    nxt = gap + 1 if gap != -1 else None
                if nxt is None:
                    nxt = end
        prev_end = end
        cursor = max(cursor + 1, min(nxt, end))
    return out


def chunks(path: str | Path, config: ChunkerConfig | None = None,
           document_id: str | None = None) -> list[Chunk]:
    """
    Split one validated document into Chunk objects.

    Callers validate first. Running this on a rejected file is a caller bug, not
    something this function silently absorbs.

    Every chunk begins and ends on a complete sentence wherever the text has
    sentences, so a cited chunk reads as a self-contained passage. target_chars
    is a hard upper bound, not a goal. See plan_cuts() for the policy.
    """
    config = config or ChunkerConfig()
    path = Path(path)
    document_id = document_id or Document.id_from_checksum(_hash_file(path)[0])

    text, pages, doc = extract(path, sort=config.sorted_reading_order,
                               strip_boilerplate=config.strip_running_headers)
    doc.close()
    return chunk_stream(text, pages, config, document_id)


def chunk_stream(text: str, pages: list[_Page], config: ChunkerConfig,
                 document_id: str) -> list[Chunk]:
    """chunks() on an extraction already in hand. No file access."""
    out: list[Chunk] = []
    page_ends = [page.char_end for page in pages]
    for start, end, _kind in plan_cuts(text, config):
        body = text[start:end]
        if not body.strip():
            continue                    # nothing a reader could cite (unchanged behaviour)
        spans = _page_spans(start, end, pages, page_ends)
        out.append(Chunk(
            chunk_id=Chunk.make_id(document_id, config.config_id, start, end),
            document_id=document_id,
            ordinal=len(out),
            text=body,
            text_checksum_sha256=text_checksum(body),
            char_start=start,
            char_end=end,
            page_start=spans[0].page_number,
            page_end=spans[-1].page_number,
            page_spans=spans,
            token_estimate=max(1, len(body) // 4),
            chunker_config_id=config.config_id,
            chunker_version=config.chunker_version,
        ))
    return out


@dataclass
class Processed:
    """One candidate, validated and (if accepted) chunked from a single extraction."""
    result: ValidationResult
    chunks: list[Chunk] | None          # None when the file was rejected
    text: str | None
    pages: list[_Page] | None
    parser_messages: int = 0            # lines the parser printed about the file; a count, never the text


def process(path: str | Path, policy: IngestionPolicy | None = None,
            config: ChunkerConfig | None = None, *, source_filename: str | None = None,
            checksum_sha256: str | None = None, byte_size: int | None = None,
            on_page=None) -> Processed:
    """
    validate() then chunks(), from one reading of the file.

    A rejected file yields no chunks, by construction: the only chunks this
    returns are cut from the extraction validate() accepted. That is what
    "invalid files fail before indexing" rests on.
    """
    config = config or ChunkerConfig()
    keep: list = []
    notes: dict = {}
    result = _validate(path, policy, source_filename=source_filename,
                       checksum_sha256=checksum_sha256, byte_size=byte_size,
                       sort=config.sorted_reading_order,
                       strip_boilerplate=config.strip_running_headers,
                       on_page=on_page, keep=keep, notes=notes)
    said = notes.get('parser_messages', 0)
    if result.outcome is Outcome.REJECTED or not keep:
        return Processed(result, None, None, None, said)
    text, pages = keep[0]
    return Processed(result, chunk_stream(text, pages, config, result.document['document_id']),
                     text, pages, said)


def _page_spans(start: int, end: int, pages: list[_Page],
                page_ends: list[int] | None = None) -> list[PageSpan]:
    """
    Map a chunk's character range onto the pages and rectangles it covers.
    Pages are contiguous and in order, so with their end offsets in hand the
    first page is found by bisection instead of walking the document per chunk.
    """
    spans: list[PageSpan] = []
    first = bisect.bisect_right(page_ends, start) if page_ends is not None else 0
    for page in pages[first:]:
        if page.char_start >= end:
            break
        lo, hi = max(start, page.char_start), min(end, page.char_end)
        if lo >= hi:
            continue
        rects = [list(s.bbox) for s in page.spans if s.start < hi and s.end > lo]
        spans.append(PageSpan(
            page_number=page.number,
            char_start=lo,
            char_end=hi,
            page_char_start=lo - page.char_start,
            page_char_end=hi - page.char_start,
            highlight_rects=_merge_rects(rects),
            coordinates_reliable=bool(rects),
            page_width=page.width,
            page_height=page.height,
        ))
    if not spans:
        # The range fell entirely in inter-page padding; attribute it to the page
        # containing its start rather than dropping provenance.
        page = next((p for p in pages if p.char_start <= start < p.char_end), pages[0])
        spans.append(PageSpan(page.number, start, end, start - page.char_start,
                              end - page.char_start, [], False, page.width, page.height))
    return spans


def _merge_rects(rects: list[list[float]], tolerance: float = 2.0,
                 gap: float = 12.0) -> list[list[float]]:
    """
    Merge span rectangles that sit on the same text line, so the UI draws one
    box per line. Every input rectangle lies inside one of the boxes returned.

    Spans of one line can differ in height by a fraction of a point (a bold
    word, a symbol font), so rows are formed by tolerance first and only then
    read left to right. Boxes on a row that are more than `gap` apart stay
    separate: two labels across a figure, or the two columns of a page.
    """
    rows: list[list[list[float]]] = []
    for r in sorted(rects, key=lambda r: (r[1], r[0])):
        for row in rows:
            if abs(r[1] - row[0][1]) <= tolerance and abs(r[3] - row[0][3]) <= tolerance:
                row.append(r)
                break
        else:
            rows.append([r])
    merged: list[list[float]] = []
    for row in rows:
        row.sort(key=lambda r: r[0])
        current = list(row[0])
        for r in row[1:]:
            if r[0] - current[2] <= gap:
                current = [min(current[0], r[0]), min(current[1], r[1]),
                           max(current[2], r[2]), max(current[3], r[3])]
            else:
                merged.append(current)
                current = list(r)
        merged.append(current)
    return [[round(v, 2) for v in r] for r in merged]
