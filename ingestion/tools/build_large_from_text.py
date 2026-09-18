"""
Typeset the DOE Fundamentals Handbook text extraction into a PDF fixture.

The handbook arrived as an extracted-text file rather than the original PDF, so
this reconstructs a page-per-page PDF from it. Original page boundaries are
recovered from the DOE footer convention ("NP-01 Page 12 Rev. 0"), which means
page N of the fixture corresponds to page N of the real module. That matters for
E2: chunk provenance is only testable if page numbers mean something.

This is a text reflow, not the original typesetting. Diagram/table layout from
the source document is NOT preserved. Layout-sensitive extraction is covered by
the NRC and arXiv fixtures instead.
"""
import re
import sys
from pathlib import Path

from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas

FOOTER = re.compile(r'^\s*(NP-\d+)\s+Page\s+([ivxlcdm\d]+)\s+Rev\.\s*\d+\s*$', re.I)

LEFT, TOP = 72, 720
LEADING, FONT_SIZE = 10.5, 8.5
MAX_LINES = 60
MAX_CHARS = 105


def split_pages(text):
    """Split the extraction into (module, page_label, lines) using DOE footers."""
    pages, current = [], []
    for line in text.replace('\r\n', '\n').split('\n'):
        m = FOOTER.match(line)
        if m:
            pages.append((m.group(1), m.group(2), current))
            current = []
        else:
            current.append(line.rstrip())
    if any(l.strip() for l in current):
        pages.append(('FRONT', 'end', current))
    return pages


def wrap(lines):
    """Hard-wrap over-long lines so nothing runs off the page."""
    out = []
    for line in lines:
        while len(line) > MAX_CHARS:
            cut = line.rfind(' ', 0, MAX_CHARS)
            cut = cut if cut > 40 else MAX_CHARS
            out.append(line[:cut])
            line = line[cut:].lstrip()
        out.append(line)
    return out


def build(src_path, out_path):
    text = Path(src_path).read_text(encoding='utf-8', errors='replace')
    pages = split_pages(text)

    c = canvas.Canvas(str(out_path), pagesize=letter)
    c.setTitle('DOE Fundamentals Handbook: Nuclear Physics and Reactor Theory, Vol 1 of 2')
    c.setAuthor('U.S. Department of Energy')
    c.setSubject('DOE-HDBK-1019/1-93 (text reflow fixture)')

    emitted = 0
    for module, label, lines in pages:
        body = wrap([l for l in lines if l.strip()])
        if not body:
            body = ['Intentionally Left Blank']
        # A source page that overflows continues onto the next PDF page.
        for start in range(0, len(body), MAX_LINES):
            chunk = body[start:start + MAX_LINES]
            c.setFont('Helvetica', FONT_SIZE)
            y = TOP
            for line in chunk:
                c.drawString(LEFT, y, line)
                y -= LEADING
            c.setFont('Helvetica-Oblique', 7.5)
            suffix = '' if start == 0 else f' (cont. {start // MAX_LINES + 1})'
            c.drawString(LEFT, 54, f'{module}  Page {label}{suffix}  Rev. 0   DOE-HDBK-1019/1-93')
            c.showPage()
            emitted += 1

    c.save()
    return len(pages), emitted


if __name__ == '__main__':
    src, out = sys.argv[1], sys.argv[2]
    source_pages, pdf_pages = build(src, out)
    print(f'source pages detected: {source_pages}')
    print(f'pdf pages written:     {pdf_pages}')
    print(f'output:                {out}')
