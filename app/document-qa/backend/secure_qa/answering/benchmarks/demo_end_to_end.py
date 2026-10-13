"""Week 4 demo: ingest/index -> ask -> retrieve -> answer -> citation -> rollback/republish, on E2's real PDFs.

    python -m secure_qa.answering.benchmarks.demo_end_to_end                          # deterministic test model
    python -m secure_qa.answering.benchmarks.demo_end_to_end --runtime http://127.0.0.1:8080   # E1's runtime
    python -m secure_qa.answering.benchmarks.demo_end_to_end --evidence docs/evidence/e3-demo.json

Steps, each checked (exit status is non-zero if any check fails):

1. Review the document folder: accepted files and rejected ones with reasons. Publish the valid
   remainder as v0001 (the rejects need explicit confirmation, SDD §6.1). Re-read the stored version and
   compare counts and checksums with its manifest.
2. Ask a question. Show what retrieval returned (document, pages, chunk, score), the answer, and that
   every citation resolves to the exact characters of the source text.
3. Publish v0002 with one more document. Ask a question only the new document answers.
4. Roll back to v0001: the same question now has no evidence, a v0001 question still answers, and
   v0001's integrity still checks out.
5. Republish: v0003 holds the same chunk ids as v0002, so the citation saved at step 3 still resolves.

Run from `app/document-qa/backend`. The collection lives under `.bench_data/demo_store` and is rebuilt each run.
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
import time  # noqa: E402
from datetime import datetime, timezone  # noqa: E402
from pathlib import Path  # noqa: E402

from ...library.corpus import SourceText, ingest_corpus  # noqa: E402
from ...paths import DATA_DIR, REPO_ROOT  # noqa: E402
from .golden import resolve_citation  # noqa: E402

FIXTURES = REPO_ROOT / "ingestion" / "fixtures"
V1_FILES = [  # the approved documents, plus files a reviewer must see rejected
    FIXTURES / "normal" / "normal_nrc_reactor_concepts_ch01.pdf",
    FIXTURES / "large" / "large_doe_nuclear_physics_v1.pdf",
    FIXTURES / "adversarial" / "adversarial_prompt_injection.pdf",
    FIXTURES / "corrupt" / "corrupt_empty.pdf",
    FIXTURES / "protected" / "protected_user_password.pdf",
    FIXTURES / "scanned" / "scanned_no_text_layer.pdf",
    FIXTURES / "nonpdf" / "nonpdf_plaintext_renamed.pdf",
]
NEW_DOCUMENT = FIXTURES / "layout" / "layout_arxiv_two_column_2112.11583.pdf"
OLD_QUESTION = "How long are the fuel rods in a reactor fuel assembly?"
NEW_QUESTION = "How many students were in the class?"  # only the arXiv course paper answers this


class Demo:
    def __init__(self, args) -> None:
        from ...library import CollectionVersions, Embedder
        from ...library.publication import Publisher
        from .. import AnswerService, FakeModelRuntime, LlamaCppGatewayRuntime

        self.root = args.store
        shutil.rmtree(self.root, ignore_errors=True)
        self.staging = self.root / "staging"
        self.staging.mkdir(parents=True)
        runtime = FakeModelRuntime() if args.runtime == "fake" else LlamaCppGatewayRuntime(args.runtime)
        print("Loading the embedding model (offline) ...", flush=True)
        self.versions = CollectionVersions(Embedder(), self.root / "collections")
        self.publisher = Publisher(self.versions)
        self.service = AnswerService(runtime, on_event=lambda e: None)
        self.checks: list[tuple[str, bool]] = []
        self.evidence: dict = {"steps": []}
        self.sources: dict[str, SourceText] = {}

    # --- helpers -----------------------------------------------------------------------

    def stage(self, files: list[Path]) -> list[Path]:
        """Copy files into staging (SDD §6.1), so the original folder is never read during a publication."""
        out = []
        for f in files:
            shutil.copy(f, self.staging / f.name)
            out.append(self.staging / f.name)
        return out

    def check(self, name: str, ok: bool, detail: str = "") -> bool:
        self.checks.append((name, ok))
        print(f"    [{'ok' if ok else 'FAIL'}] {name}{(' - ' + detail) if detail else ''}")
        return ok

    def heading(self, text: str) -> None:
        print(f"\n== {text}")

    def publish(self, files: list[Path], confirm: bool = False):
        t = time.perf_counter()
        staged = self.stage(files)
        outcome = self.publisher.publish(staged, confirm_rejects=confirm)
        return outcome, round(time.perf_counter() - t, 2)

    def show_review(self, review) -> None:
        print(f"    {'file':44} {'result':24} {'pages':>5} {'chunks':>6}  reason")
        for f in review.files:
            print(f"    {f.filename:44} {f.outcome:24} {f.pages:5} {f.chunks:6}  {f.reject_reason or ''}")
        s = review.summary()
        print(f"    {s['accepted']} accepted ({s['accepted_with_warnings']} with warnings), {s['rejected']} rejected · "
              f"{s['pages']} pages · {s['chunks']} chunks · manifest {s['manifest_sha256'][:16]}...")

    def sources_for(self, files: list[Path]) -> None:
        """Text streams for resolving citations exactly (the same extraction publication used)."""
        review = ingest_corpus(files, keep_text=True)
        self.sources.update(review.sources)

    def ask(self, question: str, label: str) -> dict:
        from ...library import trace_search

        store = self.versions.open_active()
        trace = trace_search(store, question, top_k=self.service.settings.top_k, min_score=self.service.settings.min_score)
        answer = self.service.answer(question, store)
        print(f"\n  Q ({label}, collection {answer.collection_version}): {question}")
        print("    retrieval:")
        for h in trace.hits[:5]:
            print(f"      #{h.rank} {h.score:.3f} {'kept   ' if h.kept else 'dropped'} {h.source_filename[:36]:36} "
                  f"pp.{h.page_start}-{h.page_end} {h.chunk_id}")
        print(f"    answer ({answer.status}, {answer.timing.total_ms:.0f} ms, model {answer.model.model_id if answer.model else '-'}):")
        print(textwrap.indent(textwrap.fill(answer.text or "(no answer text)", 96), "      "))
        problems = [p for c in answer.citations for p in resolve_citation(c, self.sources, store)]
        for c in answer.citations:
            pages = ", ".join(f"p.{p.page_number} [{p.page_char_start}:{p.page_char_end}]" for p in c.pages)
            print(f"    citation {c.citation_id}: {c.source_filename} {pages} chunk {', '.join(c.chunk_ids)}")
        return {"question": question, "collection_version": answer.collection_version, "status": answer.status,
                "trace": trace.event(), "citations": [c.__dict__ | {"pages": [p.__dict__ for p in c.pages]} for c in answer.citations],
                "citation_problems": problems, "answer_text": answer.text, "timing_ms": answer.timing.total_ms,
                "model": answer.model.model_id if answer.model else None, "stub_model": bool(answer.model and answer.model.stub),
                "warnings": [w.code for w in answer.warnings], "_answer": answer}

    # --- the steps ---------------------------------------------------------------------

    def run(self) -> bool:
        self.heading("1. Ingest and index: review the folder, publish the valid remainder")
        self.sources_for([f for f in V1_FILES + [NEW_DOCUMENT] if f.name not in {"corrupt_empty.pdf", "protected_user_password.pdf",
                                                                                "scanned_no_text_layer.pdf", "nonpdf_plaintext_renamed.pdf"}])
        outcome, secs = self.publish(V1_FILES)
        self.show_review(outcome.review)
        self.check("rejected files need explicit confirmation before anything is published",
                   outcome.status == "needs_confirmation" and self.versions.active() is None, outcome.message)
        outcome, secs = self.publish(V1_FILES, confirm=True)
        v1 = outcome.version
        self.check("the valid remainder publishes as v0001", outcome.published and v1.version_id == "v0001",
                   f"{v1.chunk_count} chunks, {len(v1.documents)} documents, {secs}s")
        self.check("every rejected file has a stated reason", all(f.reject_reason and f.reject_detail for f in outcome.review.rejected),
                   ", ".join(sorted({f.reject_reason for f in outcome.review.rejected})))
        self.check("stored counts and checksums match the manifest", outcome.integrity.ok,
                   f"{outcome.integrity.stored_chunks}/{outcome.integrity.expected_chunks} chunks, integrity {v1.integrity_sha256[:16]}...")
        self.evidence["steps"].append({"step": "publish_v1", "summary": outcome.review.summary(), "version": v1.summary(),
                                       "integrity": outcome.integrity.__dict__, "elapsed_s": secs})

        self.heading("2. Ask, retrieve, answer, cite")
        a1 = self.ask(OLD_QUESTION, "NRC document")
        self.check("retrieval maps every result to document, pages and chunk", not a1["trace"]["hits"] == [] and
                   a1["trace"]["kept"] >= 1, f"{a1['trace']['kept']} kept of {a1['trace']['returned']} returned")
        self.check("the answer is grounded, with a citation", a1["status"] == "answered" and bool(a1["citations"]), a1["status"])
        self.check("every citation resolves to the exact source characters", not a1["citation_problems"] and bool(a1["citations"]),
                   "; ".join(a1["citation_problems"]))
        self.evidence["steps"].append({"step": "ask_v1", **_public(a1)})

        self.heading("3. Publish v0002 with one more document")
        new_question_before = self.ask(NEW_QUESTION, "arXiv paper, not in v0001 yet")
        self.check("before publishing, the collection lacks the evidence", new_question_before["status"] != "answered" or not any(
            "arxiv" in (c["source_filename"] or "").lower() or "layout_arxiv" in (c["source_filename"] or "") for c in new_question_before["citations"]),
            new_question_before["status"])
        outcome2, secs2 = self.publish(V1_FILES + [NEW_DOCUMENT], confirm=True)
        v2 = outcome2.version
        self.check("v0002 publishes; v0001 becomes the rollback version",
                   outcome2.published and [v.version_id for v in self.versions.versions()] == ["v0002", "v0001"],
                   f"{v2.chunk_count} chunks, {len(v2.documents)} documents, {secs2}s")
        self.check("v0002 integrity matches its manifest", outcome2.integrity.ok)
        a2 = self.ask(NEW_QUESTION, "arXiv paper")
        cites_new = any(NEW_DOCUMENT.name in (c["source_filename"] or "") for c in a2["citations"])
        self.check("the new document now answers, with a resolving citation", a2["status"] == "answered" and cites_new and not a2["citation_problems"], a2["status"])
        saved = {cid: c["text_checksum_sha256"] for c in a2["citations"] for cid in c["chunk_ids"]}  # a citation kept in conversation history
        self.evidence["steps"].append({"step": "publish_v2_and_ask", "version": v2.summary(), "integrity": outcome2.integrity.__dict__,
                                       "elapsed_s": secs2, "question": _public(a2)})

        self.heading("4. Roll back to v0001")
        rolled = self.publisher.rollback()
        self.check("rollback makes v0001 active and v0002 the rollback version",
                   rolled.version_id == "v0001" and [v.version_id for v in self.versions.versions()] == ["v0001", "v0002"])
        a3 = self.ask(NEW_QUESTION, "arXiv paper, after rollback")
        self.check("the document added in v0002 no longer answers", not any(NEW_DOCUMENT.name in (c["source_filename"] or "") for c in a3["citations"]), a3["status"])
        a4 = self.ask(OLD_QUESTION, "NRC document, after rollback")
        self.check("v0001 evidence still answers with resolving citations", a4["status"] == "answered" and not a4["citation_problems"])
        integ = self.versions.check_integrity()
        self.check("v0001's stored counts and checksums still match", integ.ok and integ.version_id == "v0001")
        self.evidence["steps"].append({"step": "rollback", "active": rolled.version_id, "integrity": integ.__dict__,
                                       "arxiv_question": _public(a3), "nrc_question": _public(a4)})

        self.heading("5. Republish")
        outcome3, secs3 = self.publish(V1_FILES + [NEW_DOCUMENT], confirm=True)
        v3 = outcome3.version
        store3 = self.versions.open(v3)
        stored = store3.collection.get(ids=list(saved), include=["metadatas"])
        same_ids = set(stored["ids"]) == set(saved) and all(m["text_checksum_sha256"] == saved[i] for i, m in zip(stored["ids"], stored["metadatas"]))
        self.check("v0003 publishes and keeps the same manifest content as v0002", outcome3.published and v3.integrity_sha256 == v2.integrity_sha256,
                   f"integrity {v3.integrity_sha256[:16]}...")
        self.check("the citation saved under v0002 still resolves in v0003 (stable chunk ids and checksums)", same_ids)
        a5 = self.ask(NEW_QUESTION, "arXiv paper, after republish")
        self.check("the new document answers again", a5["status"] == "answered" and not a5["citation_problems"])
        self.evidence["steps"].append({"step": "republish", "version": v3.summary(), "integrity": outcome3.integrity.__dict__,
                                       "same_integrity_as_v2": v3.integrity_sha256 == v2.integrity_sha256, "saved_citation_resolves": same_ids,
                                       "question": _public(a5)})

        passed = sum(ok for _, ok in self.checks)
        model = self.service.runtime.info()
        print(f"\n{passed}/{len(self.checks)} checks passed · model {model.model_id}{' (test/stub model)' if model.stub else ''} "
              f"· min_score {self.service.settings.min_score} · embedding {v3.embedding_model}")
        self.evidence |= {"generated": datetime.now(timezone.utc).isoformat(timespec="seconds"), "model": model.model_id,
                          "stub_model": model.stub, "min_score": self.service.settings.min_score, "embedding_model": v3.embedding_model,
                          "checks": [{"name": n, "ok": ok} for n, ok in self.checks], "passed": passed == len(self.checks)}
        self.versions.close()
        return passed == len(self.checks)


def _public(answer: dict) -> dict:
    return {k: v for k, v in answer.items() if not k.startswith("_")}


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--runtime", default="fake", help="'fake' (deterministic test model) or E1's gateway URL, e.g. http://127.0.0.1:8080")
    p.add_argument("--store", type=Path, default=DATA_DIR / "demo_store")
    p.add_argument("--evidence", type=Path, help="write the saved test evidence (versions, counts, checksums, answers, citations) here")
    args = p.parse_args()
    demo = Demo(args)
    ok = demo.run()
    if args.evidence:
        args.evidence.parent.mkdir(parents=True, exist_ok=True)
        args.evidence.write_text(json.dumps(demo.evidence, indent=2, default=str), encoding="utf-8")
        print(f"Evidence written to {args.evidence}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
