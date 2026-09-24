#!/usr/bin/env python3
"""
Live walkthrough: one document, file to citation.

The Week 1 E2 demo, meant to be run in front of people rather than read.
WALKTHROUGH.md is the written version of the same thing.

    python3 demo.py                      # NRC baseline, chunk 0
    python3 demo.py --doc large          # the 96-page DOE handbook
    python3 demo.py --doc arxiv -n 7     # a specific chunk
    python3 demo.py --full-text          # also dump the entire stream
    python3 demo.py --no-color           # for piping to a file
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from src.ingest import chunks, extract, validate
from src.schema import ChunkerConfig, citation_targets

DOCS = {
    'normal': ROOT / 'fixtures/normal/normal_nrc_reactor_concepts_ch01.pdf',
    'large': ROOT / 'fixtures/large/large_doe_nuclear_physics_v1.pdf',
    'arxiv': ROOT / 'fixtures/layout/layout_arxiv_two_column_2112.11583.pdf',
    'scanned': ROOT / 'fixtures/scanned/scanned_mixed_text_and_image_pages.pdf',
    'truncated': ROOT / 'fixtures/corrupt/corrupt_truncated_50pct.pdf',
    'restricted': ROOT / 'fixtures/protected/protected_owner_password_no_extract.pdf',
}

C = {'dim': '\033[2m', 'b': '\033[1m', 'green': '\033[32m', 'yellow': '\033[33m',
     'red': '\033[31m', 'cyan': '\033[36m', 'mag': '\033[35m', 'inv': '\033[7m', '0': '\033[0m'}
STATUS = {'pass': 'green', 'warn': 'yellow', 'fail': 'red', 'skipped': 'dim'}


def plain():
    for k in C:
        C[k] = ''


def rule(title=''):
    bar = '─' * 78
    print(f"\n{C['dim']}{bar}{C['0']}")
    if title:
        print(f"{C['b']}{title}{C['0']}")


def show(text, limit=None):
    """Render text with escapes visible, so whitespace in the stream is not a mystery."""
    t = text[:limit] if limit else text
    out = t.replace('\n', f"{C['dim']}⏎{C['0']}\n")
    return out + (f"{C['dim']}…{C['0']}" if limit and len(text) > limit else '')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--doc', default='normal', choices=sorted(DOCS))
    ap.add_argument('-n', '--chunk', type=int, default=None,
                    help='which chunk to inspect (default: the first that spans pages)')
    ap.add_argument('--target-chars', type=int, default=1200)
    ap.add_argument('--overlap-chars', type=int, default=200)
    ap.add_argument('--full-text', action='store_true', help='dump the entire text stream')
    ap.add_argument('--no-color', action='store_true')
    args = ap.parse_args()
    if args.no_color or not sys.stdout.isatty():
        plain()

    pdf = DOCS[args.doc]
    config = ChunkerConfig(target_chars=args.target_chars, overlap_chars=args.overlap_chars)

    # ---------------------------------------------------------------- 1
    rule('1.  THE FILE')
    raw = pdf.read_bytes()
    print(f'   {pdf.relative_to(ROOT)}')
    print(f'   {len(raw):,} bytes, first 8 bytes {raw[:8]!r}')

    # ---------------------------------------------------------------- 2
    rule('2.  VALIDATE  →  ValidationResult')
    result = validate(pdf)
    for c in result.checks:
        colour = C[STATUS[c.status.value]]
        print(f'   {colour}{c.status.value.upper():<8}{C["0"]} {c.check_id:<22} {c.message}')
        if c.status.value in ('warn', 'fail'):
            print(f'            {C["dim"]}observed {json.dumps(c.observed)}  '
                  f'expected {json.dumps(c.expected)}{C["0"]}')
    verdict = result.outcome.value
    colour = C['green'] if verdict == 'accepted' else C['yellow'] if 'warn' in verdict else C['red']
    print(f'\n   outcome: {colour}{C["b"]}{verdict}{C["0"]}')
    if result.reject_reason:
        print(f'   reason:  {C["red"]}{result.reject_reason.value}{C["0"]} — {result.reject_detail}')
        print(f'\n   {C["dim"]}Rejected before indexing. Nothing downstream ever sees this file.{C["0"]}')
        return 0
    for w in result.warnings:
        print(f'   {C["yellow"]}warning{C["0"]}: {w["message"]}')

    doc_meta = result.document
    print(f'\n   document_id  {C["cyan"]}{doc_meta["document_id"]}{C["0"]}')
    print(f'   {C["dim"]}= doc_ + sha256(file bytes)[:24] — content-addressed, so the same'
          f'\n     file under any name is the same document.{C["0"]}')

    # ---------------------------------------------------------------- 3
    rule('3.  EXTRACT  →  one canonical text stream')
    text, pages, handle = extract(pdf)
    handle.close()
    print(f'   {len(text):,} characters across {len(pages)} pages '
          f'({len(text) // len(pages)} per page)')
    print(f'\n   {C["dim"]}Page boundaries are offsets into that single stream:{C["0"]}')
    for p in pages[:4]:
        print(f'     page {p.number:>3}   chars {p.char_start:>7,} – {p.char_end:<7,}'
              f'  {C["dim"]}{p.char_end - p.char_start:>5,} chars, {len(p.spans):>3} spans{C["0"]}')
    if len(pages) > 5:
        print(f'     {C["dim"]}...{C["0"]}')
        p = pages[-1]
        print(f'     page {p.number:>3}   chars {p.char_start:>7,} – {p.char_end:<7,}'
              f'  {C["dim"]}{p.char_end - p.char_start:>5,} chars, {len(p.spans):>3} spans{C["0"]}')

    dump = ROOT / 'walkthrough/text' / f'{pdf.stem}.text.txt'
    if dump.exists():
        print(f'\n   Full stream on disk: {C["cyan"]}{dump.relative_to(ROOT)}{C["0"]}')
        print(f'   {C["dim"]}Every chunk offset below indexes into that exact file.{C["0"]}')
    if args.full_text:
        rule('3b. THE ENTIRE STREAM')
        print(show(text))

    # ---------------------------------------------------------------- 4
    rule('4.  CHUNK  →  Chunk objects')
    print(f'   config {C["cyan"]}{config.config_id}{C["0"]}  '
          f'target={config.target_chars}  overlap={config.overlap_chars}')
    cs = chunks(pdf, config)
    spanning = [c for c in cs if c.spans_pages]
    print(f'   {len(cs)} chunks, {len(spanning)} of them spanning more than one page '
          f'({len(spanning) / len(cs):.0%})')
    print()
    print(f'   {C["dim"]}{"#":>3}  {"chunk_id":<28} {"pages":>7}  {"chars":>15}  {"len":>5}{C["0"]}')
    for c in cs[:6]:
        pages_label = (f'{c.page_start}' if not c.spans_pages
                       else f'{C["mag"]}{c.page_start}–{c.page_end}{C["0"]}')
        print(f'   {c.ordinal:>3}  {c.chunk_id:<28} {pages_label:>{7 + (len(C["mag"]) + len(C["0"]) if c.spans_pages else 0)}}'
              f'  {c.char_start:>6,}–{c.char_end:<7,} {len(c.text):>5,}')
    if len(cs) > 6:
        print(f'   {C["dim"]}... {len(cs) - 6} more{C["0"]}')

    # ---------------------------------------------------------------- 5
    index = args.chunk if args.chunk is not None else (spanning[0].ordinal if spanning else 0)
    chunk = cs[index]
    rule(f'5.  ONE CHUNK IN FULL  (ordinal {chunk.ordinal})')
    print(json.dumps(chunk.to_dict(), indent=2)[:2400])
    if len(json.dumps(chunk.to_dict(), indent=2)) > 2400:
        print(f'   {C["dim"]}… truncated; full object in walkthrough/all_chunks.json{C["0"]}')

    # ---------------------------------------------------------------- 6
    rule(f'6.  WHERE THAT CHUNK SITS IN THE STREAM')
    before = text[max(0, chunk.char_start - 90):chunk.char_start]
    after = text[chunk.char_end:chunk.char_end + 90]
    prev_end = cs[index - 1].char_end if index > 0 else None
    overlap_len = (prev_end - chunk.char_start) if prev_end and prev_end > chunk.char_start else 0

    print(f'   {C["dim"]}preceding text (not in this chunk){C["0"]}')
    print(f'   {C["dim"]}{show(before)}{C["0"]}')
    if overlap_len:
        print(f'\n   {C["yellow"]}▼ first {overlap_len} chars are the overlap shared with chunk '
              f'{index - 1}{C["0"]}')
        print(f'   {C["yellow"]}{show(chunk.text[:overlap_len])}{C["0"]}')
        print(f'\n   {C["b"]}▼ text unique to this chunk{C["0"]}')
        print(f'   {show(chunk.text[overlap_len:], 700)}')
    else:
        print(f'\n   {C["b"]}▼ chunk {chunk.ordinal}, chars {chunk.char_start:,}–{chunk.char_end:,}{C["0"]}')
        print(f'   {show(chunk.text, 700)}')
    print(f'\n   {C["dim"]}following text (not in this chunk){C["0"]}')
    print(f'   {C["dim"]}{show(after)}{C["0"]}')
    verified = text[chunk.char_start:chunk.char_end] == chunk.text
    mark = f'{C["green"]}✓{C["0"]}' if verified else f'{C["red"]}✗{C["0"]}'
    print(f'\n   {mark} stream[{chunk.char_start}:{chunk.char_end}] == chunk.text')

    # ---------------------------------------------------------------- 7
    rule('7.  CHUNK  →  CITATION')
    targets = citation_targets(chunk)
    print(f'   This chunk expands into {len(targets)} citation target(s), one per page it touches.')
    for t in targets:
        print(f'\n   page {C["b"]}{t.page_number}{C["0"]}  '
              f'{len(t.highlight_rects)} highlight rect(s)  '
              f'reliable={t.coordinates_reliable}  '
              f'page {t.page_width:.0f}×{t.page_height:.0f} pt')
        for r in t.highlight_rects[:3]:
            print(f'      {C["dim"]}rect {r}{C["0"]}')
        if len(t.highlight_rects) > 3:
            print(f'      {C["dim"]}... {len(t.highlight_rects) - 3} more{C["0"]}')
        print(f'      quote: {show(t.quoted_text, 90)}')
    print(f'\n   {C["dim"]}SDD 7.3 wants document + page + rendered page + highlighted passage.'
          f'\n   All four come from page_spans, with no second pass over the PDF.{C["0"]}')

    # ---------------------------------------------------------------- 8
    rule('8.  THE IDs ARE STABLE')
    again = chunks(pdf, config)
    identical = [a.chunk_id for a in cs] == [b.chunk_id for b in again]
    wider = chunks(pdf, ChunkerConfig(target_chars=config.target_chars + 600))
    collisions = {c.chunk_id for c in cs} & {c.chunk_id for c in wider}
    print(f'   {C["green"] if identical else C["red"]}'
          f'{"✓" if identical else "✗"}{C["0"]} same file + same config  →  '
          f'identical IDs ({len(cs)} chunks)')
    print(f'   {C["green"] if not collisions else C["red"]}'
          f'{"✓" if not collisions else "✗"}{C["0"]} different config        →  '
          f'no shared IDs ({len(wider)} chunks at target={config.target_chars + 600})')
    print(f'\n   {C["dim"]}A citation stored in conversation history still resolves after the'
          f'\n   collection is republished. Change the chunker and every ID changes,'
          f'\n   which is the honest outcome: a stale citation pointing at moved text'
          f'\n   is worse than one that fails loudly.{C["0"]}')

    rule()
    print(f'   Written version: WALKTHROUGH.md      Contract tests: tests/test_contracts.py')
    print(f'   Visual: walkthrough/chunk_viewer.html\n')
    return 0

if __name__ == '__main__':
    sys.exit(main())
