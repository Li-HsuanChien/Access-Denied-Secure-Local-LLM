"""Exercise the packaged real model and embeddings, then the native webview.

Uses only public fixture PDFs and isolated data. No downloads or developer Python
services are started: both host and gateway are the frozen payload executable.
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

from smoke import ROOT, request, check_desktop, port_free


def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


@contextlib.contextmanager
def service(exe, args, data, ready):
    data.mkdir(parents=True, exist_ok=True)
    log_path = data / 'acceptance-service.log'
    with log_path.open('ab') as log:
        process = subprocess.Popen([str(exe), *args], cwd=data,
            env={**os.environ, 'SECURE_QA_DATA_DIR': str(data)}, stdout=log, stderr=log)
        try:
            deadline = time.monotonic() + 240
            while time.monotonic() < deadline:
                if process.poll() is not None:
                    raise RuntimeError(f'Packaged service exited {process.returncode}: {log_path.read_text(errors="replace")[-6000:]}')
                try:
                    if ready():
                        break
                except (OSError, urllib.error.URLError):
                    pass
                time.sleep(.25)
            else:
                raise TimeoutError(f'Packaged real service startup timed out: {log_path.read_text(errors="replace")[-6000:]}')
            yield
        finally:
            process.terminate()
            process.wait(timeout=20)


def completion(port):
    body = {'model': 'local', 'messages': [{'role': 'user', 'content': 'Reply with the single word READY.'}],
            'max_tokens': 8, 'temperature': 0, 'stream': False}
    req = urllib.request.Request(f'http://127.0.0.1:{port}/v1/chat/completions',
        data=json.dumps(body).encode(), headers={'Content-Type': 'application/json'})
    with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(req, timeout=120) as response:
        return json.load(response)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--app', type=Path, default=ROOT / 'app/release/dist/Secure-Local-DocQA')
    args = parser.parse_args()
    app = args.app.resolve()
    payload = app / 'payload'
    exe = payload / 'host/docqa-service.exe'
    runtime = payload / 'runtime'
    assert json.loads((payload / 'profile.json').read_text())['mode'] == 'real'
    for port in (8764, 8765, 8080):
        if not port_free(port):
            raise RuntimeError(f'Close the running preview before acceptance: port {port} is occupied')
    with tempfile.TemporaryDirectory(prefix='docqa-real-') as tmp:
        data = Path(tmp)
        gateway, host = free_port(), free_port()
        runtime_args = ['runtime', 'up', '--config', str(runtime / 'runtime.toml'),
            '--server-bin', str(runtime / 'bin/llama-server.exe'), '--models-dir', str(runtime / 'models'),
            '--host', '127.0.0.1', '--port', str(gateway)]
        with service(exe, runtime_args, data / 'runtime', lambda: request(gateway, origin=None)['ready']):
            health = request(gateway, origin=None)
            assert health['engine']['stub'] is False, health
            assert 'qwen' in health['model']['name'].lower(), health
            result = completion(gateway)
            assert result['choices'][0]['message']['content'].strip(), result
            print(f'PASS packaged real llama.cpp generation: {health["model"]["name"]}', flush=True)
            host_args = ['host', '--port', str(host), '--runtime', f'http://127.0.0.1:{gateway}',
                         '--embedding-model', str(runtime / 'embedding')]
            with service(exe, host_args, data, lambda: request(host)['answering']['ready']):
                assert request(host)['answering']['stub'] is False
                pdf = ROOT / 'ingestion/fixtures/normal/normal_nrc_reactor_concepts_ch01.pdf'
                review = request(host, 'library.review', {'files': [{'name': pdf.name, 'data': base64.b64encode(pdf.read_bytes()).decode()}]})
                assert review['accepted'] and not review['rejected'], review
                published = request(host, 'library.publish', {'review_id': review['review_id'], 'confirmed': True})
                health = request(host)
                assert health['ready'] and not health['library']['embedding_model'].startswith('fake'), health
                print(f'PASS frozen real embeddings and PDF publication: {published["version_id"]}', flush=True)
                answer = request(host, 'answering.ask', {'question': 'What is the purpose of a nuclear power plant?',
                    'general_knowledge': False}, timeout=180)
                assert answer['model']['stub'] is False and answer['status'] != 'failed', answer
                assert answer['collection_version'] == published['version_id'], answer
                assert answer['status'] == 'answered' and answer['citations'], answer
                print(f'PASS packaged question-answer workflow: status={answer["status"]}, citations={len(answer["citations"])}', flush=True)
        check_desktop(app / 'secure-local-docqa.exe', data)
        assert all(port_free(port) for port in (8764, 8765, 8080)), 'A real service listener survived shutdown'
    print('PASS real native application: model, embeddings, PDF library, webview and process cleanup', flush=True)


if __name__ == '__main__':
    main()
