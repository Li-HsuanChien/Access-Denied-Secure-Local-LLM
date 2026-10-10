"""
Sentence-boundary detection for the canonical PDF text stream.

Works from the text alone: no layout, no fonts, no dependency. The stream is
what extract() builds - one "\n" per layout line, one extra "\n" per page - so
a newline says nothing about sentences and a blank line says only "page break".

  sentence_starts(text)  offsets where a new sentence (or the heading / table /
                         label run that leads into one) begins: the offset just
                         after a true sentence end and its whitespace.
  line_starts(text)      offsets where a non-blank line begins, graded good or
                         weak, for the fallback when a stretch of text has no
                         sentence end inside the budget.

The detector is precision-first. A missed sentence end costs a slightly longer
unit; a false one is a chunk that stops at "Fig." - so every doubtful case
resolves to "not a boundary".
"""
from __future__ import annotations

import re

# A terminator, any closing quotes/brackets, an optional citation marker, then
# whitespace (which may include a page break) or the end of the text.
_CANDIDATE = re.compile(r'[.!?]["\'”’)\]]*(?:\[\d+(?:[,–-]\s*\d+)*\])?(?:\s+|$)')

_OPEN = '"\'“‘([{'
_CLOSE = '"\'”’)]}'

# Never end a sentence, whatever their case.
_ABBR_ANY = frozenset('''
e.g i.e vs cf viz fig figs eq eqs eqn pp approx ca vol vols dept univ natl intl
dr mr mrs prof capt cmdr sgt gov lt jan feb apr aug sept oct nov dec ed eds chap
sect refs circ acad proc conf cont
'''.split())
# The same, but only when capitalised: in lower case these are ordinary words
# or units ("the answer is no.", "5 ms.", "12 ft.").
_ABBR_CAP = frozenset('''
no nos st mt ft gen col sen rep hon rev ms mar jun jul sep est mem tech trans ch
sec ref
'''.split())
# Often do end a sentence: a boundary only when an unmistakable opener follows.
_ABBR_MAYBE = frozenset('etc inc co corp ltd jr sr bros al'.split())
_DOTTED = re.compile(r'(?:[A-Za-z]{1,4}\.)+[A-Za-z]{1,4}$')          # U.S  e.g  Ph.D  K.E

# Words that open sentences far more often than they follow an initial or an
# abbreviation inside a name. Only used to rescue the ambiguous cases.
_OPENERS = frozenset('''
The This That These Those It Its In On At As An A If For From With When While
Where Since Because Although Though However Thus Therefore Hence Then There
Here We Our He She They Their Each Some Most Many All Both Such Other Another
After Before During Under Over To By One Two Three Note Also Figure Table
'''.split())

# "FIG. 1." / "Table 2." / "Step 4." at the start of a line labels what follows.
_LABELS = frozenset('''
fig fig. figs figure figures table tables eq eq. eqn equation step example
exercise problem chapter section sec. module volume appendix part note case
'''.split())

_INITIAL = re.compile(r'(?:[A-Z]\.)+,?$')
_NUMBER = re.compile(r'\d[\d.,:/()–%°-]*$')
_ROMAN = re.compile(r'[IVXLC]{1,5}$')
_ENUM = re.compile(r'[A-Za-z]{0,2}\d{1,3}[a-z]?$|\d{1,2}(?:\.\d{1,2}){0,3}$')
_HAS_LETTER = re.compile(r'[A-Za-z]')
_NOT_BULLET = '=+<>×÷±/\\|^~()[]{}"\'“”‘’.,;:!?%$'
_ENTRY = re.compile(r'[\[(]\d{1,3}[\])]')              # "[12]" / "(3)" opening a list entry
_CHAIN = re.compile(r'[A-Z][a-z]{1,4}\.$')              # the "Rev." after "Phys."
_TITLES = frozenset('dr mr mrs ms prof st'.split())
# A bare exponent or sign that the layout set on its own baseline: the "6" of
# "1 x 10 atoms/second." arrives as the rest of the line or as the line after.
_FRAGMENT = re.compile(r'[-+−–]\d{0,2}$|\d{1,2}$')
_MAX_FRAGMENTS = 2                                       # more than this in a row is a column of figures
_MIN_TEXT_LINE = 8                                       # shorter than this is another scrap, not text


