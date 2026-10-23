"""Conversation memory for multi-turn answering (SDD §4.2, §4.3, §7.3).

Modern conversational-RAG, not naive full-history replay:

* a running `summary` of older turns plus a short verbatim window of recent
  turns give the model memory within a token budget, and
* a follow-up question is rewritten into a standalone retrieval query so that
  "and for workers?" still searches the collection well.

Both the rewrite and the summary update are single short model calls that
degrade gracefully to deterministic heuristics (and are skipped entirely when
there is no prior context), so a thread never costs more than one extra small
generation per turn and stays inside the one-question/8 GB budget (SDD §12).

The conversation block is context, never citable evidence: the system prompt
and citation validation are unchanged, so every document-supported claim still
cites a retrieved passage (SDD §7.3).
"""

from __future__ import annotations

from dataclasses import dataclass, field

MAX_SUMMARY_CHARS = 1200
RECENT_TURN_CHARS = 600  # per turn, when rendering the verbatim window
CONTEXT_HEADING = "Conversation so far (context only — do not cite):"


@dataclass
class Conversation:
    """The memory handed to the answering service for one turn."""
    conversation_id: str
    summary: str = ""
    recent_turns: list[dict] = field(default_factory=list)  # [{role, content}], oldest first, excludes the current question

    @property
    def has_context(self) -> bool:
        return bool(self.summary.strip()) or any(t.get("content", "").strip() for t in self.recent_turns)


def rewrite_query(runtime, question: str, conversation: Conversation | None, *, max_tokens: int = 64) -> str:
    """Turn a follow-up into a standalone retrieval query using the conversation.

    Returns `question` unchanged when there is no prior context, and falls back
    to it on any model error, so retrieval never breaks because of memory.
    """
    if conversation is None or not conversation.has_context:
        return question
    messages = [
        {"role": "system", "content":
            "You rewrite a follow-up question into a standalone search query using the conversation so far. "
            "Output only the query on one line, with no explanation. If the question is already standalone, output it unchanged."},
        {"role": "user", "content":
            f"{_render_history(conversation)}\n\nFollow-up question: {_one_line(question)}\n\nStandalone search query:"},
    ]
    try:
        text = runtime.complete(messages, max_tokens=max_tokens, temperature=0.0, seed=42).text
    except Exception:
        return question
    rewritten = _one_line(text.splitlines()[0] if text else "")
    return rewritten[:500] or question


def update_summary(runtime, old_summary: str, question: str, answer: dict | None, *, max_tokens: int = 160) -> str:
    """Fold the latest exchange into the running summary (heuristic on model error)."""
    headline = _answer_headline(answer)
    messages = [
        {"role": "system", "content":
            "You maintain a brief running summary of a conversation between an analyst and their document assistant. "
            "Keep it under about 100 words, factual, and do not include citations or passage labels."},
        {"role": "user", "content":
            f"Current summary:\n{old_summary or '(none)'}\n\nNew exchange:\nQ: {_one_line(question)}\nA: {headline}\n\nUpdated summary:"},
    ]
    try:
        text = runtime.complete(messages, max_tokens=max_tokens, temperature=0.0, seed=42).text
        summary = " ".join(text.split()).strip()
        if summary:
            return summary[:MAX_SUMMARY_CHARS]
    except Exception:
        pass
    return _heuristic_summary(old_summary, question, headline)


def context_block(conversation: Conversation | None) -> str | None:
    """The delimited memory block for the prompt, or None when there's nothing to add."""
    if conversation is None or not conversation.has_context:
        return None
    return f"{CONTEXT_HEADING}\n{_render_history(conversation)}"


# --- helpers ----------------------------------------------------------------------------

def _render_history(conversation: Conversation) -> str:
    parts: list[str] = []
    if conversation.summary.strip():
        parts.append(f"Summary: {_one_line(conversation.summary)[:MAX_SUMMARY_CHARS]}")
    for turn in conversation.recent_turns:
        content = _one_line(turn.get("content", ""))
        if not content:
            continue
        who = "User" if turn.get("role") == "user" else "Assistant"
        parts.append(f"{who}: {content[:RECENT_TURN_CHARS]}")
    return "\n".join(parts)


def _answer_headline(answer: dict | None) -> str:
    if not isinstance(answer, dict):
        return "(no answer)"
    docs = answer.get("documents") or []
    texts = [d.get("text", "") for d in docs if isinstance(d, dict)]
    joined = " ".join(t for t in texts if t).strip()
    if joined:
        return _one_line(joined)[:600]
    if answer.get("general_knowledge"):
        return _one_line(answer["general_knowledge"])[:600]
    return f"(status: {answer.get('status', 'unknown')})"


def _heuristic_summary(old_summary: str, question: str, headline: str) -> str:
    line = f"Q: {_one_line(question)[:120]} -> {headline[:160]}"
    combined = f"{old_summary}\n{line}" if old_summary else line
    return combined[-MAX_SUMMARY_CHARS:]


def _one_line(text: str) -> str:
    return " ".join((text or "").split())
