# ADR 0005: Per-conversation memory for multi-turn answering

**Status: active; reflected in the [System Design Document](../SDD.md) §4.2, §4.3.**
**Date:** 2026-10-22.

## Context

The MVP answered each question standalone: the host sent only the current question to the
answering workflow, and Conversation History stored one answer snapshot per row, so every
message produced a separate "conversation." Users expect modern chat-room behavior — a thread
with memory of earlier turns — without the cost and context-window blow-up of replaying the
whole transcript to the model on every turn, and without weakening evidence grounding.

## Decision

Give each thread (addressed by a stable `conversation_id`) bounded memory, assembled with a
modern conversational-RAG approach rather than naive full-history replay:

- **Conversation History becomes a thread store.** `conversations` hold thread metadata plus a
  running `summary`; a new `messages` table holds ordered user/assistant turns (assistant turns
  keep the full structured answer). The pre-thread schema migrates on open. Turn-level methods
  (`append_turn`, `recent_turns`, `get_summary`/`set_summary`) back the memory.
- **The answering workflow owns the memory logic.** For a turn with prior context it (1) rewrites
  the follow-up into a standalone retrieval query, and (2) maintains the running summary after
  answering. Both are single short model calls that **degrade to deterministic heuristics** on
  error and are **skipped entirely with no prior context**, so a turn costs at most one extra
  small generation.
- **Memory is context, never evidence.** The summary + a short verbatim window of recent turns
  are supplied to the model as a delimited "context only — do not cite" block, budgeted ahead of
  passages. The system prompt and citation validation are unchanged, so every document-supported
  claim still cites a retrieved passage.
- **The host stays thin.** `answering.ask` gains an optional `conversation_id`; the host loads
  memory from History, calls the answering workflow, then appends the turns and updates the
  summary. Orchestration logic lives in `secure_qa`, not the host route.

## Why this shape

Rewrite + summary + a recent-turn window is the smallest design that makes follow-ups retrieve
and read well while staying inside the one-question/8 GB latency budget (SDD §12). Keeping memory
out of the citable-evidence path preserves the product's core grounding and citation invariants.
Making both model calls optional and heuristic-degradable keeps the feature offline, deterministic
in tests, and safe when the runtime is slow or unavailable. The thread store matches the
Conversation/Message records the SDD data model already named.

## Consequences

- Threads accumulate turns and a summary; disabling persistence disables memory (answers remain
  single-turn). Conversation privacy still rests on OS full-disk encryption (SDD §8).
- A follow-up's retrieval now depends on a model-produced query; the fallback to the raw question
  bounds the blast radius when rewriting is poor.
- Supersedes the one-answer-per-row assumption of the earlier Conversation History design.