def _token_before(text: str, end: int) -> tuple[int, str]:
    """The whitespace-delimited token that ends at `end`, skipping whitespace first."""
    while end > 0 and text[end - 1].isspace():
        end -= 1
    start = end
    while start > 0 and not text[start - 1].isspace():
        start -= 1
    return start, text[start:end]


def _token_after(text: str, start: int) -> str:
    end, limit = start, min(len(text), start + 40)
    while end < limit and not text[end].isspace():
        end += 1
    return text[start:end]


def _line_initial(text: str, pos: int) -> bool:
    """True when only blanks separate `pos` from the start of its line."""
    while pos > 0 and text[pos - 1] in ' \t':
        pos -= 1
    return pos == 0 or text[pos - 1] == '\n'


def _inside_parens(text: str, dot: int, after: int) -> bool:
    """
    True when the terminator sits inside a short parenthetical that opened on
    the same line and closes a few words later: "(cont. 4)", "(approx. 5 cm)".
    A period there is an abbreviation; a sentence that ends a parenthetical
    has its ")" right after the period, which the candidate already absorbed.
    """
    floor = max(0, dot - 200)                         # bounded look-back: lines can be very long
    newline = text.rfind('\n', floor, dot)
    line_start = newline + 1 if newline != -1 else floor
    before = text[line_start:dot]
    if before.count('(') <= before.count(')'):
        return False
    tail = text[after:after + 24]
    close = tail.find(')')
    return close != -1 and '(' not in tail[:close] and '\n' not in tail[:close] \
        and not any(c in tail[:close] for c in '.!?')


