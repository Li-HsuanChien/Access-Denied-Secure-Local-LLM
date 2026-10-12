@echo off
rem Start the local LLM runtime and chat with it. Double-click, or run from a terminal.
rem Type your question in this window once the model is loaded; "exit" (or Ctrl+C) stops the runtime.
rem Uses llama.cpp with a real model when one is installed, otherwise the stub backend (simulated answers).
rem   start.cmd [flags]                 flags go to "docqa-runtime up", e.g. --model <id> --port 9090
rem   start.cmd --server-only [flags]   API server only on http://127.0.0.1:8080, no chat prompt
rem The runtime lives in app\open-webui\backend\secure_qa\answering\llama_cpp\ - see its README.
call "%~dp0app\open-webui\backend\secure_qa\answering\llama_cpp\start.cmd" %*
