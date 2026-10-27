# One-folder payload: native libraries remain adjacent to the frozen interpreter.
import os
import sys
from pathlib import Path
from PyInstaller.utils.hooks import collect_all, collect_submodules

root = Path(SPECPATH).resolve().parents[1]
backend = root / 'app/document-qa/backend'
runtime = backend / 'secure_qa/answering/llama_cpp/src'
real = os.environ.get('DOCQA_BUILD_PROFILE') == 'real'
datas, binaries, hidden = [], [], ['dev_host', 'ingestion.src.ingest', 'ingestion.src.schema']
def runtime_module(name):
    # all-MiniLM-L6-v2 resolves BERT lazily. Include its architecture and shared
    # code without importing hundreds of unrelated model architectures.
    if name.startswith('transformers.models.'):
        return name.split('.')[2] in {'auto', 'bert'}
    return not name.startswith(('chromadb.test', 'chromadb.server', 'onnxruntime.tools',
                               'onnxruntime.transformers', 'onnxruntime.quantization'))

for package in ['chromadb', 'tokenizers', 'onnxruntime', 'docqa_runtime'] + (['sentence_transformers', 'transformers'] if real else []):
    data, binary, imports = collect_all(package, filter_submodules=runtime_module)
    datas += data
    binaries += binary
    hidden += imports
datas += [(str(backend / 'secure_qa/library/tests/fixtures/e2'), 'secure_qa/library/tests/fixtures/e2')]
hidden += collect_submodules('ingestion.src')
hidden += collect_submodules('chromadb', filter=runtime_module)
# Explicitly collect the installed MSVC runtime. Dependency scanning can otherwise
# choose an older Java/third-party copy on PATH which imports but crashes Chroma.
if sys.platform == 'win32':
    system = Path(os.environ['SystemRoot']) / 'System32'
    for name in ('msvcp140.dll', 'msvcp140_1.dll', 'msvcp140_2.dll', 'vcruntime140.dll', 'vcruntime140_1.dll'):
        if not (system / name).is_file():
            raise RuntimeError('Install the current Microsoft VC++ x64 redistributable on the build machine')
        binaries.append((str(system / name), '.'))
a = Analysis([str(backend / 'desktop_entry.py')], pathex=[str(root), str(backend), str(runtime)],
    datas=datas, binaries=binaries, hiddenimports=hidden,
    excludes=['tkinter', 'IPython', 'matplotlib'] + ([] if real else ['sentence_transformers', 'torch', 'transformers', 'sklearn', 'scipy']),
    noarchive=False)
# Supported Windows versions provide UCRT. Never shadow it with an old copy
# discovered in a third-party program directory.
if sys.platform == 'win32':
    a.binaries = [entry for entry in a.binaries if Path(entry[0]).name.lower() != 'ucrtbase.dll'
                  and not Path(entry[0]).name.lower().startswith('api-ms-win-')]
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name='docqa-service', console=True, upx=False)
coll = COLLECT(exe, a.binaries, a.datas, strip=False, upx=False, name='host')
