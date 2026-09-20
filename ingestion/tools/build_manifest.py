"""
Build manifest.json by merging the static fixture descriptors below with the
measured output of probe_fixtures.py.

Sizes, checksums, page counts and extraction results are never hand-written:
they come from the probe, so the manifest cannot drift from the files.

Usage:  python3 tools/probe_fixtures.py && python3 tools/build_manifest.py
"""
import json
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

SCHEMA_VERSION = '1.0.0'

# expected_outcome vocabulary:
#   accept            - must ingest and produce chunks
#   reject            - must fail validation before indexing (SDD 6.1)
#   decision_required - E2 must choose the rule; fixture exists to force the choice
DESCRIPTORS = {
    'normal/normal_nrc_reactor_concepts_ch01.pdf': dict(
        id='normal-nrc-ch01',
        category='normal',
        expected_outcome='accept',
        reject_reason=None,
        title='Reactor Concepts Manual, Ch.1: Nuclear Power for Electrical Generation',
        source='U.S. Nuclear Regulatory Commission, Technical Training Center',
        source_url='https://www.nrc.gov/reading-rm/basic-ref/students/for-educators/01.pdf',
        license='U.S. Government work, public domain',
        derived_from=None,
        detection_signal='none required; baseline happy path',
        notes=('Text-sparse: roughly 775 characters per page, because the manual is '
               'slide-style with labeled diagrams. Chunk sizes above ~800 characters '
               'will span pages on this document, so it is the fixture that proves '
               'page provenance is tracked per chunk rather than per document.'),
    ),
    'large/large_doe_nuclear_physics_v1.pdf': dict(
        id='large-doe-hdbk-1019-v1',
        category='large',
        expected_outcome='accept',
        reject_reason=None,
        title='DOE Fundamentals Handbook: Nuclear Physics and Reactor Theory, Vol 1 (modules NP-01, NP-02)',
        source='U.S. Department of Energy, DOE-HDBK-1019/1-93',
        source_url='https://www.navsea.navy.mil/Portals/103/Documents/NNPTC/Radiation/doe_reactor_theory_v1.pdf',
        license='U.S. Government work, public domain',
        derived_from='tools/doe_hdbk_1019_v1_source.txt (text extraction of the original)',
        detection_signal='none required; dense-text happy path',
        notes=('TEXT REFLOW, NOT ORIGINAL TYPESETTING. The handbook was supplied as an '
               'extracted-text file, so pages were reconstructed from the DOE footer '
               'convention ("NP-01 Page 12 Rev. 0"); fixture page N corresponds to '
               'module page N. Original tables and figures are not preserved. Use the '
               'NRC and arXiv fixtures for layout-sensitive extraction tests. Covers '
               'modules NP-01 and NP-02 only, not the full volume.'),
    ),
    'layout/layout_arxiv_two_column_2112.11583.pdf': dict(
        id='layout-arxiv-two-column',
        category='layout',
        expected_outcome='accept',
        reject_reason=None,
        title='Nuclear History, Politics, and Futures from (A)toms-to-(Z)oom',
        source='arXiv:2112.11583',
        source_url='https://arxiv.org/pdf/2112.11583',
        license='arXiv preprint; verify the per-paper license before redistributing',
        derived_from=None,
        detection_signal='none required; layout stress case',
        notes=('Two-column academic layout with 23 embedded images. The reading-order '
               'case: naive extraction interleaves the columns, which produces chunks '
               'whose text is real but whose sentence order is wrong. Compare extracted '
               'order against the rendered page before trusting any chunker.'),
    ),

    # ---------------- corrupt ----------------
    'corrupt/corrupt_truncated_50pct.pdf': dict(
        id='corrupt-truncated',
        category='corrupt',
        expected_outcome='reject',
        reject_reason='corrupt',
        title='NRC Ch.1 truncated at 50% of bytes',
        source=None, source_url=None, license='derived from normal-nrc-ch01',
        derived_from='normal/normal_nrc_reactor_concepts_ch01.pdf',
        detection_signal='doc.is_repaired is True AND extracted text volume collapses',
        notes=('THE DANGEROUS ONE. PyMuPDF auto-repairs this file and reports the same '
               '24 pages as the healthy original, but recovers 1,632 of 18,609 '
               'characters. Page-count validation passes it. It would ingest, chunk, '
               'index, and then silently fail to answer questions about 91% of the '
               'document. Only is_repaired plus a per-page text-yield check catches it.'),
    ),
    'corrupt/corrupt_bad_xref.pdf': dict(
        id='corrupt-bad-xref',
        category='corrupt',
        expected_outcome='decision_required',
        reject_reason='corrupt',
        title='NRC Ch.1 with a damaged startxref offset',
        source=None, source_url=None, license='derived from normal-nrc-ch01',
        derived_from='normal/normal_nrc_reactor_concepts_ch01.pdf',
        detection_signal='doc.is_repaired is True; text output is otherwise complete',
        notes=('Structurally damaged but fully recoverable: PyMuPDF rebuilds the xref '
               'and returns text identical to the healthy file. E2 must decide whether '
               'a repaired-but-complete document is accepted with a warning or rejected '
               'as corrupt. Recommend accept-with-warning, recorded in the import '
               'report, since rejecting it discards a document the parser read '
               'perfectly. Pair the decision with the truncated fixture above, which '
               'carries the same is_repaired signal and must NOT be accepted.'),
    ),
    'corrupt/corrupt_header_only.pdf': dict(
        id='corrupt-header-only',
        category='corrupt',
        expected_outcome='reject',
        reject_reason='corrupt',
        title='Valid %PDF- header followed by binary garbage',
        source=None, source_url=None, license='synthetic',
        derived_from=None,
        detection_signal='open raises; magic bytes alone are not sufficient validation',
        notes=('Passes an extension check and a magic-byte check, then fails to parse. '
               'Proves validation must attempt a real open, not just sniff the header.'),
    ),
    'corrupt/corrupt_empty.pdf': dict(
        id='corrupt-empty',
        category='corrupt',
        expected_outcome='reject',
        reject_reason='corrupt',
        title='Zero-byte file',
        source=None, source_url=None, license='synthetic',
        derived_from=None,
        detection_signal='file size is 0',
        notes='Trivial, and the case most often left unhandled until it reaches production.',
    ),

    # ---------------- protected ----------------
    'protected/protected_user_password.pdf': dict(
        id='protected-user-password',
        category='protected',
        expected_outcome='reject',
        reject_reason='password_protected',
        title='NRC Ch.1 encrypted with a user (open) password',
        source=None, source_url=None, license='derived from normal-nrc-ch01',
        derived_from='normal/normal_nrc_reactor_concepts_ch01.pdf',
        detection_signal='doc.needs_pass is True',
        notes=('Password is "fixture-open-2026" (documented deliberately; this is a test '
               'file). Unambiguous reject: no page can be read without authenticating. '
               'Note that the file still OPENS in PyMuPDF, so a bare open() success is '
               'not proof of readability; needs_pass must be checked explicitly.'),
    ),
    'protected/protected_owner_password_no_extract.pdf': dict(
        id='protected-owner-password',
        category='protected',
        expected_outcome='decision_required',
        reject_reason='password_protected',
        title='NRC Ch.1 with owner password and extraction permission denied',
        source=None, source_url=None, license='derived from normal-nrc-ch01',
        derived_from='normal/normal_nrc_reactor_concepts_ch01.pdf',
        detection_signal='doc.permissions lacks PDF_PERM_COPY (observed -1044); '
                         'needs_pass and is_encrypted are both False',
        notes=('THE POLICY CASE. The document forbids text extraction, and PyMuPDF '
               'extracts all 18,609 characters anyway, because permission bits are '
               'advisory and the empty user password already decrypted the file. '
               'is_encrypted reports False, so an is_encrypted check misses this file '
               'entirely. E2 must decide whether the pipeline honors the document '
               'owner\'s stated restriction or its own technical capability. For a '
               'product whose premise is handling controlled material, honoring the '
               'restriction is the defensible default, and the decision belongs in the '
               'SDD rather than in parser code.'),
    ),

    # ---------------- scanned ----------------
    'scanned/scanned_no_text_layer.pdf': dict(
        id='scanned-no-text',
        category='scanned',
        expected_outcome='reject',
        reject_reason='scanned_only',
        title='NRC Ch.1 rendered to page images with no text layer',
        source=None, source_url=None, license='derived from normal-nrc-ch01',
        derived_from='normal/normal_nrc_reactor_concepts_ch01.pdf',
        detection_signal='opens cleanly, page count normal, zero extractable characters',
        notes=('SDD 16 lists scanned-only PDFs as unsupported without OCR, and OCR is '
               'out of scope per the PRD. This must reject with a stated reason rather '
               'than ingest to zero chunks, which would look like success everywhere '
               'upstream.'),
    ),
    'scanned/scanned_mixed_text_and_image_pages.pdf': dict(
        id='scanned-mixed',
        category='scanned',
        expected_outcome='decision_required',
        reject_reason='scanned_only',
        title='NRC Ch.1 with every fourth page replaced by a scan',
        source=None, source_url=None, license='derived from normal-nrc-ch01',
        derived_from='normal/normal_nrc_reactor_concepts_ch01.pdf',
        detection_signal='per-page text yield: 18 of 24 pages carry text, 6 are empty',
        notes=('The realistic case, and the one that breaks all-or-nothing validation: '
               'a document-level "has extractable text" check passes this file and then '
               'loses six pages without telling anyone. E2 must decide the per-document '
               'threshold and, more importantly, must surface which pages were dropped '
               'in the import report. Recommend accept-with-warning plus an explicit '
               'list of image-only pages, so QA answers "is the missing page a parser '
               'bug or a scan?" without reopening the source.'),
    ),

    # ---------------- non-PDF ----------------
    'nonpdf/nonpdf_zip_container_renamed.pdf': dict(
        id='nonpdf-zip',
        category='nonpdf',
        expected_outcome='reject',
        reject_reason='non_pdf',
        title='OOXML-shaped zip container with a .pdf extension',
        source=None, source_url=None, license='synthetic',
        derived_from=None,
        detection_signal='magic bytes are PK\\x03\\x04, not %PDF-',
        notes='Extension-based validation accepts it; content sniffing rejects it.',
    ),
    'nonpdf/nonpdf_plaintext_renamed.pdf': dict(
        id='nonpdf-plaintext',
        category='nonpdf',
        expected_outcome='reject',
        reject_reason='non_pdf',
        title='UTF-8 text file with a .pdf extension',
        source=None, source_url=None, license='synthetic',
        derived_from=None,
        detection_signal='magic bytes are not %PDF-',
        notes='Rejection message must name the real type, not just say "invalid".',
    ),

    # ---------------- oversized ----------------
    'oversized/oversized_1200_pages.pdf': dict(
        id='oversized-1200p',
        category='oversized',
        expected_outcome='decision_required',
        reject_reason='oversized',
        title='1,200-page synthetic document with per-page markers',
        source=None, source_url=None, license='synthetic, built from the DOE text',
        derived_from='tools/doe_hdbk_1019_v1_source.txt',
        detection_signal='page count or byte size exceeds the configured cap',
        notes=('E2 has not yet set the per-document cap, so this fixture has no fixed '
               'expected outcome; it exists to force the number into the validation '
               'schema. Every page carries a unique marker of the form '
               '"marker-0042-xray", so retrieval tests can target an exact deep page '
               'and prove that page provenance survives a long document. Also usable as '
               'a component of the 10,000-page stress corpus due in Week 8.'),
    ),

    # ---------------- adversarial ----------------
    'adversarial/adversarial_prompt_injection.pdf': dict(
        id='adversarial-injection',
        category='adversarial',
        expected_outcome='accept',
        reject_reason=None,
        title='Reactor coolant overview carrying embedded model instructions',
        source=None, source_url=None, license='synthetic',
        derived_from=None,
        detection_signal='none; this file must ingest normally',
        notes=('NOT an ingestion reject case. It exists so E3 and E5 have a corpus '
               'document carrying hostile instructions, per the PRD success measure '
               '"resistance to instructions embedded inside documents" and SDD 10. '
               'Page 1 carries a visible instruction block; page 2 hides one in '
               'near-white 7pt text that a human reviewer would miss and the parser '
               'reads perfectly. E2 passes this test by treating the content as data: '
               'it must chunk like any other document and must not be filtered, since '
               'silently stripping it would hide the very behavior E3 needs to test.'),
    ),
}


