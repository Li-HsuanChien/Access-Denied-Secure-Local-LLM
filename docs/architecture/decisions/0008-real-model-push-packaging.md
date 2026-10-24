# ADR 0008: Real-model source-to-package command and push builds

Status: approved by the request to script packaging and run it on push, 2026-10-22.

This supersedes ADR 0007's demo-only CI workflow. The installed application's
offline behavior and production release qualification requirements are unchanged.

`app/release/package.ps1` sets up an isolated build environment, installs the
frontend lockfiles and pinned Python build/runtime requirements, and calls
`package.py`. The Python command checks the project, prepares model assets, freezes
the real Python payload, builds the native executable from current source with
`tauri build --no-bundle`, assembles a portable app folder, and runs real-model and
native-window acceptance. It never reuses a stale desktop executable as a shortcut.

`assets.lock.json` pins Qwen's GGUF, the CPU llama.cpp archive and every required
MiniLM snapshot file to exact revisions and SHA-256 digests. `assets.py` is a
connected staging-machine tool, not installed application code. It re-verifies
cache entries, rejects incomplete/corrupt downloads and unsafe archive entries,
and performs no download in offline-assets mode. Runtime configuration must select
the same model as the lock. Cached public assets are separate from user data.

The real-model folder contains the native executable, Python payload, llama.cpp,
answering weights, embedding weights and notices. Large weights stay outside a
single NSIS executable. An optional ZIP64 archive supports local sharing. Assembly
rejects a demo profile and refuses to overwrite a running output app. Source commit,
dirty-tree status, version and executable/payload/asset-lock hashes accompany it.
These development provenance records are not production signatures.

GitHub Actions runs the same PowerShell command on pushes to `main`, version tags
matching `v*`, and manual dispatch, then uploads the tested real-model folder as a
seven-day artifact. Source checks must pass before the build; packaged acceptance
must pass before upload. Other branch pushes do not package. PRs run project
checks without fetching large model assets or assembling a package. Dependency and
asset caches reduce repeat work. Jobs have read-only repository permissions; there
is no release publication, deployment, auto-update or signing-key requirement.

Production signing, trusted pre-install verification, network-isolated acceptance,
cross-platform qualification and reference-hardware performance remain SDD gates.
The user authorized an initial hosted integration test on a separate branch.
`ci/desktop-packaging-validation` temporarily had an explicit push trigger because
the workflow was not yet on the default branch. Hosted run 40046762577 passed on
commit f766bac, including package acceptance and artifact upload; the temporary
trigger was then removed. Remote `main` was not modified as part of this test.

Frontend validation retains strict checking of the QA features, their global types
and configuration. The checker reports but excludes diagnostics originating inside
imported upstream Open WebUI components, utilities, stores, APIs and constants from this
feature gate. Svelte-check traverses those sources despite the QA tsconfig include
list; importing the PDF preview otherwise expands the gate to unrelated upstream
code. Diagnostics in owned features (including their use of imported interfaces)
still fail packaging. Checker startup/configuration failures also fail closed.
