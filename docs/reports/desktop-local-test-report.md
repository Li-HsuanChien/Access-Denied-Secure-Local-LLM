# Windows desktop preview: local verification

## First hosted integration run

The user authorized a push to `ci/desktop-packaging-validation`; remote `main`
was left unchanged. Run [40045844609](https://github.com/Li-HsuanChien/Access-Denied-Secure-Local-LLM/actions/runs/40045844609)
passed dependency setup, QA checking, 43 frontend tests, the backend suite (118
tests, optional real-model cases skipped), 12 release tests, asset downloads and
the real Python freeze. The frontend build then failed because
`src/lib/apis/models/index.ts` existed locally but was excluded by the root
`models/` ignore rule. The rule now targets the actual weight directories, and
the required upstream source module is included for clean checkouts.

Subsequent run [40046762577](https://github.com/Li-HsuanChien/Access-Denied-Secure-Local-LLM/actions/runs/40046762577)
passed completely on commit `f766bac`: 43 frontend tests, 118 backend tests with
seven optional cases skipped, 12 release tests and two native lifecycle tests.
Packaged Qwen generation, real MiniLM/PDF publication, an answer with one citation,
native chat rendering, workflow calls, port-conflict rejection and shutdown cleanup
all passed. The real-model artifact uploaded successfully and dependency/model
caches saved. The temporary validation-branch push trigger was then removed;
`main` was not changed.

Artifact: `windows-x64-real-f766bacc6a84030e079a88b7c0ea7c8ae84ddfde`,
ID `12541879001`, size 3,529,008,076 bytes. GitHub's archive SHA-256 is
`fd2abd95ecdf6d861770dcf837891debd0b0a6d9f53b1f61c4af1cbe49764c50`.

The artifact was downloaded and its complete ZIP SHA-256 matched GitHub's digest.
Extraction verified the expected clean source commit, real profile, executable
hash and payload-manifest hash. Local acceptance against the downloaded copy at
`app/release/dist/hosted-f766bac` also passed: real Qwen generation, real embeddings,
PDF publication, an answered question with one citation, native chat rendering,
workflow calls, port-conflict rejection and process cleanup. Temporary test data
was used. The retained ZIP is `app/release/build/hosted-f766bac.zip`.

## Follow-up lifecycle test stability

The user's fresh build exposed an intermittent readiness-test failure. Its mock
HTTP server read only once before replying and closing; a partial request could
leave unread bytes and reset the connection on Windows. The mock now consumes
complete headers, sets a read timeout and includes health errors in assertions.
Application readiness code is unchanged. Both lifecycle tests pass, and the
readiness case passed 100 consecutive runs (HTTP 200 and 503 on every run).

The user's freshly built native executable and real payload were assembled into
`app/release/dist/Secure-Local-DocQA` without repeating the freeze. Follow-up native
acceptance stopped before launching: existing development host/runtime processes
occupied loopback ports 8765 and 8080. They were left running pending user approval.
The earlier successful acceptance run below is separate from this follow-up.

## Source-to-package pipeline verification, 2026-10-23

The shared packaging entry point completed successfully using the prepared local
Python/npm environment and checksum-verified offline asset cache. Project checks
ran first with `package.ps1 -SkipSetup -Python ./venv/Scripts/python.exe -ChecksOnly`.
The subsequent full build used `-OfflineAssets -SkipChecks -Output
app/release/dist/ci-validation`; only the already-passed checks were skipped.
The workflow definition passes neither check nor native-test skip flags.

| Check | Result |
| --- | --- |
| Strict QA feature check | Zero owned errors; 213 imported upstream diagnostics reported outside the feature gate |
| Gate failure behavior | Deliberate feature type error correctly failed the gate; temporary probe removed |
| Frontend feature tests | 36 passed, including current Library preview tests |
| Backend workflow/host suite | 110 run, one skipped, no failures |
| Release assembly/assets | 12 passed |
| Rust format/lifecycle | Format passed; two lifecycle tests passed |
| Pinned assets | Online preparation succeeded; full build reverified/reused the offline cache |
| Fresh source build | Python freeze, static frontend, release Tauri executable and portable assembly passed |
| Real model | Bundled Qwen3 4B Instruct 2507 generated text through llama.cpp |
| Real document workflow | Frozen MiniLM published the NRC fixture; answer status answered, one citation |
| Native window | Chat rendering, webview HTTP, workflow call, shutdown cleanup and port-conflict rejection passed |
| Workflow syntax | actionlint passed |

The resulting executable is
`app/release/dist/ci-validation/secure-local-docqa.exe`; keep its complete folder.
Its payload profile is real, with pinned GGUF/embedding/runtime assets and a
development provenance record. The previously user-tested package under
`app/release/dist/Secure-Local-DocQA/` was preserved. Acceptance ran with temporary
application data.

At this earlier local verification, no commit, push or hosted GitHub Actions run
had occurred. Hosted dependency setup and artifact upload were pending; the
subsequent hosted results are recorded above.
This functional Windows test does not establish production signing, isolated-VM
network qualification, reference-hardware performance or macOS/Linux compatibility.
See [ADR 0008](../architecture/decisions/0008-real-model-push-packaging.md).

## Earlier manual preview verification

Date: 2026-10-22. Profiles: real local model and deterministic CI demo. Version: 0.1.0.

The Tauri executable embeds the production static frontend and starts the frozen
Python payload. Node, Vite and a source Python interpreter are not started by it.

Completed local checks:

| Check | Result |
| --- | --- |
| Frontend type check | Passed: zero errors/warnings |
| Frontend feature tests | 34 passed |
| Backend workflow/host suite | 110 run, one skipped, no failures |
| Release input validation | Three passed |
| Native lifecycle tests | Two passed |
| Frozen host acceptance | Grounding, PDF ingestion, publication and persisted collection/history/settings passed |
| Native webview acceptance | Chat rendered; webview health/workflow calls, shutdown cleanup and occupied-port rejection passed |
| GitHub Actions static validation | actionlint passed |
| Packaged real-model generation | Qwen3 4B Instruct 2507 generated text through bundled llama.cpp; stub=false |
| Real embeddings and PDF workflow | MiniLM published the NRC fixture PDF; real-model QA returned answered with one citation |
| Real-model native webview | Chat rendered; workflow calls, shutdown cleanup and port-conflict rejection passed |

Native smoke used the actual release executable, with temporary application data.
The real-model application is
`app/release/dist/Secure-Local-DocQA/secure-local-docqa.exe`; keep that complete
folder together. At the time of this earlier run, the executable under
`app/desktop/src-tauri/target/release` and the NSIS installer were demo artifacts.
The source-to-package run above rebuilt the native target. User testing should use the assembled real-model
folder. Its gateway loaded the bundled GGUF in approximately 12 seconds in this
local run; this is a functional startup observation, not reference-hardware qualification.

Installer-based acceptance remains pending user testing. The CI workflow is a local
draft: no hosted workflow was run, and nothing was committed or pushed. The user
requested manual desktop testing before any push.

Packaging fixes found by these checks: the freezer explicitly collects the current
Microsoft runtime rather than an older copy found in Java's PATH directory; the
existing publisher reserves its job before PDF review, restoring its concurrency
test. See [ADR 0007](../architecture/decisions/0007-desktop-build-and-ci.md).

This run establishes functional real-model packaging on this Windows machine.
Cross-platform installers, reference-hardware response/memory performance, release
signatures and network-isolation qualification remain as specified in the SDD.
