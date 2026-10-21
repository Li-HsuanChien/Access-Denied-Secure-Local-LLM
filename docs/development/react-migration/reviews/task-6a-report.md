# Stage 6A frontend graph cutover

Status: **frontend cleanup, final install, strict check, unified tests, opt-in host checks and static build complete**. Source/config/manifest graph released to primary for independent production/offline/visual recapture. This report does not declare final parity or packaged/offline release acceptance.

Read the concrete task-6-removal-spec.md (superseding the draft), cleanup-before.json and applicable root/app/document-QA/frontend AGENTS. Stage5A/5B accepted before dispatch. Work stayed in the existing shared checkout under explicit primary ownership; no commits, staging, push or subagents. No server was started/stopped by6A, and no user listener5174/8765/8080 or data was touched. Only explicit disposable8766 integration checks contacted a host.

## Exact removal and preservation

`task-6a-removal-manifest.json` records all **4,594 removed files**, per-file reason/bytes/SHA256 and all26 ignored backup verifications. Only tracked obsolete files, the26 explicitly authorized ignored old upstream files and three explicitly superseded transition configs were removed. Directories were removed only when empty; unrelated untracked files were preserved.

Before removing any ignored file, verified **both current source and recoverable backup** against each expected hash in `/private/tmp/react-migration-preserved-ignored-upstream/manifest.json`:26/26 match. Copies remain at that backup path. These include25 Svelte files under nested Models folders and the ignored old models API adapter.

Removed all old routes and627 Svelte files (602 tracked+25 ignored), obsolete upstream APIs/components/constants/stores/utils/types/workers/Pyodide, old Svelte app declarations/template, unused original i18n entry/picker metadata, old answering view test/OpenWebUI adapter+test/settings store, Pyodide preparation script/parser config, Svelte config and QA tsconfig. Removed transition vite.react/tsconfig.react/vitest.react configs only after promoting their active behavior to canonical config.

Preserved all React features/providers/contracts/tests, retained workflow clients/fixtures/schema seam, bundled localization bridge and **64 locale translation catalogs**, semantic settings translation helper, full migration-parity evidence and notices. Verified accepted capture-index hash and **all95 original PNG hashes** after cleanup.

Preserved src/app.css, src/tailwind.css and personality.css **byte-identical to HEAD**; checksums and comparison results are in `task-6a-counts.json`. All three LICENSE, LICENSE_HISTORY and LICENSE_NOTICE hashes match cleanup-before.json exactly. Markdown docs/notices are6B-owned and can change separately without changing these license hashes.

Static retained files: Inter-Variable.ttf,Vazirmatn-Variable.ttf,/favicon.png,/static/favicon.png,robots.txt and four existing Markdown asset/provenance notes. Unused static files removed: **3,865 /12,346,429 bytes**. No unrelated static untracked file existed before removal. KaTeX package fonts remain Vite-built assets.

## Counts

| Measure | Before | After |
| --- | --- | --- |
| Actual src files, including migration additions | 894 | 172 |
| Actual Svelte source | 627 | 0 |
| Tracked Svelte source | 602 | 0 remaining |
| Static files | 3,874 | 9 |
| Static bytes | 13,437,738 | 1,091,009 at final inventory |
| Locked package entries, including root/platform optionals | 1,375 | 587 |
| Direct runtime dependencies | 105 | 26 |
| Direct dev dependencies | 35 | 18 |

The retained Markdown asset notes were concurrently updated by6B; therefore final static bytes differ slightly from before-minus-removed. Exact removed bytes are measured at deletion and independently recorded. Remaining source includes49.ts/43.tsx files. Counts, retained assets, all notice/CSS hashes, package/lock hashes and build file/byte totals: `task-6a-counts.json`.

## Canonical graph/configuration

`package.json`: private access-denied-document-qa,v0.11.4 retained provenance-era version; Node>=20<=22.x/npm>=10. Every direct dependency is pinned to the exact reviewed existing lock version;26 runtime/18 dev pins match the concrete specification. No version update/audit-fix command. Runtime includes React/nativeFloatingUI, CodeMirror, safe renderers and local i18next catalogs; removes Svelte/SvelteKit, old adapters, transformers/Pyodide, Tiptap and other unused upstream direct dependency closure.

Canonical vite.config.ts keeps rootreact/public../static, outputs../build, uses React aliases/plugin, loopback127.0.0.1,strict dev5173,sourcemaps and **cssMinify:false**. PostCSS keeps **optimize:false**. Tailwind scans remaining src and react HTML/JS/TS/JSX/TSX; stylesheet declarations are untouched.

Canonical tsconfig.json strictly includes **all src TS/TSX**, React entry TS/TSX, JSON resolution/noEmit/aliases and Vite+Node declarations. No retained production client is excluded; no retained-source strict error or behavior fix was necessary.

