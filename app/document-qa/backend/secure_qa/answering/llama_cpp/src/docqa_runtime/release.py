"""Frozen release manifest (Week 3): the exact model file, llama.cpp build and runtime settings that were selected.

`docqa-runtime freeze` writes release-manifest.json next to runtime.toml from the current configuration;
`docqa-runtime verify` checks a machine against it (file checksum, engine build, frozen settings), so the selected
setup can be reproduced and drift is caught before a demo or a benchmark.
"""

from __future__ import annotations

import hashlib
import json
import re
import time
from pathlib import Path

from . import API_VERSION, __version__
from .config import Config
from .discovery import ModelEntry, find_server, select_model, server_version
from .errors import ConfigError, RuntimeFailure
from .evals import EVAL_SET_VERSION
from .prompts import PROMPT_SET_VERSION

MANIFEST_NAME = "release-manifest.json"
MANIFEST_VERSION = 1

# Settings that change what the model computes or what it is exposed to. Ports, paths and timeouts are deployment
# details and may differ per machine.
FROZEN_KEYS = ("ctx_size", "threads", "n_gpu_layers", "mmap", "mlock", "parallel", "cache_ram_mib", "extra_args",
               "offline", "host", "allow_remote")


def manifest_path(cfg: Config) -> Path:
    return Path(cfg.base_dir or ".") / MANIFEST_NAME


def sha256_file(path: Path, chunk: int = 8 * 1024 * 1024) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while block := f.read(chunk):
            h.update(block)
    return h.hexdigest()


def _build_numbers(version: str) -> tuple[str | None, str | None]:
    """'0.5.0-dev (build 11242, commit 526c43b8f)' -> ('11242', '526c43b8f'); older builds print '6543 (a1b2c3d)'."""
    m = re.search(r"build (\d+), commit ([0-9a-f]+)", version) or re.search(r"(\d{3,})\s*\(([0-9a-f]{6,})\)", version)
    return (m.group(1), m.group(2)) if m else (None, None)


def build_manifest(cfg: Config, *, model: ModelEntry, sha256: str, engine_version: str,
                   evidence: dict | None = None, selection: str = "") -> dict:
    build, commit = _build_numbers(engine_version)
    return {
        "manifest_version": MANIFEST_VERSION,
        "frozen_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "api_version": API_VERSION,
        "runtime_version": __version__,
        "prompt_set": PROMPT_SET_VERSION,
        "eval_set": EVAL_SET_VERSION,
        "model": {
            "file": model.path.name, "id": model.id, "name": model.name, "quant": model.quant,
            "architecture": model.architecture, "size_bytes": model.size_bytes, "sha256": sha256,
            "context_length_train": model.context_length,
        },
        "llama_cpp": {"version": engine_version, "tag": f"b{build}" if build else None, "commit": commit},
        "config": {k: getattr(cfg, k) for k in FROZEN_KEYS},
        "selection": selection,
        "evidence": evidence or {},
    }


def freeze(cfg: Config, *, evidence: dict | None = None, selection: str = "") -> tuple[dict, Path]:
    if not cfg.model.strip():
        raise ConfigError("model_not_pinned", "runtime.toml does not name a model",
                          "Set [backend] model = \"<file>.gguf\" to the selected model before freezing.")
    model = select_model(cfg)
    if model.stub:
        raise ConfigError("stub_model", f"{model.id} is a stub model", "Freeze a real GGUF model.")
    cmd = find_server(cfg)
    manifest = build_manifest(cfg, model=model, sha256=sha256_file(model.path), engine_version=server_version(cmd),
                              evidence=evidence, selection=selection)
    path = manifest_path(cfg)
    path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return manifest, path


def load_manifest(cfg: Config) -> dict | None:
    p = manifest_path(cfg)
    if not p.is_file():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        raise ConfigError("manifest_invalid", f"{p.name} is not valid JSON: {e}", "Restore it from git.")


def release_info(cfg: Config, model: ModelEntry) -> dict:
    """What /health reports about the frozen release (cheap: compares file name and size, never hashes)."""
    try:
        m = load_manifest(cfg)
    except RuntimeFailure:
        m = None
    if not m:
        return {"manifest": False, "frozen_at": None, "matches_manifest": False, "model_sha256": None}
    want = m["model"]
    matches = model.path.name.lower() == want["file"].lower() and model.size_bytes == want["size_bytes"]
    return {"manifest": True, "frozen_at": m.get("frozen_at"), "matches_manifest": matches,
            "model_sha256": want["sha256"] if matches else None}


def verify(cfg: Config, manifest: dict, *, full_hash: bool = True) -> list[tuple[str, str]]:
    """Return (level, message) lines; level is OK, WARN or FAIL."""
    out: list[tuple[str, str]] = []
    want = manifest["model"]
    path = cfg.models_path / want["file"]
    if not path.is_file():
        out.append(("FAIL", f"model file {want['file']} is not in {cfg.models_path}"))
    else:
        size = path.stat().st_size
        if size != want["size_bytes"]:
            out.append(("FAIL", f"{want['file']} is {size:,} bytes, manifest says {want['size_bytes']:,} (incomplete or different file)"))
        elif full_hash:
            got = sha256_file(path)
            out.append(("OK", f"{want['file']} SHA-256 matches") if got == want["sha256"] else
                       ("FAIL", f"{want['file']} SHA-256 {got} does not match the manifest {want['sha256']}"))
        else:
            out.append(("OK", f"{want['file']} size matches (checksum skipped; run without --quick to hash it)"))
    pinned = cfg.model.strip()
    if Path(pinned).name.lower() not in (want["file"].lower(), want["id"].lower()):
        out.append(("FAIL", f"runtime.toml model = {pinned!r}, but the frozen model is {want['file']!r}"))
    drift = [f"{k} = {getattr(cfg, k)!r} (frozen: {v!r})" for k, v in manifest["config"].items() if getattr(cfg, k) != v]
    out.append(("FAIL", "settings differ from the frozen config: " + "; ".join(drift)) if drift else
               ("OK", "runtime settings match the frozen config"))
    try:
        engine = server_version(find_server(cfg))
        build, commit = _build_numbers(engine)
        frozen = manifest["llama_cpp"]
        same = build and f"b{build}" == frozen.get("tag") and (not frozen.get("commit") or commit == frozen["commit"])
        out.append(("OK", f"llama.cpp {frozen.get('tag')} ({frozen.get('commit')})") if same else
                   ("FAIL", f"llama.cpp is {engine!r}, frozen build is {frozen.get('tag')} ({frozen.get('commit')}). "
                            f"Run scripts/windows/fetch_runtime.ps1 -Tag {frozen.get('tag')}"))
    except RuntimeFailure as e:
        out.append(("FAIL", e.message))
    if manifest.get("api_version") != API_VERSION:
        out.append(("WARN", f"API version is {API_VERSION}, manifest was frozen at {manifest.get('api_version')}"))
    return out
