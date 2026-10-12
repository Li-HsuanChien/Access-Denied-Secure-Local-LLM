"""Golden queries: the week 3 controlled retrieval-to-answer check.

Publishes the golden collection (synthetic placeholder corpus + E2's NRC chunks)
as a real collection version, asks every golden question, and checks that:

- the expected evidence chunk is retrieved (and its rank),
- the answer has the expected status and facts,
- every citation resolves to the exact source text: the document's canonical
  text stream sliced at the citation's offsets equals the quote, the checksum
  matches, and each page entry's offsets land on that page.

    python -m secure_qa.answering.benchmarks.golden                       # deterministic test model
    python -m secure_qa.answering.benchmarks.golden --show g01            # the demo query, in full
    python -m secure_qa.answering.benchmarks.golden --runtime http://127.0.0.1:8080   # E1's runtime
    python -m secure_qa.answering.benchmarks.golden --json out.json

Run from `app/document-qa/backend`. Exit status is non-zero if any check fails.
"""

from __future__ import annotations

import os

os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
os.environ.setdefault("ANONYMIZED_TELEMETRY", "False")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

import argparse  # noqa: E402
import json  # noqa: E402
import shutil  # noqa: E402
import sys  # noqa: E402
import textwrap  # noqa: E402
from dataclasses import dataclass  # noqa: E402
from pathlib import Path  # noqa: E402

from ...library import Chunk  # noqa: E402
from ...library.chunk import text_checksum  # noqa: E402
from ...library.synthetic import synthetic_corpus  # noqa: E402
from ...paths import DATA_DIR  # noqa: E402
from ..answer import Answer, Citation  # noqa: E402

HERE = Path(__file__).resolve().parent
GOLDEN_PATH = HERE / "golden_queries.json"
E2_DIR = HERE.parent.parent / "library" / "tests" / "fixtures" / "e2"


@dataclass
class SourceText:
    """A document's canonical text stream and page boundaries, for resolving citations exactly."""

    text: str
    page_bounds: list[tuple[int, int]]  # (char_start, char_end) per page, 1-based page n at index n-1


def load_golden() -> list[dict]:
    return json.loads(GOLDEN_PATH.read_text(encoding="utf-8"))["queries"]


def golden_collection() -> tuple[list[Chunk], list[dict], dict[str, SourceText]]:
    """Chunks, document records and source text streams for the golden collection."""
    docs, chunks = synthetic_corpus()
    records = [d.metadata() for d in docs]
    sources = {d.document_id: SourceText(d.text, d.page_bounds) for d in docs}

    nrc_chunks = [Chunk.from_dict(c) for c in json.loads((E2_DIR / "nrc_all_chunks.json").read_text(encoding="utf-8"))["chunks"]]
    nrc_doc = json.loads((E2_DIR / "nrc_document.json").read_text(encoding="utf-8"))
    offsets = json.loads((E2_DIR / "nrc_offsets.json").read_text(encoding="utf-8"))
    with open(E2_DIR / "nrc_text.txt", encoding="utf-8", newline="") as f:
        nrc_text = f.read()
    sources[nrc_doc["document_id"]] = SourceText(nrc_text, [(p["char_start"], p["char_end"]) for p in offsets["pages"]])
    return chunks + nrc_chunks, records + [nrc_doc], sources


def expected_chunk_ids(record: dict, chunks: list[Chunk], documents: list[dict]) -> set[str]:
    ev = record["evidence"]
    doc_ids = {d["document_id"] for d in documents if d["source_filename"] == ev["source_filename"]}
    return {
        c.chunk_id for c in chunks
        if c.document_id in doc_ids and c.page_start <= ev["page"] <= c.page_end and ev["contains"] in " ".join(c.text.split())
    }


