"""Synthetic documents and E2-schema chunks for prototyping without real PDFs.

Chunks are built the way E2's reference chunker builds them: one canonical text
stream per document, overlapping character windows split on word boundaries,
and one PageSpan per page a chunk touches. IDs use E2's formulas:

    document_id = doc_ + sha256(sha256(file bytes))[:24]      (text bytes stand in for the PDF)
    config_id   = cfg_ + sha256(canonical config JSON)[:12]
    chunk_id    = chk_ + sha256(document_id|config_id|start|end)[:24]

There is no PDF layout, so every PageSpan has `highlight_rects=[]` and
`coordinates_reliable=False` (cite the page, don't highlight), and a US Letter page size.
"""

from __future__ import annotations

import hashlib
import json
import random
from collections.abc import Iterator
from dataclasses import asdict, dataclass

from .chunk import Chunk, PageSpan, text_checksum

PAGE_WIDTH, PAGE_HEIGHT = 612.0, 792.0


@dataclass(frozen=True)
class ChunkerConfig:
    """Mirror of E2's ChunkerConfig; smaller windows than E2's 1200/200 default so short pages still span."""

    target_chars: int = 400
    overlap_chars: int = 80
    min_chunk_chars: int = 100
    split_on_word_boundary: bool = True
    chunker_version: str = "synthetic-e3-1.0.0"

    @property
    def config_id(self) -> str:
        canonical = json.dumps(asdict(self), sort_keys=True, separators=(",", ":"))
        return _sid(canonical, prefix="cfg", length=12)


@dataclass
class SyntheticDocument:
    """Stands in for E2's Document record plus its canonical text stream."""

    document_id: str
    source_filename: str
    display_title: str
    text: str  # canonical text stream; chunk offsets index into this
    page_bounds: list[tuple[int, int]]  # (char_start, char_end) of each page in `text`

    @property
    def page_count(self) -> int:
        return len(self.page_bounds)

    @classmethod
    def from_pages(cls, source_filename: str, pages: list[str]) -> SyntheticDocument:
        text, bounds = "", []
        for page in pages:
            start = len(text)
            text += page + "\n"
            bounds.append((start, len(text)))
        title = source_filename.rsplit("/", 1)[-1].removesuffix(".pdf").replace("_", " ").title()
        return cls(
            document_id=_sid(hashlib.sha256(text.encode("utf-8")).hexdigest(), prefix="doc"),
            source_filename=source_filename,
            display_title=title,
            text=text,
            page_bounds=bounds,
        )

    def metadata(self) -> dict:
        return {
            "document_id": self.document_id,
            "source_filename": self.source_filename,
            "display_title": self.display_title,
            "page_count": self.page_count,
        }


