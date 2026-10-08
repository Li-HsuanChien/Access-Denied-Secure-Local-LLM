"""
Reference implementation of the E2 ingestion seam: validate() and chunks().

This is the Week 1 walking skeleton, not the Week 4 production pipeline. It
exists to prove the schemas are implementable and to give E3 and E4 something
real to code against instead of a document describing objects nobody has built.

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
from .validation import (Check, CheckStatus, IngestionPolicy, Outcome,
                         RejectReason, ValidationResult)

VALIDATOR_VERSION = 'e2-validate-1.0.0'
EXTRACTOR = f'pymupdf/{getattr(pymupdf, "__version__", "unknown")}'
PDF_MAGIC = b'%PDF-'


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
    images: int = 0      # image blocks drawn on the page
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
# nothing here reads. The images are counted instead.
_TEXT_FLAGS = pymupdf.TEXTFLAGS_DICT & ~pymupdf.TEXT_PRESERVE_IMAGES


def _page_blocks(page, sort: bool) -> tuple[list[dict], int, int]:
    """
    A page's text blocks, holding the lines that carry ink; how many images the
    page draws; and how many lines were left out as unreadable glyphs.

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
    blocks, images, undecoded = [], len(page.get_image_info()), 0
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
    return blocks, images, undecoded


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


def _page_lines(page, sort: bool) -> list[tuple[str, list[tuple]]]:
    """One entry per layout line: its text and its spans, in reading order."""
    out = []
    for block in page.get_text('dict', sort=sort)['blocks']:
        if block.get('type') != 0:            # 0 = text block; 1 = image
            continue
        for line in block['lines']:
            pieces = [(s['text'], tuple(s['bbox'])) for s in line['spans'] if s['text']]
            if pieces:
                out.append((''.join(t for t, _ in pieces), pieces))
    return out


