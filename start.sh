#!/usr/bin/env bash
# One-command launcher for the Secure Local DocQA web app (macOS and Linux).
# Sets up the Python and frontend dependencies, then starts the dev host and the Open WebUI
# frontend and opens the browser. It asks whether to run the Quick demo (no downloads) or a
# real local model. Press Ctrl+C to stop everything.
#
# Usage: ./start.sh            # interactive
#        ./start.sh --demo     # skip the prompt, Quick demo
#        ./start.sh --real     # skip the prompt, real local model
set -euo pipefail

cd "$(dirname "$0")"

PY=""
for cand in python3 python; do
  if command -v "$cand" >/dev/null 2>&1; then PY="$cand"; break; fi
done
if [ -z "$PY" ]; then
  echo "Python 3.11+ is required but was not found."
  echo "Install it from https://www.python.org/downloads/ or your package manager, then run again."
  exit 1
fi

exec "$PY" launch.py "$@"
