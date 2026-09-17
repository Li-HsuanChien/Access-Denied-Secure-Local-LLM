"""Helpers for the local Qdrant container: memory sampling, restart and readiness."""

from __future__ import annotations

import json
import shutil
import subprocess
import time
import urllib.request


def container_running(name: str) -> bool:
    if shutil.which("docker") is None:
        return False
    proc = subprocess.run(
        ["docker", "inspect", "-f", "{{.State.Running}}", name], capture_output=True, text=True
    )
    return proc.returncode == 0 and proc.stdout.strip() == "true"


def container_process_memory_mb(name: str, process_name: str = "qdrant") -> tuple[float, float] | None:
    """(current RSS, peak RSS) of the named process inside the container.

    Comparable to psutil RSS for Chroma. `docker stats` is avoided because its
    figure includes page cache. Peak (VmHWM) covers the time since the container started.
    """
    proc = subprocess.run(
        ["docker", "exec", name, "sh", "-c", "cat /proc/[0-9]*/status 2>/dev/null"],
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        return None
    rss_kb = peak_kb = 0
    current = None
    for line in proc.stdout.splitlines():
        if line.startswith("Name:"):
            current = line.split(":", 1)[1].strip()
        elif current == process_name and line.startswith("VmRSS:"):
            rss_kb += int(line.split()[1])
        elif current == process_name and line.startswith("VmHWM:"):
            peak_kb += int(line.split()[1])
    return (rss_kb / 1024, peak_kb / 1024) if rss_kb else None


def restart_container(name: str) -> None:
    subprocess.run(["docker", "restart", name], check=True, capture_output=True)


def wait_until_ready(base_url: str, timeout_s: float = 60) -> None:
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(f"{base_url}/readyz", timeout=2) as resp:
                if resp.status == 200:
                    return
        except OSError:
            pass
        time.sleep(0.2)
    raise TimeoutError(f"Qdrant at {base_url} not ready after {timeout_s}s")


def server_version(base_url: str) -> str | None:
    try:
        with urllib.request.urlopen(base_url, timeout=2) as resp:
            return json.load(resp).get("version")
    except OSError:
        return None