def chunk_document(doc: SyntheticDocument, config: ChunkerConfig = ChunkerConfig()) -> list[Chunk]:
    text, n = doc.text, len(doc.text)
    chunks: list[Chunk] = []
    start = _skip_space(text, 0)
    while start < n:
        end = min(start + config.target_chars, n)
        if end < n and config.split_on_word_boundary:
            cut = text.rfind(" ", start + config.target_chars // 2, end)
            end = cut if cut > start else end
        body = text[start:end].rstrip()
        end = start + len(body)
        if body and (len(body) >= config.min_chunk_chars or not chunks):
            chunks.append(_make_chunk(doc, config, len(chunks), start, end))
        if end >= n or not text[end:].strip():
            break
        next_start = max(end - config.overlap_chars, start + 1)
        if config.split_on_word_boundary:
            space = text.find(" ", next_start, end)
            next_start = space + 1 if space != -1 else next_start
        start = _skip_space(text, next_start)
    return chunks


def _make_chunk(doc: SyntheticDocument, config: ChunkerConfig, ordinal: int, start: int, end: int) -> Chunk:
    spans = []
    for page_number, (p_start, p_end) in enumerate(doc.page_bounds, start=1):
        s, e = max(start, p_start), min(end, p_end)
        if s < e:
            spans.append(PageSpan(
                page_number=page_number,
                char_start=s,
                char_end=e,
                page_char_start=s - p_start,
                page_char_end=e - p_start,
                highlight_rects=[],
                coordinates_reliable=False,
                page_width=PAGE_WIDTH,
                page_height=PAGE_HEIGHT,
            ))
    body = doc.text[start:end]
    return Chunk(
        chunk_id=_sid(doc.document_id, config.config_id, start, end, prefix="chk"),
        document_id=doc.document_id,
        ordinal=ordinal,
        text=body,
        text_checksum_sha256=text_checksum(body),
        char_start=start,
        char_end=end,
        page_start=spans[0].page_number,
        page_end=spans[-1].page_number,
        page_spans=spans,
        token_estimate=max(1, len(body) // 4),
        chunker_config_id=config.config_id,
        chunker_version=config.chunker_version,
    )


def synthetic_corpus(min_chunks: int = 0, seed: int = 1234) -> tuple[list[SyntheticDocument], list[Chunk]]:
    """The placeholder documents, padded with template filler documents until there are `min_chunks` chunks."""
    docs = placeholder_documents()
    chunks = [c for d in docs for c in chunk_document(d)]
    filler = filler_documents(seed)
    while len(chunks) < min_chunks:
        doc = next(filler)
        docs.append(doc)
        chunks += chunk_document(doc)
    if len(docs) > len(PLACEHOLDER_PAGES):
        chunks = chunks[:min_chunks]  # trim filler to the exact size; placeholder chunks are never dropped
    return docs, chunks


def _sid(*parts, prefix: str, length: int = 24) -> str:
    joined = "|".join(str(p) for p in parts).encode("utf-8")
    return f"{prefix}_{hashlib.sha256(joined).hexdigest()[:length]}"


def _skip_space(text: str, i: int) -> int:
    while i < len(text) and text[i].isspace():
        i += 1
    return i


# --- placeholder documents ------------------------------------------------------------------

# source filename -> pages. Short, topical pages so a handful of chunks span page breaks.
PLACEHOLDER_PAGES: dict[str, list[str]] = {
    "synthetic/air_gap_deployment_guide.pdf": [
        "The reference machine has no network interfaces enabled. All software, model weights and installers are "
        "transferred by write-once optical media after malware scanning on a separate staging host. "
        "The reference laptop has 8 GB of RAM and integrated graphics only, so every model must run acceptably on CPU.",
        "Python dependencies are installed from a pre-built wheelhouse mirrored on the staging host. pip must be "
        "invoked with --no-index so that no package index is contacted. Release bundles are signed and their "
        "digests are verified against the signed manifest before installation.",
        "Embedding models are copied as a directory of safetensors weights and tokenizer files. Libraries must be "
        "configured for offline mode so they never attempt to reach a model hub. Telemetry and update checks must be "
        "disabled in every component, including the vector database, because outbound connection attempts are logged "
        "as security events.",
    ],
    "synthetic/reactor_coolant_systems.pdf": [
        "A pressurized water reactor keeps its primary coolant at roughly 15.5 MPa so the water does not boil in the "
        "core. Heat passes through the steam generator tubes to a secondary loop, where the water boils and drives the turbine.",
        "The pressurizer maintains primary system pressure using electric heaters and a spray line. If pressure rises "
        "too far, power-operated relief valves open and discharge steam to the pressurizer relief tank.",
        "Reactor coolant pumps circulate water through the core at about 150,000 gallons per minute per loop. "
        "Loss of forced circulation triggers a reactor trip, and decay heat is then removed by natural circulation.",
    ],
    "synthetic/radiation_protection_handbook.pdf": [
        "Occupational dose limits are 50 mSv in any single year and 100 mSv averaged over five consecutive years. "
        "The ALARA principle requires exposures to be kept as low as reasonably achievable below these limits.",
        "Time, distance and shielding are the three basic methods of reducing external dose. Doubling the distance "
        "from a point source reduces the dose rate to one quarter, following the inverse square law.",
        "Personal dosimeters are read monthly. A reading above the investigation level of 5 mSv in a month requires "
        "a written review by the radiation protection officer before the worker returns to controlled areas.",
    ],
    "synthetic/safeguards_inspection_procedures.pdf": [
        "Safeguards inspectors verify that declared nuclear material has not been diverted. Material balance areas "
        "are defined so that every transfer of material in or out can be measured and recorded.",
        "Containment and surveillance measures, such as tamper-indicating seals and unattended cameras, maintain "
        "continuity of knowledge between inspections. A broken seal must be reported within 24 hours.",
        "Short-notice random inspections may be announced as little as two hours before inspectors arrive at the "
        "facility. Operators must provide access to records and the locations listed in the design information.",
    ],
    "synthetic/document_ingestion_spec.pdf": [
        "Only PDF files are accepted. Password-protected, corrupt, scanned-only, oversized and non-PDF files are "
        "rejected during candidate review, and the reason is shown to the analyst before publication.",
        "Documents are split into overlapping character windows. Each chunk records its document ID, order, page "
        "span and character offsets so that every citation can be traced back to the page it came from.",
        "Each chunk stores a SHA-256 checksum of its text so that corruption in transit or storage can be detected "
        "at index time. A chunk ID is derived from the document ID, the chunking configuration and the chunk's offsets.",
    ],
}

PLACEHOLDER_QUERIES = [
    "How much RAM does the offline reference laptop have?",
    "How are Python packages installed without internet access?",
    "What pressure is the primary coolant kept at?",
    "What happens when reactor coolant pumps stop?",
    "What is the annual occupational dose limit?",
    "How does distance reduce radiation exposure?",
    "How soon must a broken safeguards seal be reported?",
    "How much warning is given before a random inspection?",
    "How are chunk checksums used?",
    "Which files are rejected during import?",
]


def placeholder_documents() -> list[SyntheticDocument]:
    return [SyntheticDocument.from_pages(name, pages) for name, pages in PLACEHOLDER_PAGES.items()]


# --- template filler for scale tests --------------------------------------------------------

_SUBJECTS = ["The shift supervisor", "Each licensee", "The inspection team", "An operator", "The safety committee", "The maintenance crew", "A qualified technician", "The records office"]
_ACTIONS = ["must review", "shall record", "may approve", "is required to verify", "must not remove", "will archive", "should recalibrate", "must inspect"]
_OBJECTS = ["valve line-ups", "maintenance logs", "fuel transfer records", "test procedures", "dosimetry reports", "incident reports", "instrument setpoints", "calibration certificates"]
_CONDITIONS = ["before the quarterly audit", "within five business days", "after every refuelling outage", "whenever a seal anomaly is detected", "prior to restart", "during the monthly surveillance window"]


def filler_documents(seed: int = 1234, pages_per_doc: int = 10) -> Iterator[SyntheticDocument]:
    """Endless deterministic template documents. They form a near-duplicate cluster, a known HNSW worst case."""
    rng = random.Random(seed)
    doc_no = 0
    while True:
        pages = [
            f"Record {doc_no}-{p}. "
            + " ".join(f"{rng.choice(_SUBJECTS)} {rng.choice(_ACTIONS)} {rng.choice(_OBJECTS)} {rng.choice(_CONDITIONS)}." for _ in range(rng.randint(3, 6)))
            for p in range(pages_per_doc)
        ]
        yield SyntheticDocument.from_pages(f"synthetic/filler_{doc_no:05d}.pdf", pages)
        doc_no += 1
