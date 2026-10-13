#!/usr/bin/env python3
"""One-command launcher for the Secure Local DocQA web app.

Brings up the loopback-only development stack the README describes, doing every
manual step for you: create the Python environment, install the backend and
frontend dependencies, then start the dev host and the Open WebUI frontend and
open the browser. It is interactive - it explains each install and lets you pick
a mode - and runs the same on Windows, macOS and Linux.

    Quick demo   deterministic fake model + a seeded collection; no weights, no
                 downloads. The fastest way to see the app working end to end.
    Real local AI  a real llama.cpp model and real sentence-transformers
                 embeddings; missing weights are downloaded only if you agree.

Only setup downloads (pip, npm, and opt-in model weights) ever touch the
network, from the same pinned sources the repo's fetch scripts already use. The
running services stay bound to 127.0.0.1 and gain no outbound behaviour.

Run it through the shims (`./start.sh` or `start.cmd`) or directly with a
Python 3.11+ interpreter: `python3 launch.py`.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import signal
import subprocess
import sys
import time
import urllib.request
import webbrowser
from pathlib import Path
from urllib.error import URLError

IS_WINDOWS = os.name == "nt"

REPO_ROOT = Path(__file__).resolve().parent
BACKEND_DIR = REPO_ROOT / "app" / "document-qa" / "backend"
FRONTEND_DIR = REPO_ROOT / "app" / "document-qa" / "frontend"
RUNTIME_DIR = BACKEND_DIR / "secure_qa" / "answering" / "llama_cpp"
EMBEDDING_DIR = REPO_ROOT / "models" / "all-MiniLM-L6-v2"
GGUF_DIR = RUNTIME_DIR / "models"
SHORTLIST = GGUF_DIR / "shortlist.json"

HOST_URL = "http://127.0.0.1:8765/health"
RUNTIME_URL = "http://127.0.0.1:8080/health"
FRONTEND_URL = "http://127.0.0.1:5173/"

# The default real-model pick (see shortlist.json / docs/week1-candidate-models.md).
DEFAULT_MODEL_KEY = "qwen3-4b-2507"
DEFAULT_MODEL_QUANT = "Q4_K_M"


# --------------------------------------------------------------- console --

BOLD, DIM, GREEN, YELLOW, RED, RESET = "\033[1m", "\033[2m", "\033[32m", "\033[33m", "\033[31m", "\033[0m"
if IS_WINDOWS:
    # Enable ANSI colours on Windows 10+ terminals; fall back to plain text otherwise.
    try:
        import ctypes

        ctypes.windll.kernel32.SetConsoleMode(ctypes.windll.kernel32.GetStdHandle(-11), 7)
    except Exception:
        BOLD = DIM = GREEN = YELLOW = RED = RESET = ""

_step = 0


def step(msg: str) -> None:
    global _step
    _step += 1
    print(f"\n{BOLD}[{_step}] {msg}{RESET}", flush=True)


def info(msg: str) -> None:
    print(f"    {msg}", flush=True)


def note(msg: str) -> None:
    print(f"    {DIM}{msg}{RESET}", flush=True)


def ok(msg: str) -> None:
    print(f"    {GREEN}{msg}{RESET}", flush=True)


def warn(msg: str) -> None:
    print(f"    {YELLOW}! {msg}{RESET}", flush=True)


def fail(msg: str) -> "NoReturn":  # type: ignore[name-defined]
    print(f"\n{RED}x {msg}{RESET}", flush=True)
    sys.exit(1)


def ask(question: str, default: str = "") -> str:
    suffix = f" [{default}]" if default else ""
    try:
        reply = input(f"    {BOLD}{question}{suffix}: {RESET}").strip()
    except EOFError:
        reply = ""
    return reply or default


def ask_yes_no(question: str, default: bool = True) -> bool:
    hint = "Y/n" if default else "y/N"
    while True:
        reply = ask(f"{question} ({hint})").lower()
        if not reply:
            return default
        if reply in ("y", "yes"):
            return True
        if reply in ("n", "no"):
            return False


# ------------------------------------------------------------- commands --

def run(cmd: list[str], cwd: Path | None = None, env: dict | None = None) -> None:
    """Run a setup command to completion, streaming its output; raise on failure."""
    note("$ " + " ".join(cmd))
    result = subprocess.run(cmd, cwd=str(cwd) if cwd else None, env=env)
    if result.returncode != 0:
        fail(f"Command failed (exit {result.returncode}): {' '.join(cmd)}")


def npm_cmd(*args: str) -> list[str]:
    """npm is a .cmd shim on Windows, so it has to go through cmd.exe there."""
    return ["cmd", "/c", "npm", *args] if IS_WINDOWS else ["npm", *args]


def venv_python(venv: Path) -> Path:
    return venv / ("Scripts" if IS_WINDOWS else "bin") / ("python.exe" if IS_WINDOWS else "python")


# ----------------------------------------------------------- prereqs --

def check_prerequisites() -> None:
    step("Checking prerequisites")
    if sys.version_info < (3, 11):
        fail(f"Python 3.11+ is required; this is {sys.version.split()[0]}. "
             "Install a newer Python from https://www.python.org/downloads/ and run again.")
    ok(f"Python {sys.version.split()[0]}")

    node = shutil.which("node")
    npm = shutil.which("npm")
    if not node or not npm:
        hint = {
            "nt": "Install Node.js LTS (18-22) from https://nodejs.org/ and reopen the terminal.",
            "darwin": "Install Node.js LTS (18-22): `brew install node@22`, or from https://nodejs.org/.",
        }.get(sys.platform, "Install Node.js LTS (18-22) from your package manager or https://nodejs.org/.")
        fail(f"Node.js and npm are required for the frontend but were not found on PATH.\n    {hint}")
    try:
        ver = subprocess.run([node, "--version"], capture_output=True, text=True).stdout.strip()
        ok(f"Node.js {ver}")
    except OSError:
        ok("Node.js found")


# -------------------------------------------------- python environment --

def ensure_venv() -> Path:
    step("Setting up the Python environment")
    for name in (".venv", "venv"):
        candidate = REPO_ROOT / name
        if venv_python(candidate).is_file():
            ok(f"Reusing existing environment: {name}{os.sep}")
            return candidate
    venv = REPO_ROOT / ".venv"
    info("Creating a virtual environment in .venv/ (keeps project packages out of your system Python).")
    run([sys.executable, "-m", "venv", str(venv)])
    ok("Created .venv/")
    return venv


def requirements_installed(py: Path) -> bool:
    """True when the backend's third-party packages already import in the venv."""
    probe = "import chromadb, sentence_transformers, fitz, psutil"
    return subprocess.run([str(py), "-c", probe], capture_output=True).returncode == 0


