# ADR 0003: Give the research workspace a restrained, evidence-led visual voice

**Status: active; reflected in the [System Design Document](../SDD.md).**
**Date:** 2026-10-12.

## Context

The product is a private document research tool, not a general-purpose assistant. Its interface must make the source and confidence of information legible while keeping routine work calm and readable. The pinned Open WebUI frontend supplies the reusable chat implementation; product styling must remain local, modular, and compatible with that shell.

## Decision

- Use locally bundled Inter for interface typography, warm paper and ink surfaces, evergreen primary actions, and a compact spacing and radius scale.
- Keep document evidence, general model knowledge, uncertainty, warnings, and errors semantically distinct. Labels and structure carry meaning in addition to color.
- Expose shared design tokens and a small voice/presentation module under `src/lib/features/personality/`. Integrating chat, citations, and app-shell modules opt in through the tokens and `data-evidence-kind` semantic hook.
- Use concise, direct copy that states evidence limits and a recoverable next step. Do not imply the model verified general knowledge against the library.
- Prefer existing text/icon primitives and bundled assets. Add no remote fonts, icon library, decorative gradients, telemetry, or product behavior.
- Keep focus visible and suppress nonessential transitions when reduced motion is requested. Preserve semantic status and alert announcements in the owning workflow.

## Consequences

- `personality.css` is a shared styling seam; it does not reimplement Open WebUI chat, shell, or Library/History behavior.
- The QA harness consumes the shared voice and tokens, while the real Open WebUI chat shell must import the stylesheet and apply semantic hooks as part of issue #4 integration because its route modules are not present in this snapshot.
- Any new evidence category or workflow state should be named in the presentation module and remain distinguishable without color.
