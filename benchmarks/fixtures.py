"""Fixture documents and queries for the store benchmark.

Resolution order:
  1. an explicit --fixtures path
  2. the first existing directory in FIXTURE_DIR_CANDIDATES (where E2's fixture
     set is expected to land)
  3. the built-in placeholder chunks below

A fixture directory may contain `*.jsonl` files (one chunk dict per line, see
`Chunk.from_dict`) and/or `*.txt` / `*.md` documents, which are split into
fixed-size character windows. An optional `queries.txt` supplies one query per
line; otherwise the placeholder queries are used.
"""

from __future__ import annotations

import json
import random
from dataclasses import dataclass
from pathlib import Path

from docstore import Chunk

REPO_ROOT = Path(__file__).resolve().parent.parent
FIXTURE_DIR_CANDIDATES = ("fixtures", "test_data", "tests/fixtures", "data/fixtures")
WINDOW_CHARS = 500
WINDOW_OVERLAP = 50


@dataclass
class FixtureSet:
    description: str
    chunks: list[Chunk]
    queries: list[str]


def load_fixture_set(fixtures_path: str | None = None, synthetic_total: int = 0) -> FixtureSet:
    directory = Path(fixtures_path) if fixtures_path else _find_fixture_dir()
    if directory is not None:
        chunks, queries = _load_directory(directory)
        description = f"fixtures from {directory}"
    else:
        chunks, queries = _placeholder_chunks(), list(PLACEHOLDER_QUERIES)
        description = "built-in placeholder chunks (no E2 fixture set found)"

    if synthetic_total > len(chunks):
        extra = synthetic_total - len(chunks)
        chunks += _synthetic_chunks(extra)
        description += f" + {extra} synthetic chunks"
    return FixtureSet(description, chunks, queries)


def _find_fixture_dir() -> Path | None:
    for candidate in FIXTURE_DIR_CANDIDATES:
        path = REPO_ROOT / candidate
        if path.is_dir() and any(path.iterdir()):
            return path
    return None


def _load_directory(directory: Path) -> tuple[list[Chunk], list[str]]:
    if not directory.is_dir():
        raise FileNotFoundError(f"Fixture directory not found: {directory}")
    chunks: list[Chunk] = []
    for path in sorted(directory.rglob("*.jsonl")):
        with path.open(encoding="utf-8") as fh:
            chunks += [Chunk.from_dict(json.loads(line)) for line in fh if line.strip()]
    for path in sorted([*directory.rglob("*.txt"), *directory.rglob("*.md")]):
        if path.name != "queries.txt":
            chunks += _window_chunks(path.read_text(encoding="utf-8"), str(path.relative_to(directory)))
    if not chunks:
        raise ValueError(f"No .jsonl, .txt or .md fixtures found in {directory}")

    queries_file = directory / "queries.txt"
    if queries_file.exists():
        queries = [q.strip() for q in queries_file.read_text(encoding="utf-8").splitlines() if q.strip()]
    else:
        queries = list(PLACEHOLDER_QUERIES)
    return chunks, queries


def _window_chunks(text: str, source: str) -> list[Chunk]:
    chunks = []
    step = WINDOW_CHARS - WINDOW_OVERLAP
    for i, start in enumerate(range(0, max(len(text) - WINDOW_OVERLAP, 1), step)):
        end = min(start + WINDOW_CHARS, len(text))
        if not text[start:end].strip():
            continue
        chunks.append(Chunk(id=f"{source}#{i}", text=text[start:end], source=source, offsets=(start, end)))
    return chunks


# --- placeholder set -------------------------------------------------------------------------

