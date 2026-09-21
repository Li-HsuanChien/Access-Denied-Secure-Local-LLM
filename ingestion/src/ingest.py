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

import hashlib
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
    bbox: tuple[float, float, float, float]


@dataclass
class _Page:
    number: int          # 1-based
    char_start: int      # offset into the document stream
    char_end: int
    width: float
    height: float
    spans: list[_Span]

    @property
    def has_text(self) -> bool:
        return self.char_end > self.char_start


def extract(path: Path) -> tuple[str, list[_Page], pymupdf.Document]:
    """Build the canonical text stream and per-page span index."""
    doc = pymupdf.open(path)
    parts: list[str] = []
    pages: list[_Page] = []
    cursor = 0

    for index, page in enumerate(doc):
        page_start = cursor
        spans: list[_Span] = []
        layout = page.get_text('dict')
        for block in layout['blocks']:
            if block.get('type') != 0:        # 0 = text block; 1 = image
                continue
            for line in block['lines']:
                for span in line['spans']:
                    t = span['text']
                    if not t:
                        continue
                    parts.append(t)
                    spans.append(_Span(cursor, cursor + len(t), tuple(span['bbox'])))
                    cursor += len(t)
                parts.append('\n')
                cursor += 1
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
def _boundary(text: str, position: int, limit: int) -> int:
    """Move a split point back to the nearest word boundary, within reason."""
    if position >= limit:
        return limit
    window = text.rfind(' ', max(0, position - 120), position)
    return window + 1 if window != -1 else position


def chunks(path: str | Path, config: ChunkerConfig | None = None,
           document_id: str | None = None) -> list[Chunk]:
    """
    Split one validated document into Chunk objects.

    Callers validate first. Running this on a rejected file is a caller bug, not
    something this function silently absorbs.
    """
    config = config or ChunkerConfig()
    path = Path(path)
    raw = path.read_bytes()
    document_id = document_id or Document.make_id(raw)

    text, pages, doc = extract(path)
    doc.close()
    if not text.strip():
        return []

    out: list[Chunk] = []
    cursor, ordinal, length = 0, 0, len(text)

    while cursor < length:
        end = _boundary(text, min(cursor + config.target_chars, length), length)
        body = text[cursor:end]
        if not body.strip():
            cursor = end
            continue
        # A short tail is folded into nothing; it is dropped only if it is also
        # whitespace, otherwise it stays as its own small chunk.
        if length - end < config.min_chunk_chars:
            end = length
            body = text[cursor:end]

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
        cursor = max(cursor + 1, end - config.overlap_chars)

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
