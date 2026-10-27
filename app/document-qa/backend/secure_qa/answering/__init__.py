"""Question Answering (SDD §4.2): a question and a collection version in, a structured cited answer out.

Week 3 scope is the text path: retrieval, context assembly, generation through the
model-runtime seam, and citation validation. Visual evidence (SDD §7.2) comes later.
"""

from .answer import Answer, Citation, CitationPage, Claim, Evidence, Notice
from .model_runtime import (
    ContextLengthExceeded,
    FakeModelRuntime,
    LlamaCppGatewayRuntime,
    ModelInfo,
    ModelRuntime,
    ModelRuntimeError,
)
from .service import AnswerService, AnswerSettings

__all__ = [
    "Answer",
    "AnswerService",
    "AnswerSettings",
    "Citation",
    "CitationPage",
    "Claim",
    "ContextLengthExceeded",
    "Evidence",
    "FakeModelRuntime",
    "LlamaCppGatewayRuntime",
    "ModelInfo",
    "ModelRuntime",
    "ModelRuntimeError",
    "Notice",
]
