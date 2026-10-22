"""
E2 ingestion pipeline: candidate PDFs in, one sealed run directory out.

    prepare(paths, root)  ->  Review     copy, checksum, validate, extract, chunk
    commit(review, ...)   ->  Run        write the manifest, verify, seal
    discard(review)                      throw the attempt away
    ingest(paths, root)   ->  Run        prepare + commit when nothing needs review
    verify(run_dir)       ->  Verification
    load_run(run_dir)     ->  Run        the only way a consumer reads a run
    recover(root)                        remove what an interrupted attempt left

What "sealed" means
-------------------
An attempt is built in  <root>/runs/.partial-<attempt>/ . The manifest is the
last file written; the directory is then renamed to <root>/runs/<run_id>/ where
run_id is derived from the manifest's own hash. A directory that is still named
.partial-*, or has no manifest, or whose manifest does not hash to its name, is
not a run. load_run() refuses it. recover() deletes interrupted attempts, moves
a run_* directory that no longer verifies into quarantine/ (it may be a good
run that was damaged later, so it is never deleted), and leaves alone anything
it did not create.

What never reaches a sealed run
-------------------------------
A rejected file's bytes, and anything derived from them. process() returns no
chunks for a rejected file, its staged copy is deleted on the spot, and verify()
checks the sealed directory holds no file it cannot attribute to an accepted
document.

Standard library plus PyMuPDF only. Embedding, indexing and activation belong
to the document store (E3); this module stops at a verified directory.
"""
from __future__ import annotations

import argparse
import errno
import hashlib
import json
import logging
import os
import platform
import re
import secrets
import shutil
import sys
import time
import unicodedata
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Iterable, Iterator

import pymupdf

from .ingest import EXTRACTOR, VALIDATOR_VERSION, Processed, extract, process
from .schema import Chunk, ChunkerConfig, Document, text_checksum
from .validation import (Check, CheckStatus, IngestionPolicy, Outcome, RejectReason,
                         ValidationResult)
from .validation import SCHEMA_VERSION as VALIDATION_SCHEMA_VERSION

PIPELINE_VERSION = 'e2-pipeline-1.0.0'
MANIFEST_SCHEMA_VERSION = '1.0.0'
MANIFEST_KIND = 'e2.ingest_manifest'
REPORT_KIND = 'e2.import_report'
PARTIAL_PREFIX = '.partial-'
RUN_PREFIX = 'run_'
QUARANTINE_DIR = 'quarantine'
RUN_NAME = re.compile(r'run_[0-9a-f]{16}$')
# Files an operating system drops into a folder that someone opened. They are
# not part of a run and must not make an intact one fail verification.
OS_METADATA = frozenset({'.DS_Store', 'Thumbs.db', 'desktop.ini'})
COPY_BLOCK = 1 << 20
TEXT_BLOCK = 1 << 18                        # characters encoded at a time when hashing a text stream
DISK_RESERVE_BYTES = 64 * 1024 * 1024       # never fill the volume to the last block

log = logging.getLogger('e2.ingest')


# ---------------------------------------------------------------------------
# errors: every one carries a stable code for the operational log (SDD 9)
# ---------------------------------------------------------------------------
class IngestError(Exception):
    code = 'ingest_failed'

    def __init__(self, message: str, review: 'Review | None' = None):
        super().__init__(message)
        self.review = review


class InsufficientDiskSpace(IngestError):
    code = 'insufficient_disk_space'

    def __init__(self, required_bytes: int, available_bytes: int):
        super().__init__(f'Not enough free disk space: {required_bytes:,} bytes are needed '
                         f'and {available_bytes:,} are available. Free some space and try again.')
        self.required_bytes, self.available_bytes = required_bytes, available_bytes


class StagingFailed(IngestError):
    """The working folder could not be written. The files being imported are not at fault."""
    code = 'staging_failed'


class Cancelled(IngestError):
    code = 'cancelled'


class Busy(IngestError):
    code = 'ingest_busy'


class ConfirmationRequired(IngestError):
    code = 'confirmation_required'


class NothingAccepted(IngestError):
    code = 'nothing_accepted'


class RunNotComplete(IngestError):
    code = 'run_not_complete'


class IntegrityError(IngestError):
    code = 'integrity_mismatch'


# ---------------------------------------------------------------------------
# small helpers
# ---------------------------------------------------------------------------
def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def _canon(obj) -> bytes:
    """The one canonical JSON encoding every hash in this module is taken over."""
    return json.dumps(obj, sort_keys=True, separators=(',', ':'), ensure_ascii=True).encode('ascii')


def _line(obj) -> bytes:
    """One JSON Lines record. ASCII-only so '\\n' is the only line terminator in the file."""
    return json.dumps(obj, separators=(',', ':'), ensure_ascii=True).encode('ascii') + b'\n'


def _sha256_file(path: Path) -> tuple[str, int]:
    digest, size = hashlib.sha256(), 0
    with open(path, 'rb') as handle:
        while block := handle.read(COPY_BLOCK):
            digest.update(block)
            size += len(block)
    return digest.hexdigest(), size


def _text_sha256(text: str) -> str:
    """SHA-256 of the text as UTF-8, encoded a slice at a time instead of copied whole."""
    digest = hashlib.sha256()
    for at in range(0, len(text), TEXT_BLOCK):
        digest.update(text[at:at + TEXT_BLOCK].encode('utf-8'))
    return digest.hexdigest()


def _write(path: Path, data: bytes | list[bytes], durable: bool = True) -> None:
    """Write a file whole, or from a list of its pieces without joining them first."""
    with open(path, 'wb') as handle:         # binary: no newline translation on Windows
        if isinstance(data, list):
            handle.writelines(data)
        else:
            handle.write(data)
        if durable:
            handle.flush()
            os.fsync(handle.fileno())


def _fsync_dir(path: Path) -> None:
    if hasattr(os, 'O_DIRECTORY'):           # POSIX; a directory cannot be fsynced on Windows
        fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)


def chunk_set_digest(pairs: Iterable[tuple[str, str]]) -> str:
    """
    sha256 over the sorted lines "chunk_id text_checksum".

    Deliberately the same formula as E3's CollectionVersion.integrity_sha256
    (secure_qa/library/versions.py, _integrity), so the value in this manifest
    can be compared with the value E3 reads back out of its store.
    """
    lines = '\n'.join(f'{cid} {checksum}' for cid, checksum in sorted(pairs))
    return hashlib.sha256(lines.encode('utf-8')).hexdigest()


def _files_digest(entries: Iterable[dict]) -> str:
    lines = '\n'.join(f'{e["sha256"]} {e["bytes"]} {e["path"]}'
                      for e in sorted(entries, key=lambda e: e['path']))
    return hashlib.sha256(lines.encode('utf-8')).hexdigest()


def _silence_mupdf() -> None:
    """
    MuPDF prints its diagnostics straight to the process's stdout, past Python's
    sys.stdout, and they can carry names taken from the document (fonts). Turn
    the printing off; the count is still available from mupdf_warnings().
    """
    pymupdf.TOOLS.mupdf_display_errors(False)
    pymupdf.TOOLS.mupdf_display_warnings(False)


