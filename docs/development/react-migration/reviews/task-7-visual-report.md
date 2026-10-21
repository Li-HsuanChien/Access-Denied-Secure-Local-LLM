# Stage7 scoped renderer visual follow-up

Status: **accepted; all six affected states are pixel identical to accepted post-cleanup references. No new visual drift.** Review followed the final six-file renderer correction for Mermaid pre-render image metadata and nested-code Save targeting. Those security/behavioral canaries belong to the independent final reviewer; this report qualifies the requested safe existing visual states only.

## Capture and comparison

Frozen canonical production origin: `http://127.0.0.1:4177`. Full Chrome for Testing was selected explicitly through `chromium.executablePath()`, Chromium151.0.7922.34. The scoped portable script reuses the existing capture harness's fixture, context, epoch/UUID/random seed, font readiness, screenshot and interaction helpers. It changes the entry sequence to the requested states only, uses the canonical preview origin, and writes to a unique temporary output. No production or repository harness edits, accepted reference edits, subagents, full95 rerun, menu or motion audit.

The same dimensions, theme/sidebar state, device scale1, America/New_York timezone, reduced motion, font settling and rich scroll positions are preserved. Every8765 request was intercepted through existing fixtures; the real user's service/data were untouched. Port5173/5174 was not used. Capture completed once, exit0, **eight PNGs: six affected states plus two normal setup captures**. There were **zero page errors, console errors and blocked requests**. The browser is closed.

The comparison imports the unchanged repository comparator's `compare_images` function, verifies each reference PNG against the accepted Stage6 capture index and compares every RGBA channel with zero tolerance and no masks. All8 are identical, with0 dimension differences and0 missing files. Both sampled rich scroll state and recorded SVG styles also match the reference metadata. No previously qualified paint/pointer/safety allowance is needed to excuse a new delta in this run: the retained states already match exactly.

| Capture | Scope | Changed pixels | Max channel |
| --- | --- | ---: | ---: |
| `chat-answer-initial` | Setup only | 0 | 0 |
| `chat-answer` | Affected state | 0 | 0 |
| `chat-sources-expanded` | Affected state | 0 | 0 |
| `chat-source-detail-modal` | Affected state | 0 | 0 |
| `chat-rich-content-initial` | Setup only | 0 | 0 |
| `chat-rich-content-top` | Affected state | 0 | 0 |
| `chat-rich-content-middle` | Affected state | 0 | 0 |
| `chat-rich-content-bottom` | Affected state | 0 | 0 |

## Mermaid appearance

The safe rich fixture's generated Mermaid A→B diagram is visibly present in the rich top/middle captures. The **entire** rich top, middle and bottom screenshots are byte-identical PNGs to accepted Stage6, including diagram node/arrow/text appearance, code chrome, tables, math, charts, layout and surrounding scroll controls. Thus the added semantic preparse does not change the generated appearance in this exercised safe fixture. The historical harness's `.mermaid-diagram` counter targets an old class and is not used as proof of diagram presence; current React uses `.renderer-diagram`. Direct screenshot inspection and full-pixel comparison establish this visual result without editing that harness.

Plain supported answer, expanded source and source-detail modal also remain wholly exact. Code Save behavior and adversarial Mermaid metadata outcomes are explicitly not inferred from these screenshots; the final independent behavior/security review covers them.

## Evidence and reproducibility

- Accepted reference: `docs/development/react-migration/evidence/stage6-visual-full/` (unchanged).
- New8 screenshots/index/metadata: `/private/tmp/react-stage7-visual-scoped/`.
- Zero-tolerance result with all reference/candidate hashes: `/private/tmp/react-stage7-visual-comparison/comparison.json`.
- Executed portable scoped capture source: `/private/tmp/react-stage7-visual-scoped.mjs`. Run from repository root or set `PARITY_REPO_ROOT`; set a unique `BASELINE_OUTPUT_ROOT`, and `BASELINE_ORIGIN` for the frozen candidate. The script never opens an original server or writes accepted references.
- Reproducible scoped comparison: `/private/tmp/react-stage7-visual-compare.py`; uses existing repository comparator and the candidate index to select exactly these8 states, without manufacturing an acceptance marker.

```sh
BASELINE_ORIGIN=http://127.0.0.1:4177 BASELINE_OUTPUT_ROOT=/private/tmp/unique-stage7-scoped node /private/tmp/react-stage7-visual-scoped.mjs
python3 /private/tmp/react-stage7-visual-compare.py docs/development/react-migration/evidence/stage6-visual-full /private/tmp/unique-stage7-scoped /private/tmp/unique-stage7-comparison
```

The actual completed run used `/private/tmp/react-stage7-visual-scoped` and the comparison path above. Scope is unchanged safe fixtures, not a replacement for the accepted95 matrix or an expanded feature audit. No independent visual blocker remains for the final renderer fixes.

Reference index SHA256: `6c1811768f6570e1a6f44de0be3d6f73c63d4d069afbe0699b2f467ea1a52717`. Repository harness SHA256: `61eef301e5bedc10a10505aa18ad88f0c2109e45f9700bf661e4e457463fffa9`. Executed scoped script SHA256: `1e433fd32f1ca44fbf2e7511614d58359aad3c2fb9271fbb0b1f7d9f77e356d1`. The immutable original index remains `560ed579f85718b5cc71f9569fd0eb6cde4d7ae92850ee38f1f75e581aa422b1`. This report is the only repository write by this scoped review.
