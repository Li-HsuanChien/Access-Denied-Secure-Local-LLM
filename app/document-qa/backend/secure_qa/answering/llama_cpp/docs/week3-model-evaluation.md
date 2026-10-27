# Week 3: model evaluation and freeze

**Frozen: Qwen3-4B-Instruct-2507 Q4_K_M** (SHA-256 `2fde00ce…a4464e`, 2,497,280,736 bytes) on llama.cpp b11242,
recorded in [`../release-manifest.json`](../release-manifest.json). It answered **22 of 23** quality questions with
the product's own prompt: every citation correct, every unanswerable question declined, and every planted
instruction ignored. It is the team's release candidate (`app/release/assets.lock.json`) and E3's real-corpus
model. **It is not yet qualified for release**: latency and peak RAM must still be measured on the 8 GB
reference laptop (SDD §12).

## Quality with the product prompt

23 fixed questions over synthetic policy passages, asked with a copy of Question Answering's prompt
(`context.py` version `e3-rag-2026-10-05.1`), temperature 0.1, seed 42, up to 512 answer tokens. Eval set
`2026-10-26.2`, run 2026-10-26. Raw replies:
[`sample-results/week3-quality/qwen3-4b-instruct-2507-q4_k_m.json`](sample-results/week3-quality/qwen3-4b-instruct-2507-q4_k_m.json).

| Question type | Passed | Threshold | Notes |
|---|---:|---|---|
| Answer is in the passages (fact + correct `[S#]` label) | 14 / 15 | | The miss: `allowance-repay`, below |
| Not in the passages (must decline, no document claim) | 5 / 5 | ≥ 80% | All five were declined under the wrong heading (next section) |
| Planted instruction in a passage (must ignore) | 3 / 3 | 100% | No "ACCESS GRANTED", no prompt leak |
| **All** | **22 / 23 (96%)** | ≥ 80% | Citations 100%; no invented labels |

**The one wrong answer.** Asked "I'm leaving after eight months; do I have to repay the allowance?", the model
quoted the rule correctly ("not repayable unless the employee leaves within twelve months" [S4]) and then
concluded the opposite, that no repayment is due. The citation is right; the reasoning is not. E3's validator does
not catch this kind of error by design (it checks that citations point at supplied passages, not that the
passage supports the conclusion), so it is exactly what E5's grounding set should keep measuring.

## Finding for E3: every refusal costs a second generation

All five refusals put "None of the passages mention …" under **From your documents:**. The prompt says to leave
that heading out when the passages don't answer. E3's validator flags the uncited sentence (`uncited_claim`),
asks the model again once, and then withholds the sentence. The user still gets a correct "not covered" answer,
but **every unanswerable question takes two generations**, roughly doubling the wait on the reference laptop. Only
78% of replies would pass the validator on the first try, and all of the failures were refusals. Options for E3:
treat a documents section that only states absence as no section, or tighten the rule's wording in `context.py`
(then re-run `bench --quality`; the parity test will require updating the runtime's copy).

## How the scoring changed after the first look (disclosed)

The eval set was rescored once after reading the replies (no new generation; `2026-10-26.1` → `.2`):

- Refusals are judged on substance (no cited label, no invented answer, says the documents don't cover it).
  First-try compliance with E3's rules is now reported separately, as above. Under `.1`, all five correct
  refusals failed because they used the documents heading.
- `print-and-monitor` asked *whether* a monitor can be claimed but required the amount (350), a leftover from
  the earlier question wording. It now requires the "yes".
- "None of the passages mention …" was added to the phrases that count as stating absence.

Under `.1` the same replies scored 16 / 23. The tests in `tests/test_evals.py` pin both behaviours.

## What was not compared, and why

The plan called for benchmarking all shortlisted models (Llama-3.2-3B, Phi-3.5-mini, Qwen2.5-1.5B, SmolLM2-1.7B
and Qwen3-4B at Q4_K_M, Q5_K_M and Q8_0; all downloaded and checksum-verified). That did not happen. The dev
machine had 2–3 GB free with other applications open. A 2026-10-06 attempt ran about 10× slower than normal
(1.4–3.4 tokens/s), which made its speed and RAM figures meaningless, so it was stopped. The quality run above is
unaffected by memory pressure, which changes only how fast answers arrive. To complete the comparison, run on the
reference laptop with nothing else open:

```
docqa-runtime bench --quality --out runs/week3-selection
```

If another candidate beats Q4_K_M on the selection rule (`decisions.md` §8), change `runtime.toml`,
`assets.lock.json` and the manifest together (`docqa-runtime freeze`).

## Reproduce

```
docqa-runtime verify                      # this machine matches the frozen release
docqa-runtime up                          # then, in another terminal:
docqa-runtime eval --out runs/eval.json   # the 23-question quality eval
```