def _boilerplate_keys(doc, sort: bool) -> set[str]:
    """
    Find running headers and footers: lines that repeat in the top or bottom
    margin across most pages.

    This is text the reader never reads twice but a naive extractor repeats on
    every page, where it lands mid-chunk, pollutes the embedding and burns
    context budget. On the NRC manual it is 13% of the stream.

    The bar is deliberately high - margin zone, and present on at least half of
    at least three pages - because wrongly dropping body text is far worse than
    keeping a header.
    """
    if doc.page_count < 3:
        return set()
    counts: dict[str, set[int]] = {}
    for index, page in enumerate(doc):
        height = page.rect.height or 1.0
        for text, pieces in _page_lines(page, sort):
            key = _running_key(text)
            if not key:
                continue
            top = min(b[1] for _, b in pieces)
            bottom = max(b[3] for _, b in pieces)
            if top < 0.12 * height or bottom > 0.88 * height:
                counts.setdefault(key, set()).add(index)
    threshold = max(3, doc.page_count // 2)
    return {k for k, pages in counts.items() if len(pages) >= threshold}


def extract(path: Path, *, sort: bool = True,
            strip_boilerplate: bool = True) -> tuple[str, list[_Page], pymupdf.Document]:
    """
    Build the canonical text stream and per-page span index.

    Spans are the unit of assembly, so every character offset maps to a bounding
    box by construction. Dropping a line therefore drops its spans too, and the
    offsets that remain stay consistent with the rectangles that remain - there
    is no second pass that could disagree.
    """
    doc = pymupdf.open(path)
    skip = _boilerplate_keys(doc, sort) if strip_boilerplate else set()

    parts: list[str] = []
    pages: list[_Page] = []
    cursor = 0

    for index, page in enumerate(doc):
        page_start = cursor
        spans: list[_Span] = []
        for text, pieces in _page_lines(page, sort):
            if skip and _running_key(text) in skip:
                continue
            for piece_text, bbox in pieces:
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
        pages.append(_Page(index + 1, page_start, cursor, page.rect.width,
                           page.rect.height, spans))
    return ''.join(parts), pages, doc


# ---------------------------------------------------------------------------
# validation
# ---------------------------------------------------------------------------
def validate(path: str | Path, policy: IngestionPolicy | None = None) -> ValidationResult:
    """Validate one candidate file. Never raises on bad input; returns a result."""
    policy = policy or IngestionPolicy()
    path = Path(path)
    raw = path.read_bytes()
    checks: list[Check] = []
    warnings: list[dict] = []

    result = ValidationResult(
        schema_version=SCHEMA_VERSION,
        validated_at=datetime.now(timezone.utc).isoformat(timespec='seconds'),
        validator_version=VALIDATOR_VERSION,
        extractor=EXTRACTOR,
        source_path=str(path),
        source_filename=path.name,
        byte_size=len(raw),
        checksum_sha256=hashlib.sha256(raw).hexdigest(),
        outcome=Outcome.ACCEPTED,
        reject_reason=None,
        reject_detail=None,
        checks=checks,
        warnings=warnings,
        policy=policy.to_dict(),
    )

    def reject(reason: RejectReason, detail: str) -> ValidationResult:
        result.outcome = Outcome.REJECTED
        result.reject_reason = reason
        result.reject_detail = detail
        return result

    # 1. non-empty -------------------------------------------------------
    ok = len(raw) > 0
    checks.append(Check('file_nonempty',
                        CheckStatus.PASS if ok else CheckStatus.FAIL,
                        'File has content.' if ok else 'File is zero bytes.',
                        observed=len(raw), expected='> 0',
                        reject_reason=None if ok else RejectReason.CORRUPT))
    if not ok:
        return reject(RejectReason.CORRUPT, 'The file is empty.')

    # 2. magic bytes -----------------------------------------------------
    ok = raw[:5] == PDF_MAGIC
    checks.append(Check('magic_bytes',
                        CheckStatus.PASS if ok else CheckStatus.FAIL,
                        'File begins with a PDF header.' if ok else
                        'File is not a PDF regardless of its extension.',
                        observed=raw[:5].decode('latin-1'), expected='%PDF-',
                        reject_reason=None if ok else RejectReason.NON_PDF))
    if not ok:
        kind = 'a zip container' if raw[:4] == b'PK\x03\x04' else 'not a PDF'
        return reject(RejectReason.NON_PDF, f'The file is {kind}.')

    # 3. parser opens ----------------------------------------------------
    try:
        doc = pymupdf.open(path)
    except Exception as e:
        checks.append(Check('parser_opens', CheckStatus.FAIL,
                            'The PDF parser could not open the file.',
                            observed=type(e).__name__, expected='opens',
                            reject_reason=RejectReason.CORRUPT))
        return reject(RejectReason.CORRUPT, f'The file could not be parsed: {e}')
    checks.append(Check('parser_opens', CheckStatus.PASS, 'The PDF parser opened the file.',
                        observed='opens', expected='opens'))

    # 4. password --------------------------------------------------------
    needs_pass = bool(doc.needs_pass)
    checks.append(Check('no_open_password',
                        CheckStatus.FAIL if needs_pass else CheckStatus.PASS,
                        'The file requires a password to open.' if needs_pass else
                        'No open password required.',
                        observed=needs_pass, expected=False,
                        reject_reason=RejectReason.PASSWORD_PROTECTED if needs_pass else None))
    if needs_pass:
        doc.close()
        return reject(RejectReason.PASSWORD_PROTECTED,
                      'The file is password-protected and cannot be read.')

    page_count = doc.page_count

    # 5. size ------------------------------------------------------------
    too_big = page_count > policy.max_pages or len(raw) > policy.max_bytes
    checks.append(Check('within_size_limits',
                        CheckStatus.FAIL if too_big else CheckStatus.PASS,
                        'The file exceeds the configured size limit.' if too_big else
                        'Within size limits.',
                        observed={'pages': page_count, 'bytes': len(raw)},
                        expected={'max_pages': policy.max_pages, 'max_bytes': policy.max_bytes},
                        reject_reason=RejectReason.OVERSIZED if too_big else None))
    if too_big:
        doc.close()
        return reject(RejectReason.OVERSIZED,
                      f'The file has {page_count:,} pages, above the {policy.max_pages:,}-page limit.')

    # 6. extraction permission ------------------------------------------
    # Note: is_encrypted and needs_pass are both False for an owner-password
    # file, so the permission bitfield is the only signal available here.
    extract_allowed = bool(doc.permissions & pymupdf.PDF_PERM_COPY)
    if extract_allowed:
        checks.append(Check('extraction_permitted', CheckStatus.PASS,
                            'The document permits text extraction.',
                            observed=doc.permissions, expected='PDF_PERM_COPY set'))
    elif policy.extraction_restricted == 'reject':
        checks.append(Check('extraction_permitted', CheckStatus.FAIL,
                            'The document forbids text extraction, and policy honors that restriction.',
                            observed=doc.permissions, expected='PDF_PERM_COPY set',
                            reject_reason=RejectReason.PASSWORD_PROTECTED))
        doc.close()
        return reject(RejectReason.PASSWORD_PROTECTED,
                      'The document forbids text extraction.')
    else:
        checks.append(Check('extraction_permitted',
                            CheckStatus.SKIPPED if policy.extraction_restricted == 'ignore'
                            else CheckStatus.WARN,
                            'The document forbids text extraction; policy proceeds anyway.',
                            observed=doc.permissions, expected='PDF_PERM_COPY set'))
        if policy.extraction_restricted != 'ignore':
            warnings.append({'code': 'extraction_restricted',
                             'message': 'The document forbids text extraction; it was extracted anyway.'})

    doc.close()
    text, pages, doc = extract(path)
    try:
        repaired = bool(getattr(doc, 'is_repaired', False))
        pages_with_text = sum(1 for p in pages if p.has_text)
        empty_pages = [p.number for p in pages if not p.has_text]
        ratio = pages_with_text / page_count if page_count else 0.0
        chars_per_page = len(text) / page_count if page_count else 0.0

        # 7. structural integrity ---------------------------------------
        if not repaired:
            checks.append(Check('structural_integrity', CheckStatus.PASS,
                                'The document structure is intact.',
                                observed=False, expected=False))
        else:
            # A repaired document that also lost most of its text is a truncation,
            # not a recoverable defect. Page count alone does not distinguish the
            # two: both report the full count.
            starved = chars_per_page < policy.min_chars_per_page_when_repaired
            if starved:
                checks.append(Check('structural_integrity', CheckStatus.FAIL,
                                    'The document was rebuilt by the parser and most of its text is '
                                    'missing, which indicates truncation rather than a recoverable defect.',
                                    observed={'repaired': True, 'chars_per_page': round(chars_per_page, 1)},
                                    expected={'chars_per_page': f'>= {policy.min_chars_per_page_when_repaired}'},
                                    reject_reason=RejectReason.CORRUPT))
                return reject(RejectReason.CORRUPT,
                              f'The file is damaged: only {len(text):,} characters were recovered '
                              f'across {page_count} pages.')
            if policy.repaired_document == 'reject':
                checks.append(Check('structural_integrity', CheckStatus.FAIL,
                                    'The document structure was rebuilt by the parser, and policy '
                                    'rejects repaired documents.',
                                    observed={'repaired': True, 'chars_per_page': round(chars_per_page, 1)},
                                    expected={'repaired': False},
                                    reject_reason=RejectReason.CORRUPT))
                return reject(RejectReason.CORRUPT, 'The file structure is damaged.')
            checks.append(Check('structural_integrity', CheckStatus.WARN,
                                'The document structure was rebuilt by the parser; text recovery '
                                'looks complete.',
                                observed={'repaired': True, 'chars_per_page': round(chars_per_page, 1)},
                                expected={'repaired': False}))
            warnings.append({'code': 'structure_repaired',
                             'message': 'The document structure was damaged and rebuilt during import.'})

        # 8. text yield --------------------------------------------------
        if ratio <= policy.min_pages_with_text_ratio_reject:
            checks.append(Check('text_yield', CheckStatus.FAIL,
                                'The document has no extractable text layer and would need OCR, '
                                'which is out of scope.',
                                observed={'pages_with_text': pages_with_text, 'pages': page_count},
                                expected=f'> {policy.min_pages_with_text_ratio_reject:.0%} of pages',
                                reject_reason=RejectReason.SCANNED_ONLY))
            return reject(RejectReason.SCANNED_ONLY,
                          f'Only {pages_with_text} of {page_count} pages contain extractable text.')
        if ratio < policy.min_pages_with_text_ratio_warn:
            checks.append(Check('text_yield', CheckStatus.WARN,
                                'Some pages contain no extractable text and will not be searchable.',
                                observed={'pages_with_text': pages_with_text, 'pages': page_count,
                                          'empty_pages': empty_pages},
                                expected=f'>= {policy.min_pages_with_text_ratio_warn:.0%} of pages'))
            warnings.append({'code': 'pages_without_text',
                             'message': f'{len(empty_pages)} page(s) contain no extractable text '
                                        f'and will not be searchable.',
                             'pages': empty_pages})
        else:
            checks.append(Check('text_yield', CheckStatus.PASS,
                                'All pages contain extractable text.',
                                observed={'pages_with_text': pages_with_text, 'pages': page_count},
                                expected=f'>= {policy.min_pages_with_text_ratio_warn:.0%} of pages'))

        meta = doc.metadata or {}
        document = Document(
            document_id=Document.make_id(raw),
            checksum_sha256=result.checksum_sha256,
            source_filename=path.name,
            display_title=(meta.get('title') or path.stem).strip(),
            page_count=page_count,
            byte_size=len(raw),
            pdf_version=meta.get('format'),
            extractor=EXTRACTOR,
            import_warnings=warnings,
        )
        result.document = document.to_dict()
        result.outcome = Outcome.ACCEPTED_WITH_WARNINGS if warnings else Outcome.ACCEPTED
        return result
    finally:
        doc.close()


# ---------------------------------------------------------------------------
# chunking
# ---------------------------------------------------------------------------
_PARA_BREAK = re.compile(r'\n\s*\n')
_SENTENCE_END = re.compile(r'[.!?]["\'”’)\]]*\s+')


def _boundary(text: str, position: int, limit: int) -> int:
    """Move a split point back to the nearest word boundary, within reason."""
    if position >= limit:
        return limit
    window = text.rfind(' ', max(0, position - 120), position)
    return window + 1 if window != -1 else position


def _boundaries(text: str) -> list[int]:
    """
    Offsets where a chunk may begin or end.

    Paragraph breaks and sentence ends only. Line breaks are deliberately not
    boundaries: PDF text wraps mid-sentence, so splitting on a newline is how a
    chunk ends up starting with 'nuclear power plant is to produce electricity'
    and no subject.
    """
    points = {0, len(text)}
    for match in _PARA_BREAK.finditer(text):
        points.add(match.end())
    for match in _SENTENCE_END.finditer(text):
        points.add(match.end())
    return sorted(points)


def chunks(path: str | Path, config: ChunkerConfig | None = None,
           document_id: str | None = None) -> list[Chunk]:
    """
    Split one validated document into Chunk objects.

    Callers validate first. Running this on a rejected file is a caller bug, not
    something this function silently absorbs.

    Boundaries land on sentence and paragraph ends, so a chunk reads as prose
    rather than starting and stopping mid-clause. target_chars stays a budget:
    the chunk runs to the last sentence that fits. Where a single sentence is
    longer than the budget - a run of figure labels, a table - it falls back to
    the word boundary so one pathological block cannot produce a giant chunk.
    """
    config = config or ChunkerConfig()
    path = Path(path)
    raw = path.read_bytes()
    document_id = document_id or Document.make_id(raw)

    text, pages, doc = extract(path, sort=config.sorted_reading_order,
                               strip_boilerplate=config.strip_running_headers)
    doc.close()
    if not text.strip():
        return []

    length = len(text)
    stops = _boundaries(text) if config.respect_sentence_boundaries else []

    def snap(target: int, floor: int) -> int | None:
        """The last boundary at or before target that still moves past floor."""
        if not stops or target <= floor:
            return None
        index = bisect.bisect_right(stops, target) - 1
        if index >= 0 and stops[index] > floor:
            return stops[index]
        return None

    out: list[Chunk] = []
    cursor = ordinal = 0

    while cursor < length:
        budget = min(cursor + config.target_chars, length)
        end = snap(budget, cursor)
        # A boundary that barely clears the cursor means the sentence ends are
        # sparse here - a run of figure labels, a table, a column of headings -
        # so honouring it would spend a whole chunk on a fragment. Below half
        # the budget, cut at the word boundary instead: in a block with no
        # sentence structure there is no sentence to preserve.
        if end is None or (end - cursor) * 2 < config.target_chars:
            end = _boundary(text, budget, length)
        if end <= cursor:
            end = budget
        # A tail too short to stand alone is folded in rather than left a runt.
        if length - end < config.min_chunk_chars:
            end = length

        body = text[cursor:end]
        if body.strip():
            spans = _page_spans(cursor, end, pages)
            out.append(Chunk(
                chunk_id=Chunk.make_id(document_id, config.config_id, cursor, end),
                document_id=document_id,
                ordinal=ordinal,
                text=body,
                text_checksum_sha256=text_checksum(body),
                char_start=cursor,
                char_end=end,
                page_start=spans[0].page_number,
                page_end=spans[-1].page_number,
                page_spans=spans,
                token_estimate=max(1, len(body) // 4),
                chunker_config_id=config.config_id,
                chunker_version=config.chunker_version,
            ))
            ordinal += 1

        if end >= length:
            break
        # Step back by the overlap window, landing on a sentence start so the
        # shared region is readable too, then clamp so the cursor always moves.
        # Never step back by more than half the chunk, or a chunk shorter than
        # the overlap window would cancel its own forward progress and the
        # cursor would crawl one character at a time.
        step_back = min(config.overlap_chars, (end - cursor) // 2)
        nxt = snap(end - step_back, cursor)
        if nxt is None or nxt <= cursor:
            # No sentence start to land on, so at least land between words: a
            # chunk beginning mid-word is unreadable to a person and unhelpful
            # to an embedding.
            nxt = _boundary(text, end - step_back, length)
        cursor = max(cursor + 1, min(nxt, end))

    return out


def _page_spans(start: int, end: int, pages: list[_Page]) -> list[PageSpan]:
    """Map a chunk's character range onto the pages and rectangles it covers."""
    spans: list[PageSpan] = []
    for page in pages:
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


def _merge_rects(rects: list[list[float]], tolerance: float = 2.0) -> list[list[float]]:
    """Merge span rectangles that sit on the same text line, so the UI draws one box per line."""
    if not rects:
        return []
    rects = sorted(rects, key=lambda r: (round(r[1], 1), r[0]))
    merged = [list(rects[0])]
    for r in rects[1:]:
        last = merged[-1]
        same_line = abs(r[1] - last[1]) <= tolerance and abs(r[3] - last[3]) <= tolerance
        if same_line and r[0] - last[2] <= 12.0:
            last[2] = max(last[2], r[2])
            last[1] = min(last[1], r[1])
            last[3] = max(last[3], r[3])
        else:
            merged.append(list(r))
    return [[round(v, 2) for v in r] for r in merged]