def _judge(text: str, dot: int, after: int) -> str:
    """
    Decide one candidate: 'ok...' for a sentence end, otherwise the name of the
    rule that rejected it. `dot` is the terminator's offset; `after` is the
    offset of the first character past the whitespace that follows it.
    """
    tok_start = dot
    while tok_start > 0 and not text[tok_start - 1].isspace():
        tok_start -= 1
    raw = text[tok_start:dot]
    word = raw.strip(_OPEN + _CLOSE)
    nxt_raw = _token_after(text, after)
    nxt = nxt_raw.lstrip(_OPEN)

    # 1. dot leaders, ellipses, stray dots: ". . . . 52", "....", "A ."
    if text[dot] == '.':
        if not word.strip('.') or nxt_raw.startswith('.') or text[dot + 1:dot + 2] == '.':
            return 'leader'
    if after >= len(text):
        return 'ok:end-of-text'

    # 2. what follows must be able to start a sentence
    first = nxt[:1]
    if first.islower() or not first:
        return 'next-lower'
    # A lone mark at the start of a line, then a capitalised word, is a list bullet
    # whatever glyph the font mapped it to ("•", "-", "&", "*").
    bullet = len(nxt_raw) == 1 and not nxt_raw.isalnum() and nxt_raw not in _NOT_BULLET \
        and _line_initial(text, after) and text[after + 1:after + 3].strip()[:1].isupper()
    entry = bool(_ENTRY.match(nxt_raw)) and _line_initial(text, after)   # "[12] A. Author"
    if not (first.isupper() or first.isdigit() or bullet or entry):
        return 'next-symbol'
    digit_next = first.isdigit() and not entry
    if text[dot] != '.':
        return 'ok:?!'
    if _inside_parens(text, dot, after):
        return 'in-parens'                            # "(cont. 4)"  "(e.g. 2 x 10 -8 cm)"

    prev_start, prev_raw = _token_before(text, tok_start)
    at_line_start = _line_initial(text, tok_start)
    low = word.lower()
    lead = re.match(r'[A-Za-z]+', nxt)
    opener = bool(lead and lead.group(0) in _OPENERS)

    # 3. a single letter: list item, initial, or a symbol/unit that ends the sentence
    if len(word) == 1 and word.isalpha():
        if at_line_start:
            return 'enumerator'                       # "a." / "B." / "I." on its own
        if _INITIAL.match(nxt_raw):
            return 'initial'                          # "J. J. Thompson"
        if opener:
            return 'ok:symbol'                        # "the symbol Z. The number"
        if _ENTRY.match(prev_raw):
            return 'initial'                          # "[2] H. Poincare"
        if not _HAS_LETTER.search(prev_raw):
            return 'ok:symbol'                        # "= A."  "2\n1 D."  "260 C."  "55.8 g."
        name_follows = bool(lead) and nxt[:1].isupper() and nxt[1:2].islower()
        if word.isupper() and prev_raw[:1].islower() and not name_follows:
            return 'ok:symbol'                        # "650 degrees F.\nSYSTEM NOTE"
        return 'initial'                              # "Robert F. Krieger", "and S. Maruyama"

    # 4. numbers: years and quantities end sentences; list and caption labels do not
    is_roman = bool(_ROMAN.match(word))
    if _NUMBER.match(word) or is_roman:
        if at_line_start and (is_roman or (_ENUM.match(word) and sum(c.isdigit() for c in word) <= 3)):
            return 'enumerator'                       # "1." "12." "2.3." "IV."
        if prev_raw.strip(_OPEN).lower() in _LABELS and _line_initial(text, prev_start):
            return 'caption-label'                    # "FIG. 1. Graphical syllabus"
        if digit_next:
            return 'next-digit'
        return 'ok:number'
    if at_line_start and _ENUM.match(word):
        return 'enumerator'                           # "H1." "C3."

    # 5. abbreviations
    if low in _ABBR_ANY or (low in _ABBR_CAP and word[:1].isupper()):
        return 'abbrev'
    if low in _ABBR_MAYBE or _DOTTED.match(word):
        return 'ok:abbrev+opener' if opener else 'abbrev'
    short_cap = len(word) <= 5 and word[:1].isupper() and word[1:].islower()
    if short_cap and not opener:
        if digit_next:
            return 'abbrev-digit'                     # "Art. 5", "Tab. 2"
        if _CHAIN.match(nxt_raw) and nxt_raw[:-1].lower() not in _TITLES:
            return 'abbrev-chain'                     # "Phys. Rev. Lett."

    # 6. a number may open the next sentence only after a real word
    if digit_next and not (word[-1:].isalpha() or raw[-1:] in _CLOSE + '%'):
        return 'next-digit'
    return 'ok'


def sentence_decisions(text: str) -> list[tuple[int, int, str]]:
    """Every candidate as (terminator offset, offset after its whitespace, verdict)."""
    return [(m.start(), m.end(), _judge(text, m.start(), m.end()))
            for m in _CANDIDATE.finditer(text)]


def _next_line(text: str, end: int) -> int:
    """The start of the first non-blank line after the line that ends at `end`."""
    pos, n = end, len(text)
    while pos < n and text[pos].isspace():
        pos += 1
    newline = text.rfind('\n', end, pos)
    return newline + 1 if newline != -1 else pos


def _past_fragments(text: str, pos: int) -> int:
    """
    Where the next sentence really starts when a sentence end is followed by a
    detached exponent or sign: after it, so the fragment stays with the
    sentence it was set in. `pos` itself when nothing of the kind follows.

    Two cases. A fragment that finishes the sentence's own line always goes
    with it. A fragment on a line of its own does only when a line of ordinary
    text follows: "below.\n93\n37\nRb" is the start of an equation, and its
    first numbers belong to what comes after them.
    """
    n = len(text)

    def line(at: int) -> tuple[str, int]:
        end = text.find('\n', at)
        end = n if end == -1 else end
        return text[at:end].strip(), end

    if pos < n and not _line_initial(text, pos):
        body, end = line(pos)
        if not _FRAGMENT.match(body):
            return pos
        pos = _next_line(text, end)
    probe, skipped = pos, 0
    while probe < n:
        body, end = line(probe)
        if not _FRAGMENT.match(body):
            break
        skipped += 1
        if skipped > _MAX_FRAGMENTS:
            return pos
        probe = _next_line(text, end)
    if skipped:
        follows = line(probe)[0] if probe < n else ''
        if len(follows) < _MIN_TEXT_LINE or follows[:1].islower():
            return pos
    return probe


