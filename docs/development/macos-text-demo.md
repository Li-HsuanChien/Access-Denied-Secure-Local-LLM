# Prepared Apple-silicon text demo

This machine is staged for Qwen3-1.7B Q4_K_M with Metal and thinking disabled.
It is real local inference with validated citations and the existing local PDF
collection/history. It is not the deterministic fake demo or a qualified release.

From the repository root:

```sh
./app/desktop/start-demo-macos.command
```

Or double-click that file in Finder. It opens `http://127.0.0.1:5173/`. Keep the
Terminal window open when it starts the services; Ctrl+C stops that launched
stack. If the matching demo is already running, the command simply opens it.
After sleep/reboot, use the same command again. The model, embedding weights,
Python environment, Node dependencies and llama.cpp must already be staged; this
launcher does not install or download anything. It is Apple-silicon-only.

The prepared profile is
`app/document-qa/backend/secure_qa/answering/llama_cpp/runtime.demo-macos.toml`.
It selects the pinned smaller GGUF, 4096 context tokens, one slot, no extra RAM
prompt cache, all available GPU layers, and the non-thinking chat template.
The normal `start.sh --real` still selects the original CPU runtime configuration.
Stop the current stack before switching profiles; never run two model jobs at once.

Verified public-fixture questions include:

- How long are the fuel rods in a reactor fuel assembly?
- What size matrix are fuel rods arranged in for pressurized water reactors?
- Which companies manufactured pressurized water reactors in the United States?
- What exact melting temperature does the NRC chapter give for the fuel rods?

For unsupported-question demonstrations, disable General knowledge if the desired
behavior is a refusal. With it enabled, unsupported questions may receive visibly
labeled general model knowledge without document citations, as designed.

On this M3/16 GB machine, the final 11-question run took 0.03–8.01 seconds per
request, startup took 5.45 seconds, and sampled host/model RSS peaked at 2.26 GiB.
The actual NRC-only app probe took 5.10 seconds and 0.72 seconds on repeat.
Background workload affects timing. These are text smoke tests, not visual-model
or 8 GB reference-machine qualification. The [full investigation](../performance/2026-11-17-local-answer-latency.md)
records failures, phase timings, tokens, memory and swap.

Rollback: stop the demo stack, then run `./start.sh --real` for the unchanged
4B CPU configuration. For the previously tested 4B Metal alternative, start the
runtime with its normal config plus `--gpu-layers 99`, followed by the local host
and frontend as documented in the repository README. Do not change the frozen
release manifest to make a demo profile appear release-qualified.
