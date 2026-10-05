"""Question Answering, text path (SDD §4.2, §7.1, §7.3): question -> retrieve -> assemble -> generate -> validate -> answer.

    service = AnswerService(LlamaCppGatewayRuntime())          # or FakeModelRuntime() in tests
    answer = service.answer("What is the annual dose limit?", versions.open_active())
    answer.to_dict()                                            # the wire payload (wire/answer.schema.json)

`collection` is anything with the Library store's `search`, `document` and
`collection_version` (a `ChromaStore`, or one opened by `CollectionVersions`).
Visual evidence (SDD §7.2) and streaming progress are not in this path yet.
"""

from __future__ import annotations

import logging
import threading
import time
import uuid
from collections.abc import Callable
from dataclasses import asdict, dataclass
from typing import Protocol

from ..library import SearchResult
from . import context as ctx_mod
from .answer import (
    STATUS_ANSWERED,
    STATUS_FAILED,
    STATUS_INSUFFICIENT,
    Answer,
    AnswerError,
    Citation,
    CitationPage,
    Claim,
    Evidence,
    ModelVersion,
    Notice,
    Timing,
)
from .citations import ParsedAnswer, corrective_instruction, parse
from .model_runtime import SUPPORTED_API_VERSIONS, ContextLengthExceeded, ModelInfo, ModelRuntime, ModelRuntimeError

log = logging.getLogger("secure_qa.answering")


@dataclass
class AnswerSettings:
    top_k: int = 5
    # Cosine similarity with all-MiniLM-L6-v2 (not Open WebUI's (1 + cos) / 2 scale). Provisional, from the
    # 2026-10-05 golden-set run: weakest on-topic top-1 0.407, strongest off-topic 0.354. The SDD §7.1
    # benchmark tunes and freezes it for release.
    min_score: float = 0.38
    max_answer_tokens: int = 512
    temperature: float = 0.1
    seed: int = 42
    general_knowledge: bool = True  # SDD §7.3: on by default, user may disable
    corrective_attempts: int = 1  # SDD §7.3: one corrective generation attempt
    max_question_chars: int = 2000


class Retriever(Protocol):
    @property
    def collection_version(self) -> str: ...

    def search(self, query: str, top_k: int = 5, min_score: float | None = None) -> list[SearchResult]: ...

    def document(self, document_id: str) -> dict | None: ...


class AnswerService:
    """Answers one question at a time (SDD §12). A second concurrent call fails fast with `busy`."""

    def __init__(
        self,
        runtime: ModelRuntime,
        settings: AnswerSettings | None = None,
        on_event: Callable[[dict], None] | None = None,
    ) -> None:
        self.runtime = runtime
        self.settings = settings or AnswerSettings()
        self.on_event = on_event or (lambda event: log.info("answer_event %s", event))
        self._busy = threading.Lock()

    def answer(self, question: str, collection: Retriever, *, request_id: str | None = None,
               general_knowledge: bool | None = None) -> Answer:
        run = _Run(self, question, collection, request_id or uuid.uuid4().hex,
                   self.settings.general_knowledge if general_knowledge is None else general_knowledge)
        if not self._busy.acquire(blocking=False):
            return run.fail("busy", "Another question is still being answered", "Wait for the current answer, then ask again.")
        try:
            answer = run.execute()
        finally:
            self._busy.release()
        self.on_event(_event(answer))
        return answer