# (source, page, text). Offsets are computed as if each source's chunks were
# concatenated with blank lines between them, so the trace metadata is realistic.
PLACEHOLDER_DOCS: list[tuple[str, int, str]] = [
    ("placeholder/air_gap_deployment_guide.pdf", 1, "The reference machine has no network interfaces enabled. All software, model weights and container images are transferred by write-once optical media after malware scanning on a separate staging host."),
    ("placeholder/air_gap_deployment_guide.pdf", 1, "Minimum hardware for the reference deployment is a four core x86 CPU, 16 GB of RAM and 256 GB of SSD storage. No GPU is assumed, so every model must run acceptably on CPU."),
    ("placeholder/air_gap_deployment_guide.pdf", 2, "Python dependencies are installed from a pre-built wheelhouse mirrored on the staging host. pip must be invoked with --no-index so that no package index is contacted."),
    ("placeholder/air_gap_deployment_guide.pdf", 2, "Container images are exported with docker save on the staging host and imported with docker load on the reference machine. Image digests are verified against the signed manifest."),
    ("placeholder/air_gap_deployment_guide.pdf", 3, "Embedding models are copied as a directory of safetensors weights and tokenizer files. Libraries must be configured for offline mode so they never attempt to reach a model hub."),
    ("placeholder/air_gap_deployment_guide.pdf", 3, "Telemetry and update checks must be disabled in every component, including vector databases, because outbound connection attempts are logged as security events."),
    ("placeholder/access_control_policy.pdf", 1, "Access to the assistant is granted per project. A user may only retrieve documents from collections that belong to projects listed in their active clearance record."),
    ("placeholder/access_control_policy.pdf", 1, "Authentication uses smart cards issued by the site security office. Shared or generic accounts are prohibited on the reference machine."),
    ("placeholder/access_control_policy.pdf", 2, "Every retrieval request is logged with the user identity, query text, returned chunk identifiers and source document checksums, and logs are retained for seven years."),
    ("placeholder/access_control_policy.pdf", 2, "Clearance changes take effect within fifteen minutes. Revoked users must not receive cached answers generated from documents they can no longer access."),
    ("placeholder/access_control_policy.pdf", 3, "Administrators may rebuild indexes but may not read document contents unless separately authorized by the data owner for that project."),
    ("placeholder/export_control_handling.pdf", 1, "Technical data subject to export controls must be marked at the document level and the marking must be carried into every chunk derived from that document."),
    ("placeholder/export_control_handling.pdf", 1, "Foreign nationals may not access export-controlled collections unless a license or exemption has been recorded by the compliance office."),
    ("placeholder/export_control_handling.pdf", 2, "Generated answers that quote export-controlled material inherit the most restrictive marking of any source chunk used to produce them."),
    ("placeholder/export_control_handling.pdf", 2, "Controlled documents may not be printed, copied to removable media or summarized into uncontrolled systems without a documented review."),
    ("placeholder/incident_response_runbook.pdf", 1, "If a user reports that the assistant returned content from a document they should not see, suspend the account and preserve the retrieval logs immediately."),
    ("placeholder/incident_response_runbook.pdf", 1, "A suspected index corruption is handled by taking the service offline, restoring the last verified snapshot and replaying ingestion from the document checksum manifest."),
    ("placeholder/incident_response_runbook.pdf", 2, "Unexpected outbound network activity from the reference machine is a severity one incident. Disconnect power only after capturing volatile memory for forensics."),
    ("placeholder/incident_response_runbook.pdf", 2, "After any incident, verify every stored chunk checksum against the source manifest before returning the system to service."),
    ("placeholder/incident_response_runbook.pdf", 3, "Backups of the vector index are encrypted at rest and stored on a separate air-gapped host in a locked cabinet with two-person access control."),
    ("placeholder/model_evaluation_plan.pdf", 1, "Retrieval quality is evaluated with a fixed question set. For each question, reviewers mark which returned chunks are relevant and recall at five is computed."),
    ("placeholder/model_evaluation_plan.pdf", 1, "Answer faithfulness is scored by checking that every claim in a generated answer is supported by a cited chunk, including its page and character offsets."),
    ("placeholder/model_evaluation_plan.pdf", 2, "Latency targets on the reference machine are under two seconds for retrieval and under thirty seconds for a complete generated answer of three hundred tokens."),
    ("placeholder/model_evaluation_plan.pdf", 2, "Index build time is measured for the full document corpus from an empty store, and memory is recorded at steady state after ingestion completes."),
    ("placeholder/model_evaluation_plan.pdf", 3, "Candidate language models are quantized to four bits and must fit alongside the embedding model and vector store within the sixteen gigabyte memory budget."),
    ("placeholder/model_evaluation_plan.pdf", 3, "Persistence is tested by restarting every service and confirming that search results are identical before and after the restart."),
    ("placeholder/document_ingestion_spec.pdf", 1, "Supported input formats are PDF, DOCX, plain text and Markdown. Scanned PDFs are passed through local OCR before chunking."),
    ("placeholder/document_ingestion_spec.pdf", 1, "Documents are split into chunks of roughly five hundred characters with fifty characters of overlap, keeping page numbers and character offsets for citation."),
    ("placeholder/document_ingestion_spec.pdf", 2, "Each chunk stores a SHA-256 checksum of its text so that re-ingestion can skip unchanged content and tampering can be detected."),
    ("placeholder/document_ingestion_spec.pdf", 2, "Deleting a source document must remove all of its chunks from the index within the same maintenance window."),
]

PLACEHOLDER_QUERIES = [
    "What hardware does the offline reference machine need?",
    "How are Python packages installed without internet access?",
    "Who is allowed to read export controlled documents?",
    "What happens when a user sees a document they are not cleared for?",
    "How is retrieval quality measured?",
    "How do we check that the index survives a restart?",
    "What gets logged for each retrieval request?",
    "How are chunk checksums used?",
    "How should telemetry be configured?",
    "How large are document chunks?",
]


def _placeholder_chunks() -> list[Chunk]:
    chunks, cursor = [], {}
    for i, (source, page, text) in enumerate(PLACEHOLDER_DOCS):
        start = cursor.get(source, 0)
        chunks.append(Chunk(id=f"ph-{i:03d}", text=text, source=source, page=page, offsets=(start, start + len(text))))
        cursor[source] = start + len(text) + 2
    return chunks


# --- synthetic padding for scale tests -------------------------------------------------------

_SUBJECTS = ["The site security office", "Each project data owner", "The ingestion service", "An administrator", "The compliance team", "The retrieval service", "A cleared analyst", "The backup operator"]
_ACTIONS = ["must review", "shall record", "may approve", "is required to verify", "must not export", "will archive", "should re-index", "must encrypt"]
_OBJECTS = ["export-controlled drawings", "maintenance logs", "supplier contracts", "test procedures", "personnel records", "incident reports", "firmware release notes", "calibration certificates"]
_CONDITIONS = ["before the quarterly audit", "within five business days", "after every clearance change", "whenever a checksum mismatch is detected", "prior to transfer to the staging host", "during the monthly maintenance window"]


def _synthetic_chunks(n: int, seed: int = 1234) -> list[Chunk]:
    """Deterministic, unique filler chunks for testing index behaviour at larger sizes."""
    rng = random.Random(seed)
    chunks = []
    for i in range(n):
        sentences = [
            f"{rng.choice(_SUBJECTS)} {rng.choice(_ACTIONS)} {rng.choice(_OBJECTS)} {rng.choice(_CONDITIONS)}."
            for _ in range(rng.randint(2, 4))
        ]
        text = f"Record {i}. " + " ".join(sentences)
        source = f"synthetic/doc_{i // 50:04d}.pdf"
        chunks.append(Chunk(id=f"syn-{i:06d}", text=text, source=source, page=i % 50 + 1, offsets=(0, len(text))))
    return chunks