def sentence_starts(text: str) -> list[int]:
    """
    Sorted offsets where a chunk may begin or end on a sentence boundary.

    Always contains 0 and len(text). A page break is not a boundary by itself:
    it becomes one only when the text before it ends a sentence.
    """
    points = {0, len(text)}
    for _, after, verdict in sentence_decisions(text):
        if verdict.startswith('ok'):
            points.add(_past_fragments(text, after))
    return sorted(points)


# ---------------------------------------------------------------------------
# line fallback
# ---------------------------------------------------------------------------
_CONNECTORS = frozenset('''
a an the of and or to in on at by for with from as is are was were be been that
which who whose than into onto per its their this these those between
'''.split())
_BARE_ENUM = re.compile(r'(?:[A-Za-z]|\d{1,3}(?:\.\d{1,2}){0,3}|[IVXivx]{1,5}|[A-Za-z]\d{1,2})[.)]?$'
                        r'|[•▪◦·‣*–-]$')
_LIST_MARK = re.compile(r'(?:[A-Za-z]|\d{1,2}|[ivxIVX]{1,4})[.)]$')     # a marker WITH its point
_PAGE_NUMBER = re.compile(r'(?:\d{1,4}|[ivxlc]{1,6})$')
_LEADER = re.compile(r'(?:\.\s){3,}|\.{4,}')


def _good_cut(before: str, after: str, earlier: str = '') -> bool:
    """Would cutting between these two (stripped) lines visibly split a unit?"""
    if after.startswith('.'):
        return False                                  # "Title\n. . . . . 11" / "...\n. 16"
    if _PAGE_NUMBER.match(after) and _LEADER.search(before):
        return False                                  # "Title . . . . .\n 11"
    if _PAGE_NUMBER.match(before) and _LEADER.search(earlier):
        return True                                   # "... . . .\n 11\n" ends a contents entry
    if _BARE_ENUM.match(before):
        return False                                  # "a." belongs to the next line
    if _LIST_MARK.match(after):
        return True                                   # "b." on its own line opens the next item
    if after[:1].islower():
        return False                                  # a wrapped line continues
    if before[-1] in '-‐,;:([{“‘/=+':
        return False                                  # hyphenated, or introduces what follows
    last = before.split()[-1]
    if last.lower() in _CONNECTORS:
        return False
    core = last.strip(_OPEN + _CLOSE)
    if core.endswith('.'):
        stem = core[:-1].lower()
        if stem in _ABBR_ANY or stem in _ABBR_MAYBE or (stem in _ABBR_CAP and core[:1].isupper()):
            return False                              # "... Fission Yield vs.\nMass Number", "(Cont.)"
    if _heading_like(before) and len(after) >= max(50, len(before) * 3 // 2) and after[:1].isupper():
        return False                                  # a heading stays with the text it heads
    return True


def _heading_like(line: str) -> bool:
    """A short line of words with no closing punctuation: 'Reactor Power Calculation'."""
    if len(line) > 60 or line[-1] in '.!?:;,' or not line[0].isupper() or _LEADER.search(line):
        return False
    words = line.split()
    return len(words) <= 8 and sum(c.isalpha() or c == ' ' for c in line) >= 0.8 * len(line)


def line_starts(text: str) -> tuple[list[int], list[int]]:
    """
    (all, good): sorted offsets where a non-blank line begins, excluding 0.

    A line start is good when cutting just before it does not visibly split a
    unit; see _good_cut. Blank lines (page breaks, spacer lines) are skipped so
    a chunk never begins with one.
    """
    every: list[int] = []
    good: list[int] = []
    before = earlier = ''
    pos = 0
    for line in text.split('\n'):          # not splitlines(): only '\n' ends a line in the stream
        body = line.strip()
        if body:
            if before:
                every.append(pos)
                if _good_cut(before, body, earlier):
                    good.append(pos)
            earlier, before = before, body
        pos += len(line) + 1
    return every, good