class _Run:
    """State for answering one question."""

    def __init__(self, service: AnswerService, question: str, collection: Retriever, request_id: str, general: bool) -> None:
        self.s = service.settings
        self.runtime = service.runtime
        self.question = " ".join(question.split())
        self.collection = collection
        self.request_id = request_id
        self.general = general
        self.t0 = time.perf_counter()
        self.timing = Timing()
        self.warnings: list[Notice] = []
        self.model: ModelVersion | None = None
        self.evidence: list[Evidence] = []
        self.version: str | None = None

    def execute(self) -> Answer:
        if not self.question:
            return self.fail("invalid_question", "The question is empty", "Type a question, then ask again.")
        if len(self.question) > self.s.max_question_chars:
            return self.fail("question_too_long", f"The question is longer than {self.s.max_question_chars} characters",
                             "Shorten the question, then ask again.")
        try:
            info = self.runtime.info()  # fail before searching if answering is unavailable (SDD §9)
        except ModelRuntimeError as exc:
            return self.fail(exc.code, exc.message, exc.hint)
        self.model = ModelVersion(info.model_id, info.name, info.quant, info.api_version, info.runtime_version, info.stub)
        if info.stub:
            self.warnings.append(Notice("test_model", "This answer came from a test model, not the answering model."))
        if info.api_version is not None and info.api_version not in SUPPORTED_API_VERSIONS:
            self.warnings.append(Notice("runtime_api_version", f"Model runtime API {info.api_version} is newer than this app expects."))

        try:
            self.version = self.collection.collection_version
            t = time.perf_counter()
            results = self.collection.search(self.question, top_k=self.s.top_k, min_score=self.s.min_score)
            self.timing.retrieval_ms = _ms(t)
        except Exception as exc:  # RetrievalError, or the store couldn't be opened at all
            log.warning("retrieval_failed request=%s error=%s", self.request_id, type(exc.__cause__ or exc).__name__)
            return self.fail("retrieval_failed", "Searching the document collection failed",
                             "Try again. If it keeps failing, restart the app; your collection is unchanged.")

        try:
            if not results:
                return self.insufficient(info)
            return self.grounded(info, results)
        except ModelRuntimeError as exc:
            return self.fail(exc.code, exc.message, exc.hint)
        except ValueError as exc:  # question can't fit the context window
            return self.fail("question_too_long", str(exc), "Shorten the question, then ask again.")

    # --- paths ------------------------------------------------------------------------

    def grounded(self, info: ModelInfo, results: list[SearchResult]) -> Answer:
        n = len(results)
        while True:
            assembled = ctx_mod.assemble(self.question, results[:n], documents=self.collection.document,
                                         ctx_size=info.ctx_size, max_answer_tokens=self.s.max_answer_tokens,
                                         general_knowledge=self.general)
            if not assembled.passages:
                raise ValueError("The question leaves no room for document passages in the model's context window")
            try:
                text = self.generate(assembled.messages)
                break
            except ContextLengthExceeded:
                if len(assembled.passages) <= 1:
                    raise
                n = len(assembled.passages) - 1  # E1: send fewer chunks
        self.evidence = _evidence(assembled.passages, cited=set())  # reported even if generation fails below
        if len(assembled.passages) < len(results):
            self.warnings.append(Notice("context_truncated",
                                        f"{len(results) - len(assembled.passages)} lower-ranked passage(s) didn't fit and weren't used."))

        labels = [p.label for p in assembled.passages]
        parsed = parse(text, set(labels))
        attempts_left = self.s.corrective_attempts
        while parsed.violations and attempts_left:
            attempts_left -= 1
            retry = assembled.messages + [
                {"role": "assistant", "content": text},
                {"role": "user", "content": corrective_instruction(parsed.violations, labels)},
            ]
            text = self.generate(retry)
            parsed = parse(text, set(labels))
        if parsed.violations:
            withheld = len(parsed.claims) - len(parsed.valid_claims)
            self.warnings.append(Notice("citation_validation_failed",
                                        f"{withheld} statement(s) were withheld because their citations couldn't be verified."
                                        if withheld else "Citation labels were removed from general knowledge."))

        claims = [Claim(c.text, c.labels) for c in parsed.valid_claims]
        cited = {label for c in claims for label in c.citation_ids}
        by_label = {p.label: p for p in assembled.passages}
        self.evidence = _evidence(assembled.passages, cited)
        citations = [_citation(by_label[label]) for label in labels if label in cited]
        status = STATUS_ANSWERED if claims else STATUS_INSUFFICIENT
        if not claims:
            self.warnings.append(Notice("insufficient_evidence",
                                        "The documents found don't answer this question, so there is no document-supported answer."))
        return self.build(status, "text" if claims else "none", claims, parsed, citations)

    def insufficient(self, info: ModelInfo) -> Answer:
        """SDD §7.1: nothing meets the relevance threshold. No document section; general knowledge if enabled."""
        self.warnings.append(Notice("insufficient_evidence",
                                    "Your documents don't contain enough relevant evidence to answer this question."))
        parsed = ParsedAnswer()
        if self.general:
            text = self.generate(ctx_mod.general_only_messages(self.question))
            raw = parse(text, set())
            parsed.general = [c.text for c in raw.claims] + raw.general  # nothing here may be presented as document-backed
            parsed.limitations = raw.limitations
        return self.build(STATUS_INSUFFICIENT, "none", [], parsed, [])

    # --- helpers ----------------------------------------------------------------------

    def generate(self, messages: list[dict]) -> str:
        t = time.perf_counter()
        completion = self.runtime.complete(messages, max_tokens=self.s.max_answer_tokens,
                                           temperature=self.s.temperature, seed=self.s.seed)
        self.timing.generation_ms += _ms(t)
        self.timing.attempts += 1
        if completion.prompt_tokens is not None:
            self.timing.prompt_tokens = (self.timing.prompt_tokens or 0) + completion.prompt_tokens
        if completion.completion_tokens is not None:
            self.timing.completion_tokens = (self.timing.completion_tokens or 0) + completion.completion_tokens
        if completion.finish_reason == "length" and "answer_truncated" not in {w.code for w in self.warnings}:
            self.warnings.append(Notice("answer_truncated", "The answer reached its length limit and may be cut short."))
        return completion.text

    def build(self, status: str, mode: str, claims: list[Claim], parsed: ParsedAnswer, citations: list[Citation]) -> Answer:
        self.timing.total_ms = _ms(self.t0)
        general = " ".join(parsed.general).strip() if self.general else ""
        return Answer(
            request_id=self.request_id,
            question=self.question,
            status=status,
            evidence_mode=mode,
            documents=claims,
            general_knowledge=general or None,
            limitations=parsed.limitations,
            citations=citations,
            evidence=self.evidence,
            warnings=self.warnings,
            model=self.model,
            collection_version=self.version,
            prompt_version=ctx_mod.PROMPT_VERSION,
            timing=self.timing,
        )

    def fail(self, code: str, message: str, hint: str) -> Answer:
        answer = self.build(STATUS_FAILED, "none", [], ParsedAnswer(), [])
        answer.error = AnswerError(code, message, hint)
        return answer


