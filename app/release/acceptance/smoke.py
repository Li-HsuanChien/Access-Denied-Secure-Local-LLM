"""Acceptance against frozen binaries, run identically locally and in CI.

Requires no model weights and never downloads anything. --desktop additionally
starts a real native webview and verifies it can render chat and reach workflows.
"""
from __future__ import annotations

import argparse
import base64
import contextlib
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[3]
PAYLOAD = ROOT / 'app/desktop/src-tauri/resources'


def port_free(port: int) -> bool:
    with socket.socket() as sock:
        try:
            sock.bind(('127.0.0.1', port))
            return True
        except OSError:
            return False


def request(port, operation=None, payload=None, *, timeout=30, origin='http://tauri.localhost'):
    url = f'http://127.0.0.1:{port}'
    data = None if operation is None else json.dumps({'request_id': 'acceptance', 'operation': operation, 'payload': payload or {}}).encode()
    headers = {'Content-Type': 'application/json'}
    if origin is not None:
        headers['Origin'] = origin
    req = urllib.request.Request(url + ('/health' if operation is None else '/v1/requests'), data=data, headers=headers)
    with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(req, timeout=timeout) as response:
        body = json.load(response)
    if operation:
        assert body['request_id'] == 'acceptance' and body['operation'] == operation, body
        return body['result']
    return body


@contextlib.contextmanager
def host(exe: Path, data: Path):
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    env = {**os.environ, 'SECURE_QA_DATA_DIR': str(data)}
    with (data / 'service.log').open('ab') as log:
        process = subprocess.Popen([str(exe), 'host', '--port', str(port)], cwd=data, env=env, stdout=log, stderr=log)
        try:
            deadline = time.monotonic() + 120
            while time.monotonic() < deadline:
                if process.poll() is not None:
                    raise RuntimeError(f'Frozen host exited ({process.returncode}): {(data / "service.log").read_text(errors="replace")[-4000:]}')
                try:
                    if request(port)['ready']:
                        break
                except (OSError, urllib.error.URLError):
                    pass
                time.sleep(.2)
            else:
                raise TimeoutError('Frozen host readiness timed out')
            yield port
        finally:
            process.terminate()
            process.wait(timeout=15)


def check_host(exe: Path, data: Path):
    with host(exe, data) as port:
        assert request(port)['answering']['stub'] is True
        answer = request(port, 'answering.ask', {'question': 'What is the annual occupational dose limit?'})
        assert answer['citations'], 'The packaged demo must return evidence citations'
        request(port, 'settings.update', {'general_knowledge': False})
        request(port, 'history.save', {'conversation_id': 'packaged-smoke', 'title': 'Packaged smoke', 'answer': answer})
        pdf = ROOT / 'ingestion/fixtures/normal/normal_nrc_reactor_concepts_ch01.pdf'
        review = request(port, 'library.review', {'files': [{'name': pdf.name, 'data': base64.b64encode(pdf.read_bytes()).decode()}]})
        assert len(review['accepted']) == 1 and not review['rejected'], review
        published = request(port, 'library.publish', {'review_id': review['review_id'], 'confirmed': True})
        versions = request(port, 'library.versions')
        assert versions['active'] == published['version_id'], versions
        answer = request(port, 'answering.ask', {'question': 'What is nuclear fission?'})
        assert answer['collection_version'] == published['version_id'], answer
    with host(exe, data) as port:
        assert request(port, 'settings.get')['general_knowledge'] is False
        assert request(port, 'history.open', {'conversation_id': 'packaged-smoke'})['conversation']['title'] == 'Packaged smoke'
        assert request(port, 'library.versions')['active'] == published['version_id']
    print('PASS frozen host: grounding, ingestion, publication, settings/history/collection persistence')


def check_desktop(exe: Path, data: Path):
    for port in (8764, 8765):
        if not port_free(port):
            raise RuntimeError(f'Close the development app first: port {port} is occupied')
    report = data / 'webview-report.json'
    process = subprocess.Popen([str(exe), '--smoke-test', '--smoke-report', str(report), '--data-dir', str(data)], cwd=data)
    try:
        code = process.wait(timeout=240)
        assert code == 0, f'Desktop exited {code}'
        assert report.exists() and json.loads(report.read_text())['passed'], 'Native webview smoke report missing or failed'
    finally:
        if process.poll() is None:
            process.terminate()
            process.wait(timeout=15)
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline and not all(port_free(p) for p in (8764, 8765)):
        time.sleep(.2)
    assert all(port_free(p) for p in (8764, 8765)), 'Desktop left a listener running'
    # Occupied services must cause failure, never attachment to an unknown host.
    with socket.socket() as occupied:
        occupied.bind(('127.0.0.1', 8765))
        occupied.listen()
        conflict = subprocess.run([str(exe), '--smoke-test', '--smoke-report', str(data / 'conflict.json'), '--data-dir', str(data)], timeout=30, cwd=data)
        assert conflict.returncode != 0, 'Desktop accepted an occupied service port'
    print('PASS native desktop: chat rendered, webview HTTP, workflow call, cleanup, port conflict')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--host', type=Path, default=PAYLOAD / 'host/docqa-service.exe')
    parser.add_argument('--desktop', type=Path)
    parser.add_argument('--installer', type=Path, help='Silently install and test a Windows NSIS preview, then uninstall it')
    parser.add_argument('--skip-host', action='store_true')
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix='docqa-packaged-') as tmp:
        data = Path(tmp)
        if not args.skip_host:
            check_host(args.host.resolve(), data)
        if args.desktop:
            desktop_data = data / 'desktop'
            desktop_data.mkdir()
            check_desktop(args.desktop.resolve(), desktop_data)
        if args.installer:
            install = data / 'installed'
            desktop_data = data / 'installed-data'
            desktop_data.mkdir()
            try:
                subprocess.run([str(args.installer.resolve()), '/S', f'/D={install}'], check=True, timeout=240)
                exe = install / 'secure-local-docqa.exe'
                assert exe.is_file(), 'Installer did not create the desktop executable'
                check_desktop(exe, desktop_data)
            finally:
                uninstall = install / 'uninstall.exe'
                if uninstall.exists():
                    subprocess.run([str(uninstall), '/S', f'_?={install}'], check=True, timeout=120)
            print('PASS Windows installer: silent install, installed app smoke, uninstall')


if __name__ == '__main__':
    main()
