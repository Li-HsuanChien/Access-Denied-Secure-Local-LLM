# E3 next steps: Open WebUI, Chroma and Ollama

**Written:** 2026-09-29 · **Updated:** 2026-10-05 (E3 items 3–5 done; `main` renamed `app/open-webui/` to `app/document-qa/`) · **Owner:** E3 (Conrad Brady) · **Branch:** `E3-Rag/Document-Store`

Working notes from reviewing Open WebUI's built-in Chroma and Ollama support against our design. The running status is in [`E3-rag-document-store-status.md`](E3-rag-document-store-status.md).

**Sources reviewed:**
- **Open WebUI** v0.11.4 (commit `8bd8b4f`, 2026-09-21). Paths below are relative to its `backend/open_webui/`. To look again: `git clone --depth 1 https://github.com/open-webui/open-webui.git`.
- **Our design:** `main`'s ADR 0001 and the codebase design spec §4.1–4.2.
- **E1's llama.cpp runtime:** branch `E1-LLM/Runtime`, `app/open-webui/backend/secure_qa/answering/llama_cpp/`.

---

## TL;DR

- **Chroma:** Open WebUI's built-in Chroma fits our choice, but its ingestion and retrieval pipeline doesn't. Share Chroma, not the pipeline.
- **Ollama:** allow it for development only. Production uses llama.cpp through E1's gateway, as ADR 0001 says.
- **First step for E3 (done 2026-10-05):** move `docstore/` into `secure_qa/library/`, with a Chroma directory separate from Open WebUI's.

## What Open WebUI's Chroma gives us

**Matches our setup:**
- **Same store setup.** Chroma runs in-process on disk by default (`VECTOR_DB=chroma`, `PersistentClient` at `DATA_DIR/vector_db`), with telemetry off. No server and no port (`retrieval/vector/dbs/chroma.py`, `config.py` ~L503).
- **Same versions.** It pins `chromadb==1.5.9`, our version, so there's one dependency set.
- **Same embedding model.** Its default is `sentence-transformers/all-MiniLM-L6-v2`, our model. `OFFLINE_MODE=true` sets `HF_HUB_OFFLINE=1` and turns off automatic embedding-model updates (`env.py` ~L1199, `config.py` ~L1008–1017).

**Doesn't meet our requirements:**

| Open WebUI behavior | Where | Why it's a problem for us |
|---|---|---|
| Chunk IDs are random `uuid4` | `routers/retrieval.py`, `save_docs_to_vector_db` | Breaks E2's stable IDs. Citations saved in chat history won't still point to the same chunk after a collection is re-published. |
| One collection per file (`file-{id}`) or knowledge base; re-importing deletes it and reinserts | same | No versioned snapshots, atomic activation or rollback (SDD §6.3) |
| Chunk metadata is a page index only; chunks are LangChain 1000/100 splits | `retrieval/loaders/main.py`, `config.py` ~L1064 | No page spans, character offsets or highlight areas for citations |
| `search()` catches every error and returns `None` | `chroma.py` `search` | A retrieval failure looks like "no results"; the SDD says it must fail explicitly |
| Score is `(1 + cos) / 2` (0–1); `RAG_RELEVANCE_THRESHOLD=0.0`, `RAG_TOP_K=3` | `chroma.py`, `config.py` ~L968 | Our scores are plain cosine; any threshold has to say which scale it uses |

**Decision:** our adapter writes and reads its own versioned collections, in a Chroma directory separate from Open WebUI's `vector_db`. Open WebUI's knowledge-base path never publishes or activates a collection version, as `main`'s spec §4.1 already says.

## What Open WebUI's Ollama support gives us

**How it's integrated:**
- **Built in.** Ollama is a first-class backend (`routers/ollama.py`). `ENABLE_OLLAMA_API` defaults to on and looks for `localhost:11434`.
- **Model-management routes.** It also forwards `/api/pull`, `/api/push`, `/api/create` and `/api/delete`. Those are the model-download controls the design says to disable.

