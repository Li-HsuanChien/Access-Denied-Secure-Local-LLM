"""
Probe every fixture with PyMuPDF (the extraction library named in SDD 11) and
report what actually happens, so the manifest records observed behavior rather
than assumed behavior.

This is deliberately not a pass/fail test. It is the evidence E2 uses to write
the validation rules, and the baseline E5 regresses against in Week 4.

Usage:  python3 tools/probe_fixtures.py
"""
import hashlib
import json
import sys
from pathlib import Path

import pymupdf

ROOT = Path(__file__).resolve().parent.parent
FIX = ROOT / 'fixtures'

MAGIC = b'%PDF-'


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for block in iter(lambda: f.read(1 << 20), b''):
            h.update(block)
    return h.hexdigest()


def probe(path):
    """Open with PyMuPDF and record what the library reports."""
    r = {
        'file': str(path.relative_to(FIX)),
        'bytes': path.stat().st_size,
        'sha256': sha256(path),
        'magic_ok': path.read_bytes()[:5] == MAGIC if path.stat().st_size >= 5 else False,
    }
    try:
        doc = pymupdf.open(path)
    except Exception as e:
        r.update(opens=False, error_type=type(e).__name__, error=str(e)[:160])
        return r

    r['opens'] = True
    r['needs_password'] = bool(doc.needs_pass)
    r['is_encrypted'] = bool(doc.is_encrypted)
    r['was_repaired'] = bool(getattr(doc, 'is_repaired', False))

    if doc.needs_pass:
        r.update(pages=None, chars=0, note='page access blocked until authenticated')
        doc.close()
        return r

    try:
        r['pages'] = doc.page_count
        chars, pages_with_text, images = 0, 0, 0
        for page in doc:
            t = page.get_text()
            chars += len(t)
            pages_with_text += 1 if t.strip() else 0
            images += len(page.get_images(full=True))
        r.update(chars=chars, pages_with_text=pages_with_text, images=images)
        if r['pages']:
            r['pages_without_text'] = r['pages'] - pages_with_text
            r['avg_chars_per_page'] = round(chars / r['pages'], 1)
        r['permissions'] = doc.permissions
        r['extract_allowed'] = bool(doc.permissions & pymupdf.PDF_PERM_COPY)
    except Exception as e:
        r.update(error_type=type(e).__name__, error=str(e)[:160])
    doc.close()
    return r


def main():
    results = []
    for path in sorted(FIX.rglob('*.pdf')):
        results.append(probe(path))

    width = max(len(r['file']) for r in results)
    print(f'{"fixture".ljust(width)}  opens  pages  chars     note')
    print('-' * (width + 46))
    for r in results:
        note = r.get('error') or r.get('note') or ''
        if r.get('was_repaired'):
            note = 'RECOVERED BY AUTO-REPAIR. ' + note
        if r.get('opens') and r.get('chars') == 0 and r.get('pages'):
            note = note or 'opens, zero extractable text'
        print(f'{r["file"].ljust(width)}  '
              f'{str(r.get("opens")).ljust(5)}  '
              f'{str(r.get("pages") if r.get("pages") is not None else "-").ljust(5)}  '
              f'{str(r.get("chars", "-")).ljust(8)}  {note[:70]}')

    out = ROOT / 'probe_results.json'
    out.write_text(json.dumps(results, indent=2))
    print(f'\nwrote {out.relative_to(ROOT)}')
    return results


if __name__ == '__main__':
    main()