def ensure_backend_deps(py: Path) -> None:
    step("Installing backend dependencies")
    if requirements_installed(py):
        ok("Backend packages already installed.")
        return
    info("Installing chromadb, sentence-transformers, PyMuPDF and psutil - the on-disk document")
    info("store and the embedding model. This is a one-time download of a few hundred MB.")
    run([str(py), "-m", "pip", "install", "--disable-pip-version-check", "-r", str(REPO_ROOT / "requirements.txt")])
    ok("Backend dependencies installed.")


def ensure_frontend_deps() -> None:
    step("Installing frontend dependencies")
    if (FRONTEND_DIR / "node_modules").is_dir():
        ok("node_modules/ already present - skipping npm install.")
        return
    info("Running `npm ci` to install the pinned Open WebUI frontend packages (one-time, a few minutes).")
    run(npm_cmd("ci"), cwd=FRONTEND_DIR)
    ok("Frontend dependencies installed.")


# --------------------------------------------------------- real model --

def ensure_runtime_package(py: Path) -> None:
    info("Installing the llama.cpp runtime (`docqa-runtime`) into the same environment.")
    run([str(py), "-m", "pip", "install", "--disable-pip-version-check", "-e", str(RUNTIME_DIR)])


def ensure_embedding_model(py: Path) -> bool:
    if EMBEDDING_DIR.is_dir() and any(EMBEDDING_DIR.iterdir()):
        ok(f"Embedding model already staged at {EMBEDDING_DIR.relative_to(REPO_ROOT)}{os.sep}")
        return True
    info(f"The embedding model (all-MiniLM-L6-v2, ~90 MB) is not in {EMBEDDING_DIR.relative_to(REPO_ROOT)}{os.sep}.")
    if not ask_yes_no("Download it now?", default=True):
        return False
    env = {k: v for k, v in os.environ.items() if k not in ("HF_HUB_OFFLINE", "TRANSFORMERS_OFFLINE")}
    run([str(py), "-m", "secure_qa.library.scripts.fetch_model"], cwd=BACKEND_DIR, env=env)
    ok("Embedding model staged.")
    return True


def have_llama_server() -> bool:
    exe = "llama-server.exe" if IS_WINDOWS else "llama-server"
    return (RUNTIME_DIR / "bin" / exe).is_file() or shutil.which("llama-server") is not None


