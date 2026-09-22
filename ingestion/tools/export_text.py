"""
Export the complete canonical text stream of a document.

Chunk offsets index into this exact stream, so having it on disk is what makes
provenance auditable by hand: if a chunk claims char_start 534, you can open the
file, seek to byte 534, and read the same characters the chunk carries.

Three outputs per document:

  <name>.text.txt        the raw stream, nothing added. Offsets are exact.
  <name>.pages.txt       the same text with page boundary markers inserted,
                         for reading. Markers shift offsets, so this file is
                         for humans and never for measurement.
  <name>.offsets.json    page boundary table and totals.

Usage:
  python3 tools/export_text.py                # all accepting fixtures
  python3 tools/export_text.py fixtures/normal/normal_nrc_reactor_concepts_ch01.pdf
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from src.ingest import extract

OUT = ROOT / 'walkthrough' / 'text'

DEFAULTS = [
    ROOT / 'fixtures/normal/normal_nrc_reactor_concepts_ch01.pdf',
    ROOT / 'fixtures/large/large_doe_nuclear_physics_v1.pdf',
    ROOT / 'fixtures/layout/layout_arxiv_two_column_2112.11583.pdf',
]


def export(pdf: Path) -> dict:
    text, pages, doc = extract(pdf)
    doc.close()
    stem = pdf.stem
    OUT.mkdir(parents=True, exist_ok=True)

    # 1. Raw stream. This is the file offsets refer to.
    raw_path = OUT / f'{stem}.text.txt'
    raw_path.write_text(text, encoding='utf-8')

    # 2. Readable copy with page markers. Offsets do NOT survive this.
    parts = []
    for page in pages:
        body = text[page.char_start:page.char_end]
        parts.append(
            f'\n{"=" * 78}\n'
            f'PAGE {page.number}  |  chars {page.char_start}-{page.char_end} '
            f'({page.char_end - page.char_start} chars)  |  '
            f'{page.width:.0f}x{page.height:.0f} pt\n'
            f'{"=" * 78}\n{body}')
    annotated_path = OUT / f'{stem}.pages.txt'
    annotated_path.write_text(''.join(parts), encoding='utf-8')

    # 3. The offset table.
    table = {
        'source_pdf': str(pdf.relative_to(ROOT)),
        'total_chars': len(text),
        'page_count': len(pages),
        'chars_per_page_mean': round(len(text) / len(pages), 1),
        'note': ('Offsets index into <stem>.text.txt. The .pages.txt copy inserts '
                 'markers for reading and its offsets do not match.'),
        'pages': [{'page_number': p.number, 'char_start': p.char_start,
                   'char_end': p.char_end, 'chars': p.char_end - p.char_start,
                   'has_text': p.has_text, 'span_count': len(p.spans),
                   'width': round(p.width, 2), 'height': round(p.height, 2)}
                  for p in pages],
    }
    offsets_path = OUT / f'{stem}.offsets.json'
    offsets_path.write_text(json.dumps(table, indent=2) + '\n')

    print(f'{pdf.name}')
    print(f'   {len(text):,} chars across {len(pages)} pages '
          f'(mean {table["chars_per_page_mean"]}/page)')
    for p in (raw_path, annotated_path, offsets_path):
        print(f'   -> {p.relative_to(ROOT)}  ({p.stat().st_size:,} bytes)')
    return table


if __name__ == '__main__':
    targets = [Path(a) for a in sys.argv[1:]] or DEFAULTS
    for t in targets:
        export(t)
