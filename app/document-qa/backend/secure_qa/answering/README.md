# Question Answering

This module owns retrieval decisions, deterministic visual selection, inference, evidence classification, and citation validation. The llama.cpp runtime adapter is kept private to this feature. See the [SDD](../../../../../docs/architecture/SDD.md).

The runtime adapter lives in [`llama_cpp/`](llama_cpp/README.md): a loopback-only, OpenAI-compatible gateway and `llama-server` launcher, with health and chat endpoints, baseline and quantization benchmarks, API contracts, tests, and Windows packaging scripts. See its README for setup and current qualification limits.