def ensure_llama_server() -> bool:
    if have_llama_server():
        ok("llama-server binary found.")
        return True
    if IS_WINDOWS:
        info("The llama.cpp binary (llama-server.exe) was not found.")
        if ask_yes_no("Download the pinned Windows CPU build now?", default=True):
            script = RUNTIME_DIR / "scripts" / "windows" / "fetch_runtime.ps1"
            run(["powershell", "-ExecutionPolicy", "Bypass", "-File", str(script)], cwd=RUNTIME_DIR)
            if have_llama_server():
                ok("llama-server installed.")
                return True
        return False
    # No cross-platform prebuilt binary exists for macOS/Linux, so point at the package manager.
    guide = ("`brew install llama.cpp`" if sys.platform == "darwin"
             else "your distro's llama.cpp package, or build it from https://github.com/ggml-org/llama.cpp")
    warn("No llama-server binary found and there is no automatic download for this OS.")
    info(f"Install it with {guide}, then re-run and choose Real local AI again.")
    return False


def ensure_gguf_model() -> bool:
    if GGUF_DIR.is_dir() and any(GGUF_DIR.glob("*.gguf")):
        ok("A GGUF model is already present.")
        return True
    manifest = json.loads(SHORTLIST.read_text(encoding="utf-8"))
    candidate = next((c for c in manifest["candidates"] if c["key"] == DEFAULT_MODEL_KEY), None)
    if candidate is None:
        warn("Could not find the default model in shortlist.json.")
        return False
    spec = candidate["files"][DEFAULT_MODEL_QUANT]
    url = f"https://huggingface.co/{candidate['repo']}/resolve/main/{spec['file']}"
    info(f"No model weights found. The default pick is {candidate['name']} {DEFAULT_MODEL_QUANT} "
         f"(~{spec['approx_gb']} GB, {candidate['license']}).")
    note(url)
    if not ask_yes_no("Download it now?", default=True):
        return False
    GGUF_DIR.mkdir(parents=True, exist_ok=True)
    dest = GGUF_DIR / spec["file"]
    download(url, dest, spec.get("sha256"))
    ok(f"Model downloaded to {dest.relative_to(REPO_ROOT)}")
    return True


def download(url: str, dest: Path, expected_sha: str | None) -> None:
    """Stream a download to <dest>.part, check the GGUF magic and SHA-256, then move it into place."""
    part = dest.with_suffix(dest.suffix + ".part")
    sha = hashlib.sha256()
    req = urllib.request.Request(url, headers={"User-Agent": "docqa-launcher"})
    try:
        with urllib.request.urlopen(req) as resp:  # noqa: S310 - fixed https host from the pinned manifest
            total = int(resp.headers.get("Content-Length") or 0)
            got = 0
            with open(part, "wb") as fh:
                first = resp.read(4)
                if first and first != b"GGUF":
                    part.unlink(missing_ok=True)
                    fail("The downloaded file is not a GGUF model (the URL may have moved). Nothing was kept.")
                sha.update(first)
                fh.write(first)
                got += len(first)
                while chunk := resp.read(1024 * 1024):
                    fh.write(chunk)
                    sha.update(chunk)
                    got += len(chunk)
                    if total:
                        pct = got * 100 // total
                        print(f"\r    downloading... {pct:3d}%  ({got // (1024*1024)} / {total // (1024*1024)} MB)",
                              end="", flush=True)
            print(flush=True)
    except URLError as exc:
        part.unlink(missing_ok=True)
        fail(f"Download failed: {exc}. Check your internet connection and try again.")
    if expected_sha and sha.hexdigest().lower() != expected_sha.lower():
        part.unlink(missing_ok=True)
        fail(f"Checksum mismatch for {dest.name}: the download is corrupt or changed upstream. Nothing was kept.")
    part.replace(dest)


# ------------------------------------------------------ process control --

class Supervisor:
    """Starts the long-running services and shuts them all down together."""

    def __init__(self) -> None:
        self.children: list[tuple[str, subprocess.Popen]] = []

    def start(self, name: str, cmd: list[str], cwd: Path, env: dict | None = None) -> None:
        note(f"starting {name}: {' '.join(cmd)}")
        kwargs: dict = {"cwd": str(cwd)}
        if env is not None:
            kwargs["env"] = env
        if IS_WINDOWS:
            kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
        else:
            kwargs["start_new_session"] = True  # own process group, so we can signal the whole tree
        self.children.append((name, subprocess.Popen(cmd, **kwargs)))

    def first_exited(self) -> tuple[str, int] | None:
        for name, proc in self.children:
            code = proc.poll()
            if code is not None:
                return name, code
        return None

    def shutdown(self) -> None:
        # Stop in reverse start order (frontend/host before the runtime they depend on).
        for name, proc in reversed(self.children):
            if proc.poll() is not None:
                continue
            note(f"stopping {name}")
            try:
                if IS_WINDOWS:
                    subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"],
                                   capture_output=True)
                else:
                    os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
            except (OSError, subprocess.SubprocessError):
                proc.terminate()
        for _, proc in self.children:
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()


