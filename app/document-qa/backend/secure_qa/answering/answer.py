"""The structured answer and citation payload (SDD §4.2, §5.1, §7.3). Wire schema: `wire/answer.schema.json`.

A citation resolves to exact source text: `chunk_ids` name the indexed chunks,
`char_start`/`char_end` index the document's canonical text stream (E2), each
page entry gives the offsets within that page plus highlight rectangles when
`coordinates_reliable` is true, and `text_checksum_sha256` lets a consumer prove
that `quote` is unchanged. Chunks can span pages, so a citation carries a page
range and per-page spans rather than SDD §5.1's single page number (pending the
SDD update E2 raised).
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field

ANSWER_SCHEMA_VERSION = "1.0.0"

STATUS_ANSWERED = "answered"  # at least one cited document-supported claim
STATUS_INSUFFICIENT = "insufficient_evidence"  # no document-supported section (SDD §7.1)
STATUS_FAILED = "failed"  # retrieval or the model failed; see `error`


@dataclass
class Claim:
    """One sentence under "From your documents", with the citations that support it."""

    text: str
    citation_ids: list[str]


@dataclass
class CitationPage:
    page_number: int  # 1-based
    page_char_start: int  # offsets within this page's own text
    page_char_end: int
    highlight_rects: list[list[float]]  # [[x0, y0, x1, y1], ...] PDF points, top-left origin
    coordinates_reliable: bool  # false: cite the page, don't highlight (SDD §7.3)
    page_width: float
    page_height: float


@dataclass
class Citation:
    citation_id: str  # the label used in claims, e.g. "S1"
    document_id: str
    document_title: str
    source_filename: str | None
    page_start: int
    page_end: int
    pages: list[CitationPage]
    chunk_ids: list[str]  # supporting chunk ids (SDD §5.1 Citation)
    char_start: int  # offsets into the document's canonical text stream
    char_end: int
    text_checksum_sha256: str
    quote: str  # the cited chunk's full text
    evidence_type: str  # "text"; "visual" arrives with SDD §7.2
    score: float  # cosine similarity at retrieval
    rank: int


@dataclass
class Evidence:
    """A passage supplied to the model, whether or not the answer cited it (benchmark evidence ids, SDD §13.2)."""

    citation_id: str
    chunk_id: str
    document_id: str
    page_start: int
    page_end: int
    score: float
    rank: int
    cited: bool


@dataclass
class Notice:
    code: str  # stable, for switching on and for logs
    message: str  # plain language, shown to the user


@dataclass
class ModelVersion:
    model_id: str
    name: str
    quant: str | None
    api_version: str | None
    runtime_version: str | None
    stub: bool


@dataclass
class Timing:
    retrieval_ms: float = 0.0
    generation_ms: float = 0.0
    total_ms: float = 0.0
    attempts: int = 0  # model calls, including the corrective retry
    prompt_tokens: int | None = None
    completion_tokens: int | None = None


@dataclass
class AnswerError:
    code: str
    message: str
    hint: str


@dataclass
class Answer:
    request_id: str
    question: str
    status: str
    evidence_mode: str  # "text" when document claims are cited, else "none"
    documents: list[Claim]  # "From your documents"
    general_knowledge: str | None  # "General model knowledge": uncited, labelled as unverified
    limitations: list[str]  # "Limitations and uncertainty"
    citations: list[Citation]  # every citation id used in `documents`, in id order
    evidence: list[Evidence]
    warnings: list[Notice]
    model: ModelVersion | None
    collection_version: str | None
    prompt_version: str
    timing: Timing = field(default_factory=Timing)
    error: AnswerError | None = None
    schema_version: str = ANSWER_SCHEMA_VERSION

    def to_dict(self) -> dict:
        return asdict(self)

    @property
    def text(self) -> str:
        """Plain-text rendering with inline [S1] markers, for terminals and logs-free demos."""
        out = []
        if self.documents:
            out.append("From your documents:")
            out += [f"  {c.text} " + "".join(f"[{i}]" for i in c.citation_ids) for c in self.documents]
        if self.general_knowledge:
            out += ["General model knowledge (not verified against your documents):", f"  {self.general_knowledge}"]
        if self.limitations:
            out += ["Limitations and uncertainty:"] + [f"  {line}" for line in self.limitations]
        return "\n".join(out)
