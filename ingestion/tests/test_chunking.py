"""
Tests for where chunks begin and end.

The goal they pin: a chunk is a run of whole sentences, so a cited chunk reads
as a self-contained passage and a reader can tell exactly where it came from.
Where the text has no sentences (a table, a contents page, a column of labels)
a chunk is a run of whole lines instead, and never stops inside one.

None of these asks the detector to grade itself. The oracles are:
  * hand-labelled strings (a person marked where the sentences end),
  * mechanical facts about the stream (is the cut at a line start? does the
    text before it end in terminal punctuation?),
  * literal patterns that are known false boundaries ("J. J. Thompson"),
  * synthetic text whose structure is known by construction.

Run:  python3 tests/test_chunking.py
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from src.ingest import chunks, extract, plan_cuts
from src.schema import ChunkerConfig
from src.sentences import sentence_starts

FIX = ROOT / 'fixtures'
NORMAL = FIX / 'normal' / 'normal_nrc_reactor_concepts_ch01.pdf'
LARGE = FIX / 'large' / 'large_doe_nuclear_physics_v1.pdf'
ORIGINAL = FIX / 'large' / 'large_doe_nuclear_physics_v1_original.pdf'
ARXIV = FIX / 'layout' / 'layout_arxiv_two_column_2112.11583.pdf'
CHUNKED = [NORMAL, LARGE, ORIGINAL, ARXIV]

CONFIGS = [
    ChunkerConfig(),
    ChunkerConfig(target_chars=600, overlap_chars=100),
    ChunkerConfig(target_chars=2400, overlap_chars=400),
    ChunkerConfig(target_chars=1200, overlap_chars=0),
    ChunkerConfig(target_chars=300, overlap_chars=50),      # many cuts: many chances to cut badly
]

_STREAMS: dict = {}
_CHUNKS: dict = {}


def stream(path):
    if path not in _STREAMS:
        text, _, doc = extract(path)
        doc.close()
        _STREAMS[path] = text
    return _STREAMS[path]


def cuts(path, cfg):
    """(start, end) of every chunk, from the real chunks() on the real PDF (default config) or the planner."""
    key = (path, cfg.config_id)
    if key not in _CHUNKS:
        if cfg == ChunkerConfig():
            _CHUNKS[key] = [(c.char_start, c.char_end) for c in chunks(path, cfg)]
        else:
            _CHUNKS[key] = [(s, e) for s, e, _ in plan_cuts(stream(path), cfg)]
    return _CHUNKS[key]


TERMINATED = re.compile(r'[.!?]["\'”’)\]]*(?:\[\d+(?:[,–-]\s*\d+)*\])?\s+$')


def after_terminator(text, pos):
    return bool(TERMINATED.search(text, max(0, pos - 40), pos))


# ---------------------------------------------------------------------------
# 1. the detector against a human
# ---------------------------------------------------------------------------
# '|' marks every place a reader would say one sentence has ended and the next
# unit begins. The detector must find exactly these and no others.
LABELLED = [
    # must be found
    'and is given the symbol Z. |The number of electrons in an atom',
    'proposed by the English chemist John\nDalton in 1803. |Dalton stated that each element',
    'release “Nuclear Power.”  |The purpose of a\nnuclear power plant is to produce electricity.',
    'identifies the\nparticular element. \n\n|ATOMIC NATURE OF MATTER\nEach type of atom',
    'frequency of the photon.) |Bohr\'s\ntheory was the first',
    'the fission rate in that cubic centimeter?\n|Solution:\nIn addition',
    'the binding energy of the nuclide.\n|1.8\nGiven the atomic mass for a nuclide',
    'nuclear history in literature.\n|B.\nPhysics of WWII\nFollowing the establishment',
    'Reviews of Physics 49, 519 (1936).\n|[8] F. Enrico and S. Leo, Neutronic reactor (1955).\n|[9] F. Enrico',
    'design temperature is 650 degrees F.\n|COOLANT PUMP SPECIFICATIONS\nEach pump',
    'in the United States (U.S.). |The handbook was written in the U.S. |It is public.',
    'electromagnetic radiation.\n|& A curie (Ci) is a unit of radioactivity.\n|& A becquerel (Bq) is another.',
    # must not be found
    'indeed\nexist. |In 1906, J. J. Thompson won the Nobel Prize in physics',
    'Foster, Arthur R. and Wright, Robert L. Jr., Basic Nuclear Engineering, 3rd Edition, Allyn\nand Bacon, Inc., 1977.\n|Jacobs, A.M.',
    'Figure 20 Binding Energy per Nucleon vs. Mass Number . . . . . . . . . . . 53\nFigure 21 Uranium-235 Fission Yield',
    'Radioactive Half-Life\n. . . . . . . . . . . . . . . . . . . . . . . .\n 32\nPlotting Radioactive Decay',
    'DEFINE the following terms:\na.\nNuclide\nc.\nAtomic number\nb.\nIsotope\nd.\nMass number',
    'the average atomic radii are\n\nATOMIC NATURE OF MATTER\napproximately the same for all atoms',
    'steam turbine, diesel engine,\netc.) must be available to provide the motive force',
    'was the Fort St. Vrain plant\nin Colorado.  |The plant was manufactured',
    'meet objectives.\n\n|FIG. 1. Graphical syllabus for NE290 course. |Units are\ncolored.',
    'the history of the cyclotron (W3L5)\nby Dr. Tim Koeth (University of Maryland, Figure 2)',
    'Technical Information Services, U.S.\nDepartment of Commerce, 5285 Port Royal., Springfield, VA 22161.\n|Order No. DE93012221',
    'the radius of a typical atom (e.g. 2 x 10 -8 cm) is more than 25,000\ntimes larger',
    'in the following equation.\n|NP-01  Page 6 (cont. 2)  Rev. 0   DOE-HDBK-1019/1-93',
    'one atomic mass unit is equal to 1.66 x 10-24 grams and 3.5 percent',
    'as described by Smith et al. in their report',
]


def test_detector_agrees_with_hand_labels():
    wrong = []
    for case in LABELLED:
        text = case.replace('|', '')
        expected, offset = {0, len(text)}, 0
        for part in case.split('|')[:-1]:
            offset += len(part)
            expected.add(offset)
        got = set(sentence_starts(text))
        if got != expected:
            missed = sorted(expected - got)
            extra = sorted(got - expected)
            wrong.append((text[:50], [text[m - 15:m + 10] for m in missed], [text[x - 15:x + 10] for x in extra]))
    assert not wrong, f'{len(wrong)} of {len(LABELLED)} labelled cases disagree: {wrong[:3]}'
    return f'{len(LABELLED)} hand-labelled cases: every marked boundary found, none invented'


# ---------------------------------------------------------------------------
# 2. mechanical facts about every cut in the real documents
# ---------------------------------------------------------------------------
def test_a_detached_exponent_stays_with_its_sentence():
    """
    The layout sets an exponent on its own baseline, so "1 x 10^6 atoms/second."
    arrives as "1 x 10 atoms/second." with a bare "6" as the rest of the line
    or as the line after. A cut between the two leaves the next chunk opening
    on "6". The first numbers of a display equation look the same and belong
    to what follows them, so the rule applies only before a line of text.
    Each case: the text, and how the next unit must begin.
    """
    cases = [
        ('produced at a rate of\n1 x 10 atoms/second.\n6\n\nThe development of the equation', 'The development'),
        ('a half-life greater than 1 x 10 years is reached. 6\nSolution:\nPredicting', 'Solution:'),
        ('will usually undergo \ufffd decay.\n-\nNuclides that are above', 'Nuclides that'),
        ('as the result of spontaneous fission.\n12\nImportant  drawbacks for some', 'Important'),
        ('between barns and cm is shown below.\n2\n1 barn = 10 cm\n-24\n2', '1 barn = 10 cm'),
        # the start of an equation or a nuclide list is left where it is
        ('in the nuclides listed below.\n1\n1H\n10\n5B\n14\n7N', '1\n1H'),
        ('converted to an energy equivalent.\n93\n37\nRb\n93\n38', '93\n37\nRb'),
        ('The totals follow.\n12\n34\n56\n78\nEnd of table. Next.', '12\n34'),
        ('It is 5 cm long.\n2\nwhere x is the length', '2\nwhere'),
    ]
    for text, begins in cases:
        inner = [p for p in sentence_starts(text) if 0 < p < len(text)]
        assert inner and text.startswith(begins, inner[0]), (
            f'{text[:40]!r}: next unit begins {text[inner[0]:inner[0] + 16]!r}, expected {begins!r}')
        assert text[inner[0] - 1] == '\n', f'{text[:40]!r}: the boundary is inside a line'
    return f'{len(cases)} cases: 5 stray exponents kept with their sentence, 4 equation openings left alone'


def test_a_line_that_fits_the_budget_is_not_cut_to_keep_an_overlap():
    """
    The budget is measured from where the overlap starts, so after a generous
    overlap a line can fit in target_chars and still not fit in what is left.
    The chunk gives up its overlap before it cuts between words.
    """
    prose = ('The pump runs. ' * 10).strip()
    more = ('The valve opens when the pressure rises above the set point of the relief line. ' * 2).strip()
    long_line = ('value ' * 58).strip()                         # 347 characters, no sentence end
    text = '\n'.join([prose, more, long_line, ('The end is near. ' * 6).strip()]) + '\n'
    cfg = ChunkerConfig(target_chars=400, overlap_chars=200, min_chunk_chars=100)
    assert len(long_line) < cfg.target_chars
    plan = plan_cuts(text, cfg)
    kinds = [kind for _, _, kind in plan]
    assert 'word' not in kinds and 'hard' not in kinds, f'a line that fits was cut inside: {kinds}'
    assert all(end - start <= cfg.target_chars + cfg.min_chunk_chars for start, end, _ in plan)
    assert any(text[start:end].startswith(long_line) for start, end, _ in plan), (
        'the long line does not open a chunk of its own')
    assert ''.join(text[max(s, plan[i - 1][1] if i else 0):e] for i, (s, e, _) in enumerate(plan)) == text
    return f'{len(plan)} chunks, end kinds {kinds}: the 347-character line is whole in one of them'


def test_no_cut_falls_inside_a_line():
    """Every chunk boundary follows terminal punctuation or sits at the start of a line."""
    checked = 0
    for path in CHUNKED:
        text = stream(path)
        longest = max(len(line) for line in text.split('\n'))
        for cfg in CONFIGS:
            assert longest <= cfg.target_chars, 'fixture has a line longer than the budget'
            spans = cuts(path, cfg)
            for pos in [e for _, e in spans[:-1]] + [s for s, _ in spans[1:]]:
                assert text[pos - 1] == '\n' or after_terminator(text, pos), (
                    f'{path.name} target={cfg.target_chars}: cut inside a line at {pos}: '
                    f'{text[pos - 40:pos]!r} | {text[pos:pos + 20]!r}')
                checked += 1
    return f'{checked} cuts across {len(CHUNKED)} documents and {len(CONFIGS)} configs: none inside a line'


def test_a_page_break_alone_never_ends_a_chunk_in_prose():
    """
    A chunk may stop at a page break only if the page ended a sentence, or as a
    line-end fallback where the text it adds has no sentence end to stop on
    instead (a contents page, a table, a block of equation fragments).

    With the default config the old chunker ended 15 chunks of the DOE reflow
    and 13 of the DOE original at a page break in the middle of a sentence.
    The oracle is deliberately simple: the text this chunk adds, up to the
    cut, holds no 'word. Capital' in its last 300 characters.
    """
    plain_break = re.compile(r'[a-z]{4,}[.!?]["”’)]*\s+[A-Z]')
    allowed = {NORMAL: 0, ARXIV: 0, ORIGINAL: 0, LARGE: 2}
    seen = 0
    for path in CHUNKED:
        text = stream(path)
        for cfg in CONFIGS:
            spans = cuts(path, cfg)
            here = 0
            for (_, prev_end), (_, end) in zip([(0, 0)] + spans, spans[:-1]):
                if text[end - 2:end] != '\n\n' or after_terminator(text, end):
                    continue
                here += 1
                if cfg.target_chars < 600:
                    continue    # too crude an oracle once the overlap is most of the chunk
                assert not plain_break.search(text, max(prev_end, end - 300), end), (
                    f'{path.name} target={cfg.target_chars}: chunk ends mid-sentence at a page break: '
                    f'{text[end - 60:end]!r}')
            if cfg == ChunkerConfig():
                assert here <= allowed[path], f'{path.name}: {here} chunks end at an unterminated page break'
            seen += here
    return f'{seen} chunk ends at an unterminated page break across all configs, all in sentence-free text'


FALSE_ENDS = [
    ('abbreviation',     re.compile(r'(?:\b|\()(?:Fig|FIG|Figs|Eq|vs|No|Dr|Mr|Mrs|Ms|Prof|St|Vol|Rev|cont|Cont|e\.g|i\.e|cf|pp)\.\)?\s+$')),
    # "J. J." or "Arthur R." - but "shown in Table I." is a sentence end, so numbered things are exempt
    ('initial',          re.compile(r'(?:[A-Z]\.\s[A-Z]|\b(?!Table|Figure|Section|Chapter|Appendix|Part|Type|Class)'
                                    r'[A-Z][a-z]+,?\s[A-Z])\.\s+$')),
    ('bare enumerator',  re.compile(r'(?:^|\n)[ \t]*(?:[a-z]|\d{1,2}|[IVX]{1,4})\.\s+$')),
    ('caption label',    re.compile(r'(?:^|\n)[ \t]*(?:FIG\.|Fig\.|Figure|TABLE|Table)\s+[\dIVX]+\.\s+$')),
]
SPLIT_CONTENTS_ENTRY = re.compile(r'\.\s\.\s*\n$')
PAGE_NUMBER_LINE = re.compile(r'[ \t]*\.?[ \t.]*\d{1,4}[ \t]*\n')


def test_no_chunk_ends_on_a_known_false_boundary():
    """No chunk ends on an abbreviation, an initial, a list letter, a caption label or half a contents entry."""
    checked = 0
    for path in CHUNKED:
        text = stream(path)
        for cfg in CONFIGS:
            for _, end in cuts(path, cfg)[:-1]:
                tail = text[max(0, end - 60):end]
                for name, pattern in FALSE_ENDS:
                    assert not pattern.search(tail), (
                        f'{path.name} target={cfg.target_chars}: chunk ends on {name}: {tail!r} | {text[end:end + 25]!r}')
                assert not (SPLIT_CONTENTS_ENTRY.search(tail) and PAGE_NUMBER_LINE.match(text, end)), (
                    f'{path.name} target={cfg.target_chars}: contents entry split from its page number: {tail!r}')
                checked += 1
    return f'{checked} chunk ends checked against {len(FALSE_ENDS) + 1} kinds of false boundary'


def test_most_chunks_end_on_terminal_punctuation():
    """
    Line-end fallbacks are for text without sentences. Measured with the default
    config: NRC 17/17, arXiv 48/48, DOE reflow 197/215, DOE original 186/203 -
    every exception is on a contents or list-of-figures page.
    """
    floors = {NORMAL: 1.0, ARXIV: 1.0, LARGE: 0.85, ORIGINAL: 0.85}
    report = []
    for path in CHUNKED:
        text = stream(path)
        ends = [e for _, e in cuts(path, ChunkerConfig())[:-1]]
        share = sum(after_terminator(text, e) for e in ends) / len(ends)
        assert share >= floors[path], f'{path.name}: only {share:.0%} of chunks end on terminal punctuation'
        report.append(f'{share:.0%}')
    return 'share of chunks ending on terminal punctuation: ' + ', '.join(report)


# ---------------------------------------------------------------------------
# 3. overlap: whole sentences, inside the window (replaces the "floor" test)
# ---------------------------------------------------------------------------
def test_overlap_is_whole_sentences_within_the_window():
    """
    overlap_chars is a ceiling. The next chunk starts at the earliest sentence
    start inside the window, so the shared text is whole sentences and at most
    overlap_chars long. One exception: when the last sentence is itself longer
    than the window, that one sentence is shared rather than nothing - never
    more than half the chunk, and never two sentences.
    """
    two_sentences = re.compile(r'[a-z]{4,}[.!?]["”’)]*\s+[A-Z]')
    pairs = shared_pairs = over = 0
    for path in CHUNKED:
        text = stream(path)
        for cfg in CONFIGS:
            spans = cuts(path, cfg)
            for (a0, a1), (b0, b1) in zip(spans, spans[1:]):
                overlap = a1 - b0
                assert 0 <= overlap <= (a1 - a0) // 2, f'overlap {overlap} of a {a1 - a0}-char chunk'
                assert b0 > a0 and b1 > a1, 'chunker failed to advance'
                assert cfg.overlap_chars or overlap == 0
                if overlap:
                    assert text[b0 - 1] == '\n' or after_terminator(text, b0), 'shared text starts mid-line'
                if overlap > cfg.overlap_chars:
                    over += 1
                    inner = text[b0:a1].rstrip()
                    assert not two_sentences.search(inner[:-1]), (
                        f'{path.name}: {overlap} shared chars exceed the window but hold more than one sentence: {inner[:80]!r}')
                pairs += 1
                shared_pairs += overlap > 0
            if cfg == ChunkerConfig():
                with_overlap = sum(1 for (a0, a1), (b0, b1) in zip(spans, spans[1:]) if a1 > b0)
                assert with_overlap >= 0.9 * (len(spans) - 1), (
                    f'{path.name} target={cfg.target_chars}: only {with_overlap}/{len(spans) - 1} pairs share text')
    return f'{pairs} adjacent pairs, {shared_pairs} share text, {over} share one over-long sentence'


# ---------------------------------------------------------------------------
# 4. structure known by construction
# ---------------------------------------------------------------------------
def test_synthetic_page_break_inside_a_sentence_is_not_a_boundary():
    filler = 'Alpha particles are stopped by a sheet of paper. ' * 6
    text = filler + 'This sentence starts on one page and\n\ncontinues on the next page. ' + filler
    forbidden = text.index('\n\n') + 2
    for target in (300, 320, 330, 340, 360, 400):
        spans = plan_cuts(text, ChunkerConfig(target_chars=target, overlap_chars=60, min_chunk_chars=50))
        assert len(spans) > 1
        for start, end, _ in spans:
            assert forbidden not in (start, end), f'target={target}: cut at the page break'
            assert start == 0 or text[start - 2:start] in ('. ', 'e.') or after_terminator(text, start)
    return 'a sentence that crosses a page break stays whole at six budgets'


def test_synthetic_table_falls_back_to_whole_lines_and_long_lines_to_words():
    table = '\n'.join(f'Row {i} carries value {i * 7} in unit {i % 5}' for i in range(120)) + '\n'
    spans = plan_cuts(table, ChunkerConfig(target_chars=300, overlap_chars=60))
    assert len(spans) > 5
    for start, end, kind in spans[:-1]:
        assert table[end - 1] == '\n' and kind in ('line', 'weak-line'), f'table cut inside a row ({kind})'
        assert end - start <= 300
    for start, _, _ in spans[1:]:
        assert table[start - 1] == '\n', 'chunk starts inside a table row'

    one_line = ' '.join(f'token{i}' for i in range(400))
    spans = plan_cuts(one_line, ChunkerConfig(target_chars=300, overlap_chars=60))
    for start, end, kind in spans[:-1]:
        assert kind == 'word' and one_line[end - 1] == ' ' and end - start <= 300
    one_word = 'x' * 1000
    spans = plan_cuts(one_word, ChunkerConfig(target_chars=300, overlap_chars=0))
    assert [e - s for s, e, _ in spans] == [300, 300, 300, 100]
    return 'a table is cut between rows; one long line between words; one long word at the budget'


def test_a_short_sentence_before_a_long_table_is_not_a_chunk_of_its_own_overlap():
    """Each chunk must add at least min_chunk_chars the previous chunk did not hold."""
    for path in CHUNKED:
        for cfg in CONFIGS:
            if cfg.target_chars < 600:
                continue        # too little room after the overlap for the preference to be a guarantee
            spans = cuts(path, cfg)
            for (a0, a1), (b0, b1) in zip(spans, spans[1:-1]):
                assert b1 - a1 >= cfg.min_chunk_chars, (
                    f'{path.name} target={cfg.target_chars}: chunk adds only {b1 - a1} new characters')
    return 'every chunk but the last adds at least min_chunk_chars of new text'


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