def resolve_citation(citation: Citation, sources: dict[str, SourceText], store) -> list[str]:
    """Problems that stop `citation` resolving to its exact source text; empty when it resolves."""
    problems = []
    src = sources.get(citation.document_id)
    if src is None:
        return [f"{citation.citation_id}: unknown document {citation.document_id}"]
    if src.text[citation.char_start:citation.char_end] != citation.quote:
        problems.append(f"{citation.citation_id}: text stream [{citation.char_start}:{citation.char_end}] != quote")
    if text_checksum(citation.quote) != citation.text_checksum_sha256:
        problems.append(f"{citation.citation_id}: quote fails its checksum")
    pages = [p.page_number for p in citation.pages]
    if pages != list(range(citation.page_start, citation.page_end + 1)):
        problems.append(f"{citation.citation_id}: pages {pages} don't match range {citation.page_start}-{citation.page_end}")
    covered = ""
    for p in citation.pages:
        start, end = src.page_bounds[p.page_number - 1]
        page_text = src.text[start:end]
        if not (0 <= p.page_char_start < p.page_char_end <= len(page_text)):
            problems.append(f"{citation.citation_id}: page {p.page_number} offsets outside the page")
        covered += page_text[p.page_char_start:p.page_char_end]
    if covered != citation.quote:
        problems.append(f"{citation.citation_id}: per-page spans don't reassemble the quote")
    for chunk_id in citation.chunk_ids:
        stored = store.collection.get(ids=[chunk_id], include=["metadatas"])
        if not stored["ids"] or stored["metadatas"][0]["text_checksum_sha256"] != citation.text_checksum_sha256:
            problems.append(f"{citation.citation_id}: chunk {chunk_id} not in collection {store.collection_version} as cited")
    return problems


def evaluate(record: dict, answer: Answer, expected_ids: set[str], sources, store) -> dict:
    """Score one golden record. `passed` is the acceptance verdict."""
    retrieved = [e.chunk_id for e in answer.evidence]
    rank = next((i + 1 for i, cid in enumerate(retrieved) if cid in expected_ids), None)
    problems = [p for c in answer.citations for p in resolve_citation(c, sources, store)]
    checks = {"status": answer.status == {"answer": "answered"}.get(record["expect"], record["expect"])}
    quality = {}
    if record["expect"] == "answer":
        claims_text = " ".join(c.text for c in answer.documents)
        cited = {cid for c in answer.citations for cid in c.chunk_ids}
        checks |= {
            "evidence_retrieved": rank is not None,
            "cites_expected_evidence": bool(cited & expected_ids),
            "citations_resolve": bool(answer.citations) and not problems,
        }
        # Answer wording depends on the model, so facts are a quality measure, not a week 3 acceptance gate.
        quality["answer_has_facts"] = all(f.lower() in claims_text.lower() for f in record.get("answer_facts", []))
    else:
        checks |= {"no_document_claims": not answer.documents and not answer.citations}
    return {
        "id": record["id"],
        "question": record["question"],
        "expect": record["expect"],
        "status": answer.status,
        "expected_rank": rank,
        "top_score": answer.evidence[0].score if answer.evidence else None,
        "citations": [{"id": c.citation_id, "document": c.source_filename, "pages": [c.page_start, c.page_end],
                       "chunk_ids": c.chunk_ids} for c in answer.citations],
        "problems": problems,
        "warnings": [w.code for w in answer.warnings],
        "checks": checks,
        "quality": quality,
        "passed": all(checks.values()),
        "timing_ms": answer.timing.total_ms,
    }