Canonical vitest.config.ts merges canonical Vite aliases/plugin and discovers all retained feature JS/TS/TSX plus src/react tests; host integration suites excluded from default. Host config imports canonical Vite config, uses node environment, retains explicit8766 opt-in. Both test configurations set hmr:false and ws:false: initial tests passed but Vite5's unused middleware WebSocket attempted0.0.0.0:24678 despite hmr:false and emitted sandboxEPERM; disabling ws eliminates that unused listener. Final clean unified run emitted no such warning.

Commands: dev/dev:qa loopback5173strict; build canonicalvitebuild; previewloopback; checktsc; test:frontend unified; test:host explicit opt-in. Transitional :react commands remain aliases; dev:react keeps explicit5176 override for harness compatibility. Useful build:watch/check:watch/format remain on retained tools. Removed broken upstream lint/Python/Cypress/i18n/Pyodide commands.

## Install and verification results

Environment: Node22.17.1/npm11.7.0. Main graph lock regenerated **offline**, then actual `npm ci --offline --no-audit --no-fund`: **pass**,484 packages installed in6s. Only warning: existing transitive whatwg-encoding3.1.1 deprecation. No audit-fix or version upgrade.

| Check | Result |
| --- | --- |
| `npm ls --all --json` | exit0,no problems; `/private/tmp/react-stage6a-npm-ls.json` |
| Lock/source forbidden graph scan | no Svelte/SvelteKit/Pyodide/Tiptap/Pyscript/ONNX/transformers lock entries; no source.svelte remains |
| `npm run check` | pass,exit0; repeated after final config correction |
| `npm run test:frontend` | **160/160 pass,28 files**, final clean run20:12:28,duration4.50s |
| `SECURE_QA_TEST_HOST_URL=http://127.0.0.1:8766 npm run test:host` | **2/2 pass**, final run20:13:30; no user8765 fallback |
| `npm run build` | pass,24.15s,2,907 modules transformed |
| Accepted original hash verification | capture index+95/95 original PNG hashes match |

Build output: **554 files /45,208,321 bytes**, including source maps, lazy locale/rendering chunks and local fonts. Only build advisory: some chunks exceed500kB after minification (largest main chunk about1.44MB, with retained Mermaid/Vega/CodeMirror closure). No unresolved import, asset-copy or compile warning. No unsolicited code-splitting/version change was made during parity cleanup.

Primary separately performed actual launcher-driven fresh and legacy-cache installs after final package/lock handoff. Read their concrete results:

- `/private/tmp/react-migration-fresh-install/app/document-qa/frontend/migration-install-result.json`: actual npmci passed; npm ls--all passed/noSvelte; exact-receipt second call did not reinstall.
- `/private/tmp/react-migration-legacy-upgrade/migration-install-result.json`: genuine prior installed Svelte graph preserved by APFSclone, `legacy_svelte_present_before:true`; actual npmci passed; npm ls--all passed/noSvelte; exact-receipt second call did not reinstall. Prior graph hashes in legacy-before.json.
- Both receipt fingerprints: `bc3279581f3a75c155e45069b48b1f71082b8df1d95f201cc30f85ea94046e06`.

These are independent fresh/legacy install proofs, not a claim inferred from main node_modules reinstall. Primary owns fresh source sync/build and post-cleanup capture;6B owns receipt implementation/tests and Markdown documentation. Final package hash `6a91301f69a57ad0a9d963bc9b510a0b7e49370f8c4d7de7c02c7ebb85871716`; lock `9316d0db5f5af6b7f40f38d87fe7fd6e2903b6a8c5b50f0b3956bcafc773d3e2` remained unchanged through handoff.

## Remaining acceptance work

Primary notified final installed/build graph is ready and no further frontend writes are planned. Tailwind pruning can alter generated CSS even with unchanged declarations; final direct-route, network/offline and screenshot evidence must come from the **canonical post-cleanup production build**. Those checks and final reviewer acceptance remain primary-owned. No claim of full post-cleanup parity, packaged Tauri release, real-model quality or reference-hardware performance is made here.

## Final log handoff

At primary's request, saved clean final command logs without further frontend changes:

- `/private/tmp/react-stage6a-check.log`: check exit0.
- `/private/tmp/react-stage6a-tests.log`:160/160,28 files,20:15:11,9.23s,exit0.
- `/private/tmp/react-stage6a-host.log`:2/2,20:15:13,exit0,explicit8766 only.
- `/private/tmp/react-stage6a-npm-ls.json`: installed full dependency tree,exit0/no problems.

Primary's independent fresh source strict/build passed; `/private/tmp/react-stage6-fresh-build.log` ends success17.41s with only large-chunk advisory. Main and fresh production CSS are byte-identical: `index-D7qluYef.css`,269,290bytes,SHA256`5b1f50f0da696da79e2dabee4e4111dd1b8d0d1bdc6b95d3d5efdbd3165130fe`. Primary reports finalproduction fixture11 and disposable8766 four-workflow checks passing with noerrors/blocked requests; independent final visual review remains primary-owned.

No further source/config/manifest/static writes are planned. Source released for post-cleanup review.
