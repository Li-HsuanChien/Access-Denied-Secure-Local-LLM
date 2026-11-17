#!/bin/bash
# Prepared local text demo. No installs or downloads; uses staged dependencies.
set -euo pipefail
cd "$(dirname "$0")/../.."
export PATH="/opt/homebrew/bin:$PATH"
export HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 ANONYMIZED_TELEMETRY=False TOKENIZERS_PARALLELISM=false
if [[ "$(uname -s)" != Darwin || "$(uname -m)" != arm64 ]]; then
  echo "This prepared demo uses Apple-silicon Metal. Use start.sh for other platforms."
  exit 1
fi
exec .venv/bin/python - <<'PY'
import json
import signal
import urllib.request
import webbrowser
import launch


def local_json(url):
    try:
        with urllib.request.urlopen(url, timeout=2) as response:
            return json.load(response)
    except Exception:
        return None


runtime = local_json(launch.RUNTIME_URL)
if runtime is not None:
    if runtime.get("ready") and runtime.get("model", {}).get("id") == "qwen3-1.7b-q4_k_m" and local_json(launch.HOST_URL):
        try:
            with urllib.request.urlopen(launch.FRONTEND_URL, timeout=2):
                pass
        except Exception:
            raise SystemExit("The model is running but the interface is unavailable. Stop the existing app before restarting this launcher.")
        webbrowser.open(launch.FRONTEND_URL)
        print("Your local demo is already running: " + launch.FRONTEND_URL)
        raise SystemExit(0)
    raise SystemExit("Another local model is already running. Stop its launcher before starting this demo.")


def stop(*_):
    raise KeyboardInterrupt


signal.signal(signal.SIGTERM, stop)
launch.start_stack("real", launch.venv_python(launch.REPO_ROOT / ".venv"),
                   runtime_config=launch.RUNTIME_DIR / "runtime.demo-macos.toml")
PY