def build_store(embedder, root: Path):
    """Publish the golden collection as a fresh version and open it for questions."""
    from ...library import CollectionVersions

    shutil.rmtree(root, ignore_errors=True)
    chunks, documents, sources = golden_collection()
    versions = CollectionVersions(embedder, root)
    version = versions.publish(chunks, documents)
    return versions, versions.open_active(), version, chunks, documents, sources


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--runtime", default="fake", help="'fake' (deterministic test model) or E1's gateway URL, e.g. http://127.0.0.1:8080")
    p.add_argument("--store", type=Path, default=DATA_DIR / "golden_store")
    p.add_argument("--show", metavar="ID", help="print one query's full answer and citation payload (g01 is the demo query)")
    p.add_argument("--json", type=Path, help="write the results to this file")
    args = p.parse_args()

    from ...library import Embedder
    from .. import AnswerService, FakeModelRuntime, LlamaCppGatewayRuntime

    runtime = FakeModelRuntime() if args.runtime == "fake" else LlamaCppGatewayRuntime(args.runtime)
    print("Loading embedding model (offline) and publishing the golden collection ...", flush=True)
    versions, store, version, chunks, documents, sources = build_store(Embedder(), args.store)
    print(f"Published {version.version_id}: {version.chunk_count} chunks from {len(version.documents)} documents "
          f"(integrity {version.integrity_sha256[:12]}...)\n")
    service = AnswerService(runtime, on_event=lambda e: None)

    records = load_golden()
    if args.show:
        records = [r for r in records if r["id"] == args.show]
    results = []
    for record in records:
        answer = service.answer(record["question"], store, request_id=record["id"])
        expected = expected_chunk_ids(record, chunks, documents) if record["expect"] == "answer" else set()
        result = evaluate(record, answer, expected, sources, store)
        results.append(result)
        if args.show:
            show(answer, result)

    print(f"{'id':4} {'pass':4} {'status':22} {'rank':>4} {'top':>6}  citations")
    for r in results:
        cites = ", ".join(f"{c['id']} {Path(c['document']).name} pp.{c['pages'][0]}-{c['pages'][1]}" for c in r["citations"]) or "-"
        top = f"{r['top_score']:.3f}" if r["top_score"] is not None else "-"
        print(f"{r['id']:4} {'ok' if r['passed'] else 'FAIL':4} {r['status']:22} {r['expected_rank'] or '-':>4} {top:>6}  {cites}")
        for name, ok in r["checks"].items():
            if not ok:
                print(f"       failed: {name} {r['problems'] or ''}")
        for name, ok in r["quality"].items():
            if not ok:
                print(f"       quality: answer is missing an expected fact {load_fact(r['id'])}")
    passed = sum(r["passed"] for r in results)
    with_facts = [r for r in results if "answer_has_facts" in r["quality"]]
    model = service.runtime.info()
    print(f"\n{passed}/{len(results)} golden queries passed acceptance · answer facts present "
          f"{sum(r['quality']['answer_has_facts'] for r in with_facts)}/{len(with_facts)} "
          f"· model {model.model_id}{' (test/stub)' if model.stub else ''} "
          f"· collection {version.version_id} · min_score {service.settings.min_score}")
    if args.json:
        args.json.write_text(json.dumps({"collection_version": version.version_id, "model": model.model_id,
                                         "min_score": service.settings.min_score, "results": results}, indent=2))
    versions.close()
    return 0 if passed == len(results) else 1


def load_fact(query_id: str) -> list[str]:
    return next(r.get("answer_facts", []) for r in load_golden() if r["id"] == query_id)


def show(answer: Answer, result: dict) -> None:
    print(f"Q: {answer.question}\n")
    print(textwrap.indent(answer.text or "(no answer text)", "  "))
    print(f"\n  status {answer.status} · evidence mode {answer.evidence_mode} · collection {answer.collection_version} "
          f"· model {answer.model.model_id if answer.model else '-'} · {answer.timing.total_ms:.0f} ms")
    for w in answer.warnings:
        print(f"  warning {w.code}: {w.message}")
    print("\n  Retrieved evidence (supplied to the model):")
    for e in answer.evidence:
        print(f"    {e.citation_id}  score {e.score:.3f}  rank {e.rank}  {e.chunk_id}  pp.{e.page_start}-{e.page_end}"
              f"{'  <- cited' if e.cited else ''}")
    print("\n  Citation payload:")
    print(textwrap.indent(json.dumps([c.__dict__ | {"quote": c.quote[:120] + "...", "pages": [p.__dict__ for p in c.pages]}
                                      for c in answer.citations], indent=2), "    "))
    print(f"\n  Citations resolve to exact source text: {'yes' if not result['problems'] else result['problems']}\n")


if __name__ == "__main__":
    sys.exit(main())