**Why not for production:**
- **It's a wrapper.** Ollama is built on llama.cpp and adds its own daemon and model store, so we get less control over flags, the multimodal setup and the exact GGUF file.
- **E1 has already built the llama.cpp side:** a launcher and gateway on 127.0.0.1:8080. It uses a random API key for each launch, clears download-related environment variables, keeps prompts and document text out of logs, and cleans up the process if the launcher dies.
- **ADR 0001 names llama.cpp.** Switching would need a new ADR.

**Why it's still useful:** teammates can use the Open WebUI chat screen right away while the fork is being brought up.

**Decision (proposed):** Ollama for development only. Production uses llama.cpp through E1's gateway, which Open WebUI reaches through its OpenAI-compatible connection setting.

**Don't use Ollama for embeddings.** It brings in a different model, and our embedding-model check would reject the collection.

**Watch out for this default:** `OPENAI_API_BASE_URL` defaults to `https://api.openai.com/v1` (`config.py` ~L323–330). The packaged config must point it at E1's gateway, or the app will try to reach the internet.

## Next steps

### 1. Bring the Open WebUI fork into `app/document-qa/` (team)

It's still only README files. Pin v0.11.4 and ship a locked-down config:

```bash
OFFLINE_MODE=true
ENABLE_OLLAMA_API=false                       # dev machines may set true to use a local Ollama
OPENAI_API_BASE_URL=http://127.0.0.1:8080/v1  # E1's llama.cpp gateway
VECTOR_DB=chroma                              # Open WebUI's own store; ours lives in a separate directory
HF_HUB_OFFLINE=1
# Also disable web search, tools, code execution, plugins and model downloads (see spec §9 hardening)
```

Done when the fork starts, chats through E1's gateway, and makes no outbound connections with networking disabled.

### 2. Record the Ollama decision (team)

Add one paragraph to ADR 0001, or a short ADR 0003: "Ollama allowed for development only; production uses llama.cpp via E1's gateway."

### 3. Move the E3 code into `main`'s layout (E3) · done 2026-10-05

- [x] Bring `main` into `E3-Rag/Document-Store`. It was merged rather than rebased, so the shared branch needs no force push.
- [x] Move `docstore/` into `app/document-qa/backend/secure_qa/library/`, tests into `library/tests/`, and the benchmark into `library/benchmarks/`.
- [x] Give our collections their own Chroma directory, separate from Open WebUI's `DATA_DIR/vector_db`, with one collection per published version (`CollectionVersions`, `<root>/chroma`).
- [x] Update the paths in the library READMEs and the status doc.
- [x] Re-run the tests, from `app/document-qa/backend`: `../../../.venv/bin/python -m unittest discover -s secure_qa -t .`.

### 4. First end-to-end path (E3 + E1 + Question Answering owner) · done 2026-10-05, pending E1's frozen model

Question → our `search()` → E1's gateway (`docs/api.md` on `E1-LLM/Runtime`) → answer with E2 page citations. This proves the parts fit together before any UI work. Start as a script, like `scripts/demo_index_search.py`.

**Built as:** `secure_qa/answering/`, with the golden runner `python -m secure_qa.answering.benchmarks.golden` and `dev_host.py` for E4. It ran against E1's runtime on the stub backend; a real-model run waits on E1's frozen model. See the status doc.

### 5. Adapter follow-ups (E3) · done 2026-10-05

- [x] Document our score scale (cosine) next to Open WebUI's `(1 + cos) / 2` before setting the relevance threshold (`library/README.md`).
- [x] Add `min_score` to `search()` (SDD §7.1). The provisional answer-path value is 0.38 cosine.
- [x] Add versioned collections, a durable active-version pointer and rollback (SDD §4.1, §6.3). Open WebUI can't provide these.
- [x] Make sure retrieval failures raise errors, never an empty result (`RetrievalError`, unlike Open WebUI's `search`).

### Still open from the status doc

- Run the demo, tests and benchmark on the **8 GB reference laptop**. This is the week 2 acceptance gap.
- SDD §5.1 update for page-spanning chunks (E2 / SDD owner).
- Network capture during index and search, as evidence for SDD §14.