def wait_for(url: str, label: str, timeout: float = 120.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=2) as resp:  # noqa: S310 - loopback only
                if resp.status < 500:
                    return True
        except Exception:
            time.sleep(0.5)
    warn(f"{label} did not respond at {url} within {int(timeout)}s.")
    return False


# ----------------------------------------------------------------- main --

def choose_mode(forced: str | None) -> str:
    if forced:
        return forced
    step("Choose how to run")
    info("[1] Quick demo    - fake model + seeded collection, instant, no downloads (recommended)")
    info("[2] Real local AI - a real llama.cpp model and real embeddings (may download weights)")
    return "real" if ask("Enter 1 or 2", default="1") == "2" else "demo"


def start_stack(mode: str, py: Path) -> None:
    sup = Supervisor()
    host_cmd = [str(py), str(BACKEND_DIR / "dev_host.py")]

    if mode == "real":
        step("Starting the local AI runtime")
        sup.start("llama runtime", [str(venv_bin(py, "docqa-runtime")), "up", "--server-only"], cwd=RUNTIME_DIR)
        if not wait_for(RUNTIME_URL, "llama runtime", timeout=240):
            sup.shutdown()
            fail("The model runtime did not become ready. See its output above.")
        ok("Model runtime ready on 127.0.0.1:8080")
        host_cmd += ["--runtime", "http://127.0.0.1:8080", "--embedding-model", str(EMBEDDING_DIR)]

    step("Starting the app")
    sup.start("dev host", host_cmd, cwd=BACKEND_DIR)
    sup.start("frontend", npm_cmd("run", "dev:qa"), cwd=FRONTEND_DIR)

    try:
        if wait_for(HOST_URL, "dev host") and wait_for(FRONTEND_URL, "frontend"):
            ok(f"App is up. Opening {FRONTEND_URL}")
            try:
                webbrowser.open(FRONTEND_URL)
            except Exception:
                pass
        print(f"\n{BOLD}{GREEN}Ready.{RESET}  Open {BOLD}{FRONTEND_URL}{RESET}")
        print(f"    Dev host: http://127.0.0.1:8765/health")
        if mode == "real":
            print(f"    Runtime:  {RUNTIME_URL}")
        print(f"    {DIM}Everything is bound to 127.0.0.1 (this computer only). Press Ctrl+C to stop.{RESET}\n")
        # Supervise until Ctrl+C or a child exits on its own.
        while True:
            exited = sup.first_exited()
            if exited:
                name, code = exited
                warn(f"'{name}' stopped (exit {code}); shutting the rest down.")
                break
            time.sleep(1)
    except KeyboardInterrupt:
        print(f"\n{DIM}Stopping...{RESET}")
    finally:
        sup.shutdown()
        ok("All services stopped.")


def venv_bin(py: Path, name: str) -> Path:
    """Path to a console script installed next to the venv's python."""
    exe = f"{name}.exe" if IS_WINDOWS else name
    return py.parent / exe


def main() -> None:
    parser = argparse.ArgumentParser(description="Launch the Secure Local DocQA web app.")
    parser.add_argument("--mode", choices=("demo", "real"), help="skip the prompt and run this mode")
    parser.add_argument("--demo", action="store_const", dest="mode", const="demo", help="shortcut for --mode demo")
    parser.add_argument("--real", action="store_const", dest="mode", const="real", help="shortcut for --mode real")
    args = parser.parse_args()

    print(f"{BOLD}Secure Local DocQA - launcher{RESET}")
    note(f"repository: {REPO_ROOT}")

    check_prerequisites()
    venv = ensure_venv()
    py = venv_python(venv)
    ensure_backend_deps(py)
    ensure_frontend_deps()

    mode = choose_mode(args.mode)
    if mode == "real":
        step("Preparing the real model")
        ensure_runtime_package(py)
        ready = ensure_embedding_model(py) and ensure_llama_server() and ensure_gguf_model()
        if not ready:
            warn("Real mode is not fully set up on this machine.")
            if ask_yes_no("Fall back to the Quick demo instead?", default=True):
                mode = "demo"
            else:
                fail("Install the missing pieces listed above, then run again.")

    start_stack(mode, py)


if __name__ == "__main__":
    main()
