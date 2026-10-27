"""Frozen release manifest: `freeze`, `verify`, the doctor/health views of it, and where it is looked for."""

import hashlib
import json
from pathlib import Path

import pytest

from docqa_runtime import cli, release
from docqa_runtime.client import get_json
from docqa_runtime.errors import ConfigError
from docqa_runtime.gguf import write_stub_gguf
from docqa_runtime.launcher import Runtime

ENGINE = "0.5.0-dev (build 11242, commit 526c43b8f)"


@pytest.fixture
def real_model(tmp_path):
    """A small GGUF that is not marked as a stub, standing in for a real model file."""
    d = tmp_path / "payload" / "models"
    d.mkdir(parents=True)
    p = write_stub_gguf(d / "Tiny-Instruct-Q4_K_M.gguf", {"general.architecture": "llama", "general.file_type": 15,
                                                         "general.name": "Tiny Instruct"})
    with open(p, "ab") as f:
        f.write(b"\0" * 4096)          # some 'weights' so a one-byte edit keeps the size
    return p


@pytest.fixture
def engine(monkeypatch):
    monkeypatch.setattr(release, "server_version", lambda cmd: ENGINE)


def cfg_for(make_cfg, model: Path, base_dir: Path):
    cfg = make_cfg(models_dir=str(model.parent), model=model.name)
    base_dir.mkdir(parents=True, exist_ok=True)
    cfg.base_dir = str(base_dir)
    return cfg


def levels(lines):
    return [level for level, _ in lines]


def test_freeze_needs_a_pinned_real_model(make_cfg, stub_models, engine):
    with pytest.raises(ConfigError) as e:
        release.freeze(make_cfg(model=""))
    assert e.value.code == "model_not_pinned"
    with pytest.raises(ConfigError) as e:
        release.freeze(make_cfg(model="tiny-stub-Q4_K_M.gguf"))
    assert e.value.code == "stub_model"


def test_freeze_records_checksum_engine_and_settings(make_cfg, real_model, tmp_path, engine):
    cfg = cfg_for(make_cfg, real_model, tmp_path / "conf")
    m, path = release.freeze(cfg, evidence={"benchmark": "runs/x"}, selection="best eval score")
    assert path == tmp_path / "conf" / release.MANIFEST_NAME and json.loads(path.read_text()) == m
    assert m["model"]["sha256"] == hashlib.sha256(real_model.read_bytes()).hexdigest()
    assert m["model"]["size_bytes"] == real_model.stat().st_size and m["model"]["quant"] == "Q4_K_M"
    assert m["llama_cpp"] == {"version": ENGINE, "tag": "b11242", "commit": "526c43b8f"}
    assert m["config"]["parallel"] == 1 and m["config"]["cache_ram_mib"] == 0 and m["config"]["host"] == "127.0.0.1"
    assert m["selection"] == "best eval score" and m["evidence"]["benchmark"] == "runs/x"
    assert set(levels(release.verify(cfg, m))) == {"OK"}


def test_verify_catches_drift(make_cfg, real_model, tmp_path, engine, monkeypatch):
    cfg = cfg_for(make_cfg, real_model, tmp_path / "conf")
    m, _ = release.freeze(cfg)

    data = bytearray(real_model.read_bytes())
    data[-1] ^= 0xFF                                          # same size, different content
    real_model.write_bytes(bytes(data))
    out = release.verify(cfg, m)
    assert ("FAIL" in levels(out)) and any("SHA-256" in msg for _, msg in out)
    assert "FAIL" not in levels(release.verify(cfg, m, full_hash=False))   # --quick only compares sizes

    real_model.write_bytes(bytes(data) + b"\0")
    assert any("bytes" in msg for level, msg in release.verify(cfg, m, full_hash=False) if level == "FAIL")

    cfg.ctx_size = 8192
    assert any("ctx_size" in msg for level, msg in release.verify(cfg, m, full_hash=False) if level == "FAIL")
    cfg.ctx_size = m["config"]["ctx_size"]

    cfg.model = "other.gguf"
    assert any("runtime.toml model" in msg for level, msg in release.verify(cfg, m, full_hash=False) if level == "FAIL")
    cfg.model = real_model.name

    monkeypatch.setattr(release, "server_version", lambda cmd: "0.5.0-dev (build 11300, commit abcdef123)")
    assert any("llama.cpp is" in msg for level, msg in release.verify(cfg, m, full_hash=False) if level == "FAIL")


def test_manifest_found_beside_the_models_folder(make_cfg, real_model, tmp_path, engine):
    """The desktop app copies runtime.toml to the user-data folder; the manifest stays beside the payload's models."""
    payload_cfg = cfg_for(make_cfg, real_model, real_model.parent.parent)
    m, written = release.freeze(payload_cfg)
    assert written.parent == real_model.parent.parent
    user_cfg = cfg_for(make_cfg, real_model, tmp_path / "user-data")
    assert release.manifest_path(user_cfg) == written
    assert release.load_manifest(user_cfg) == m
    from docqa_runtime.discovery import ModelEntry
    info = release.release_info(user_cfg, ModelEntry.from_path(real_model))
    assert info == {"manifest": True, "frozen_at": m["frozen_at"], "matches_manifest": True,
                    "model_sha256": m["model"]["sha256"]}


def test_health_reports_whether_the_frozen_model_is_loaded(make_cfg, stub_models):
    cfg = make_cfg(model="tiny-stub-Q4_K_M.gguf")
    stub = stub_models / "tiny-stub-Q4_K_M.gguf"
    manifest = {"frozen_at": "2026-10-26T12:00:00", "model": {"file": stub.name, "id": "tiny-stub-q4_k_m",
                "size_bytes": stub.stat().st_size, "sha256": "ab" * 32}, "config": {}, "llama_cpp": {}}
    (Path(cfg.base_dir) / release.MANIFEST_NAME).write_text(json.dumps(manifest))
    rt = Runtime(cfg, quiet=True)
    rt.start()
    try:
        _, h = get_json(rt.base_url(), "/health")
        assert h["release"] == {"manifest": True, "frozen_at": "2026-10-26T12:00:00", "matches_manifest": True,
                                "model_sha256": "ab" * 32}
    finally:
        rt.stop()
    rt = Runtime(make_cfg(model="tiny-stub-Q8_0.gguf"), quiet=True)
    rt.start()
    try:
        _, h = get_json(rt.base_url(), "/health")
        assert h["release"]["manifest"] is True and h["release"]["matches_manifest"] is False
        assert h["release"]["model_sha256"] is None
    finally:
        rt.stop()


def test_cli_freeze_then_verify(real_model, tmp_path, engine, capsys, monkeypatch):
    conf = real_model.parent.parent / "runtime.toml"
    conf.write_text(f'[backend]\nserver_bin = "stub"\nmodel = "{real_model.name}"\n', encoding="utf-8")
    monkeypatch.chdir(tmp_path)
    assert cli.main(["freeze", "--config", str(conf), "--reason", "test"]) == 0
    assert cli.main(["verify", "--config", str(conf)]) == 0
    assert "Matches the frozen release." in capsys.readouterr().out
    conf.write_text(conf.read_text() + "ctx_size = 2048\n", encoding="utf-8")
    assert cli.main(["verify", "--config", str(conf), "--quick"]) == 2
    assert "settings differ" in capsys.readouterr().out