def _evidence(passages: list[ctx_mod.Passage], cited: set[str]) -> list[Evidence]:
    return [Evidence(p.label, p.chunk.chunk_id, p.chunk.document_id, p.chunk.page_start, p.chunk.page_end,
                     round(p.result.score, 4), p.result.rank, p.label in cited) for p in passages]


def _citation(p: ctx_mod.Passage) -> Citation:
    c = p.chunk
    return Citation(
        citation_id=p.label,
        document_id=c.document_id,
        document_title=p.document_title,
        source_filename=p.source_filename,
        page_start=c.page_start,
        page_end=c.page_end,
        pages=[CitationPage(s.page_number, s.page_char_start, s.page_char_end, s.highlight_rects,
                            s.coordinates_reliable, s.page_width, s.page_height) for s in c.page_spans],
        chunk_ids=[c.chunk_id],
        char_start=c.char_start,
        char_end=c.char_end,
        text_checksum_sha256=c.text_checksum_sha256,
        quote=c.text,
        evidence_type="text",
        score=round(p.result.score, 4),
        rank=p.result.rank,
    )


def _event(answer: Answer) -> dict:
    """SDD §15 operational event: ids, versions, codes and timings only. Never question, answer or document text."""
    return {
        "event": "answer",
        "request_id": answer.request_id,
        "status": answer.status,
        "error_code": answer.error.code if answer.error else None,
        "warning_codes": [w.code for w in answer.warnings],
        "collection_version": answer.collection_version,
        "model_id": answer.model.model_id if answer.model else None,
        "prompt_version": answer.prompt_version,
        "evidence_chunk_ids": [e.chunk_id for e in answer.evidence],
        "cited_chunk_ids": [cid for c in answer.citations for cid in c.chunk_ids],
        "timing": asdict(answer.timing),
    }


def _ms(t: float) -> float:
    return round((time.perf_counter() - t) * 1000, 1)