def main():
    probe = {r['file']: r for r in json.loads((ROOT / 'probe_results.json').read_text())}

    missing = set(DESCRIPTORS) - set(probe)
    unexpected = set(probe) - set(DESCRIPTORS)
    if missing:
        raise SystemExit(f'described but not on disk: {sorted(missing)}')
    if unexpected:
        raise SystemExit(f'on disk but not described: {sorted(unexpected)}')

    fixtures = []
    for rel, d in DESCRIPTORS.items():
        p = probe[rel]
        fixtures.append({
            'id': d['id'],
            'path': f'fixtures/{rel}',
            'category': d['category'],
            'expected_outcome': d['expected_outcome'],
            'reject_reason': d['reject_reason'],
            'title': d['title'],
            'provenance': {
                'source': d['source'],
                'source_url': d['source_url'],
                'license': d['license'],
                'derived_from': d['derived_from'],
            },
            'measured': {
                'bytes': p['bytes'],
                'sha256': p['sha256'],
                'magic_ok': p['magic_ok'],
                'opens': p['opens'],
                'needs_password': p.get('needs_password'),
                'is_encrypted': p.get('is_encrypted'),
                'was_repaired': p.get('was_repaired'),
                'pages': p.get('pages'),
                'chars': p.get('chars'),
                'pages_with_text': p.get('pages_with_text'),
                'pages_without_text': p.get('pages_without_text'),
                'extract_allowed': p.get('extract_allowed'),
                'open_error': p.get('error'),
            },
            'detection_signal': d['detection_signal'],
            'notes': d['notes'],
        })

    manifest = {
        'schema_version': SCHEMA_VERSION,
        'generated': date.today().isoformat(),
        'workstream': 'E2 - Ingestion / Chunking',
        'purpose': ('Representative document fixture set for the Secure Local Document-QA '
                    'System. Reject categories follow SDD 6.1: password-protected, '
                    'corrupt, scanned-only, oversized, and non-PDF.'),
        'measured_with': 'PyMuPDF 1.28.2 (the extraction library named in SDD 11)',
        'domain': 'nuclear engineering (public NRC and DOE training material)',
        'outcome_vocabulary': {
            'accept': 'must ingest and produce chunks',
            'reject': 'must fail validation before indexing, with a stated reason',
            'decision_required': 'E2 owes a rule; the fixture exists to force the choice',
        },
        'counts': {
            'total': len(fixtures),
            'accept': sum(1 for f in fixtures if f['expected_outcome'] == 'accept'),
            'reject': sum(1 for f in fixtures if f['expected_outcome'] == 'reject'),
            'decision_required': sum(1 for f in fixtures
                                     if f['expected_outcome'] == 'decision_required'),
        },
        'fixtures': fixtures,
    }

    out = ROOT / 'manifest.json'
    out.write_text(json.dumps(manifest, indent=2) + '\n')
    print(f'wrote {out.name}: {manifest["counts"]}')


if __name__ == '__main__':
    main()