class _JobLock:
    """
    One ingestion job per root (SDD 6.2). An OS lock on an open file, so it is
    released by the operating system when the process dies and can never be
    left stale by a crash.
    """

    def __init__(self, root: Path):
        self.path = root / 'ingest.lock'
        self.fd: int | None = None

    def acquire(self) -> None:
        fd = os.open(self.path, os.O_RDWR | os.O_CREAT, 0o600)
        try:
            if os.name == 'nt':
                import msvcrt
                msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            os.close(fd)
            raise Busy('Another import is already running.') from None
        self.fd = fd

    def release(self) -> None:
        if self.fd is not None:
            try:
                if os.name == 'nt':
                    import msvcrt
                    os.lseek(self.fd, 0, os.SEEK_SET)
                    msvcrt.locking(self.fd, msvcrt.LK_UNLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(self.fd, fcntl.LOCK_UN)     # closing is not enough if a child inherited the fd
            finally:
                os.close(self.fd)
                self.fd = None


class _Journal:
    """
    Append-only operational events (SDD 15): types, ids, counts, codes, timings.
    Never a filename, a title, a reject detail or a character of document text.
    """

    def __init__(self, root: Path, attempt_id: str):
        self.path, self.attempt_id = root / 'journal.jsonl', attempt_id

    def __call__(self, event: str, **fields) -> None:
        record = {'at': _now(), 'event': event, 'attempt_id': self.attempt_id, **fields}
        line = json.dumps(record, separators=(',', ':'), ensure_ascii=True)
        log.info(line)
        with open(self.path, 'ab') as handle:
            handle.write(line.encode('ascii') + b'\n')


# ---------------------------------------------------------------------------
# public data shapes
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class Progress:
    """What SDD 6.2 asks the interface to show while a job runs."""
    phase: str                    # validating | review. commit() is quick and reports nothing.
    files_done: int
    files_total: int
    pages_done: int
    warnings: int
    elapsed_seconds: float


@dataclass
class Candidate:
    """One path the caller supplied, and what became of it. This is one row of the review screen."""
    index: int
    source_path: str
    source_filename: str
    byte_size: int | None = None
    checksum_sha256: str | None = None
    disposition: str = 'pending'          # accepted | accepted_with_warnings | rejected | duplicate
    document_id: str | None = None
    duplicate_of: str | None = None       # checksum of the first copy of the same bytes
    page_count: int | None = None
    chunk_count: int | None = None
    reject_reason: str | None = None
    reject_detail: str | None = None
    warnings: list[dict] = field(default_factory=list)
    validation: dict | None = None        # the full ValidationResult, for the report
    seconds: float = 0.0
    parser_messages: int = 0              # how many diagnostics MuPDF raised; a count, never the text


@dataclass
class Review:
    """
    The state between validation and sealing.

    state is one of
      ready                  nothing was rejected; commit() needs no argument
      awaiting_confirmation  something was rejected; commit() needs confirmation_token (SDD 6.1)
      nothing_accepted       there is nothing to publish; commit() refuses
    """
    attempt_id: str
    root: Path
    partial_dir: Path
    state: str
    candidates: list[Candidate]
    documents: list[dict]
    rejected: list[dict]
    confirmation_token: str | None
    totals: dict
    policy: IngestionPolicy
    config: ChunkerConfig
    started_at: str
    phases: list[dict]
    durable: bool = True
    _lock: _JobLock | None = None
    _journal: _Journal | None = None
    _open: bool = True

    @property
    def requires_confirmation(self) -> bool:
        return self.state == 'awaiting_confirmation'

    def __enter__(self) -> 'Review':
        return self

    def __exit__(self, *exc) -> None:
        """`with prepare(...) as review:` discards the attempt unless it was committed."""
        discard(self, 'abandoned')

    def to_dict(self) -> dict:
        return {
            'attempt_id': self.attempt_id, 'state': self.state,
            'requires_confirmation': self.requires_confirmation,
            'confirmation_token': self.confirmation_token,
            'totals': self.totals,
            'candidates': [asdict(c) for c in self.candidates],
        }


@dataclass
class Run:
    """A sealed, verified run. Obtained from commit() or load_run() and from nowhere else."""
    run_id: str
    path: Path
    manifest: dict
    reused: bool = False

    @property
    def documents(self) -> list[dict]:
        """One E2 Document record per accepted document, as E3's publish() takes them."""
        with open(self.path / self.manifest['documents_file']['path'], 'rb') as handle:
            return [json.loads(line) for line in handle]

    def iter_chunks(self, document_id: str | None = None) -> Iterator[dict]:
        """Chunk dicts (Chunk.to_dict() shape), document by document, in ordinal order."""
        for doc in self.manifest['documents']:
            if document_id is not None and doc['document_id'] != document_id:
                continue
            with open(self.path / doc['files']['chunks']['path'], 'rb') as handle:
                for line in handle:
                    yield json.loads(line)

    def source_path(self, document_id: str) -> Path:
        """The staged PDF for a document: what a citation renders its page from (SDD 7.3)."""
        doc = next(d for d in self.manifest['documents'] if d['document_id'] == document_id)
        return self.path / doc['files']['source']['path']

    @property
    def report(self) -> dict | None:
        path = self.path / 'report.json'
        return json.loads(path.read_bytes()) if path.exists() else None


@dataclass
class Verification:
    ok: bool
    checks: list[dict]
    stats: dict

    def failed(self) -> list[dict]:
        return [c for c in self.checks if not c['ok']]


# ---------------------------------------------------------------------------
# prepare: stage -> checksum -> validate -> extract -> chunk
# ---------------------------------------------------------------------------
def _synthetic_result(candidate: Candidate, policy: IngestionPolicy, check: Check,
                      reason: RejectReason, detail: str) -> ValidationResult:
    """A rejection decided by the pipeline rather than by validate(), in validate()'s vocabulary."""
    return ValidationResult(
        schema_version=VALIDATION_SCHEMA_VERSION, validated_at=_now(),
        validator_version=VALIDATOR_VERSION, extractor=EXTRACTOR,
        source_path=candidate.source_path, source_filename=candidate.source_filename,
        byte_size=candidate.byte_size or 0,
        checksum_sha256=candidate.checksum_sha256 or hashlib.sha256(b'').hexdigest(),
        outcome=Outcome.REJECTED, reject_reason=reason, reject_detail=detail,
        checks=[check], warnings=[], document=None, policy=policy.to_dict())


def _copy_and_hash(source: Path, target: Path | None, tick: Callable[[], None],
                   durable: bool) -> tuple[str, int, bytes]:
    """
    Read the source once: hash it and (unless target is None) write the staged copy.

    An OSError that leaves here came from reading the source, which is a fact
    about that one file. Failing to write the copy is not: it raises
    StagingFailed (or the original error when the disk is full) and ends the
    import, instead of blaming each file in turn.
    """
    def staging(exc: OSError) -> Exception:
        if exc.errno == errno.ENOSPC:
            return exc
        return StagingFailed('The import could not write to its working folder '
                             f'({type(exc).__name__}, errno {exc.errno}).')

    digest, size, head = hashlib.sha256(), 0, b''
    out = None
    try:
        if target is not None:
            try:
                out = open(target, 'wb')
            except OSError as exc:
                raise staging(exc) from None
        with open(source, 'rb') as handle:
            while block := handle.read(COPY_BLOCK):
                if not head:
                    head = block[:8]
                digest.update(block)
                size += len(block)
                if out is not None:
                    try:
                        out.write(block)
                    except OSError as exc:
                        raise staging(exc) from None
                tick()
        if out is not None and durable:
            try:
                out.flush()
                os.fsync(out.fileno())
            except OSError as exc:
                raise staging(exc) from None
    finally:
        if out is not None:
            out.close()
    return digest.hexdigest(), size, head


def _free_bytes(path: Path) -> int:
    return shutil.disk_usage(path).free


def prepare(paths: Iterable[str | Path], root: str | Path, *,
            policy: IngestionPolicy | None = None, config: ChunkerConfig | None = None,
            progress: Callable[[Progress], None] | None = None,
            cancel: Callable[[], bool] | None = None,
            disk_free: Callable[[Path], int] = _free_bytes,
            durable: bool = True) -> Review:
    """
    Stage and process every candidate, and return what the review screen shows.

    Nothing is sealed here. The returned Review holds the job lock until it is
    passed to commit() or discard(); use it as a context manager to make sure
    one of the two happens. On any exception - cancellation, a full disk, a
    bug - the attempt directory is removed before the exception leaves.
    """
    policy, config = policy or IngestionPolicy(), config or ChunkerConfig()
    # Built before the lock is taken: a bad argument must not leave the root locked.
    # NFC, because macOS reports decomposed names and the manifest must not depend on the platform.
    candidates = [Candidate(i, str(p), unicodedata.normalize('NFC', Path(p).name) or '(unnamed)')
                  for i, p in enumerate(paths)]
    root = Path(root)
    runs = root / 'runs'
    runs.mkdir(parents=True, exist_ok=True)
    lock = _JobLock(root)
    lock.acquire()

    attempt_id = f'{datetime.now(timezone.utc):%Y%m%dT%H%M%SZ}-{os.getpid()}-{secrets.token_hex(3)}'
    partial = runs / (PARTIAL_PREFIX + attempt_id)
    journal = _Journal(root, attempt_id)
    started_at, t0 = _now(), time.perf_counter()
    phases: list[dict] = []
    state = {'phase': 'validating', 'files': 0, 'pages': 0, 'warnings': 0}
    # An exception out of the caller's progress or cancel callback is not a
    # property of the file being read when it happened. It is noted here so
    # the guard around process() does not record it as a damaged PDF.
    hook_failed: list[BaseException] = []

    def tick() -> None:
        if cancel is not None and cancel():
            raise Cancelled('The import was cancelled.')

    def report() -> None:
        if progress is not None:
            progress(Progress(state['phase'], state['files'], len(candidates), state['pages'],
                              state['warnings'], round(time.perf_counter() - t0, 3)))

    def page_tick(done: int, total: int) -> None:
        try:
            tick()
            state['pages'] += 1
            if done == total or done % 25 == 0:
                report()
        except BaseException as exc:
            hook_failed.append(exc)
            raise

    try:
        _silence_mupdf()
        partial.mkdir()
        for sub in ('incoming', 'sources', 'chunks', 'extraction'):
            (partial / sub).mkdir()
        journal('run_started', candidates=len(candidates), pipeline_version=PIPELINE_VERSION,
                chunker_config_id=config.config_id)

        # Sizes first, so a batch that cannot fit is refused before a byte is copied.
        for c in candidates:
            try:
                c.byte_size = os.stat(c.source_path).st_size
            except (OSError, ValueError):         # ValueError: a NUL in the path
                c.byte_size = None
        to_copy = sum(c.byte_size for c in candidates
                      if c.byte_size is not None and c.byte_size <= policy.max_bytes)
        free = disk_free(root)
        if free < to_copy + DISK_RESERVE_BYTES:
            raise InsufficientDiskSpace(to_copy + DISK_RESERVE_BYTES, free)

        by_checksum: dict[str, Candidate] = {}
        staged: dict[str, dict] = {}       # checksum -> working record of an accepted document
        rejected: dict[str, dict] = {}     # checksum (or 'unreadable:<n>') -> manifest entry
        names: dict[str, list[str]] = {}   # checksum -> every filename it was supplied under

        t_phase = time.perf_counter()
        for c in candidates:
            tick()
            t_file = time.perf_counter()
            pymupdf.TOOLS.reset_mupdf_warnings()
            said = 0
            source = Path(c.source_path)
            result: ValidationResult | None = None
            processed: Processed | None = None
            staged_path: Path | None = None

            # --- stage: one read of the source, hashing as it is copied ------
            if c.byte_size is None or not source.is_file():
                result = _synthetic_result(c, policy, Check(
                    'parser_opens', CheckStatus.FAIL, 'The file could not be read.',
                    observed='unreadable', expected='opens', reject_reason=RejectReason.CORRUPT),
                    RejectReason.CORRUPT, 'The file could not be read from where it was selected.')
            else:
                too_big = c.byte_size > policy.max_bytes
                tmp = None if too_big else partial / 'incoming' / f'{c.index:06d}.part'
                try:
                    c.checksum_sha256, c.byte_size, head = _copy_and_hash(source, tmp, tick, durable)
                except OSError as exc:
                    if exc.errno == errno.ENOSPC:
                        raise
                    if tmp is not None:
                        tmp.unlink(missing_ok=True)
                    result = _synthetic_result(c, policy, Check(
                        'parser_opens', CheckStatus.FAIL, 'The file could not be read.',
                        observed=type(exc).__name__, expected='opens',
                        reject_reason=RejectReason.CORRUPT),
                        RejectReason.CORRUPT, 'The file could not be read from where it was selected.')
                else:
                    first = by_checksum.get(c.checksum_sha256)
                    if first is not None:
                        # The same bytes again, under this or another name: one document.
                        if tmp is not None:
                            tmp.unlink()
                        names[c.checksum_sha256].append(c.source_filename)
                        c.disposition, c.duplicate_of = 'duplicate', c.checksum_sha256
                        c.document_id = first.document_id
                        c.seconds = round(time.perf_counter() - t_file, 4)
                        state['files'] += 1
                        journal('file_duplicate', checksum=c.checksum_sha256[:16])
                        report()
                        continue
                    by_checksum[c.checksum_sha256] = c
                    names[c.checksum_sha256] = [c.source_filename]
                    if too_big:
                        # Refused on size alone, without a copy. Same order as validate(): type before size.
                        if head[:5] != b'%PDF-':
                            result = _synthetic_result(c, policy, Check(
                                'magic_bytes', CheckStatus.FAIL,
                                'File is not a PDF regardless of its extension.',
                                observed=head[:5].decode('latin-1'), expected='%PDF-',
                                reject_reason=RejectReason.NON_PDF), RejectReason.NON_PDF,
                                'The file is not a PDF.')
                        else:
                            result = _synthetic_result(c, policy, Check(
                                'within_size_limits', CheckStatus.FAIL,
                                'The file exceeds the configured size limit.',
                                observed={'bytes': c.byte_size}, expected={'max_bytes': policy.max_bytes},
                                reject_reason=RejectReason.OVERSIZED), RejectReason.OVERSIZED,
                                f'The file is {c.byte_size:,} bytes, above the '
                                f'{policy.max_bytes:,}-byte limit.')
                    else:
                        document_id = Document.id_from_checksum(c.checksum_sha256)
                        # The staged name is derived from the content, never from the
                        # name the user's file happened to have.
                        staged_path = partial / 'sources' / f'{document_id}.pdf'
                        os.replace(tmp, staged_path)
                        journal('file_staged', checksum=c.checksum_sha256[:16], bytes=c.byte_size)

            # --- validate + extract + chunk, from one extraction --------------
            if result is None:
                try:
                    processed = process(staged_path, policy, config,
                                        source_filename=c.source_filename,
                                        checksum_sha256=c.checksum_sha256, byte_size=c.byte_size,
                                        on_page=page_tick)
                    result, said = processed.result, processed.parser_messages
                except (Cancelled, MemoryError):
                    raise
                except Exception as exc:
                    if hook_failed:
                        raise                     # the caller's callback failed, not the file
                    # validate() promises not to raise and has been seen to. A file
                    # that crashes the parser is a damaged file, not a failed import.
                    processed = None
                    result = _synthetic_result(c, policy, Check(
                        'structural_integrity', CheckStatus.FAIL,
                        'The document could not be processed.',
                        observed={'exception': type(exc).__name__}, expected='processes',
                        reject_reason=RejectReason.CORRUPT),
                        RejectReason.CORRUPT, 'The file is damaged and could not be processed.')
                result.source_path = c.source_path
                if (result.outcome is not Outcome.REJECTED and processed is not None
                        and not processed.chunks):
                    # Accepted but nothing to search: an accepted document always has chunks.
                    result.outcome, result.reject_reason = Outcome.REJECTED, RejectReason.SCANNED_ONLY
                    result.reject_detail = 'The document contains no searchable text.'
                    result.document = None
                    result.checks.append(Check(
                        'text_yield', CheckStatus.FAIL, 'No chunk could be produced from the text.',
                        observed={'chunks': 0}, expected='>= 1 chunk',
                        reject_reason=RejectReason.SCANNED_ONLY))
                    processed = None

            c.parser_messages = said + len(pymupdf.TOOLS.mupdf_warnings().splitlines())
            c.validation = result.to_dict()
            key = c.checksum_sha256 or f'unreadable:{c.index}'

            if result.outcome is Outcome.REJECTED:
                # Nothing of a rejected file stays in staging.
                if staged_path is not None:
                    staged_path.unlink(missing_ok=True)
                failing = [k.check_id for k in result.checks if k.status is CheckStatus.FAIL]
                c.disposition = 'rejected'
                c.reject_reason = result.reject_reason.value
                c.reject_detail = (result.reject_detail or '').replace(str(partial), '')
                rejected[key] = {
                    'checksum_sha256': c.checksum_sha256, 'byte_size': c.byte_size or 0,
                    'reject_reason': c.reject_reason, 'reject_detail': c.reject_detail,
                    'failed_check': failing[-1] if failing else None,
                }
            else:
                text, pages, made = processed.text, processed.pages, processed.chunks
                document = result.document
                # Lines, not one joined blob: joining would hold every line twice.
                lines = [_line(k.to_dict()) for k in made]
                table = {
                    'schema_version': MANIFEST_SCHEMA_VERSION,
                    'document_id': document['document_id'],
                    'extractor': EXTRACTOR, 'chunker_config_id': config.config_id,
                    'text_chars': len(text),
                    'text_sha256': _text_sha256(text),
                    'pages': [{'page_number': p.number, 'char_start': p.char_start,
                               'char_end': p.char_end, 'width': p.width, 'height': p.height,
                               'has_text': p.has_text, 'spans': len(p.spans)} for p in pages],
                }
                table_blob = json.dumps(table, sort_keys=True, separators=(',', ':'),
                                        ensure_ascii=True).encode('ascii') + b'\n'
                need = sum(map(len, lines)) + len(table_blob) + DISK_RESERVE_BYTES
                free = disk_free(root)
                if free < need:
                    raise InsufficientDiskSpace(need, free)
                _write(partial / 'chunks' / f'{document["document_id"]}.jsonl', lines, durable)
                _write(partial / 'extraction' / f'{document["document_id"]}.json', table_blob, durable)
                c.document_id = document['document_id']
                c.page_count, c.chunk_count = document['page_count'], len(made)
                c.warnings = list(result.warnings)
                c.disposition = 'accepted_with_warnings' if result.warnings else 'accepted'
                staged[c.checksum_sha256] = {
                    'document': document, 'candidate': c,
                    'text_chars': table['text_chars'], 'text_sha256': table['text_sha256'],
                    'pages_with_text': sum(1 for p in pages if p.has_text),
                    'pages_without_text': [p.number for p in pages if not p.has_text],
                    'chunk_count': len(made),
                }
                state['warnings'] += len(result.warnings)
                del text, pages, made, lines, processed     # one document in memory at a time

            c.seconds = round(time.perf_counter() - t_file, 4)
            state['files'] += 1
            journal('file_processed', checksum=(c.checksum_sha256 or '')[:16],
                    document_id=c.document_id, disposition=c.disposition,
                    reject_reason=c.reject_reason, pages=c.page_count, chunks=c.chunk_count,
                    warnings=[w['code'] for w in c.warnings], parser_messages=c.parser_messages,
                    seconds=c.seconds)
            report()

        shutil.rmtree(partial / 'incoming')
        phases.append({'phase': 'validating', 'seconds': round(time.perf_counter() - t_phase, 3)})

        # --- names: aliases of one content, and one name on two contents --------
        owners: dict[str, set[str]] = {}
        for checksum, supplied in names.items():
            if checksum in staged:
                for name in supplied:
                    owners.setdefault(name, set()).add(checksum)
        documents: list[dict] = []
        for checksum, work in staged.items():
            document, c = work['document'], work['candidate']
            supplied = sorted(set(names[checksum]))
            primary = supplied[0]                 # smallest name, so input order cannot matter
            if document['source_filename'] != primary:
                if document['display_title'] == Path(document['source_filename']).stem:
                    document['display_title'] = Path(primary).stem
                document['source_filename'] = primary
            if any(len(owners[name]) > 1 for name in supplied):
                warning = {'code': 'filename_shared',
                           'message': 'Another file in this import has the same name but different '
                                      'content. They were imported as separate documents.'}
                document['import_warnings'] = list(document['import_warnings']) + [warning]
                c.warnings = list(c.warnings) + [warning]
                c.disposition = 'accepted_with_warnings'
                state['warnings'] += 1
            c.validation['document'] = document
            documents.append({
                'document_id': document['document_id'],
                'checksum_sha256': checksum, 'byte_size': document['byte_size'],
                'source_filename': primary, 'aliases': [n for n in supplied if n != primary],
                'times_supplied': len(names[checksum]),
                'outcome': c.disposition,
                'warnings': document['import_warnings'],
                'page_count': document['page_count'],
                'pages_with_text': work['pages_with_text'],
                'pages_without_text': work['pages_without_text'],
                'text_chars': work['text_chars'], 'text_sha256': work['text_sha256'],
                'chunk_count': work['chunk_count'],
                '_record': document,
            })
        documents.sort(key=lambda d: d['document_id'])
        rejected_list = []
        for key, entry in rejected.items():
            supplied = sorted(set(names.get(key, [])) or
                              {c.source_filename for c in candidates if f'unreadable:{c.index}' == key})
            rejected_list.append({'source_filename': supplied[0], 'aliases': supplied[1:],
                                  'times_supplied': max(1, len(names.get(key, []))), **entry})
        rejected_list.sort(key=lambda r: (r['checksum_sha256'] or '', r['source_filename']))

        _write(partial / 'documents.jsonl',
               b''.join(_line(d['_record']) for d in documents), durable)

        token = None
        if rejected_list:
            token = 'ack_' + hashlib.sha256(_canon(
                [[r['checksum_sha256'], r['source_filename'], r['reject_reason']]
                 for r in rejected_list])).hexdigest()[:16]
        review_state = ('nothing_accepted' if not documents else
                        'awaiting_confirmation' if rejected_list else 'ready')
        totals = {
            'candidates': len(candidates),
            'accepted': len(documents),
            'accepted_with_warnings': sum(1 for d in documents if d['outcome'] == 'accepted_with_warnings'),
            'rejected': len(rejected_list),
            'duplicates': sum(1 for c in candidates if c.disposition == 'duplicate'),
            'pages': sum(d['page_count'] for d in documents),
            'chunks': sum(d['chunk_count'] for d in documents),
            'text_chars': sum(d['text_chars'] for d in documents),
            'warnings': sum(len(d['warnings']) for d in documents),
        }
        review = Review(attempt_id, root, partial, review_state, candidates, documents,
                        rejected_list, token, totals, policy, config, started_at, phases,
                        durable, lock, journal)
        state['phase'] = 'review'
        journal('review_ready', state=review_state, accepted=totals['accepted'],
                rejected=totals['rejected'], duplicates=totals['duplicates'],
                pages=totals['pages'], chunks=totals['chunks'],
                seconds=round(time.perf_counter() - t0, 3))
        report()
        return review
    except BaseException as exc:
        if isinstance(exc, OSError) and exc.errno == errno.ENOSPC:
            exc = InsufficientDiskSpace(DISK_RESERVE_BYTES, _free_bytes(root))
        shutil.rmtree(partial, ignore_errors=True)
        fields = {'reason': getattr(exc, 'code', 'failed'), 'error': type(exc).__name__,
                  'phase': state['phase'], 'files_done': state['files'], 'pages_done': state['pages']}
        if isinstance(exc, InsufficientDiskSpace):
            fields.update(required_bytes=exc.required_bytes, available_bytes=exc.available_bytes)
        try:
            journal('run_discarded', **fields)
        finally:
            lock.release()
        raise exc


# ---------------------------------------------------------------------------
# commit / discard
# ---------------------------------------------------------------------------
def discard(review: Review, reason: str = 'declined') -> None:
    """Throw an attempt away: the user declined, or the caller is shutting down."""
    if not review._open:
        return
    review._open = False
    shutil.rmtree(review.partial_dir, ignore_errors=True)
    try:
        review._journal('run_discarded', reason=reason, phase='review')
    finally:
        review._lock.release()


def _file_entry(base: Path, relative: str) -> dict:
    digest, size = _sha256_file(base / relative)
    return {'path': relative, 'bytes': size, 'sha256': digest}


def _seal(body: dict) -> dict:
    digest = hashlib.sha256(_canon(body)).hexdigest()
    return {'manifest_sha256': digest, 'run_id': RUN_PREFIX + digest[:16]}


def commit(review: Review, *, acknowledge_rejections: str | None = None) -> Run:
    """
    Write the manifest and the import report, verify the directory, and seal it.

    If any file was rejected the caller must pass review.confirmation_token,
    which it can only have after showing the review to the user (SDD 6.1). The
    token is a hash of the rejected set, so it cannot be reused for another one.
    """
    if not review._open:
        raise IngestError('This review has already been committed or discarded.', review)
    if review.state == 'nothing_accepted':
        raise NothingAccepted('No file was accepted, so there is nothing to publish.', review)
    if review.requires_confirmation and acknowledge_rejections != review.confirmation_token:
        raise ConfirmationRequired(
            f'{review.totals["rejected"]} file(s) were rejected. Review them and confirm before '
            f'publishing the remaining {review.totals["accepted"]}.', review)

    partial, journal, t0 = review.partial_dir, review._journal, time.perf_counter()
    try:
        documents, listed = [], []
        pairs_all: list[tuple[str, str]] = []
        for d in review.documents:
            doc_id = d['document_id']
            files = {'source': _file_entry(partial, f'sources/{doc_id}.pdf'),
                     'chunks': _file_entry(partial, f'chunks/{doc_id}.jsonl'),
                     'extraction': _file_entry(partial, f'extraction/{doc_id}.json')}
            # Taken from the bytes on disk, not from what prepare() meant to write.
            pairs = []
            with open(partial / files['chunks']['path'], 'rb') as handle:
                for line in handle:
                    chunk = json.loads(line)
                    pairs.append((chunk['chunk_id'], chunk['text_checksum_sha256']))
            pairs_all += pairs
            listed += files.values()
            documents.append({**{k: v for k, v in d.items() if k != '_record'},
                              'chunk_set_sha256': chunk_set_digest(pairs), 'files': files})
        documents_file = _file_entry(partial, 'documents.jsonl')
        listed.append(documents_file)

        body = {
            'schema_version': MANIFEST_SCHEMA_VERSION,
            'kind': MANIFEST_KIND,
            'pipeline_version': PIPELINE_VERSION,
            'validator_version': VALIDATOR_VERSION,
            'extractor': EXTRACTOR,
            'chunker': review.config.to_dict(),
            'policy': review.policy.to_dict(),
            'documents': documents,
            'rejected': review.rejected,
            'documents_file': documents_file,
            'totals': {**review.totals,
                       'source_bytes': sum(d['files']['source']['bytes'] for d in documents),
                       'chunk_bytes': sum(d['files']['chunks']['bytes'] for d in documents)},
            'review': {'confirmation_required': review.requires_confirmation,
                       'confirmation_token': review.confirmation_token},
            'integrity': {'chunk_set_sha256': chunk_set_digest(pairs_all),
                          'files_sha256': _files_digest(listed)},
        }
        seal = _seal(body)
        manifest = {**body, 'seal': seal}
        run_id = seal['run_id']

        finished = _now()
        report_body = {
            'schema_version': MANIFEST_SCHEMA_VERSION,
            'kind': REPORT_KIND,
            'run_id': run_id,
            'attempt_id': review.attempt_id,
            'state': 'complete',
            'manifest_sha256': seal['manifest_sha256'],
            'started_at': review.started_at,
            'finished_at': finished,
            'phases': review.phases,
            'host': {'platform': platform.platform(), 'python': platform.python_version(),
                     'extractor': EXTRACTOR},
            'candidates': [asdict(c) for c in review.candidates],
            'summary': review.totals,
            'confirmation': {'required': review.requires_confirmation,
                             'token': review.confirmation_token,
                             'acknowledged': review.requires_confirmation,
                             'acknowledged_at': finished if review.requires_confirmation else None},
        }
        report = {**report_body,
                  'seal': {'report_sha256': hashlib.sha256(_canon(report_body)).hexdigest()}}
        pretty = dict(indent=2, sort_keys=True, ensure_ascii=True)
        _write(partial / 'report.json', json.dumps(report, **pretty).encode('ascii') + b'\n',
               review.durable)
        # The manifest is the last file written: its presence is the claim of completeness.
        _write(partial / 'manifest.json', json.dumps(manifest, **pretty).encode('ascii') + b'\n',
               review.durable)
        if review.durable:
            for sub in ('sources', 'chunks', 'extraction', '.'):
                _fsync_dir(partial / sub)

        checked = verify(partial, sealed=False)
        if not checked.ok:
            raise IntegrityError(f'The run failed verification: {checked.failed()[0]["check"]}', review)

        final = review.root / 'runs' / run_id
        reused = False
        if final.exists():
            # The same inputs under the same configuration were sealed before.
            if verify(final).ok:
                shutil.rmtree(partial)
                reused = True
            else:
                _set_aside(review.root, final)
                os.replace(partial, final)
        else:
            os.replace(partial, final)
        # Sealed. Nothing after this point may be reported as a discard.
        review._open = False
        try:
            if review.durable:
                _fsync_dir(review.root / 'runs')
            journal('run_reused' if reused else 'run_sealed', run_id=run_id,
                    manifest_sha256=seal['manifest_sha256'], documents=len(documents),
                    rejected=len(review.rejected), chunks=review.totals['chunks'],
                    chunk_set_sha256=body['integrity']['chunk_set_sha256'],
                    seconds=round(time.perf_counter() - t0, 3))
        except OSError as exc:
            log.warning('run %s is sealed but could not be journalled: %s', run_id,
                        type(exc).__name__)
        finally:
            review._lock.release()
        return Run(run_id, final, json.loads((final / 'manifest.json').read_bytes()), reused)
    except BaseException as exc:
        if review._open:
            review._open = False
            shutil.rmtree(partial, ignore_errors=True)
            try:
                journal('run_discarded', reason=getattr(exc, 'code', 'failed'),
                        error=type(exc).__name__, phase='sealing')
            finally:
                review._lock.release()
        raise


def ingest(paths: Iterable[str | Path], root: str | Path, *,
           acknowledge_rejections: bool = False, **options) -> Run:
    """
    prepare() and commit() in one call, for callers with no review step of their own.

    Raises ConfirmationRequired (carrying the Review) when files were rejected and
    acknowledge_rejections is False; nothing is left on disk in that case.
    """
    review = prepare(paths, root, **options)
    try:
        if review.requires_confirmation and not acknowledge_rejections:
            raise ConfirmationRequired(
                f'{review.totals["rejected"]} file(s) were rejected. Nothing was published.', review)
        return commit(review, acknowledge_rejections=review.confirmation_token)
    except BaseException as exc:
        discard(review, reason=getattr(exc, 'code', 'failed'))
        raise


# ---------------------------------------------------------------------------
# verify / load
# ---------------------------------------------------------------------------
def verify(run_dir: str | Path, *, deep: bool = False, sealed: bool = True) -> Verification:
    """
    Re-read a run from disk and prove it is what its manifest says.

    Everything is recomputed from bytes: file hashes, chunk text checksums,
    chunk ids, the E3-compatible chunk-set digest, and each document's text
    stream rebuilt from its chunks. deep=True also re-extracts every staged PDF
    and requires the chunk files to come out byte-for-byte the same.
    """
    run_dir = Path(run_dir).resolve()         # so "verify ." has the run's name to compare
    checks: list[dict] = []
    stats = {'files': 0, 'bytes': 0, 'documents': 0, 'chunks': 0, 'pages': 0}

    def check(name: str, ok: bool, detail: str = '') -> bool:
        checks.append({'check': name, 'ok': bool(ok), 'detail': detail})
        return bool(ok)

    try:
        manifest = json.loads((run_dir / 'manifest.json').read_bytes())
        if not isinstance(manifest, dict):
            raise ValueError('the manifest is not a JSON object')
    except (OSError, ValueError) as exc:
        check('manifest_readable', False, type(exc).__name__)
        return Verification(False, checks, stats)
    check('manifest_readable', True)

    try:
        body = {k: v for k, v in manifest.items() if k != 'seal'}
        seal = _seal(body)
        check('manifest_seal', seal == manifest.get('seal'),
              f'manifest hashes to {seal["manifest_sha256"][:16]}')
        check('run_directory_name', (not sealed) or run_dir.name == seal['run_id'], run_dir.name)
        check('schema_version', manifest.get('schema_version') == MANIFEST_SCHEMA_VERSION
              and manifest.get('kind') == MANIFEST_KIND)

        # The id is recomputed from the settings as stored, not from today's
        # ChunkerConfig: a run sealed before a setting was added or removed is
        # still the run it was.
        config_id = manifest['chunker']['config_id']
        stored = {k: v for k, v in manifest['chunker'].items() if k != 'config_id'}
        check('chunker_config_id', ChunkerConfig.id_of(stored) == config_id, config_id)

        # --- every listed file is present and unchanged; nothing else is there ---
        listed = [manifest['documents_file']]
        for d in manifest['documents']:
            listed += d['files'].values()
        bad = []
        for entry in listed:
            path = run_dir / entry['path']
            if not path.is_file():
                bad.append(f'{entry["path"]}: missing')
                continue
            digest, size = _sha256_file(path)
            stats['files'] += 1
            stats['bytes'] += size
            if size != entry['bytes'] or digest != entry['sha256']:
                bad.append(f'{entry["path"]}: content changed')
        check('files_present_and_unchanged', not bad, '; '.join(bad[:3]) or f'{len(listed)} files')
        check('files_digest', _files_digest(listed) == manifest['integrity']['files_sha256'])
        allowed = {e['path'] for e in listed} | {'manifest.json', 'report.json'}
        on_disk = {p.relative_to(run_dir).as_posix() for p in run_dir.rglob('*')
                   if p.is_file() and p.name not in OS_METADATA}
        check('no_unlisted_files', on_disk <= allowed, ', '.join(sorted(on_disk - allowed)[:3]))

        # --- rejected files left nothing behind -------------------------------
        accepted_sums = {d['checksum_sha256'] for d in manifest['documents']}
        rejected_ids = {Document.id_from_checksum(r['checksum_sha256'])
                        for r in manifest['rejected'] if r['checksum_sha256']}
        leaked = [p for p in on_disk if any(rid in p for rid in rejected_ids)]
        overlap = accepted_sums & {r['checksum_sha256'] for r in manifest['rejected']}
        check('rejected_files_absent', not leaked and not overlap,
              f'{len(manifest["rejected"])} rejected, none present')
        check('confirmation_recorded',
              manifest['review']['confirmation_required'] == bool(manifest['rejected'])
              and (not manifest['rejected'] or bool(manifest['review']['confirmation_token'])))

        # --- document records ---------------------------------------------------
        if bad:
            return Verification(False, checks, stats)
        with open(run_dir / manifest['documents_file']['path'], 'rb') as handle:
            records = [json.loads(line) for line in handle]
        ok = [r['document_id'] for r in records] == [d['document_id'] for d in manifest['documents']]
        for record, d in zip(records, manifest['documents']):
            ok &= record['checksum_sha256'] == d['checksum_sha256'] == d['files']['source']['sha256']
            ok &= record['document_id'] == Document.id_from_checksum(d['checksum_sha256'])
            ok &= record['page_count'] == d['page_count'] and record['byte_size'] == d['byte_size']
            ok &= d['files']['source']['path'] == f'sources/{d["document_id"]}.pdf'
        check('documents_match_sources', ok, f'{len(records)} document records')
        stats['documents'] = len(records)

        # --- chunks -------------------------------------------------------------
        problems: dict[str, list[str]] = {k: [] for k in (
            'chunk_counts', 'chunk_text_checksums', 'chunk_ids', 'chunk_provenance',
            'text_stream_rebuilt', 'chunk_set_digests')}
        pairs_all: list[tuple[str, str]] = []
        seen_ids: set[str] = set()
        for d in manifest['documents']:
            doc_id = d['document_id']
            table = json.loads((run_dir / d['files']['extraction']['path']).read_bytes())
            page = {p['page_number']: p for p in table['pages']}
            if (table['document_id'] != doc_id or len(page) != d['page_count']
                    or table['text_sha256'] != d['text_sha256']
                    or [n for n, p in page.items() if not p['has_text']] != d['pages_without_text']):
                problems['chunk_provenance'].append(f'{doc_id}: page table disagrees with manifest')
            stream: list[str] = []
            n = 0
            base, tail = 0, ''          # invariant: tail == rebuilt_stream[base:]
            pairs = []
            with open(run_dir / d['files']['chunks']['path'], 'rb') as handle:
                for line in handle:
                    c = json.loads(line)
                    where = f'{doc_id} chunk {n}'
                    text, start, end = c['text'], c['char_start'], c['char_end']
                    if text_checksum(text) != c['text_checksum_sha256']:
                        problems['chunk_text_checksums'].append(where)
                    if (c['document_id'] != doc_id or c['chunker_config_id'] != config_id
                            or c['chunk_id'] != Chunk.make_id(doc_id, config_id, start, end)
                            or c['chunk_id'] in seen_ids):
                        problems['chunk_ids'].append(where)
                    seen_ids.add(c['chunk_id'])
                    spans = c['page_spans']
                    good = (c['ordinal'] == n and len(text) == end - start
                            and 0 <= start < end <= d['text_chars'] and spans
                            and spans[0]['char_start'] == start and spans[-1]['char_end'] == end
                            and c['page_start'] == spans[0]['page_number']
                            and c['page_end'] == spans[-1]['page_number'])
                    for a, b in zip(spans, spans[1:]):
                        good = good and a['char_end'] == b['char_start'] and a['page_number'] < b['page_number']
                    for s in spans:
                        p = page.get(s['page_number'])
                        good = (good and p is not None
                                and p['char_start'] <= s['char_start'] < s['char_end'] <= p['char_end']
                                and s['page_char_start'] == s['char_start'] - p['char_start']
                                and s['page_char_end'] == s['char_end'] - p['char_start'])
                    if not good:
                        problems['chunk_provenance'].append(where)
                    # Rebuild the stream: each chunk must agree with the text already laid down.
                    if not base <= start <= base + len(tail):
                        problems['text_stream_rebuilt'].append(
                            f'{where}: not contiguous with the previous chunk')
                    else:
                        have = tail[start - base:]            # what the stream already says from here
                        common = min(len(have), len(text))
                        if have[:common] != text[:common]:
                            problems['text_stream_rebuilt'].append(
                                f'{where}: overlap disagrees with the previous chunk')
                        stream.append(text[common:])
                        base, tail = start, have + text[common:]
                    pairs.append((c['chunk_id'], c['text_checksum_sha256']))
                    n += 1
            rebuilt = ''.join(stream)
            if (len(rebuilt) != d['text_chars']
                    or _text_sha256(rebuilt) != d['text_sha256']):
                problems['text_stream_rebuilt'].append(f'{doc_id}: rebuilt stream does not hash to text_sha256')
            if n != d['chunk_count'] or n < 1:
                problems['chunk_counts'].append(f'{doc_id}: {n} lines, manifest says {d["chunk_count"]}')
            if chunk_set_digest(pairs) != d['chunk_set_sha256']:
                problems['chunk_set_digests'].append(doc_id)
            pairs_all += pairs
            stats['chunks'] += n
            stats['pages'] += d['page_count']
        if chunk_set_digest(pairs_all) != manifest['integrity']['chunk_set_sha256']:
            problems['chunk_set_digests'].append('run')
        totals = manifest['totals']
        if (stats['chunks'] != totals['chunks'] or stats['pages'] != totals['pages']
                or len(manifest['documents']) != totals['accepted']
                or len(manifest['rejected']) != totals['rejected']):
            problems['chunk_counts'].append('totals disagree with contents')
        for name, found in problems.items():
            check(name, not found, '; '.join(found[:3]) or f'{stats["chunks"]} chunks')

        # --- the import report belongs to this manifest ---------------------------
        report_path = run_dir / 'report.json'
        if report_path.exists():
            report = json.loads(report_path.read_bytes())
            report_body = {k: v for k, v in report.items() if k != 'seal'}
            check('report_seal', hashlib.sha256(_canon(report_body)).hexdigest()
                  == report.get('seal', {}).get('report_sha256')
                  and report.get('manifest_sha256') == seal['manifest_sha256'])
        else:
            check('report_seal', False, 'report.json is missing')

        # --- deep: the staged PDFs still produce these chunks ------------------------
        if deep:
            # This step does need today's code to understand the stored
            # settings; a TypeError here is reported as a failed check below.
            policy = IngestionPolicy(**manifest['policy'])
            config = ChunkerConfig(**stored)
            _silence_mupdf()
            different = []
            for d in manifest['documents']:
                source = run_dir / d['files']['source']['path']
                again = process(source, policy, config, source_filename=d['source_filename'],
                                checksum_sha256=d['checksum_sha256'], byte_size=d['byte_size'])
                digest = hashlib.sha256()
                for k in again.chunks or []:
                    digest.update(_line(k.to_dict()))
                del again
                if digest.hexdigest() != d['files']['chunks']['sha256']:
                    different.append(d['document_id'])
            check('reextraction_reproduces_chunks', not different,
                  ', '.join(different[:3]) or f'{len(manifest["documents"])} documents re-extracted '
                  f'with {EXTRACTOR}')
    except (KeyError, TypeError, ValueError, AttributeError, OSError) as exc:
        check('manifest_well_formed', False, f'{type(exc).__name__}: {exc}')
    return Verification(all(c['ok'] for c in checks), checks, stats)


def load_run(run_dir: str | Path, *, check: bool = True) -> Run:
    """
    Open a sealed run for a consumer. This is the hand-off to E3.

    Raises RunNotComplete for anything that is not a sealed run (an attempt
    still in progress, an interrupted one, a directory without a manifest) and
    IntegrityError when the contents do not match the manifest.
    """
    run_dir = Path(run_dir).resolve()
    if run_dir.name.startswith(PARTIAL_PREFIX) or not (run_dir / 'manifest.json').is_file():
        raise RunNotComplete(f'{run_dir.name} is not a sealed run.')
    if check:
        result = verify(run_dir)
        if not result.ok:
            failed = result.failed()[0]
            raise IntegrityError(f'{run_dir.name} failed verification: {failed["check"]} {failed["detail"]}')
    manifest = json.loads((run_dir / 'manifest.json').read_bytes())
    return Run(manifest['seal']['run_id'], run_dir, manifest)


# ---------------------------------------------------------------------------
# startup recovery and retention
# ---------------------------------------------------------------------------
def _set_aside(root: Path, path: Path) -> Path:
    target = root / QUARANTINE_DIR / f'{path.name}-{secrets.token_hex(3)}'
    target.parent.mkdir(exist_ok=True)
    os.replace(path, target)
    return target


def _tree_bytes(path: Path) -> int:
    return sum(p.stat().st_size for p in path.rglob('*') if p.is_file())


def recover(root: str | Path, *, quarantine: bool = False) -> list[dict]:
    """
    Call at startup (SDD 9, unexpected shutdown). Returns what it found under
    runs/ that is not a sealed run, and what it did with each. Raises Busy if
    a job is running now.

      .partial-*   an interrupted attempt: deleted, or with quarantine=True
                   moved to quarantine/.
      run_*        that has no manifest, or whose manifest does not hash to
                   its name: always moved to quarantine/, never deleted. It
                   may be a good run damaged later, with the only staged copy
                   of its PDFs.
      other names  left where they are and reported: this module did not make
                   them. Symbolic links are not followed.
    """
    root = Path(root)
    runs = root / 'runs'
    if not runs.is_dir():
        return []
    lock = _JobLock(root)
    lock.acquire()
    found = []
    journal = _Journal(root, 'recover')
    try:
        for entry in sorted(runs.iterdir()):
            if entry.is_symlink() or not entry.is_dir():
                continue
            if entry.name.startswith(PARTIAL_PREFIX):
                why, action = 'interrupted_attempt', 'quarantined' if quarantine else 'removed'
            elif not RUN_NAME.match(entry.name):
                why, action = 'not_a_run', 'ignored'
            elif not (entry / 'manifest.json').is_file():
                why, action = 'no_manifest', 'quarantined'
            else:
                try:
                    manifest = json.loads((entry / 'manifest.json').read_bytes())
                    good = _seal({k: v for k, v in manifest.items() if k != 'seal'}) == manifest.get('seal') \
                        and manifest['seal']['run_id'] == entry.name
                except (ValueError, KeyError, TypeError, AttributeError, OSError):
                    good = False
                if good:
                    continue
                why, action = 'manifest_seal_mismatch', 'quarantined'
            size = _tree_bytes(entry)
            if action == 'quarantined':
                _set_aside(root, entry)
            elif action == 'removed':
                shutil.rmtree(entry)
            found.append({'name': entry.name, 'reason': why, 'bytes': size, 'action': action})
            # Run and attempt names are derived from hashes and clock time, never from a filename.
            journal('leftover_' + action, reason=why, bytes=size,
                    name=entry.name if action != 'ignored' else None)
    finally:
        lock.release()
    return found


def job_active(root: str | Path) -> bool:
    """True while an import holds the job lock. The shell asks before quitting (SDD 6.3)."""
    root = Path(root)
    if not root.is_dir():
        return False
    lock = _JobLock(root)
    try:
        lock.acquire()
    except Busy:
        return True
    lock.release()
    return False


def list_runs(root: str | Path) -> list[str]:
    runs = Path(root) / 'runs'
    if not runs.is_dir():
        return []
    return sorted(p.name for p in runs.iterdir()
                  if p.is_dir() and p.name.startswith(RUN_PREFIX) and (p / 'manifest.json').is_file())


def prune(root: str | Path, keep: Iterable[str]) -> list[str]:
    """Delete sealed runs not named in keep. E3 calls this with the runs behind its active and previous versions."""
    keep, removed = set(keep), []
    for name in list_runs(root):
        if name not in keep:
            shutil.rmtree(Path(root) / 'runs' / name)
            removed.append(name)
    return removed


# ---------------------------------------------------------------------------
# provenance trace (what the demo prints)
# ---------------------------------------------------------------------------
def trace(run: Run, document_id: str, ordinal: int) -> dict:
    """
    Follow one chunk back to its source: file, page(s), offsets, rectangles,
    and prove each link by recomputing it from the staged PDF.
    """
    doc = next((d for d in run.manifest['documents'] if d['document_id'] == document_id), None)
    if doc is None:
        raise LookupError(f'This run has no document {document_id}.')
    chunk = next((c for c in run.iter_chunks(document_id) if c['ordinal'] == ordinal), None)
    if chunk is None:
        raise LookupError(f'Document {document_id} has {doc["chunk_count"]} chunks; '
                          f'there is no chunk {ordinal}.')
    settings = run.manifest['chunker']
    source = run.path / doc['files']['source']['path']
    _silence_mupdf()
    text, pages, handle = extract(source, sort=settings.get('sorted_reading_order', True),
                                  strip_boilerplate=settings.get('strip_running_headers', True))
    handle.close()
    page_text = {p.number: text[p.char_start:p.char_end] for p in pages}
    spans = []
    for s in chunk['page_spans']:
        quoted = chunk['text'][s['char_start'] - chunk['char_start']:s['char_end'] - chunk['char_start']]
        spans.append({**s, 'quoted': quoted,
                      'page_slice_matches': page_text[s['page_number']][s['page_char_start']:s['page_char_end']] == quoted})
    return {
        'source_filename': doc['source_filename'], 'aliases': doc['aliases'],
        'source_sha256': doc['checksum_sha256'], 'staged_as': doc['files']['source']['path'],
        'staged_sha256_matches': _sha256_file(source)[0] == doc['checksum_sha256'],
        'document_id': document_id, 'chunk': chunk, 'text_chars': doc['text_chars'],
        'text_checksum_matches': text_checksum(chunk['text']) == chunk['text_checksum_sha256'],
        'stream_slice_matches': text[chunk['char_start']:chunk['char_end']] == chunk['text'],
        'stream_sha256_matches': _text_sha256(text) == doc['text_sha256'],
        'spans': spans,
    }


# ---------------------------------------------------------------------------
# command line: also the demo
# ---------------------------------------------------------------------------
def _mark(ok: bool) -> str:
    return 'ok  ' if ok else 'FAIL'


def _print_trace(t: dict) -> None:
    c = t['chunk']
    print(f'   source     {t["source_filename"]}'
          + (f'  (also supplied as {", ".join(t["aliases"])})' if t['aliases'] else ''))
    print(f'              sha256 {t["source_sha256"]}')
    print(f'   staged as  {t["staged_as"]}')
    print(f'   document   {t["document_id"]}')
    print(f'   chunk      {c["chunk_id"]}  ordinal {c["ordinal"]}  '
          f'pages {c["page_start"]}-{c["page_end"]}  '
          f'chars {c["char_start"]:,}-{c["char_end"]:,} of {t["text_chars"]:,}')
    for s in t['spans']:
        first = s['highlight_rects'][0] if s['highlight_rects'] else None
        quote = ' '.join(s['quoted'].split())
        print(f'     page {s["page_number"]:>4}  stream {s["char_start"]:,}-{s["char_end"]:,}  '
              f'page chars {s["page_char_start"]:,}-{s["page_char_end"]:,}  '
              f'{len(s["highlight_rects"])} rect(s), first {first}')
        print(f'                "{quote[:76]}{"..." if len(quote) > 76 else ""}"')
    print(f'   [{_mark(t["staged_sha256_matches"])}] staged PDF still hashes to the recorded checksum')
    print(f'   [{_mark(t["text_checksum_matches"])}] sha256(chunk text) == text_checksum_sha256')
    print(f'   [{_mark(t["stream_slice_matches"])}] re-extracted stream[{c["char_start"]}:{c["char_end"]}] == chunk text')
    print(f'   [{_mark(all(s["page_slice_matches"] for s in t["spans"]))}] every page slice equals its part of the chunk')


def _print_review(review: Review) -> None:
    """The review screen as text: stage, validate, extract, chunk - one block each."""
    config = review.config
    print('1. STAGE      copy into staging, sha256 computed during the copy')
    for c in review.candidates:
        digest = f'sha256 {c.checksum_sha256[:16]}...' if c.checksum_sha256 else 'unreadable'
        if c.disposition == 'duplicate':
            kept = f'same bytes as an earlier file ({c.document_id or "rejected"}); not copied twice'
        elif c.disposition == 'rejected':
            kept = 'not kept'
        else:
            kept = f'sources/{c.document_id}.pdf'
        print(f'   {c.source_filename:<44} {c.byte_size or 0:>11,} bytes  {digest}  -> {kept}')

    print('\n2. VALIDATE')
    for c in review.candidates:
        if c.disposition == 'duplicate':
            continue
        checks = c.validation['checks']
        if c.disposition == 'rejected':
            print(f'   REJECTED   {c.source_filename:<44} {c.reject_reason}: {c.reject_detail}')
            failing = [k for k in checks if k['status'] == 'fail']
            if failing:
                print(f'              failed check {failing[-1]["check_id"]}: observed '
                      f'{json.dumps(failing[-1]["observed"])}, expected {json.dumps(failing[-1]["expected"])}')
        else:
            passed = sum(1 for k in checks if k['status'] == 'pass')
            label = 'ACCEPTED' if c.disposition == 'accepted' else 'ACCEPTED*'
            print(f'   {label:<10} {c.source_filename:<44} {passed}/{len(checks)} checks pass')
            for w in c.warnings:
                pages = f' pages {w["pages"]}' if w.get('pages') else ''
                print(f'              warning {w["code"]}: {w["message"]}{pages}')

    print(f'\n3. EXTRACT    one canonical text stream per document ({EXTRACTOR})')
    for d in review.documents:
        blank = d['pages_without_text']
        print(f'   {d["document_id"]}  {d["page_count"]:>5} pages  {d["text_chars"]:>9,} chars  '
              f'pages without text: {blank if blank else "none"}')

    print(f'\n4. CHUNK      {config.config_id} ({config.chunker_version}, target {config.target_chars}, '
          f'overlap {config.overlap_chars})')
    for d in review.documents:
        print(f'   {d["document_id"]}  {d["chunk_count"]:>5} chunks  -> chunks/{d["document_id"]}.jsonl')

    t = review.totals
    print(f'\n5. REVIEW     {t["candidates"]} supplied: {t["accepted"]} accepted '
          f'({t["accepted_with_warnings"]} with warnings), {t["rejected"]} rejected, '
          f'{t["duplicates"]} duplicate; {t["pages"]:,} pages, {t["chunks"]:,} chunks')


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog='python -m src.pipeline',
                                 description='E2 ingestion: validate, extract, chunk, seal, verify.')
    sub = ap.add_subparsers(dest='command', required=True)
    a = sub.add_parser('ingest', help='drop in PDFs and get a sealed run (the demo)')
    a.add_argument('pdfs', nargs='+')
    a.add_argument('--out', required=True, help='ingestion root directory')
    a.add_argument('--accept-rejections', action='store_true',
                   help='publish the valid remainder when some files are rejected')
    a.add_argument('--trace', type=int, default=None, metavar='N',
                   help='ordinal of the chunk to trace (default: first chunk spanning pages)')
    a.add_argument('--max-pages', type=int, default=None)
    a.add_argument('--target-chars', type=int, default=None)
    a.add_argument('--overlap-chars', type=int, default=None)
    v = sub.add_parser('verify', help='re-read a sealed run and recompute every count and checksum')
    v.add_argument('run_dir')
    v.add_argument('--deep', action='store_true', help='also re-extract every staged PDF')
    s = sub.add_parser('show', help='trace one chunk of a sealed run back to its source')
    s.add_argument('run_dir')
    s.add_argument('--doc', default=None)
    s.add_argument('--chunk', type=int, default=0)
    r = sub.add_parser('recover', help='remove what an interrupted attempt left behind')
    r.add_argument('root')
    r.add_argument('--quarantine', action='store_true')
    args = ap.parse_args(argv)

    if args.command == 'recover':
        try:
            found = recover(args.root, quarantine=args.quarantine)
        except Busy as exc:
            print(f'{exc.code}: {exc}')
            return 5
        for f in found:
            print(f'   {f["action"]:<12} {f["name"]}  ({f["reason"]}, {f["bytes"]:,} bytes)')
        print(f'{len(found)} leftover(s) handled; sealed runs: {list_runs(args.root)}')
        return 0

    if args.command == 'verify':
        result = verify(args.run_dir, deep=args.deep)
        for c in result.checks:
            print(f'   [{_mark(c["ok"])}] {c["check"]:<32} {c["detail"]}')
        print(f'{"VERIFIED" if result.ok else "FAILED"}: {result.stats["documents"]} documents, '
              f'{result.stats["pages"]:,} pages, {result.stats["chunks"]:,} chunks, '
              f'{result.stats["files"]} files, {result.stats["bytes"]:,} bytes')
        return 0 if result.ok else 1

    if args.command == 'show':
        try:
            run = load_run(args.run_dir)
        except IngestError as exc:
            print(f'{exc.code}: {exc}')
            return 1
        doc_id = args.doc or run.manifest['documents'][0]['document_id']
        try:
            _print_trace(trace(run, doc_id, args.chunk))
        except LookupError as exc:
            print(exc.args[0])
            return 1
        return 0

    try:
        policy = IngestionPolicy(**({'max_pages': args.max_pages}
                                    if args.max_pages is not None else {}))
        overrides = {k: v for k, v in (('target_chars', args.target_chars),
                                       ('overlap_chars', args.overlap_chars)) if v is not None}
        config = ChunkerConfig(**overrides)
    except ValueError as exc:
        print(f'usage error: {exc}')
        return 64
    try:
        review = prepare(args.pdfs, args.out, policy=policy, config=config)
    except InsufficientDiskSpace as exc:
        print(f'{exc.code}: {exc}')
        return 4
    except Busy as exc:
        print(f'{exc.code}: {exc}')
        return 5
    except IngestError as exc:
        print(f'{exc.code}: {exc}')
        return 1
    except KeyboardInterrupt:
        print('cancelled: nothing was kept')
        return 130
    _print_review(review)

    if review.state == 'nothing_accepted':
        print('   No file was accepted. Nothing to publish.')
        discard(review, 'nothing_accepted')
        return 3
    if review.requires_confirmation and not args.accept_rejections:
        print(f'   {review.totals["rejected"]} file(s) were rejected, so confirmation is required before the '
              f'remaining {review.totals["accepted"]} are published.')
        print('   Nothing was sealed. Re-run with --accept-rejections to publish the valid remainder.')
        discard(review, 'declined')
        return 2
    print('   confirmation ' + (f'given for rejected set {review.confirmation_token}'
                                if review.requires_confirmation else 'not needed: nothing was rejected'))

    print('\n6. SEAL + VERIFY')
    try:
        run = commit(review, acknowledge_rejections=review.confirmation_token)
    except IngestError as exc:
        print(f'   {exc.code}: {exc}')
        print('   Nothing was sealed.')
        return 1
    m = run.manifest
    print(f'   run        {run.run_id}{"  (identical run already sealed; reused)" if run.reused else ""}')
    print(f'   directory  {run.path}')
    print(f'   manifest   sha256 {m["seal"]["manifest_sha256"]}')
    print(f'   chunk set  sha256 {m["integrity"]["chunk_set_sha256"]}   (E3 recomputes this after indexing)')
    print(f'   totals     {m["totals"]["accepted"]} documents, {m["totals"]["pages"]:,} pages, '
          f'{m["totals"]["chunks"]:,} chunks, {m["totals"]["chunk_bytes"]:,} bytes of chunks')
    result = verify(run.path)
    print(f'   verify     {"VERIFIED" if result.ok else "FAILED"}: {sum(c["ok"] for c in result.checks)}/'
          f'{len(result.checks)} checks, {result.stats["files"]} files re-hashed')

    print('\n7. TRACE      one chunk back to its source file, page and offsets')
    first = next((c for c in review.candidates if c.disposition.startswith('accepted')), None)
    doc = next(d for d in m['documents'] if d['document_id'] == first.document_id)
    if args.trace is not None:
        ordinal = args.trace
    else:
        ordinal = next((c['ordinal'] for c in run.iter_chunks(doc['document_id'])
                        if c['page_end'] > c['page_start']), 0)
    try:
        _print_trace(trace(run, doc['document_id'], ordinal))
    except LookupError as exc:
        print(f'   {exc.args[0]} The run is sealed all the same.')
    return 0 if result.ok else 1


if __name__ == '__main__':
    sys.exit(main())
