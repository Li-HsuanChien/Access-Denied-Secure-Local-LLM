"""Run unchanged capture and retain complete failed staging evidence; never retries."""
import hashlib, json, os, pathlib, shutil, subprocess, sys, tempfile, time
repo = pathlib.Path(os.environ.get('PARITY_REPO_ROOT', str(pathlib.Path.cwd())))
origin, output, evidence = sys.argv[1:]
evidence = pathlib.Path(evidence)
evidence.mkdir(parents=True, exist_ok=False)
harness = repo / 'app/document-qa/frontend/migration-parity/capture.mjs'
original = repo / 'app/document-qa/frontend/migration-parity/original/capture-index.json'
tmp = pathlib.Path(tempfile.gettempdir())
before = {p.resolve() for p in tmp.glob('docqa-parity-capture-*')}
manifest = {'origin': origin, 'output': output, 'started': time.time(), 'harness_sha256': hashlib.sha256(harness.read_bytes()).hexdigest(), 'original_index_sha256': hashlib.sha256(original.read_bytes()).hexdigest(), 'harness_unchanged': True, 'automatic_retries': 0}
(evidence / 'run.json').write_text(json.dumps(manifest, indent=2) + '\n')
env = dict(os.environ, BASELINE_ORIGIN=origin, BASELINE_OUTPUT_ROOT=output)
print('Starting unchanged capture; evidence ' + str(evidence), flush=True)
with (evidence / 'capture.log').open('w') as log:
    process = subprocess.Popen(['node', str(harness)], cwd=repo, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    for line in process.stdout:
        log.write(line)
        log.flush()
        print(line, end='', flush=True)
    status = process.wait()
new = sorted({p.resolve() for p in tmp.glob('docqa-parity-capture-*')} - before)
manifest.update(exit_code=status, ended=time.time(), staging_paths=[str(p) for p in new], capture_gate='PASS' if status == 0 else 'FAIL')
for i, staging in enumerate(new):
    shutil.copytree(staging, evidence / ('staging-' + str(i)))
manifest['retained_screenshots'] = {str(p.relative_to(evidence)): hashlib.sha256(p.read_bytes()).hexdigest() for p in evidence.glob('staging-*/screenshots/*.png')}
(evidence / 'run.json').write_text(json.dumps(manifest, indent=2) + '\n')
print(json.dumps({'exit_code': status, 'capture_gate': manifest['capture_gate'], 'staging_paths': manifest['staging_paths'], 'retained_png_count': len(manifest['retained_screenshots'])}), flush=True)
sys.exit(status)
