"""Parse a model answer into the three SDD §7.3 parts and check its citations.

Rules checked after generation (SDD §4.2, §7.3):

- `uncited_claim`: a sentence under "From your documents" carries no passage label.
- `unknown_citation`: a label that doesn't name a passage supplied to the model.
- `cited_general_knowledge`: a passage label under "General model knowledge".

This checks that citations point at supplied evidence. It does not judge whether
the passage really supports the sentence; that is measured by the answer-quality
benchmark (SDD §13.2), not enforced at runtime.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

_THINK = re.compile(r"<think>.*?</think>", re.S | re.I)
_MARKER = re.compile(r"\[\s*(S?\d+(?:\s*(?:[,;]|[-–])\s*S?\d+)*)\s*\]", re.I)
_MARKER_RUN = r"(?:\s*\[\s*S?\d+(?:\s*(?:[,;]|[-–])\s*S?\d+)*\s*\])+"
_MARKERS_AFTER_STOP = re.compile(r"([.!?])(" + _MARKER_RUN + r")")
_BULLET = re.compile(r"^\s*(?:[-*•]|\d+[.)])\s+")
_SENTENCE_BREAK = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9\"'(])")
_ABBREVIATIONS = ("e.g.", "i.e.", "etc.", "vs.", "approx.", "pp.", "p.", "no.", "fig.", "sec.", "ch.", "vol.", "dr.", "mr.", "ms.", "st.", "u.s.", "u.k.")

_HEADINGS = (
    ("documents", ("from your documents", "from the documents", "from documents", "document-supported")),
    ("general", ("general model knowledge", "general knowledge")),
    ("limitations", ("limitations and uncertainty", "limitations", "uncertainty")),
)


@dataclass
class ParsedClaim:
    text: str  # the sentence with its labels removed
    labels: list[str]  # passage labels cited, e.g. ["S1", "S3"]
    problem: str | None = None  # violation code, if any


@dataclass
class Violation:
    code: str
    detail: str


@dataclass
class ParsedAnswer:
    claims: list[ParsedClaim] = field(default_factory=list)
    general: list[str] = field(default_factory=list)
    limitations: list[str] = field(default_factory=list)
    violations: list[Violation] = field(default_factory=list)

    @property
    def valid_claims(self) -> list[ParsedClaim]:
        return [c for c in self.claims if c.problem is None]


def parse(text: str, supplied: set[str]) -> ParsedAnswer:
    """Split `text` into sections and claims, and record every citation-rule violation."""
    sections: dict[str, list[str]] = {"documents": [], "general": [], "limitations": []}
    current = "documents"  # text before any heading is treated as document claims, so it must be cited
    for raw in _THINK.sub("", text).splitlines():
        heading, rest = _heading(raw)
        if heading:
            current = heading
            raw = rest
        line = _BULLET.sub("", raw).strip()
        if line:
            sections[current].append(line)

    answer = ParsedAnswer()
    for line in sections["documents"]:
        for sentence in _split_sentences(line):
            labels = _labels(sentence)
            body = _strip_markers(sentence)
            if not re.search(r"[A-Za-z0-9]", body):
                if answer.claims and labels:  # a stray "[S2]" after the full stop belongs to the sentence before
                    answer.claims[-1].labels += [lb for lb in labels if lb not in answer.claims[-1].labels]
                continue
            answer.claims.append(ParsedClaim(body, labels))
    for claim in answer.claims:
        unknown = [lb for lb in claim.labels if lb not in supplied]
        if not claim.labels:
            claim.problem = "uncited_claim"
            answer.violations.append(Violation("uncited_claim", f'No citation: "{_short(claim.text)}"'))
        elif unknown:
            claim.problem = "unknown_citation"
            answer.violations.append(Violation("unknown_citation", f"Cites {', '.join(unknown)}, which was not supplied"))
    for line in sections["general"]:
        if _MARKER.search(line):
            answer.violations.append(Violation("cited_general_knowledge", "General knowledge carries a passage label"))
        answer.general.append(_strip_markers(line))
    answer.limitations = [_strip_markers(line) for line in sections["limitations"]]
    return answer


def corrective_instruction(violations: list[Violation], supplied: list[str]) -> str:
    """The follow-up message for the one corrective generation attempt (SDD §7.3)."""
    problems = "\n".join(f"- {v.detail}" for v in violations[:8])
    return (
        "Your answer broke the citation rules:\n"
        f"{problems}\n\n"
        "Rewrite the whole answer under the same headings. Every sentence under \"From your documents:\" must end "
        f"with one or more of these labels in square brackets: {', '.join(supplied)}. Move anything the passages "
        "don't support to \"General model knowledge:\" without labels, or leave it out."
    )


def _heading(line: str) -> tuple[str | None, str]:
    plain = line.strip().lstrip("#").strip().strip("*_").strip()
    lowered = plain.lower()
    for section, names in _HEADINGS:
        for name in names:
            if lowered.startswith(name):
                rest = plain[len(name):].lstrip("*_ ")
                if not rest or rest[0] == ":":
                    return section, rest[1:].strip("*_ ").strip() if rest else ""
    return None, line


def _split_sentences(line: str) -> list[str]:
    line = _MARKERS_AFTER_STOP.sub(lambda m: f"{m.group(2)}{m.group(1)}", line)  # "x. [S1]" -> "x [S1]."
    parts = _SENTENCE_BREAK.split(line)
    merged: list[str] = []
    for part in parts:
        if merged and _ends_with_abbreviation(merged[-1]):
            merged[-1] += " " + part
        else:
            merged.append(part)
    return merged


def _ends_with_abbreviation(text: str) -> bool:
    last = _strip_markers(text).split()[-1].lower() if _strip_markers(text).split() else ""
    return last in _ABBREVIATIONS or bool(re.fullmatch(r"[a-z]\.", last))


def _labels(text: str) -> list[str]:
    labels: list[str] = []
    for group in _MARKER.findall(text):
        for item in re.split(r"\s*[,;]\s*", group):
            bounds = re.split(r"\s*[-–]\s*", item)
            nums = [int(re.sub(r"(?i)^s", "", b)) for b in bounds]
            for n in range(nums[0], nums[-1] + 1) if len(nums) == 2 and nums[1] - nums[0] < 20 else nums:
                label = f"S{n}"
                if label not in labels:
                    labels.append(label)
    return labels


def _strip_markers(text: str) -> str:
    text = _MARKER.sub("", text)
    text = re.sub(r"\s+([.,;:!?])", r"\1", text)
    return " ".join(text.split())


def _short(text: str, n: int = 80) -> str:
    return text if len(text) <= n else text[: n - 1] + "…"
