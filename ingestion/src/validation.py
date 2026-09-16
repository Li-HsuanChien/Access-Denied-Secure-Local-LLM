"""
Validation result schema and the ingestion policy, version 1.0.0.

Every check below exists because a fixture in the corpus exercises it, and the
observed/expected pair recorded per check is what makes Week 2's criterion
("unreadable/encrypted/malformed inputs return explicit errors") assertable
rather than a matter of opinion.

The four decisions E2 still owes the team live in IngestionPolicy, not in the
check code. Flipping one is a config change, not a patch, which is the point:
the team can settle them on Friday without touching the parser.
"""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from enum import Enum

SCHEMA_VERSION = '1.0.0'


class Outcome(str, Enum):
    ACCEPTED = 'accepted'
    ACCEPTED_WITH_WARNINGS = 'accepted_with_warnings'
    REJECTED = 'rejected'


class RejectReason(str, Enum):
    """The rejection vocabulary named in SDD 6.1. Do not extend without an SDD change."""
    PASSWORD_PROTECTED = 'password_protected'
    CORRUPT = 'corrupt'
    SCANNED_ONLY = 'scanned_only'
    OVERSIZED = 'oversized'
    NON_PDF = 'non_pdf'


class CheckStatus(str, Enum):
    PASS = 'pass'
    WARN = 'warn'
    FAIL = 'fail'
    SKIPPED = 'skipped'


@dataclass
class Check:
    """
    One validation check. observed and expected are recorded even on pass, so a
    regression diff shows what moved rather than only that something broke.
    """
    check_id: str
    status: CheckStatus
    message: str
    observed: object = None
    expected: object = None
    reject_reason: RejectReason | None = None

    def to_dict(self) -> dict:
        d = asdict(self)
        d['status'] = self.status.value
        d['reject_reason'] = self.reject_reason.value if self.reject_reason else None
        return d


@dataclass
class IngestionPolicy:
    """
    The four open decisions from the fixture corpus, as configuration.

    Defaults below are the recommendations from README.md. They are proposals
    awaiting team sign-off, not settled rules; each one is here so it gets
    decided deliberately instead of by whatever the parser happened to do.
    """

    # Decision 1: a PDF whose structure was damaged but which the parser rebuilt.
    # 'accept_with_warning' keeps a document the parser read perfectly; 'reject'
    # treats any repair as corruption. Independent of the text-yield floor below,
    # which is what actually catches the dangerous truncation case.
    repaired_document: str = 'accept_with_warning'      # accept_with_warning | reject

    # Decision 2: a PDF whose permission bits forbid text extraction, which the
    # parser can extract from anyway. 'reject' honors the document's stated
    # restriction; 'accept_with_warning' honors the parser's capability.
    extraction_restricted: str = 'reject'               # reject | accept_with_warning | ignore

    # Decision 3: how much of a document must carry extractable text. Below the
    # reject floor the document is scanned-only; between the floor and the warn
    # threshold it is partially scanned and the empty pages are named in the
    # import report so QA can tell a parser bug from a scan.
    min_pages_with_text_ratio_reject: float = 0.10
    min_pages_with_text_ratio_warn: float = 0.95

    # A repaired document that also lost most of its text is the truncation case.
    # This is the check that a page-count comparison misses entirely.
    min_chars_per_page_when_repaired: int = 200

    # Decision 4: the size cap, currently a placeholder. 2,000 pages sits above
    # the PRD's 5,000-page initial collection spread across many documents and
    # below the 10,000-page stress corpus.
    max_pages: int = 2000
    max_bytes: int = 200 * 1024 * 1024

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class ValidationResult:
    """What validate() returns for exactly one candidate file."""
    schema_version: str
    validated_at: str
    validator_version: str
    extractor: str
    source_path: str
    source_filename: str
    byte_size: int
    checksum_sha256: str
    outcome: Outcome
    reject_reason: RejectReason | None
    reject_detail: str | None
    checks: list[Check] = field(default_factory=list)
    warnings: list[dict] = field(default_factory=list)
    document: dict | None = None          # populated only when not rejected
    policy: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            'schema_version': self.schema_version,
            'validated_at': self.validated_at,
            'validator_version': self.validator_version,
            'extractor': self.extractor,
            'source_path': self.source_path,
            'source_filename': self.source_filename,
            'byte_size': self.byte_size,
            'checksum_sha256': self.checksum_sha256,
            'outcome': self.outcome.value,
            'reject_reason': self.reject_reason.value if self.reject_reason else None,
            'reject_detail': self.reject_detail,
            'checks': [c.to_dict() for c in self.checks],
            'warnings': self.warnings,
            'document': self.document,
            'policy': self.policy,
        }
