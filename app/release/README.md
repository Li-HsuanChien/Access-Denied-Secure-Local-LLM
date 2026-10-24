# Source to real-model desktop package

From the repository root on a connected Windows x64 build machine:

```powershell
./app/release/package.ps1
```

Build prerequisites are Python 3.11, Node 22, Rust stable with rustfmt, Visual Studio
C++ build tools and the current Microsoft VC++ x64 redistributable. The script
creates `app/release/build/package-venv`, installs dependencies with the frontend
lockfiles and Python requirement pins, and runs the same pipeline used by CI.

The pipeline checks the project, obtains checksum-verified model/runtime assets,
freezes Python, builds the static frontend and current Tauri executable, assembles
the real-model folder, and tests model generation, real embeddings, PDF ingestion,
a cited answer, the native chat and process cleanup. Close the running app first.
A failed step stops the command and prevents CI from uploading a successful package.

Open `app/release/dist/Secure-Local-DocQA/secure-local-docqa.exe`. Keep the complete
folder together. It contains Qwen3-4B Q4_K_M, MiniLM, llama.cpp and the Python
runtime; the installed app does not download weights or require Node/Python.
Import PDFs through Library before asking document questions.

## Rebuilds and local options

Once an existing Python environment and npm dependencies are prepared:

```powershell
./app/release/package.ps1 -SkipSetup -Python ./venv/Scripts/python.exe
```

Optional flags:

- `-OfflineAssets`: require verified cached assets; refuse missing/corrupt assets.
  Combine with `-SkipSetup` on a prepared machine to avoid dependency installation.
- `-Output app/release/dist/my-test-build`: use a different generated output folder.
- `-Zip`: also create a ZIP64 archive and SHA-256 file for local sharing.
- `-ChecksOnly`: run project checks without asset preparation or packaging.
- `-SkipChecks` / `-SkipNativeTest`: local iteration only; CI passes neither flag.

Outputs must stay under `app/release/dist/`. Assembly refuses to replace an app
running from the output folder. Application collections/history live separately in
the user's application-data folder and are not copied into packages.

## What happens on a push

[desktop.yml](../../.github/workflows/desktop.yml) defines **Package desktop**:

| Trigger | Result |
| --- | --- |
| Push to `main` | Check, build and test the real-model Windows package |
| Push a version tag (`v*`, for example `v0.1.0`) | Same tested package pipeline |
| Manual Run workflow | Same package pipeline for the selected revision |
| Pull request | Project checks without large model downloads or packaging |

Source checks must pass before packaging starts. Packaged real-model/native
acceptance must also pass before the artifact is uploaded. Other branch pushes
do not trigger packaging; open a PR for checks or use manual dispatch for a build.
A local commit alone does not start GitHub Actions. Version tags currently create
downloadable workflow artifacts, with release publication left as a separate step.

After the workflow file is committed and pushed, open the successful run under
**Actions -> Package desktop** and download `windows-x64-real-<commit>` from
Artifacts. Extract it and open `secure-local-docqa.exe` beside `payload/`.
Artifacts are retained for seven days. Dependencies and public model assets are
cached; asset checksums are verified even when a cache is restored.

No custom secrets are needed: model sources are public and the workflow uses
read-only repository permissions. There is no automatic release publication,
deployment or installed-app updater. Defining this trigger does not push local
changes; hosted CI cannot be claimed tested until a real run completes.

## Asset pins and output provenance

`assets.lock.json` pins the GGUF, llama.cpp CPU archive and complete MiniLM snapshot
to immutable revisions and SHA-256 digests. `assets.py` downloads only on the build
machine. Matching locally staged GGUF weights can seed the cache. A mismatch fails
instead of substituting a test model. Model upgrades require reviewing the lock
and `runtime.toml` together.

Each package contains `provenance.json` with source revision, dirty-tree state,
version, profile and executable/payload/asset-lock hashes. It also retains the
payload checksum manifest, asset lock and Open WebUI notices.

These are development packages. Provenance/checksums are not signatures or a
replacement for the trusted production pre-install verifier. Production signing,
offline VM qualification, reference-hardware performance and macOS/Linux packaging
remain separate SDD requirements. Large real-model assets are delivered as a
folder/archive rather than a single NSIS executable.

## Maintainer tools

`build.py --profile real --assets <directory>` only freezes/stages an already
prepared payload. `local_model.py` is the legacy helper for already-staged repository
assets and an existing native binary; the complete source build uses `package.ps1`.
An explicit `build.py --profile demo` remains available for deterministic adapter
tests. `assemble.py` refuses to emit a user package from that demo profile.

See [ADR 0008](../../docs/architecture/decisions/0008-real-model-push-packaging.md)
for the workflow decision and the SDD for production release gates.
