"""
Ingest the corpus listed in corpus/corpus.json and record what came out.

This is the reproducible ingest command for the collection E2 hands to
indexing (E3). It runs the import pipeline (src/pipeline.py) over every file
the corpus lists, as one batch, and writes:

  corpus/out/manifest.json   the sealed run's manifest, byte for byte: the versioned
                             manifest E3 compares what it indexed against
  corpus/out/summary.json    counts, checksums, versions, and every reject with its reason
  corpus/out/SUMMARY.md      the same, for reading

The sealed run itself (staged PDFs, chunk files) goes to corpus/runs/, which is
not committed: the command rebuilds it from the PDFs.

Nothing in the outputs depends on the machine, the folder or the time, so the
same corpus, code and settings always produce the same bytes. --check proves
it: it ingests again into a fresh directory and compares with the committed
outputs.

A file is rejected only if the corpus list expects it, for the reason the list
gives. Any other outcome - a document rejected, a bad file accepted, a reject
for a different reason, a file whose bytes changed - stops the run before
anything is sealed. That expectation is what stands in for the user's
confirmation of the rejected set (SDD 6.1).

Usage:
  python3 tools/ingest_corpus.py            # ingest, seal, verify, write corpus/out/
  python3 tools/ingest_corpus.py --check    # re-ingest from scratch; exit 1 if anything differs
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from src import pipeline as P

CORPUS = ROOT / 'corpus' / 'corpus.json'
OUT = ROOT / 'corpus' / 'out'
RUNS = ROOT / 'corpus' / 'runs'
COMMAND = 'python3 tools/ingest_corpus.py'


class CorpusError(Exception):
    """The corpus list and the files, or the files and their expected outcomes, disagree."""


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, 'rb') as handle:
        while block := handle.read(1 << 20):
            digest.update(block)
    return digest.hexdigest()


def load_corpus(path: Path = CORPUS) -> dict:
    """The corpus list, after checking every file it names is present and unchanged."""
    corpus = json.loads(path.read_text(encoding='utf-8'))
    problems = []
    for entry in corpus['documents'] + corpus['intake_checks']:
        file = ROOT / entry['path']
        if not file.is_file():
            problems.append(f'{entry["id"]}: {entry["path"]} is missing')
        elif file.stat().st_size != entry['bytes'] or _sha256(file) != entry['sha256']:
            problems.append(f'{entry["id"]}: {entry["path"]} does not match its recorded SHA-256')
    if problems:
        raise CorpusError('the corpus list and the files disagree:\n  ' + '\n  '.join(problems))
    return corpus


def _unexpected(corpus: dict, review: P.Review) -> list[str]:
    """Every candidate whose outcome the corpus list does not predict."""
    by_checksum = {c.checksum_sha256: c for c in review.candidates}
    found = []
    for entry in corpus['documents']:
        c = by_checksum[entry['sha256']]
        if not c.disposition.startswith('accepted'):
            found.append(f'{entry["id"]}: expected accepted, got {c.disposition} '
                         f'({c.reject_reason}: {c.reject_detail})')
    for entry in corpus['intake_checks']:
        c = by_checksum[entry['sha256']]
        if c.disposition != 'rejected':
            found.append(f'{entry["id"]}: expected rejected, got {c.disposition}')
        elif c.reject_reason != entry['expected_reject_reason']:
            found.append(f'{entry["id"]}: expected {entry["expected_reject_reason"]}, '
                         f'rejected as {c.reject_reason}')
    return found


def ingest(corpus: dict, root: Path) -> tuple[P.Run, P.Verification]:
    """Ingest every file of the corpus as one batch; seal only if each outcome is expected."""
    paths = [ROOT / e['path'] for e in corpus['documents'] + corpus['intake_checks']]
    review = P.prepare(paths, root)
    unexpected = _unexpected(corpus, review)
    if unexpected:
        P.discard(review, 'unexpected_outcome')
        raise CorpusError('outcomes the corpus list does not expect; nothing was sealed:\n  '
                          + '\n  '.join(unexpected))
    run = P.commit(review, acknowledge_rejections=review.confirmation_token)
    return run, P.verify(run.path, deep=True)


def summarize(corpus: dict, run: P.Run, verification: P.Verification) -> dict:
    """What the run holds, from its sealed manifest. No paths, times or machine details."""
    m = run.manifest
    ids = {e['sha256']: e['id'] for e in corpus['documents'] + corpus['intake_checks']}
    expected = {e['sha256']: e['expected_reject_reason'] for e in corpus['intake_checks']}
    t = m['totals']
    return {
        'corpus': corpus['corpus'],
        'corpus_version': corpus['version'],
        'corpus_list_sha256': _sha256(CORPUS),
        'command': COMMAND,
        'run_id': m['seal']['run_id'],
        'manifest_sha256': m['seal']['manifest_sha256'],
        'chunk_set_sha256': m['integrity']['chunk_set_sha256'],
        'files_sha256': m['integrity']['files_sha256'],
        'versions': {
            'pipeline': m['pipeline_version'],
            'validator': m['validator_version'],
            'chunker': m['chunker']['chunker_version'],
            'chunker_config_id': m['chunker']['config_id'],
            'extractor': m['extractor'],
            'schema': m['schema_version'],
        },
        'chunker': {k: v for k, v in m['chunker'].items() if k not in ('chunker_version', 'config_id')},
        'policy': m['policy'],
        'totals': {
            'files': t['candidates'],
            'accepted': t['accepted'],
            'accepted_with_warnings': t['accepted_with_warnings'],
            'rejected': t['rejected'],
            'duplicates': t['duplicates'],
            'pages': t['pages'],
            'chunks': t['chunks'],
            'text_chars': t['text_chars'],
            'warnings': t['warnings'],
        },
        'documents': [{
            'id': ids[d['checksum_sha256']],
            'source_filename': d['source_filename'],
            'document_id': d['document_id'],
            'outcome': d['outcome'],
            'pages': d['page_count'],
            'pages_with_text': d['pages_with_text'],
            'pages_without_text': d['pages_without_text'],
            'chunks': d['chunk_count'],
            'text_chars': d['text_chars'],
            'checksum_sha256': d['checksum_sha256'],
            'text_sha256': d['text_sha256'],
            'chunk_set_sha256': d['chunk_set_sha256'],
            'warnings': d['warnings'],
        } for d in m['documents']],
        'rejects': [{
            'id': ids[r['checksum_sha256']],
            'source_filename': r['source_filename'],
            'checksum_sha256': r['checksum_sha256'],
            'reject_reason': r['reject_reason'],
            'expected_reject_reason': expected[r['checksum_sha256']],
            'failed_check': r['failed_check'],
            'reject_detail': r['reject_detail'],
        } for r in m['rejected']],
        'verification': {
            'deep': True,
            'ok': verification.ok,
            'checks_passed': sum(c['ok'] for c in verification.checks),
            'checks_total': len(verification.checks),
        },
    }


def render(s: dict) -> str:
    """SUMMARY.md: the corpus summary for the demo and for E3."""
    t, v = s['totals'], s['versions']
    lines = [
        f'# Corpus ingestion summary: {s["corpus"]}, version {s["corpus_version"]}',
        '',
        f'Generated by `{s["command"]}` from `corpus/corpus.json`. Do not edit by hand:',
        'rerun the command, and check that a rerun reproduces it with',
        f'`{s["command"]} --check`.',
        '',
        '## Totals',
        '',
        '| | |',
        '|---|---|',
        f'| Files in the batch | {t["files"]} |',
        f'| Accepted documents | {t["accepted"]} ({t["accepted_with_warnings"]} with warnings) |',
        f'| Rejected files | {t["rejected"]}, each for the reason the corpus list expects |',
        f'| Pages | {t["pages"]:,} |',
        f'| Chunks | {t["chunks"]:,} |',
        f'| Characters of text | {t["text_chars"]:,} |',
        f'| Run | `{s["run_id"]}` |',
        f'| Manifest SHA-256 | `{s["manifest_sha256"]}` |',
        f'| Chunk set SHA-256 | `{s["chunk_set_sha256"]}` |',
        f'| Verification | {s["verification"]["checks_passed"]} of {s["verification"]["checks_total"]} '
        f'checks pass, including re-extracting every PDF |',
        '',
        '## Accepted documents',
        '',
        '| Document | Pages | Pages without text | Chunks | Document ID |',
        '|---|---|---|---|---|',
    ]
    for d in s['documents']:
        blank = ', '.join(map(str, d['pages_without_text'])) or 'none'
        lines.append(f'| `{d["source_filename"]}` | {d["pages"]} | {blank} | {d["chunks"]} '
                     f'| `{d["document_id"]}` |')
    warned = [d for d in s['documents'] if d['warnings']]
    if warned:
        lines += ['', 'Warnings:', '']
        for d in warned:
            for w in d['warnings']:
                lines.append(f'- `{d["source_filename"]}`: {w.get("code")}: {w.get("message")}')
    lines += [
        '',
        '## Rejected files',
        '',
        'None of these reaches the sealed run: no staged copy, no chunks.',
        '',
        '| File | Reason | Failed check | Detail |',
        '|---|---|---|---|',
    ]
    for r in s['rejects']:
        detail = r['reject_detail'].replace('|', '\\|')
        lines.append(f'| `{r["source_filename"]}` | `{r["reject_reason"]}` | `{r["failed_check"]}` '
                     f'| {detail} |')
    lines += [
        '',
        '## Versions',
        '',
        f'- Pipeline `{v["pipeline"]}`, validator `{v["validator"]}`, chunker `{v["chunker"]}` '
        f'(config `{v["chunker_config_id"]}`), extractor `{v["extractor"]}`, schema `{v["schema"]}`.',
        f'- Chunk settings: target {s["chunker"]["target_chars"]} characters, overlap '
        f'{s["chunker"]["overlap_chars"]}, minimum {s["chunker"]["min_chunk_chars"]}.',
        f'- Policy: at most {s["policy"]["max_pages"]:,} pages and {s["policy"]["max_bytes"]:,} bytes '
        f'per file; repaired files `{s["policy"]["repaired_document"]}`; extraction-restricted files '
        f'`{s["policy"]["extraction_restricted"]}`.',
        '',
        '## For indexing (E3)',
        '',
        '- The sealed run is rebuilt under `corpus/runs/` by the command above. '
        '`src.pipeline.load_run()` opens it; `run.documents` and `run.iter_chunks()` yield the '
        'Document and Chunk records.',
        '- `manifest.json` here is that run\'s manifest, byte for byte. Its '
        '`integrity.chunk_set_sha256` uses the same formula as E3\'s collection integrity hash, '
        'so an indexed collection can be checked against it.',
        '- Chunk IDs depend on the chunker version and settings above. A change to either '
        'changes every ID and this summary.',
        '',
    ]
    return '\n'.join(lines)


def _dump(obj: dict) -> str:
    return json.dumps(obj, indent=2, ensure_ascii=False) + '\n'


def outputs(corpus: dict, root: Path) -> dict[str, bytes]:
    """Ingest into root and return the three output files, as they would be written."""
    run, verification = ingest(corpus, root)
    if not verification.ok:
        raise CorpusError('the sealed run failed verification: '
                          + '; '.join(f'{c["check"]}: {c["detail"]}' for c in verification.failed()))
    summary = summarize(corpus, run, verification)
    return {
        'manifest.json': (run.path / 'manifest.json').read_bytes(),
        'summary.json': _dump(summary).encode('utf-8'),
        'SUMMARY.md': render(summary).encode('utf-8'),
    }


def _print(summary: dict) -> None:
    t = summary['totals']
    print(f'corpus     {summary["corpus"]} v{summary["corpus_version"]}: {t["files"]} files')
    print(f'accepted   {t["accepted"]} documents, {t["pages"]:,} pages, {t["chunks"]:,} chunks')
    for d in summary['documents']:
        print(f'             {d["source_filename"]:<52} {d["pages"]:>4} pages {d["chunks"]:>5} chunks')
    print(f'rejected   {t["rejected"]} files, each for the expected reason')
    for r in summary['rejects']:
        print(f'             {r["source_filename"]:<52} {r["reject_reason"]:<18} {r["failed_check"]}')
    print(f'run        {summary["run_id"]}')
    print(f'manifest   sha256 {summary["manifest_sha256"]}')
    print(f'chunk set  sha256 {summary["chunk_set_sha256"]}')
    v = summary['verification']
    print(f'verify     {v["checks_passed"]}/{v["checks_total"]} checks (deep)')


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0].strip())
    ap.add_argument('--check', action='store_true',
                    help='ingest again into a fresh directory and compare with corpus/out/')
    args = ap.parse_args(argv)
    P._silence_mupdf()
    try:
        corpus = load_corpus()
        if args.check:
            with tempfile.TemporaryDirectory(prefix='e2-corpus-check-') as scratch:
                fresh = outputs(corpus, Path(scratch))
        else:
            fresh = outputs(corpus, RUNS)
    except CorpusError as exc:
        print(f'error: {exc}')
        return 1
    _print(json.loads(fresh['summary.json']))

    if args.check:
        differ = [name for name, data in fresh.items()
                  if not (OUT / name).is_file() or (OUT / name).read_bytes() != data]
        if differ:
            print(f'\nINCONSISTENT: a fresh run differs from corpus/out/ in {", ".join(differ)}')
            return 1
        print('\nCONSISTENT: a fresh run reproduces corpus/out/ byte for byte')
        return 0
    OUT.mkdir(parents=True, exist_ok=True)
    for name, data in fresh.items():
        (OUT / name).write_bytes(data)
    print(f'\nwrote corpus/out/: {", ".join(fresh)}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
